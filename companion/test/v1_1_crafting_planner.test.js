'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const mcDataFactory = require('minecraft-data')
const mcData = mcDataFactory('1.21.1')

const {
  createCraftingPlanner,
  planCraft,
  executeCraftPlan,
  getStationType
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
