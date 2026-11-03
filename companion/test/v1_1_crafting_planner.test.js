'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const mcDataFactory = require('minecraft-data')
const mcData = mcDataFactory('1.21.1')

const {
  createCraftingPlanner,
  planCraft,
  executeCraftPlan,
  getStationType,
  writeDurableCraftJournal,
  recoverCraftJournal,
  reconcileCraftJournal
} = require('../src/crafting_planner')

test('Crafting Planner - Station classification (2x2 player vs 3x3 table)', () => {
  const tableRecipe = mcData.recipes[mcData.itemsByName.crafting_table.id][0]
  assert.equal(getStationType(tableRecipe), 'player_inventory')

  const stickRecipe = mcData.recipes[mcData.itemsByName.stick.id][0]
  assert.equal(getStationType(stickRecipe), 'player_inventory')

  const pickaxeRecipe = mcData.recipes[mcData.itemsByName.wooden_pickaxe.id][0]
  assert.equal(getStationType(pickaxeRecipe), 'crafting_table')

  const chestRecipe = mcData.recipes[mcData.itemsByName.chest.id][0]
  assert.equal(getStationType(chestRecipe), 'crafting_table')
})

test('Crafting Planner - Single-step 2x2 crafting planning', () => {
  const inv = { oak_log: 2 }
  const res = planCraft(mcData, 'oak_planks', 4, inv)
  assert.equal(res.ok, true)
  assert.equal(res.stepsCount, 1)
  assert.equal(res.plan[0].target_item, 'oak_planks')
  assert.equal(res.plan[0].station, 'player_inventory')
  assert.equal(res.requiresCraftingTable, false)
})

test('Crafting Planner - Chained multi-step DAG resolution (logs -> planks -> sticks -> pickaxe)', () => {
  // 3 logs = 12 planks. 2 planks = 4 sticks. 3 planks + 2 sticks = 1 wooden_pickaxe.
  const inv = { oak_log: 3 }
  const res = planCraft(mcData, 'wooden_pickaxe', 1, inv)

  assert.equal(res.ok, true)
  assert.ok(res.stepsCount >= 3)
  assert.ok(res.stepsCount <= 10, 'Steps must be bounded to max 10')
  assert.equal(res.requiresCraftingTable, true)

  const finalStep = res.plan[res.plan.length - 1]
  assert.equal(finalStep.target_item, 'wooden_pickaxe')
  assert.equal(finalStep.station, 'crafting_table')

  // Check intermediate dependencies
  const targetItems = res.plan.map(s => s.target_item)
  assert.ok(targetItems.includes('oak_planks'))
  assert.ok(targetItems.includes('stick'))
  assert.ok(targetItems.includes('wooden_pickaxe'))

  // Verify topological order: planks before stick, stick before pickaxe
  const planksIdx = targetItems.indexOf('oak_planks')
  const stickIdx = targetItems.indexOf('stick')
  const pickIdx = targetItems.indexOf('wooden_pickaxe')
  assert.ok(planksIdx < stickIdx)
  assert.ok(stickIdx < pickIdx)
})

test('Crafting Planner - Missing base materials fails closed with detailed report', () => {
  const inv = { oak_log: 0 }
  const res = planCraft(mcData, 'wooden_pickaxe', 1, inv)

  assert.equal(res.ok, false)
  assert.equal(res.reason, 'insufficient_materials')
  assert.ok(res.missing.oak_log > 0 || Object.keys(res.missing).length > 0)
})

test('Crafting Planner - Missing materials to auto-craft station fails closed', () => {
  // Inventory has exact ingredients for wooden_pickaxe, but no crafting table and no wood to craft table
  const inv = { oak_planks: 3, stick: 2 }
  const res = planCraft(mcData, 'wooden_pickaxe', 1, inv, { autoCraftStation: true })

  assert.equal(res.ok, false)
  assert.equal(res.reason, 'insufficient_materials')
  assert.ok(res.missing.oak_planks > 0 || Object.keys(res.missing).length > 0)
})

test('Crafting Planner - Exceeded max steps boundary protection', () => {
  const inv = { oak_log: 5 }
  // Force strict limit of 1 step: pickaxe requires at least 3 steps so it must fail
  const res = planCraft(mcData, 'wooden_pickaxe', 1, inv, { maxSteps: 1 })
  assert.equal(res.ok, false)
  assert.ok(res.reason === 'insufficient_materials' || res.reason === 'exceeded_max_steps')
})

