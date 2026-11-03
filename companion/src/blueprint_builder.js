'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { Vec3 } = require('vec3')
const { parseBlueprint } = require('./blueprint_importer')

const MAX_BATCH_SIZE = 64
const MAX_PLACE_DISTANCE = 4.5

const ATTACHMENT_BLOCKS = Object.freeze(new Set([
  'torch', 'wall_torch', 'redstone_torch', 'lantern', 'soul_lantern',
  'ladder', 'lever', 'stone_button', 'oak_button', 'spruce_button',
  'painting', 'item_frame', 'glow_item_frame'
]))

const GRAVITY_BLOCKS = Object.freeze(new Set([
  'sand', 'red_sand', 'gravel',
  'white_concrete_powder', 'orange_concrete_powder', 'magenta_concrete_powder',
  'light_blue_concrete_powder', 'yellow_concrete_powder', 'lime_concrete_powder',
  'pink_concrete_powder', 'gray_concrete_powder', 'light_gray_concrete_powder',
  'cyan_concrete_powder', 'purple_concrete_powder', 'blue_concrete_powder',
  'brown_concrete_powder', 'green_concrete_powder', 'red_concrete_powder',
  'black_concrete_powder'
]))

/**
 * Persists build journal to disk atomically with fsync and cryptographic checksum.
 */
