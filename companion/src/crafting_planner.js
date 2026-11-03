'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { Vec3 } = require('vec3')
const mcDataFactory = require('minecraft-data')

/**
 * Persists craft journal to disk atomically with fsync and cryptographic checksum.
 */
function writeDurableCraftJournal(journalPath, journalData) {
  if (!journalPath) return
  const dir = path.dirname(journalPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const payloadString = JSON.stringify(journalData)
  const sha256 = crypto.createHash('sha256').update(payloadString).digest('hex')
  const envelope = {
    format: 'guiaia_durable_craft_journal_v1',
    schemaVersion: 1,
    sha256,
    writtenAt: Date.now(),
    payload: journalData
  }

  const envelopeJson = JSON.stringify(envelope, null, 2)
  const tempPath = `${journalPath}.${process.pid}.${Date.now()}.tmp`
  const fd = fs.openSync(tempPath, 'w')
  try {
    fs.writeSync(fd, envelopeJson, 0, 'utf8')
    fs.fsyncSync(fd) // Flush OS buffers to physical storage media
  } finally {
    fs.closeSync(fd)
  }

  if (fs.existsSync(journalPath)) {
    try {
      fs.copyFileSync(journalPath, `${journalPath}.bak`)
    } catch {}
  }

  fs.renameSync(tempPath, journalPath)

  // Directory metadata sync (POSIX & Windows supported)
  try {
    const dirFd = fs.openSync(dir, 'r')
    try {
      fs.fsyncSync(dirFd)
    } finally {
      fs.closeSync(dirFd)
    }
  } catch {}
}

/**
 * Recovers craft journal from disk, verifying cryptographic checksum envelope.
 * Falls back to valid .bak file if primary was corrupted by torn writes.
 * Enforces rollback prevention: rejects journals that regress behind high-water sequence marks.
 */
function recoverCraftJournal(journalPath, options = {}) {
  if (!journalPath || !fs.existsSync(journalPath)) {
    return { ok: false, reason: 'journal_not_found' }
  }

  function readAndValidate(targetPath) {
    try {
      const content = fs.readFileSync(targetPath, 'utf8')
      const parsed = JSON.parse(content)

      if (parsed && parsed.format === 'guiaia_durable_craft_journal_v1') {
        const computedSha256 = crypto.createHash('sha256').update(JSON.stringify(parsed.payload)).digest('hex')
        if (computedSha256 !== parsed.sha256) {
          return { ok: false, reason: 'checksum_mismatch', error: 'Craft journal checksum mismatch' }
        }
        return { ok: true, journal: parsed.payload, verifiedChecksum: true }
      }

      // Legacy format backwards compatibility
      if (parsed && typeof parsed === 'object' && parsed.missionId) {
        return { ok: true, journal: parsed, verifiedChecksum: false }
      }

      return { ok: false, reason: 'corrupt_journal' }
    } catch (err) {
      return { ok: false, reason: 'unreadable_journal', error: err.message }
    }
  }

  function checkRollback(recovered) {
    if (!recovered.ok || !recovered.journal) return recovered
    const journal = recovered.journal

    if (options.highWaterSequence !== undefined && journal.sequence !== undefined) {
      if (journal.sequence < options.highWaterSequence) {
        return {
          ok: false,
          reason: 'ROLLBACK_DETECTED',
          message: `Restored journal sequence ${journal.sequence} is lower than known high-water mark ${options.highWaterSequence}; rollback rejected`
        }
      }
    }

    if (options.highWaterStep !== undefined && journal.completedSteps !== undefined) {
      if (journal.completedSteps < options.highWaterStep) {
        return {
          ok: false,
          reason: 'ROLLBACK_DETECTED',
          message: `Restored journal completedSteps ${journal.completedSteps} is lower than known high-water step ${options.highWaterStep}; rollback rejected`
        }
      }
    }

    if (journal.highestWitnessedSequence !== undefined && journal.sequence !== undefined) {
      if (journal.sequence < journal.highestWitnessedSequence) {
        return {
          ok: false,
          reason: 'ROLLBACK_DETECTED',
          message: `Journal sequence ${journal.sequence} regressed behind witnessed high-water mark ${journal.highestWitnessedSequence}; rollback rejected`
        }
      }
    }

    return recovered
  }

  const primary = readAndValidate(journalPath)
  if (primary.ok) return checkRollback(primary)

  const backupPath = `${journalPath}.bak`
  if (fs.existsSync(backupPath)) {
    const backupRes = readAndValidate(backupPath)
    if (backupRes.ok) {
      backupRes.recoveredFromBackup = true
      return checkRollback(backupRes)
    }
  }

  return primary
}

/**
 * Reconciles an interrupted crafting mission journal against inventory state.
 * If left in_progress, transitions safely to needs_review.
 */
function reconcileCraftJournal(journalPath, options = {}) {
  const recovered = recoverCraftJournal(journalPath, options)
  if (!recovered.ok) {
    return { ok: false, reason: recovered.reason, error: recovered.error }
  }

  const journal = recovered.journal
  const inventory = options.inventory || options.bot?.inventory
  const discrepancies = []

  if (inventory && Array.isArray(journal.receipts)) {
    for (const receipt of journal.receipts) {
      const currentCount = countInventoryItem(inventory, receipt.target_item, options.mcData)
      if (currentCount < receipt.delta) {
        discrepancies.push({
          target_item: receipt.target_item,
          expectedMin: receipt.delta,
          found: currentCount
        })
      }
    }
  }

  if (journal.status === 'in_progress') {
    journal.status = 'needs_review'
    journal.interruptedReason = 'process_terminated_in_flight'
    journal.reconciledAt = Date.now()
    journal.discrepancies = discrepancies
    writeDurableCraftJournal(journalPath, journal)
    return {
      ok: true,
      reconciled: true,
      action: 'quarantine_for_review',
      status: 'needs_review',
      discrepanciesCount: discrepancies.length,
      discrepancies,
      journal
    }
  }

  return {
    ok: true,
    reconciled: false,
    status: journal.status,
    discrepanciesCount: discrepancies.length,
    discrepancies,
    journal
  }
}

const STATION_MAP = Object.freeze({
  player: 'player_inventory',
  crafting_table: 'crafting_table'
})

function getStationType(recipe) {
  if (!recipe) return 'player_inventory'
  if (recipe.inShape) {
    const height = recipe.inShape.length
    const width = Math.max(...recipe.inShape.map(row => Array.isArray(row) ? row.length : 1))
    return (width > 2 || height > 2) ? 'crafting_table' : 'player_inventory'
  }
  if (Array.isArray(recipe.ingredients)) {
    return recipe.ingredients.length > 4 ? 'crafting_table' : 'player_inventory'
  }
  return 'player_inventory'
}

function extractRecipeIngredients(recipe) {
  const counts = new Map()
  if (recipe.inShape) {
    for (const row of recipe.inShape) {
      if (!Array.isArray(row)) continue
      for (const id of row) {
        if (typeof id === 'number' && id > 0) {
          counts.set(id, (counts.get(id) || 0) + 1)
        }
      }
    }
  } else if (Array.isArray(recipe.ingredients)) {
    for (const id of recipe.ingredients) {
      if (typeof id === 'number' && id > 0) {
        counts.set(id, (counts.get(id) || 0) + 1)
      }
    }
  }
  return counts
}

function resolveItem(mcData, itemIdentifier) {
  if (typeof itemIdentifier === 'number') {
    return mcData.items[itemIdentifier] || null
  }
  if (typeof itemIdentifier === 'string') {
    return mcData.itemsByName[itemIdentifier] || null
  }
  return null
}

function countInventoryItem(inventory, itemNameOrId, mcData) {
  if (!inventory) return 0
  if (typeof inventory.items === 'function') {
    const items = inventory.items()
    let total = 0
    const targetItem = resolveItem(mcData, itemNameOrId)
    if (!targetItem) return 0
    for (const item of items) {
      if (item && (item.type === targetItem.id || item.name === targetItem.name)) {
        total += (item.count || 0)
      }
    }
    return total
  }
  // Plain object { item_name: count } or { itemId: count }
  if (typeof itemNameOrId === 'string' && typeof inventory[itemNameOrId] === 'number') {
    return inventory[itemNameOrId]
  }
  const target = resolveItem(mcData, itemNameOrId)
  if (target) {
    if (typeof inventory[target.name] === 'number') return inventory[target.name]
    if (typeof inventory[target.id] === 'number') return inventory[target.id]
  }
  return 0
}

/**
 * Plans a directed acyclic graph (DAG) of crafting steps to produce a target item.
 *
 * @param {Object} mcData Minecraft-data instance
 * @param {string|number} targetItemName Name or ID of target item
 * @param {number} targetCount Desired quantity
 * @param {Object} currentInventory Snapshot of available inventory
 * @param {Object} [options]
 * @param {number} [options.maxSteps=10] Maximum steps in the DAG
 * @returns {Object} { ok: boolean, plan?: Array, totalBaseNeeded?: Object, reason?: string, missing?: Object }
 */
function planCraft(mcData, targetItemName, targetCount = 1, currentInventory = {}, options = {}) {
  const maxSteps = options.maxSteps || 10
  const targetItem = resolveItem(mcData, targetItemName)
  if (!targetItem) {
    return { ok: false, reason: 'unknown_target_item', target: targetItemName }
  }

  // Working inventory (cloned so we simulate consumption as steps are planned)
  const simInv = new Map()
  if (currentInventory) {
    if (typeof currentInventory.items === 'function') {
      for (const it of currentInventory.items()) {
        if (it && it.name && it.count > 0) {
          const itemDef = resolveItem(mcData, it.name)
          if (itemDef) {
            simInv.set(itemDef.id, (simInv.get(itemDef.id) || 0) + it.count)
          }
        }
      }
    } else {
      for (const [key, val] of Object.entries(currentInventory)) {
        if (typeof val === 'number' && val > 0) {
          const itemDef = resolveItem(mcData, key)
          if (itemDef) {
            simInv.set(itemDef.id, (simInv.get(itemDef.id) || 0) + val)
          }
        }
      }
    }
  }

  const steps = []
  const missingBase = new Map()
  const visiting = new Set()

  function scoreRecipe(recipe) {
    // Prefer recipes where we already possess the ingredients in simInv
    let possessed = 0
    const ingMap = extractRecipeIngredients(recipe)
    for (const [id, needed] of ingMap) {
      if ((simInv.get(id) || 0) >= needed) possessed += 1
    }
    return possessed
  }

  function decompose(itemId, neededCount) {
    if (neededCount <= 0) return true
    const itemDef = mcData.items[itemId]
    if (!itemDef) return false

    // Check if simulation inventory already has enough
    const available = simInv.get(itemId) || 0
    if (available >= neededCount) {
      simInv.set(itemId, available - neededCount)
      return true
    }

    const stillNeeded = neededCount - available

    // Cycle check
    if (visiting.has(itemId)) {
      return false // Circular dependency
    }

    const availableRecipes = mcData.recipes[itemId]
    if (!availableRecipes || availableRecipes.length === 0) {
      // Base material cannot be crafted, must be gathered
      missingBase.set(itemDef.name, (missingBase.get(itemDef.name) || 0) + stillNeeded)
      return false
    }

    // Sort recipes prioritizing those where we already have some ingredients in simInv
    const sortedRecipes = [...availableRecipes].sort((a, b) => scoreRecipe(b) - scoreRecipe(a))

    visiting.add(itemId)

    // Try each recipe variant with backtracking
    for (const recipe of sortedRecipes) {
      const simInvSnapshot = new Map(simInv)
      const stepsSnapshotLen = steps.length
      const missingSnapshot = new Map(missingBase)

      simInv.set(itemId, 0) // consume all currently available

      const resultPerCraft = recipe.result?.count || 1
      const craftsNeeded = Math.ceil(stillNeeded / resultPerCraft)
      const producedCount = craftsNeeded * resultPerCraft

      const ingredientsMap = extractRecipeIngredients(recipe)
      let stepPossible = true

      for (const [ingId, ingPerCraft] of ingredientsMap) {
        const totalIngNeeded = ingPerCraft * craftsNeeded
        const ingPossible = decompose(ingId, totalIngNeeded)
        if (!ingPossible) {
          stepPossible = false
          break
        }
      }

      if (stepPossible && steps.length < maxSteps) {
        const station = getStationType(recipe)
        const stepIndex = steps.length

        const readableIngredients = {}
        for (const [ingId, count] of ingredientsMap) {
          const ingDef = mcData.items[ingId]
          readableIngredients[ingDef ? ingDef.name : ingId] = count * craftsNeeded
        }

        steps.push({
          step_index: stepIndex,
          kind: 'craft',
          target_item: itemDef.name,
          target_item_id: itemDef.id,
          count: producedCount,
          craft_times: craftsNeeded,
          station,
          recipe_shape: recipe.inShape || null,
          ingredients: readableIngredients,
          dependencies: []
        })

        // Surplus produced added back to simInv
        const surplus = producedCount - stillNeeded
        if (surplus > 0) {
          simInv.set(itemId, (simInv.get(itemId) || 0) + surplus)
        }

        visiting.delete(itemId)
        return true
      }

      // Backtrack
      simInv.clear()
      for (const [k, v] of simInvSnapshot) simInv.set(k, v)
      steps.length = stepsSnapshotLen
      missingBase.clear()
      for (const [k, v] of missingSnapshot) missingBase.set(k, v)
    }

    visiting.delete(itemId)
    missingBase.set(itemDef.name, (missingBase.get(itemDef.name) || 0) + stillNeeded)
    return false
  }

  const success = decompose(targetItem.id, targetCount)

  if (!success || missingBase.size > 0) {
    const missingObj = {}
    for (const [k, v] of missingBase) {
      missingObj[k] = v
    }
    return {
      ok: false,
      reason: 'insufficient_materials',
      missing: missingObj,
      partialSteps: steps
    }
  }

  if (steps.length > maxSteps) {
    return {
      ok: false,
      reason: 'exceeded_max_steps',
      stepsCount: steps.length,
      maxSteps
    }
  }

  // Check if any step requires crafting_table and whether we have one or need to place/craft one
  let requiresCraftingTable = false
  for (const s of steps) {
    if (s.station === 'crafting_table') {
      requiresCraftingTable = true
      break
    }
  }

  if (requiresCraftingTable && options.autoCraftStation !== false) {
    const hasTable = countInventoryItem(currentInventory, 'crafting_table', mcData) > 0
    if (!hasTable && !steps.some(s => s.target_item === 'crafting_table')) {
      const tableItem = mcData.itemsByName.crafting_table
      if (tableItem) {
        decompose(tableItem.id, 1)
      }
    }
  }

  // Optimize plan: coalesce steps for identical items at the same station
  const coalesced = []
  for (const s of steps) {
    const existing = coalesced.find(c => c.target_item_id === s.target_item_id && c.station === s.station)
    if (existing) {
      existing.craft_times += s.craft_times
      existing.count += s.count
      for (const [k, v] of Object.entries(s.ingredients)) {
        existing.ingredients[k] = (existing.ingredients[k] || 0) + v
      }
    } else {
      coalesced.push({ ...s, ingredients: { ...s.ingredients } })
    }
  }

  // Ensure crafting_table is placed before any station === 'crafting_table' step
  const tableStepIdx = coalesced.findIndex(s => s.target_item === 'crafting_table')
  if (tableStepIdx > 0) {
    const firstTableDependentIdx = coalesced.findIndex(s => s.station === 'crafting_table')
    if (firstTableDependentIdx !== -1 && tableStepIdx > firstTableDependentIdx) {
      const [tableStep] = coalesced.splice(tableStepIdx, 1)
      coalesced.splice(firstTableDependentIdx, 0, tableStep)
    }
  }

  // Re-index steps
  for (let i = 0; i < coalesced.length; i++) {
    coalesced[i].step_index = i
  }

  return {
    ok: true,
    targetItem: targetItem.name,
    targetCount,
    requiresCraftingTable,
    stepsCount: coalesced.length,
    plan: coalesced
  }
}

/**
 * Executes a planned crafting DAG sequentially against a Mineflayer bot.
 * Verifies inventory deltas before and after every single step.
 * Fails closed immediately upon delta mismatch or station unavailability.
 *
 * @param {Array} plan Array of steps produced by planCraft
 * @param {Object} bot Mineflayer bot instance
 * @param {Object} options
 * @param {Object} [options.craftingTableBlock] Mineflayer block representing crafting table if needed
 * @returns {Promise<Object>} Execution receipt
 */
async function executeCraftPlan(plan, bot, options = {}) {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error('Craft plan must be a non-empty array of steps')
  }

  const journalDir = options.journalDir || path.join(process.cwd(), '.guiaia', 'craft_journals')
  const missionId = options.missionId || `craft_mission_${Date.now()}`
  const journalPath = options.journalPath || path.join(journalDir, `${missionId}.json`)

  let journal
  let startIndex = 0

  if (options.resumeFromJournal && typeof options.resumeFromJournal === 'object') {
    journal = { ...options.resumeFromJournal }
    startIndex = journal.completedSteps || 0
  } else if (options.resumeJournalPath) {
    const recovered = recoverCraftJournal(options.resumeJournalPath)
    if (recovered.ok) {
      journal = recovered.journal
      startIndex = journal.completedSteps || 0
    }
  }

  if (!journal) {
    journal = {
      missionId,
      status: 'in_progress',
      totalSteps: plan.length,
      completedSteps: 0,
      receipts: [],
      timestamp: Date.now()
    }
  }
  writeDurableCraftJournal(journalPath, journal)

  const receipts = [...(journal.receipts || [])]

  for (let i = startIndex; i < plan.length; i++) {
    const step = plan[i]
    if (options.isCancelled?.() || options.signal?.aborted) {
      journal.status = 'cancelled'
      journal.reason = 'operator_cancelled'
      writeDurableCraftJournal(journalPath, journal)
      return {
        ok: false,
        status: 'cancelled',
        reason: 'mission_cancelled_by_operator',
        journal
      }
    }

    // Allow pending server window/slot update packets to settle before recording baseline
    if (bot && typeof bot.on === 'function') {
      await new Promise(r => setTimeout(r, 500))
    }

    const targetName = step.target_item

    // 1. Two-sided baseline: record input ingredients before craft
    const beforeInputs = {}
    if (step.ingredients && typeof step.ingredients === 'object') {
      for (const [ingName] of Object.entries(step.ingredients)) {
        beforeInputs[ingName] = countInventoryItem(bot.inventory, ingName, options.mcData)
      }
    }
    const initialCount = countInventoryItem(bot.inventory, targetName, options.mcData)

    // 2. Physical Station Resolution: search or place crafting table
    let stationBlock = null
    if (step.station === 'crafting_table') {
      stationBlock = options.craftingTableBlock ||
        (typeof bot.findBlock === 'function' ? bot.findBlock({ matching: options.mcData?.blocksByName?.crafting_table?.id, maxDistance: 4 }) : null)

      if (!stationBlock) {
        // Physical placement: check if bot has crafting_table item in inventory
        const hasTableItem = countInventoryItem(bot.inventory, 'crafting_table', options.mcData) > 0
        if (hasTableItem && typeof bot.placeBlock === 'function') {
          let supportBlock = null
          if (typeof bot.blockAt === 'function' && bot.entity?.position) {
            const botPos = bot.entity.position.floored()
            const offsets = [
              new Vec3(1, -1, 0),
              new Vec3(-1, -1, 0),
              new Vec3(0, -1, 1),
              new Vec3(0, -1, -1)
            ]
            for (const off of offsets) {
              const b = bot.blockAt(botPos.plus(off))
              if (b && b.name !== 'air') {
                const above = bot.blockAt(botPos.plus(off).offset(0, 1, 0))
                if (above && above.name === 'air') {
                  supportBlock = b
                  break
                }
              }
            }
          }
          if (!supportBlock && typeof bot.findBlock === 'function') {
            supportBlock = bot.findBlock({ matching: (b) => b && b.name !== 'air', maxDistance: 3 })
          }

          if (supportBlock) {
            const itemObj = bot.inventory?.items?.().find(i => i.name === 'crafting_table')
            if (typeof bot.equip === 'function') {
              const equipParam = (itemObj && itemObj.slot !== undefined) ? itemObj : 'crafting_table'
              await bot.equip(equipParam, 'hand')
            }
            await bot.placeBlock(supportBlock, new Vec3(0, 1, 0))
            await new Promise(r => setTimeout(r, 400))
            stationBlock = typeof bot.findBlock === 'function'
              ? bot.findBlock({ matching: options.mcData?.blocksByName?.crafting_table?.id, maxDistance: 4 })
              : { name: 'crafting_table' }
          }
        }
      }

      if (!stationBlock) {
        journal.status = 'failed'
        journal.error = `missing_station: crafting_table for step ${step.step_index}`
        writeDurableCraftJournal(journalPath, journal)
        throw new Error(`Step ${step.step_index} (${targetName}) requires nearby crafting_table station, none found in world or inventory`)
      }
    }

    // 3. Resolve Mineflayer recipe object
    let mfRecipe = null
    if (typeof bot.recipesFor === 'function') {
      const availableMfRecipes = bot.recipesFor(step.target_item_id, null, 1, stationBlock)
      if (!availableMfRecipes || availableMfRecipes.length === 0) {
        journal.status = 'failed'
        journal.error = `missing_recipe_or_ingredients: step ${step.step_index}`
        writeDurableCraftJournal(journalPath, journal)
        throw new Error(`Bot lacks ingredients or recipe for step ${step.step_index}: ${targetName}`)
      }
      // Match the recipe that uses our specific step ingredients (e.g. oak_planks vs bamboo)
      mfRecipe = availableMfRecipes.find(r => {
        if (!step.ingredients || !options.mcData) return true
        const reqIngs = Object.keys(step.ingredients)
        return Array.isArray(r.delta) && r.delta.some(d => {
          const itemDef = options.mcData.items[d.id]
          return itemDef && reqIngs.includes(itemDef.name) && d.count < 0
        })
      }) || availableMfRecipes[0]
    }

    // 4. Execute craft: sequentially 1 by 1 with settling window to maintain 1.21.1 stateId sync
    const craftTimes = Math.max(1, step.craft_times || 1)
    for (let c = 0; c < craftTimes; c++) {
      if (typeof bot.craft === 'function') {
        await bot.craft(mfRecipe, 1, stationBlock)
      }
      await new Promise(r => setTimeout(r, 350))
    }

    // 5. Two-sided delta verification: output produced AND inputs consumed
    let afterCount = countInventoryItem(bot.inventory, targetName, options.mcData)
    let delta = afterCount - initialCount
    if (delta <= 0) {
      // Grace window for server set_slot packet arrival over loopback
      const deadline = Date.now() + 3000
      while (delta <= 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100))
        afterCount = countInventoryItem(bot.inventory, targetName, options.mcData)
        delta = afterCount - initialCount
      }
    }

    if (delta <= 0) {
      journal.status = 'needs_review'
      journal.reason = 'uncertain_inventory_delta'
      journal.error = `Inventory delta verification failed for ${targetName}: expected >= 1, got delta ${delta}`
      writeDurableCraftJournal(journalPath, journal)
      throw new Error(`Inventory delta verification failed for ${targetName}: expected >= 1, got delta ${delta}`)
    }

    const consumedDeltas = {}
    if (step.ingredients && options.verifyInputDeltas !== false) {
      for (const [ingName] of Object.entries(step.ingredients)) {
        let afterIngCount = countInventoryItem(bot.inventory, ingName, options.mcData)
        let consumed = beforeInputs[ingName] - afterIngCount
        if (consumed <= 0) {
          const deadline = Date.now() + 2000
          while (consumed <= 0 && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 100))
            afterIngCount = countInventoryItem(bot.inventory, ingName, options.mcData)
            consumed = beforeInputs[ingName] - afterIngCount
          }
        }
        if (consumed <= 0) {
          journal.status = 'needs_review'
          journal.reason = 'uncertain_ingredient_consumption'
          journal.error = `Inventory two-sided delta verification failed: ingredient ${ingName} was not consumed`
          writeDurableCraftJournal(journalPath, journal)
          throw new Error(`Inventory two-sided delta verification failed: ingredient ${ingName} was not consumed`)
        }
        consumedDeltas[ingName] = consumed
      }
    }

    const receipt = {
      step_index: step.step_index,
      target_item: targetName,
      delta,
      consumed: consumedDeltas,
      total_after: afterCount
    }

    receipts.push(receipt)
    journal.completedSteps = receipts.length
    journal.receipts = receipts
    writeDurableCraftJournal(journalPath, journal)
  }

  journal.status = 'completed'
  writeDurableCraftJournal(journalPath, journal)
  return {
    ok: true,
    completedSteps: receipts.length,
    receipts,
    journal
  }
}

/**
 * Higher-level Crafting Engine compatible with controller engines injection.
 */
function createCraftingPlanner(options = {}) {
  const version = options.version || '1.21.1'
  const mcData = options.mcData || mcDataFactory(version)
  const maxSteps = options.maxSteps || 10

  return {
    mcData,
    plan: (targetItem, count, inventory) => planCraft(mcData, targetItem, count, inventory, { maxSteps }),
    execute: async (grant, execOptions = {}) => {
      const planRes = planCraft(mcData, grant.recipe || grant.item, grant.count, execOptions.inventory || {}, { maxSteps })
      if (!planRes.ok) {
        return planRes
      }
      if (execOptions.bot) {
        return await executeCraftPlan(planRes.plan, execOptions.bot, { ...execOptions, mcData })
      }
      return {
        ok: true,
        action: 'craft',
        recipe: grant.recipe || grant.item,
        count: grant.count,
        plan: planRes.plan,
        stepsCount: planRes.stepsCount
      }
    }
  }
}

module.exports = {
  createCraftingPlanner,
  planCraft,
  executeCraftPlan,
  getStationType,
  extractRecipeIngredients,
  writeDurableCraftJournal,
  recoverCraftJournal,
  reconcileCraftJournal,
  STATION_MAP
}