test('Crafting Planner - Execution with mock bot delta verification (happy path)', async () => {
  const inventoryState = {
    items: () => [
      { name: 'oak_planks', count: 3, type: mcData.itemsByName.oak_planks.id },
      { name: 'stick', count: 2, type: mcData.itemsByName.stick.id }
    ]
  }

  const mockBot = {
    inventory: inventoryState,
    recipesFor: (id, meta, count, station) => [{ result: { id, count: 1 } }],
    craft: async (recipe, count, station) => {
      // Simulate successful craft adding 1 wooden_pickaxe to inventory
      inventoryState.items = () => [
        { name: 'wooden_pickaxe', count: 1, type: mcData.itemsByName.wooden_pickaxe.id }
      ]
    }
  }

  const singleStepPlan = [{
    step_index: 0,
    kind: 'craft',
    target_item: 'wooden_pickaxe',
    target_item_id: mcData.itemsByName.wooden_pickaxe.id,
    craft_times: 1,
    station: 'crafting_table'
  }]

  const fakeCraftingTableBlock = { name: 'crafting_table', position: { x: 0, y: 64, z: 0 } }
  const result = await executeCraftPlan(singleStepPlan, mockBot, {
    mcData,
    craftingTableBlock: fakeCraftingTableBlock
  })

  assert.equal(result.ok, true)
  assert.equal(result.completedSteps, 1)
  assert.equal(result.receipts[0].delta, 1)
})

test('Crafting Planner - Execution fails closed when crafting table station is missing', async () => {
  const mockBot = {
    inventory: { items: () => [] },
    findBlock: () => null // no table nearby
  }

  const plan = [{
    step_index: 0,
    kind: 'craft',
    target_item: 'wooden_pickaxe',
    target_item_id: mcData.itemsByName.wooden_pickaxe.id,
    craft_times: 1,
    station: 'crafting_table'
  }]

  await assert.rejects(
    async () => executeCraftPlan(plan, mockBot, { mcData }),
    /requires nearby crafting_table station, none found/i
  )
})

test('Crafting Planner - Execution fails closed on inventory delta mismatch', async () => {
  const mockBot = {
    inventory: { items: () => [] }, // inventory does not increase after craft
    recipesFor: () => [{ result: { id: 10, count: 1 } }],
    craft: async () => {} // no-op craft
  }

  const plan = [{
    step_index: 0,
    kind: 'craft',
    target_item: 'stick',
    target_item_id: mcData.itemsByName.stick.id,
    craft_times: 1,
    station: 'player_inventory'
  }]

  await assert.rejects(
    async () => executeCraftPlan(plan, mockBot, { mcData }),
    /Inventory delta verification failed/i
  )
})

test('Crafting Planner - Two-sided delta verification: fails closed if ingredient not consumed', async () => {
  const inventoryState = {
    items: () => [
      { name: 'oak_planks', count: 4, type: mcData.itemsByName.oak_planks.id }
    ]
  }

  const mockBot = {
    inventory: inventoryState,
    recipesFor: (id) => [{ result: { id, count: 4 } }],
    craft: async () => {
      // Buggy or cheating craft: produces sticks but does NOT consume planks!
      inventoryState.items = () => [
        { name: 'oak_planks', count: 4, type: mcData.itemsByName.oak_planks.id },
        { name: 'stick', count: 4, type: mcData.itemsByName.stick.id }
      ]
    }
  }

  const plan = [{
    step_index: 0,
    kind: 'craft',
    target_item: 'stick',
    target_item_id: mcData.itemsByName.stick.id,
    craft_times: 1,
    station: 'player_inventory',
    ingredients: { oak_planks: 2 }
  }]

  await assert.rejects(
    async () => executeCraftPlan(plan, mockBot, { mcData }),
    /Inventory two-sided delta verification failed: ingredient oak_planks was not consumed/i
  )
})