function writeDurableJournal(journalPath, journalData) {
  if (!journalPath) return
  const dir = path.dirname(journalPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const payloadString = JSON.stringify(journalData)
  const sha256 = crypto.createHash('sha256').update(payloadString).digest('hex')
  const envelope = {
    format: 'guiaia_durable_build_journal_v1',
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

  // Backup current intact file before atomic replace
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
 * Recovers build journal from disk, verifying cryptographic checksum envelope.
 * Falls back to valid .bak file if primary file was corrupted by torn writes.
 * Enforces rollback prevention: rejects journals that regress behind high-water sequence marks.
 */
function recoverBuildJournal(journalPath, options = {}) {
  if (!journalPath || !fs.existsSync(journalPath)) {
    return { ok: false, reason: 'journal_not_found' }
  }

  function readAndValidate(targetPath) {
    try {
      const content = fs.readFileSync(targetPath, 'utf8')
      const parsed = JSON.parse(content)

      if (parsed && parsed.format === 'guiaia_durable_build_journal_v1') {
        const computedSha256 = crypto.createHash('sha256').update(JSON.stringify(parsed.payload)).digest('hex')
        if (computedSha256 !== parsed.sha256) {
          return { ok: false, reason: 'checksum_mismatch', error: 'Journal checksum mismatch (corrupted content)' }
        }
        return { ok: true, journal: parsed.payload, verifiedChecksum: true }
      }

      // Legacy plain journal format backwards compatibility
      if (parsed && typeof parsed === 'object' && parsed.buildId && parsed.blueprintId) {
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
          message: `Restored build journal sequence ${journal.sequence} is lower than known high-water mark ${options.highWaterSequence}; rollback rejected`
        }
      }
    }

    if (options.highWaterPlaced !== undefined && Array.isArray(journal.placedBlocks)) {
      if (journal.placedBlocks.length < options.highWaterPlaced) {
        return {
          ok: false,
          reason: 'ROLLBACK_DETECTED',
          message: `Restored build journal placedBlocks count ${journal.placedBlocks.length} is lower than known high-water count ${options.highWaterPlaced}; rollback rejected`
        }
      }
    }

    if (journal.highestWitnessedSequence !== undefined && journal.sequence !== undefined) {
      if (journal.sequence < journal.highestWitnessedSequence) {
        return {
          ok: false,
          reason: 'ROLLBACK_DETECTED',
          message: `Build journal sequence ${journal.sequence} regressed behind witnessed high-water mark ${journal.highestWitnessedSequence}; rollback rejected`
        }
      }
    }

    return recovered
  }

  const primary = readAndValidate(journalPath)
  if (primary.ok) return checkRollback(primary)

  // Attempt backup recovery if primary corrupted
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
 * Reconciles an interrupted build journal against physical world observation.
 * If the process was terminated mid-flight, transitions to 'needs_review' rather
 * than permitting blind resumption.
 */
function reconcileBuildJournal(journalPath, options = {}) {
  const recovered = recoverBuildJournal(journalPath, options)
  if (!recovered.ok) {
    return { ok: false, reason: recovered.reason, error: recovered.error }
  }

  const journal = recovered.journal
  const blockAt = options.blockAt || (options.bot && typeof options.bot.blockAt === 'function' ? pos => options.bot.blockAt(pos) : null)

  const discrepancies = []

  // Check physical world consistency for all placed blocks if world observer is available
  if (blockAt && Array.isArray(journal.placedBlocks) && journal.origin) {
    for (const b of journal.placedBlocks) {
      const worldPos = new Vec3(journal.origin.x + b.x, journal.origin.y + b.y, journal.origin.z + b.z)
      const currentBlock = blockAt(worldPos)
      if (!currentBlock || currentBlock.name !== b.block) {
        discrepancies.push({
          position: { x: worldPos.x, y: worldPos.y, z: worldPos.z },
          expected: b.block,
          found: currentBlock ? currentBlock.name : 'unknown'
        })
      }
    }
  }

  if (journal.status === 'in_progress') {
    journal.status = 'needs_review'
    journal.interruptedReason = 'process_terminated_in_flight'
    journal.reconciledAt = Date.now()
    journal.discrepancies = discrepancies
    writeDurableJournal(journalPath, journal)
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

/**
 * Computes canonical SHA-256 hash of blueprint blocks.
 */
function computeBlueprintSha256(blocks) {
  if (!Array.isArray(blocks)) return null
  const canonical = JSON.stringify([...blocks].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y
    if (a.x !== b.x) return a.x - b.x
    return a.z - b.z
  }))
  return crypto.createHash('sha256').update(canonical).digest('hex')
}

/**
 * Topologically orders blocks for physical stability and dependency resolution.
 * Principles adapted from Möbius:
 * 1. Bottom-to-top layer ordering (layer Y=0 before Y=1, etc.)
 * 2. Solid structural blocks placed before attachments within the same layer
 * 3. Gravity blocks placed only after support underneath
 */
function orderBlocksTopologically(blocks) {
  if (!Array.isArray(blocks)) return []

  const sorted = [...blocks].sort((a, b) => {
    // 1. Layer Y ascending
    if (a.y !== b.y) return a.y - b.y

    // 2. Attachments placed after solid blocks on the same layer
    const aIsAttach = ATTACHMENT_BLOCKS.has(a.block)
    const bIsAttach = ATTACHMENT_BLOCKS.has(b.block)
    if (aIsAttach !== bIsAttach) return aIsAttach ? 1 : -1

    // 3. Proximity: X then Z
    if (a.x !== b.x) return a.x - b.x
    return a.z - b.z
  })

  return sorted
}

/**
 * Splits ordered blocks into verified batches of at most maxBatchSize (64).
 */
function createBatches(blocks, maxBatchSize = MAX_BATCH_SIZE) {
  const batches = []
  for (let i = 0; i < blocks.length; i += maxBatchSize) {
    batches.push(blocks.slice(i, i + maxBatchSize))
  }
  return batches
}

/**
 * Previews blueprint placement without world mutation.
 * Verifies bounds, existing block collisions, and inventory sufficiency.
 */
function previewBlueprint(blueprint, origin, inventory) {
  if (!blueprint || !Array.isArray(blueprint.blocks)) {
    throw new Error('Invalid blueprint structure for preview')
  }
  if (!origin || !['x', 'y', 'z'].every(k => Number.isInteger(origin[k]))) {
    throw new Error('Valid integer origin coordinates {x, y, z} required')
  }

  const materialsNeeded = { ...blueprint.materials_needed }
  const missing = {}
  let hasSufficient = true

  // Check inventory counts
  const invCounts = {}
  if (inventory) {
    if (typeof inventory.items === 'function') {
      for (const item of inventory.items()) {
        if (item && item.name && item.count > 0) {
          invCounts[item.name] = (invCounts[item.name] || 0) + item.count
        }
      }
    } else {
      Object.assign(invCounts, inventory)
    }
  }

  for (const [mat, count] of Object.entries(materialsNeeded)) {
    const available = invCounts[mat] || 0
    if (available < count) {
      hasSufficient = false
      missing[mat] = count - available
    }
  }

  const orderedBlocks = orderBlocksTopologically(blueprint.blocks)
  const batches = createBatches(orderedBlocks, MAX_BATCH_SIZE)

  return {
    ok: true,
    blueprintId: blueprint.blueprint_id,
    origin: { ...origin },
    dimensions: { ...blueprint.dimensions },
    totalBlocks: blueprint.blocks.length,
    materialsNeeded,
    inventoryHasSufficient: hasSufficient,
    missingMaterials: missing,
    batchesCount: batches.length,
    batchSize: MAX_BATCH_SIZE
  }
}

/**
 * Creates the autonomous blueprint builder engine.
 */
function createBlueprintBuilder(options = {}) {
  const maxBatchSize = options.maxBatchSize || MAX_BATCH_SIZE
  const defaultJournalDir = options.journalDir || path.join(process.cwd(), '.guiaia', 'build_journals')

  async function execute(grant, blueprintInput, execOptions = {}) {
    const origin = grant.origin
    if (!origin || typeof origin.x !== 'number' || typeof origin.y !== 'number' || typeof origin.z !== 'number') {
      throw new Error('Build grant must specify valid origin coordinates')
    }

    let blueprint
    if (blueprintInput) {
      blueprint = typeof blueprintInput === 'object' && blueprintInput.blocks
        ? blueprintInput
        : await parseBlueprint(blueprintInput, { blueprintId: grant.blueprintId })
    } else {
      throw new Error(`Blueprint data not supplied for ${grant.blueprintId}`)
    }

    // 1. Strict Grant Scoping Validations
    if (grant.blueprintId && blueprint.blueprint_id && grant.blueprintId !== blueprint.blueprint_id) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'blueprint_id_mismatch',
        message: `Grant blueprintId '${grant.blueprintId}' does not match blueprint '${blueprint.blueprint_id}'`
      }
    }

    if (grant.origin && (origin.x !== grant.origin.x || origin.y !== grant.origin.y || origin.z !== grant.origin.z)) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'origin_mismatch',
        message: `Specified origin coordinates do not match signed grant origin`
      }
    }

    if (grant.maxBlocks !== undefined && blueprint.blocks.length > grant.maxBlocks) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'exceeds_authorized_block_budget',
        message: `Blueprint total blocks (${blueprint.blocks.length}) exceeds authorized grant budget (${grant.maxBlocks})`
      }
    }

    if (grant.blueprintSha256) {
      const computedHash = computeBlueprintSha256(blueprint.blocks)
      if (grant.blueprintSha256 !== computedHash) {
        return {
          ok: false,
          status: 'blocked',
          reason: 'blueprint_hash_mismatch',
          message: `Blueprint SHA-256 (${computedHash}) does not match authorized grant hash (${grant.blueprintSha256})`
        }
      }
    }

    // 2. Pre-flight Preview & Materials Verification
    const preview = previewBlueprint(blueprint, origin, execOptions.inventory || execOptions.bot?.inventory)
    if (!preview.inventoryHasSufficient && execOptions.requireSufficientInventory !== false) {
      return {
        ok: false,
        reason: 'insufficient_materials',
        missing: preview.missingMaterials,
        preview
      }
    }

    // Pre-flight preview and authorization requirement
    if (execOptions.requirePreview !== false && !execOptions.previewAuthorized && !grant.previewConfirmed) {
      return {
        ok: false,
        status: 'preview_required',
        reason: 'preview_authorization_required',
        message: 'World modification requires explicit prior preview authorization',
        preview
      }
    }

    const orderedBlocks = orderBlocksTopologically(blueprint.blocks)
    const batches = createBatches(orderedBlocks, maxBatchSize)
    const bot = execOptions.bot

    // If no bot provided (simulation/preview mode)
    if (!bot) {
      return {
        ok: true,
        action: 'build_preview',
        blueprintId: grant.blueprintId,
        origin,
        totalBlocks: blueprint.blocks.length,
        batchesCount: batches.length,
        preview
      }
    }

    // 3. Durable Write-Ahead Build Journal Initialization
    const journalDir = execOptions.journalDir || defaultJournalDir
    const buildId = grant.nonce || `build_${Date.now()}`
    const journalPath = execOptions.journalPath || path.join(journalDir, `${buildId}.json`)

    const journal = {
      buildId,
      blueprintId: grant.blueprintId,
      origin: { ...origin },
      status: 'in_progress',
      totalBlocks: blueprint.blocks.length,
      placedBlocks: [],
      skippedExisting: [],
      failedBlocks: [],
      batchesCompleted: 0,
      timestamp: Date.now()
    }
    writeDurableJournal(journalPath, journal)

    // Physical bot placement
    let totalPlaced = 0
    let totalSkippedExisting = 0
    const placedBatches = []

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]
      let batchPlaced = 0
      let batchSkipped = 0

      for (const b of batch) {
        // Continuous cancellation check before every single block placement
        if (execOptions.isCancelled?.() || execOptions.signal?.aborted) {
          journal.status = 'cancelled'
          journal.cancellationReason = 'operator_cancelled'
          writeDurableJournal(journalPath, journal)
          return {
            ok: false,
            status: 'cancelled',
            reason: 'build_cancelled_by_operator',
            totalPlaced: totalPlaced + batchPlaced,
            totalSkippedExisting: totalSkippedExisting + batchSkipped,
            journal
          }
        }

        const worldTarget = new Vec3(origin.x + b.x, origin.y + b.y, origin.z + b.z)

        // 1. Check existing block state in world
        const existing = typeof bot.blockAt === 'function' ? bot.blockAt(worldTarget) : null

        // If target block already present: do NOT increment placed count
        if (existing && existing.name === b.block) {
          batchSkipped++
          journal.skippedExisting.push({ x: b.x, y: b.y, z: b.z, block: b.block })
          writeDurableJournal(journalPath, journal)
          continue
        }

        // 2. Validate real non-air collision
        if (existing && existing.name !== 'air' && existing.name !== b.block) {
          if (!execOptions.allowOverwrite) {
            journal.status = 'failed'
            journal.error = `world_collision: existing ${existing.name} at (${worldTarget.x}, ${worldTarget.y}, ${worldTarget.z})`
            writeDurableJournal(journalPath, journal)
            return {
              ok: false,
              reason: 'world_collision',
              conflict: {
                targetBlock: b.block,
                existingBlock: existing.name,
                position: { x: worldTarget.x, y: worldTarget.y, z: worldTarget.z }
              },
              journal
            }
          }
        }

        // 3. Check adjacent support block
        const referenceDirections = [
          new Vec3(0, -1, 0), // below
          new Vec3(0, 0, -1), // north
          new Vec3(0, 0, 1),  // south
          new Vec3(-1, 0, 0), // west
          new Vec3(1, 0, 0)   // east
        ]

        let supportBlock = null
        let placeFace = null

        for (const dir of referenceDirections) {
          const neighborPos = worldTarget.plus(dir)
          const neighborBlock = typeof bot.blockAt === 'function' ? bot.blockAt(neighborPos) : null
          if (neighborBlock && neighborBlock.name !== 'air') {
            supportBlock = neighborBlock
            placeFace = dir.scaled(-1) // face points toward worldTarget
            break
          }
        }

        // 4. Gravity check
        if (GRAVITY_BLOCKS.has(b.block)) {
          const belowPos = worldTarget.plus(new Vec3(0, -1, 0))
          const belowBlock = typeof bot.blockAt === 'function' ? bot.blockAt(belowPos) : null
          if (!belowBlock || belowBlock.name === 'air') {
            journal.status = 'failed'
            journal.error = `gravity_unsupported: ${b.block} at (${worldTarget.x}, ${worldTarget.y}, ${worldTarget.z})`
            writeDurableJournal(journalPath, journal)
            throw new Error(`Cannot place gravity block ${b.block} without solid support below at ${belowPos}`)
          }
        }

        // 5. Equip and place
        if (typeof bot.equip === 'function') {
          const itemToEquip = bot.inventory?.items?.().find(i => i.name === b.block)
          if (itemToEquip) {
            await bot.equip(itemToEquip, 'hand')
          }
        }
        if (typeof bot.placeBlock === 'function' && supportBlock && placeFace) {
          await bot.placeBlock(supportBlock, placeFace)
          await new Promise(r => setTimeout(r, 350))
        }

        // 6. Post-placement physical world state verification
        let postBlock = typeof bot.blockAt === 'function' ? bot.blockAt(worldTarget) : null
        if (!postBlock || postBlock.name !== b.block) {
          const deadline = Date.now() + 1000
          while ((!postBlock || postBlock.name !== b.block) && Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 100))
            postBlock = typeof bot.blockAt === 'function' ? bot.blockAt(worldTarget) : null
          }
        }
        if (postBlock && postBlock.name === b.block) {
          batchPlaced++
          journal.placedBlocks.push({ x: b.x, y: b.y, z: b.z, block: b.block })
        } else {
          journal.failedBlocks.push({ x: b.x, y: b.y, z: b.z, block: b.block, reason: 'placement_unverified' })
        }
        writeDurableJournal(journalPath, journal)
      }

      totalPlaced += batchPlaced
      totalSkippedExisting += batchSkipped
      journal.batchesCompleted++
      placedBatches.push({ batch: batchIdx, placed: batchPlaced, skippedExisting: batchSkipped })
      writeDurableJournal(journalPath, journal)
    }

    // 4. Final verification: fail closed if any block placement failed
    if (journal.failedBlocks.length > 0) {
      journal.status = 'partial_failure'
      writeDurableJournal(journalPath, journal)
      return {
        ok: false,
        status: 'partial_failure',
        reason: 'unverified_blocks_encountered',
        blueprintId: grant.blueprintId,
        origin,
        totalPlaced,
        totalSkippedExisting,
        failedBlocks: journal.failedBlocks,
        batches: placedBatches,
        journal
      }
    }

    journal.status = 'completed'
    writeDurableJournal(journalPath, journal)
    return {
      ok: true,
      action: 'build_execute',
      blueprintId: grant.blueprintId,
      origin,
      totalPlaced,
      totalSkippedExisting,
      batches: placedBatches,
      journal
    }
  }

  return {
    execute,
    preview: previewBlueprint,
    orderBlocks: orderBlocksTopologically,
    createBatches
  }
}

module.exports = {
  createBlueprintBuilder,
  orderBlocksTopologically,
  createBatches,
  previewBlueprint,
  writeDurableJournal,
  writeDurableBuildJournal: writeDurableJournal,
  recoverBuildJournal,
  reconcileBuildJournal,
  computeBlueprintSha256,
  MAX_BATCH_SIZE,
  MAX_PLACE_DISTANCE,
  ATTACHMENT_BLOCKS,
  GRAVITY_BLOCKS
}
