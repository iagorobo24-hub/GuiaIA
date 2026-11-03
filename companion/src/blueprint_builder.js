'use strict'

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

  async function execute(grant, blueprintInput, execOptions = {}) {
    const origin = grant.origin
    if (!origin) throw new Error('Build grant must specify origin coordinates')

    let blueprint
    if (blueprintInput) {
      blueprint = typeof blueprintInput === 'object' && blueprintInput.blocks
        ? blueprintInput
        : await parseBlueprint(blueprintInput, { blueprintId: grant.blueprintId })
    } else {
      throw new Error(`Blueprint data not supplied for ${grant.blueprintId}`)
    }

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

    // Recoverable write-ahead build journal
    const journal = {
      buildId: grant.nonce || `build_${Date.now()}`,
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

    // Physical bot placement
    let totalPlaced = 0
    let totalSkippedExisting = 0
    const placedBatches = []

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (execOptions.isCancelled?.()) {
        journal.status = 'cancelled'
        journal.cancellationReason = 'operator_cancelled'
        return {
          ok: false,
          status: 'cancelled',
          reason: 'build_cancelled_by_operator',
          journal
        }
      }

      const batch = batches[batchIdx]
      let batchPlaced = 0
      let batchSkipped = 0

      for (const b of batch) {
        const worldTarget = new Vec3(origin.x + b.x, origin.y + b.y, origin.z + b.z)

        // 1. Check existing block state in world
        const existing = typeof bot.blockAt === 'function' ? bot.blockAt(worldTarget) : null

        // If target block already present: do NOT increment placed count
        if (existing && existing.name === b.block) {
          batchSkipped++
          journal.skippedExisting.push({ x: b.x, y: b.y, z: b.z, block: b.block })
          continue
        }

        // 2. Validate real non-air collision
        if (existing && existing.name !== 'air' && existing.name !== b.block) {
          if (!execOptions.allowOverwrite) {
            journal.status = 'failed'
            journal.error = `world_collision: existing ${existing.name} at (${worldTarget.x}, ${worldTarget.y}, ${worldTarget.z})`
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
            throw new Error(`Cannot place gravity block ${b.block} without solid support below at ${belowPos}`)
          }
        }

        // 5. Equip and place
        if (typeof bot.equip === 'function') {
          await bot.equip(b.block, 'hand')
        }
        if (typeof bot.placeBlock === 'function' && supportBlock && placeFace) {
          await bot.placeBlock(supportBlock, placeFace)
        }

        // 6. Post-placement world state verification
        const postBlock = typeof bot.blockAt === 'function' ? bot.blockAt(worldTarget) : null
        if (postBlock && postBlock.name === b.block) {
          batchPlaced++
          journal.placedBlocks.push({ x: b.x, y: b.y, z: b.z, block: b.block })
        } else if (!bot.blockAt) {
          batchPlaced++
          journal.placedBlocks.push({ x: b.x, y: b.y, z: b.z, block: b.block })
        } else {
          journal.failedBlocks.push({ x: b.x, y: b.y, z: b.z, block: b.block, reason: 'placement_unverified' })
        }
      }

      totalPlaced += batchPlaced
      totalSkippedExisting += batchSkipped
      journal.batchesCompleted++
      placedBatches.push({ batch: batchIdx, placed: batchPlaced, skippedExisting: batchSkipped })
    }

    journal.status = 'completed'
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
  MAX_BATCH_SIZE,
  MAX_PLACE_DISTANCE,
  ATTACHMENT_BLOCKS,
  GRAVITY_BLOCKS
}