test('Crafting Planner - Physical station placement when table is in bot inventory', async () => {
  let placedBlockName = null
  let equippedItem = null
  let tableInWorld = false

  const inventoryState = {
    items: () => [
      { name: 'crafting_table', count: 1, type: mcData.itemsByName.crafting_table.id },
      { name: 'oak_planks', count: 3, type: mcData.itemsByName.oak_planks.id },
      { name: 'stick', count: 2, type: mcData.itemsByName.stick.id }
    ]
  }

  const mockBot = {
    inventory: inventoryState,
    findBlock: ({ matching, maxDistance }) => {
      if (typeof matching === 'function') {
        return { name: 'dirt', position: { x: 0, y: 63, z: 0 } }
      }
      if (tableInWorld && matching === mcData.blocksByName.crafting_table.id) {
        return { name: 'crafting_table', position: { x: 1, y: 64, z: 1 } }
      }
      return null
    },
    equip: async (item) => { equippedItem = item },
    placeBlock: async (support, face) => {
      placedBlockName = 'crafting_table'
      tableInWorld = true
    },
    recipesFor: (id) => [{ result: { id, count: 1 } }],
    craft: async () => {
      inventoryState.items = () => [
        { name: 'wooden_pickaxe', count: 1, type: mcData.itemsByName.wooden_pickaxe.id }
      ]
    }
  }

  const plan = [{
    step_index: 0,
    kind: 'craft',
    target_item: 'wooden_pickaxe',
    target_item_id: mcData.itemsByName.wooden_pickaxe.id,
    craft_times: 1,
    station: 'crafting_table',
    ingredients: { oak_planks: 3, stick: 2 }
  }]

  const res = await executeCraftPlan(plan, mockBot, { mcData })
  assert.equal(res.ok, true)
  assert.equal(equippedItem, 'crafting_table')
  assert.equal(placedBlockName, 'crafting_table')
  assert.equal(res.journal.status, 'completed')
})

test('Crafting Planner - Compound mission cancellation in-flight produces recoverable journal', async () => {
  const plan = [
    { step_index: 0, kind: 'craft', target_item: 'stick', target_item_id: 1, craft_times: 1, station: 'player_inventory' },
    { step_index: 1, kind: 'craft', target_item: 'wooden_pickaxe', target_item_id: 2, craft_times: 1, station: 'player_inventory' }
  ]

  const mockBot = {
    inventory: { items: () => [] }
  }

  // Cancel immediately
  const res = await executeCraftPlan(plan, mockBot, {
    mcData,
    isCancelled: () => true
  })

  assert.equal(res.ok, false)
  assert.equal(res.status, 'cancelled')
  assert.equal(res.reason, 'mission_cancelled_by_operator')
  assert.equal(res.journal.status, 'cancelled')
})

test('Crafting Planner - Durable craft journal persists to disk and recovers after crash', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_craft_journal_test_'))
  const journalPath = path.join(tempDir, 'craft_test_1.json')

  const inventoryState = {
    items: () => [
      { name: 'oak_log', count: 2, type: mcData.itemsByName.oak_log.id }
    ]
  }

  const mockBot = {
    inventory: inventoryState,
    recipesFor: (id) => [{ result: { id, count: 4 } }],
    craft: async () => {
      inventoryState.items = () => [
        { name: 'oak_log', count: 1, type: mcData.itemsByName.oak_log.id },
        { name: 'oak_planks', count: 4, type: mcData.itemsByName.oak_planks.id }
      ]
    }
  }

  const plan = [{
    step_index: 0,
    kind: 'craft',
    target_item: 'oak_planks',
    target_item_id: mcData.itemsByName.oak_planks.id,
    craft_times: 1,
    station: 'player_inventory',
    ingredients: { oak_log: 1 }
  }]

  const res = await executeCraftPlan(plan, mockBot, {
    mcData,
    missionId: 'craft_test_1',
    journalPath
  })

  assert.equal(res.ok, true)
  assert.equal(res.completedSteps, 1)
  assert.equal(fs.existsSync(journalPath), true)

  const recovered = recoverCraftJournal(journalPath)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.journal.missionId, 'craft_test_1')
  assert.equal(recovered.journal.status, 'completed')
  assert.equal(recovered.journal.completedSteps, 1)
  assert.equal(recovered.journal.receipts.length, 1)

  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
})

test('Crafting Planner - Uncertain inventory delta records needs_review in durable journal without retry', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_craft_uncertain_test_'))
  const journalPath = path.join(tempDir, 'craft_uncertain.json')

  let craftAttempts = 0
  const mockBot = {
    inventory: { items: () => [] }, // inventory never increases
    recipesFor: () => [{ result: { id: 10, count: 1 } }],
    craft: async () => {
      craftAttempts++
    }
  }

  const plan = [{
    step_index: 0,
    kind: 'craft',
    target_item: 'stick',
    target_item_id: mcData.itemsByName.stick.id,
    craft_times: 1,
    station: 'player_inventory'
  }]

  await assert.rejects(
    async () => executeCraftPlan(plan, mockBot, { mcData, journalPath }),
    /Inventory delta verification failed for stick/i
  )

  // Verify it did NOT retry blindly (exactly 1 craft attempt)
  assert.equal(craftAttempts, 1)

  // Verify journal on disk records needs_review
  const recovered = recoverCraftJournal(journalPath)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.journal.status, 'needs_review')
  assert.equal(recovered.journal.reason, 'uncertain_inventory_delta')

  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
})

test('Crafting Planner - Resuming from durable journal skips already-completed steps', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_craft_resume_test_'))
  const journalPath = path.join(tempDir, 'craft_resume.json')

  // Pre-seed journal with step 0 already completed
  const initialJournal = {
    missionId: 'craft_resume_1',
    status: 'in_progress',
    totalSteps: 2,
    completedSteps: 1,
    receipts: [{
      step_index: 0,
      target_item: 'oak_planks',
      delta: 4,
      consumed: { oak_log: 1 },
      total_after: 4
    }],
    timestamp: Date.now()
  }
  writeDurableCraftJournal(journalPath, initialJournal)

  const executedSteps = []
  const inventoryState = {
    items: () => [
      { name: 'oak_planks', count: 4, type: mcData.itemsByName.oak_planks.id }
    ]
  }

  const mockBot = {
    inventory: inventoryState,
    recipesFor: (id) => [{ result: { id, count: 4 } }],
    craft: async (recipe, count) => {
      executedSteps.push(recipe.result.id)
      inventoryState.items = () => [
        { name: 'oak_planks', count: 2, type: mcData.itemsByName.oak_planks.id },
        { name: 'stick', count: 4, type: mcData.itemsByName.stick.id }
      ]
    }
  }

  const plan = [
    { step_index: 0, kind: 'craft', target_item: 'oak_planks', target_item_id: mcData.itemsByName.oak_planks.id, craft_times: 1, station: 'player_inventory' },
    { step_index: 1, kind: 'craft', target_item: 'stick', target_item_id: mcData.itemsByName.stick.id, craft_times: 1, station: 'player_inventory', ingredients: { oak_planks: 2 } }
  ]

  const res = await executeCraftPlan(plan, mockBot, {
    mcData,
    journalPath,
    resumeJournalPath: journalPath
  })

  assert.equal(res.ok, true)
  assert.equal(res.completedSteps, 2)
  // Step 0 was skipped because it was already completed; only step 1 executed!
  assert.equal(executedSteps.length, 1)
  assert.equal(executedSteps[0], mcData.itemsByName.stick.id)

  const recovered = recoverCraftJournal(journalPath)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.journal.status, 'completed')
  assert.equal(recovered.journal.completedSteps, 2)
  assert.equal(recovered.journal.receipts.length, 2)

  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
})


test('Crafting Planner - Reconciles interrupted in_progress journal to needs_review with inventory check', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_craft_reconcile_test_'))
  const journalPath = path.join(tempDir, 'craft_interrupted.json')
  const inFlightJournal = {
    missionId: 'craft_crash_01',
    status: 'in_progress',
    totalSteps: 2,
    completedSteps: 1,
    receipts: [{
      step_index: 0,
      target_item: 'oak_planks',
      delta: 4,
      consumed: { oak_log: 1 },
      total_after: 4
    }],
    timestamp: Date.now() - 5000
  }
  writeDurableCraftJournal(journalPath, inFlightJournal)
  const mockInventory = { oak_planks: 2 }
  const reconcileRes = reconcileCraftJournal(journalPath, { inventory: mockInventory, mcData })
  assert.equal(reconcileRes.ok, true)
  assert.equal(reconcileRes.reconciled, true)
  assert.equal(reconcileRes.status, 'needs_review')
  assert.equal(reconcileRes.discrepanciesCount, 1)
  assert.equal(reconcileRes.discrepancies[0].target_item, 'oak_planks')
  assert.equal(reconcileRes.discrepancies[0].expectedMin, 4)
  assert.equal(reconcileRes.discrepancies[0].found, 2)
  const diskState = recoverCraftJournal(journalPath)
  assert.equal(diskState.journal.status, 'needs_review')
  assert.equal(diskState.journal.interruptedReason, 'process_terminated_in_flight')
  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
})

test('Crafting Planner - Corruption detection and automatic recovery from .bak file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_craft_corrupt_test_'))
  const journalPath = path.join(tempDir, 'craft_corrupt.json')
  const validJournal = {
    missionId: 'craft_valid_01',
    status: 'completed',
    totalSteps: 1,
    completedSteps: 1,
    receipts: [],
    timestamp: Date.now()
  }
  writeDurableCraftJournal(journalPath, validJournal)
  const updatedJournal = { ...validJournal, completedSteps: 2 }
  writeDurableCraftJournal(journalPath, updatedJournal)
  fs.writeFileSync(journalPath, 'corrupted bytes that are not json', 'utf8')
  const recovered = recoverCraftJournal(journalPath)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.recoveredFromBackup, true)
  assert.equal(recovered.journal.missionId, 'craft_valid_01')
  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
})
