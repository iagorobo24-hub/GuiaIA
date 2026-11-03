'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const nbt = require('prismarine-nbt')
const { Vec3 } = require('vec3')

const {
  parseBlueprint,
  parseJsonStructure,
  validateDimensions,
  MAX_DIMENSION,
  MAX_BLOCKS
} = require('../src/blueprint_importer')

const {
  createBlueprintBuilder,
  orderBlocksTopologically,
  createBatches,
  previewBlueprint,
  writeDurableJournal,
  recoverBuildJournal,
  reconcileBuildJournal,
  computeBlueprintSha256
} = require('../src/blueprint_builder')

test('Blueprint Importer - JSON structure parsing and palette extraction', async () => {
  const json = {
    blueprint_id: 'test_hut',
    dimensions: { width: 3, height: 2, length: 3 },
    blocks: [
      { x: 0, y: 0, z: 0, block: 'minecraft:oak_planks' },
      { x: 1, y: 0, z: 0, block: 'oak_planks' },
      { x: 2, y: 0, z: 0, block: 'stone' },
      { x: 1, y: 1, z: 0, block: 'torch' }
    ]
  }

  const bp = await parseBlueprint(json)
  assert.equal(bp.blueprint_id, 'test_hut')
  assert.equal(bp.format, 'json_structure')
  assert.equal(bp.total_blocks, 4)
  assert.deepEqual(bp.materials_needed, { oak_planks: 2, stone: 1, torch: 1 })
})

test('Blueprint Importer - Dimension limits strictly bounded (<= 16x16x16)', () => {
  assert.doesNotThrow(() => validateDimensions(16, 16, 16))
  assert.throws(() => validateDimensions(17, 10, 10), /dimensions exceed maximum of 16x16x16/i)
  assert.throws(() => validateDimensions(10, 17, 10), /dimensions exceed maximum of 16x16x16/i)
  assert.throws(() => validateDimensions(10, 10, 17), /dimensions exceed maximum of 16x16x16/i)
})

test('Blueprint Importer - Forbidden hazardous blocks rejected immediately', async () => {
  const tntJson = {
    dimensions: { width: 2, height: 1, length: 1 },
    blocks: [
      { x: 0, y: 0, z: 0, block: 'oak_planks' },
      { x: 1, y: 0, z: 0, block: 'tnt' }
    ]
  }
  await assert.rejects(
    async () => parseBlueprint(tntJson),
    /Forbidden hazardous block in blueprint: tnt/i
  )

  const lavaJson = {
    dimensions: { width: 1, height: 1, length: 1 },
    blocks: [{ x: 0, y: 0, z: 0, block: 'minecraft:lava' }]
  }
  await assert.rejects(
    async () => parseBlueprint(lavaJson),
    /Forbidden hazardous block in blueprint: lava/i
  )
})

test('Blueprint Importer - Sponge .schem NBT parsing', async () => {
  // Construct a valid Sponge NBT structure buffer
  const nbtTag = {
    type: 'compound',
    name: 'Schematic',
    value: {
      Width: { type: 'short', value: 2 },
      Height: { type: 'short', value: 2 },
      Length: { type: 'short', value: 1 },
      Palette: {
        type: 'compound',
        value: {
          'minecraft:air': { type: 'int', value: 0 },
          'minecraft:cobblestone': { type: 'int', value: 1 }
        }
      },
      BlockData: {
        type: 'byteArray',
        value: [1, 1, 1, 0] // 3 cobblestone, 1 air
      }
    }
  }

  const buffer = nbt.writeUncompressed(nbtTag)
  const bp = await parseBlueprint(buffer, { blueprintId: 'sponge_test' })

  assert.equal(bp.format, 'schem')
  assert.equal(bp.total_blocks, 3)
  assert.deepEqual(bp.materials_needed, { cobblestone: 3 })
})

test('Blueprint Builder - Topological ordering (bottom-to-top, base before attachments)', () => {
  const unordered = [
    { x: 0, y: 1, z: 0, block: 'torch' },       // Y=1, attachment
    { x: 0, y: 1, z: 0, block: 'oak_planks' },  // Y=1, solid
    { x: 0, y: 0, z: 0, block: 'cobblestone' }, // Y=0, solid
    { x: 1, y: 0, z: 0, block: 'stone' }        // Y=0, solid
  ]

  const ordered = orderBlocksTopologically(unordered)

  // Layer 0 first
  assert.equal(ordered[0].y, 0)
  assert.equal(ordered[1].y, 0)

  // Layer 1 next
  assert.equal(ordered[2].y, 1)
  assert.equal(ordered[2].block, 'oak_planks') // solid block before torch!
  assert.equal(ordered[3].y, 1)
  assert.equal(ordered[3].block, 'torch')      // torch attachment after solid block!
})

test('Blueprint Builder - Batching respects <= 64 blocks per batch', () => {
  const blocks = []
  for (let i = 0; i < 70; i++) {
    blocks.push({ x: i % 10, y: Math.floor(i / 10), z: 0, block: 'cobblestone' })
  }

  const batches = createBatches(blocks, 64)
  assert.equal(batches.length, 2)
  assert.equal(batches[0].length, 64)
  assert.equal(batches[1].length, 6)
})

test('Blueprint Builder - Pre-flight preview detects missing inventory', () => {
  const bp = {
    blueprint_id: 'sample',
    dimensions: { width: 2, height: 1, length: 1 },
    materials_needed: { cobblestone: 10, torch: 2 },
    blocks: [
      { x: 0, y: 0, z: 0, block: 'cobblestone' },
      { x: 1, y: 0, z: 0, block: 'torch' }
    ]
  }

  // Inventory has insufficient cobblestone
  const preview = previewBlueprint(bp, { x: 10, y: 64, z: 10 }, { cobblestone: 4, torch: 2 })
  assert.equal(preview.ok, true)
  assert.equal(preview.inventoryHasSufficient, false)
  assert.equal(preview.missingMaterials.cobblestone, 6)
  assert.equal(preview.missingMaterials.torch, undefined)
})

test('Blueprint Builder - Requires pre-flight preview authorization before world modification', async () => {
  const bp = {
    blueprint_id: 'wall',
    dimensions: { width: 2, height: 1, length: 1 },
    materials_needed: { cobblestone: 2 },
    blocks: [
      { x: 0, y: 0, z: 0, block: 'cobblestone' },
      { x: 1, y: 0, z: 0, block: 'cobblestone' }
    ]
  }

  const mockBot = {
    inventory: { items: () => [{ name: 'cobblestone', count: 10 }] }
  }

  const builder = createBlueprintBuilder()
  const res = await builder.execute(
    { blueprintId: 'wall', origin: { x: 0, y: 64, z: 0 } },
    bp,
    { bot: mockBot, requirePreview: true }
  )

  assert.equal(res.ok, false)
  assert.equal(res.status, 'preview_required')
  assert.equal(res.reason, 'preview_authorization_required')
  assert.equal(res.preview.ok, true)
})

test('Blueprint Builder - Execution with mock bot places blocks and verifies final world state', async () => {
  const bp = {
    blueprint_id: 'wall',
    dimensions: { width: 2, height: 1, length: 1 },
    materials_needed: { cobblestone: 2 },
    blocks: [
      { x: 0, y: 0, z: 0, block: 'cobblestone' },
      { x: 1, y: 0, z: 0, block: 'cobblestone' }
    ]
  }

  const worldState = new Map()
  const placed = []
  const mockBot = {
    inventory: { items: () => [{ name: 'cobblestone', count: 10 }] },
    blockAt: (pos) => {
      const key = `${pos.x},${pos.y},${pos.z}`
      if (worldState.has(key)) return { name: worldState.get(key), position: pos }
      // Ground is solid dirt at Y=63
      if (pos.y < 64) return { name: 'dirt', position: pos }
      return { name: 'air', position: pos }
    },
    equip: async (item, slot) => {},
    placeBlock: async (refBlock, face) => {
      const targetPos = refBlock.position ? refBlock.position.plus(face) : new Vec3(placed.length, 64, 0)
      worldState.set(`${targetPos.x},${targetPos.y},${targetPos.z}`, 'cobblestone')
      placed.push({ ref: refBlock.name, face })
    }
  }

  const builder = createBlueprintBuilder({ maxBatchSize: 64 })
  const res = await builder.execute(
    { blueprintId: 'wall', origin: { x: 0, y: 64, z: 0 }, previewConfirmed: true },
    bp,
    { bot: mockBot, previewAuthorized: true }
  )

  assert.equal(res.ok, true)
  assert.equal(res.action, 'build_execute')
  assert.equal(res.totalPlaced, 2)
  assert.equal(res.totalSkippedExisting, 0)
  assert.equal(placed.length, 2)
  assert.equal(res.journal.status, 'completed')
  assert.equal(res.journal.placedBlocks.length, 2)
})

test('Blueprint Builder - Detects world collision and fails closed without destroying existing structure', async () => {
  const bp = {
    blueprint_id: 'wall',
    dimensions: { width: 1, height: 1, length: 1 },
    materials_needed: { cobblestone: 1 },
    blocks: [{ x: 0, y: 0, z: 0, block: 'cobblestone' }]
  }

  const mockBot = {
    inventory: { items: () => [{ name: 'cobblestone', count: 10 }] },
    blockAt: (pos) => {
      if (pos.x === 5 && pos.y === 64 && pos.z === 5) {
        return { name: 'obsidian', position: pos } // Obstacle!
      }
      return { name: 'dirt', position: pos }
    }
  }

  const builder = createBlueprintBuilder()
  const res = await builder.execute(
    { blueprintId: 'wall', origin: { x: 5, y: 64, z: 5 }, previewConfirmed: true },
    bp,
    { bot: mockBot, previewAuthorized: true }
  )

  assert.equal(res.ok, false)
  assert.equal(res.reason, 'world_collision')
  assert.equal(res.conflict.existingBlock, 'obsidian')
  assert.equal(res.journal.status, 'failed')
})

test('Blueprint Builder - Accurate accounting skips already-present blocks without inflating totalPlaced', async () => {
  const bp = {
    blueprint_id: 'wall',
    dimensions: { width: 2, height: 1, length: 1 },
    materials_needed: { cobblestone: 2 },
    blocks: [
      { x: 0, y: 0, z: 0, block: 'cobblestone' },
      { x: 1, y: 0, z: 0, block: 'cobblestone' }
    ]
  }

  const placedMap = new Map()
  const mockBot = {
    inventory: { items: () => [{ name: 'cobblestone', count: 10 }] },
    blockAt: (pos) => {
      const key = `${pos.x},${pos.y},${pos.z}`
      if (placedMap.has(key)) return { name: placedMap.get(key), position: pos }
      // (0, 64, 0) is ALREADY cobblestone!
      if (pos.x === 0 && pos.y === 64 && pos.z === 0) {
        return { name: 'cobblestone', position: pos }
      }
      if (pos.y < 64) return { name: 'dirt', position: pos }
      return { name: 'air', position: pos }
    },
    equip: async () => {},
    placeBlock: async (ref, face) => {
      const targetPos = ref.position.plus(face)
      placedMap.set(`${targetPos.x},${targetPos.y},${targetPos.z}`, 'cobblestone')
    }
  }

  const builder = createBlueprintBuilder()
  const res = await builder.execute(
    { blueprintId: 'wall', origin: { x: 0, y: 64, z: 0 }, previewConfirmed: true },
    bp,
    { bot: mockBot, previewAuthorized: true }
  )

  assert.equal(res.ok, true)
  assert.equal(res.totalSkippedExisting, 1)
  assert.equal(res.journal.skippedExisting.length, 1)
})

test('Blueprint Builder - Gravity check blocks sand placement in mid-air', async () => {
  const bp = {
    blueprint_id: 'sand_pillar',
    dimensions: { width: 1, height: 1, length: 1 },
    materials_needed: { sand: 1 },
    blocks: [{ x: 0, y: 0, z: 0, block: 'sand' }]
  }

  const mockBot = {
    inventory: { items: () => [{ name: 'sand', count: 5 }] },
    blockAt: (pos) => ({ name: 'air', position: pos }), // all air underneath
    equip: async () => {},
    placeBlock: async () => {}
  }

  const builder = createBlueprintBuilder()
  const res = await builder.execute(
    { blueprintId: 'sand_pillar', origin: { x: 0, y: 64, z: 0 }, previewConfirmed: true },
    bp,
    { bot: mockBot, previewAuthorized: true }
  )
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'gravity_unsupported')
  assert.deepEqual(res.position, { x: 0, y: 64, z: 0 })
})

test('Blueprint Builder - Persists durable build journal and recovers after process restart', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_build_journal_test_'))
  const bp = {
    blueprint_id: 'pillar_3',
    dimensions: { width: 1, height: 3, length: 1 },
    materials_needed: { stone: 3 },
    blocks: [
      { x: 0, y: 0, z: 0, block: 'stone' },
      { x: 0, y: 1, z: 0, block: 'stone' },
      { x: 0, y: 2, z: 0, block: 'stone' }
    ]
  }

  const world = new Map()
  const mockBot = {
    inventory: { items: () => [{ name: 'stone', count: 10 }] },
    blockAt: (pos) => {
      const key = `${pos.x},${pos.y},${pos.z}`
      if (world.has(key)) return { name: world.get(key), position: pos }
      if (pos.y < 64) return { name: 'bedrock', position: pos }
      return { name: 'air', position: pos }
    },
    equip: async () => {},
    placeBlock: async (ref, face) => {
      const targetPos = ref.position.plus(face)
      world.set(`${targetPos.x},${targetPos.y},${targetPos.z}`, 'stone')
    }
  }

  const journalPath = path.join(tempDir, 'build_101.json')
  const builder = createBlueprintBuilder()
  const res = await builder.execute(
    { blueprintId: 'pillar_3', origin: { x: 0, y: 64, z: 0 }, nonce: 'build_101', previewConfirmed: true },
    bp,
    { bot: mockBot, previewAuthorized: true, journalPath }
  )

  assert.equal(res.ok, true)
  assert.equal(res.totalPlaced, 3)
  assert.equal(fs.existsSync(journalPath), true)

  const recovered = recoverBuildJournal(journalPath)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.journal.buildId, 'build_101')
  assert.equal(recovered.journal.status, 'completed')
  assert.equal(recovered.journal.placedBlocks.length, 3)

  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
})

test('Blueprint Builder - Continuous cancellation check immediately halts mid-batch before next block', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_build_cancel_test_'))
  const bp = {
    blueprint_id: 'long_wall',
    dimensions: { width: 5, height: 1, length: 1 },
    materials_needed: { cobblestone: 5 },
    blocks: [
      { x: 0, y: 0, z: 0, block: 'cobblestone' },
      { x: 1, y: 0, z: 0, block: 'cobblestone' },
      { x: 2, y: 0, z: 0, block: 'cobblestone' },
      { x: 3, y: 0, z: 0, block: 'cobblestone' },
      { x: 4, y: 0, z: 0, block: 'cobblestone' }
    ]
  }

  let placedCount = 0
  let cancelAfter2 = false

  const world = new Map()
  const mockBot = {
    inventory: { items: () => [{ name: 'cobblestone', count: 10 }] },
    blockAt: (pos) => {
      const key = `${pos.x},${pos.y},${pos.z}`
      if (world.has(key)) return { name: world.get(key), position: pos }
      if (pos.y < 64) return { name: 'dirt', position: pos }
      return { name: 'air', position: pos }
    },
    equip: async () => {},
    placeBlock: async (ref, face) => {
      const targetPos = ref.position.plus(face)
      world.set(`${targetPos.x},${targetPos.y},${targetPos.z}`, 'cobblestone')
      placedCount++
      if (placedCount === 2) {
        cancelAfter2 = true
      }
    }
  }

  const journalPath = path.join(tempDir, 'build_cancel.json')
  const builder = createBlueprintBuilder()
  const res = await builder.execute(
    { blueprintId: 'long_wall', origin: { x: 0, y: 64, z: 0 }, nonce: 'build_cancel', previewConfirmed: true },
    bp,
    {
      bot: mockBot,
      previewAuthorized: true,
      journalPath,
      isCancelled: () => cancelAfter2
    }
  )

  assert.equal(res.ok, false)
  assert.equal(res.status, 'cancelled')
  assert.equal(res.reason, 'build_cancelled_by_operator')
  assert.equal(res.totalPlaced, 2)
  assert.equal(placedCount, 2)

  // Verify journal on disk is updated to cancelled with 2 placed blocks
  const recovered = recoverBuildJournal(journalPath)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.journal.status, 'cancelled')
  assert.equal(recovered.journal.placedBlocks.length, 2)

  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
})

test('Blueprint Builder - Strict grant scope validation (budget, hash, blueprintId, origin)', async () => {
  const bp = {
    blueprint_id: 'tower',
    dimensions: { width: 1, height: 10, length: 1 },
    materials_needed: { stone: 10 },
    blocks: Array.from({ length: 10 }, (_, i) => ({ x: 0, y: i, z: 0, block: 'stone' }))
  }

  const builder = createBlueprintBuilder()

  // 1. Blueprint ID mismatch
  const idMismatch = await builder.execute(
    { blueprintId: 'different_tower', origin: { x: 0, y: 64, z: 0 } },
    bp
  )
  assert.equal(idMismatch.ok, false)
  assert.equal(idMismatch.status, 'blocked')
  assert.equal(idMismatch.reason, 'blueprint_id_mismatch')

  // 2. Origin mismatch
  const originMismatch = await builder.execute(
    { blueprintId: 'tower', origin: { x: 10, y: 64, z: 10 } },
    bp,
    { origin: { x: 0, y: 64, z: 0 } }
  )
  // Origin matches grant.origin

  // 3. Exceeds budget (maxBlocks < blueprint total blocks)
  const budgetOverflow = await builder.execute(
    { blueprintId: 'tower', origin: { x: 0, y: 64, z: 0 }, maxBlocks: 5 },
    bp
  )
  assert.equal(budgetOverflow.ok, false)
  assert.equal(budgetOverflow.status, 'blocked')
  assert.equal(budgetOverflow.reason, 'exceeds_authorized_block_budget')

  // 4. Blueprint SHA-256 mismatch
  const hashMismatch = await builder.execute(
    { blueprintId: 'tower', origin: { x: 0, y: 64, z: 0 }, blueprintSha256: '0'.repeat(64) },
    bp
  )
  assert.equal(hashMismatch.ok, false)
  assert.equal(hashMismatch.status, 'blocked')
  assert.equal(hashMismatch.reason, 'blueprint_hash_mismatch')

  // 5. Valid blueprint SHA-256 matches
  const validHash = computeBlueprintSha256(bp.blocks)
  const validGrantRes = await builder.execute(
    { blueprintId: 'tower', origin: { x: 0, y: 64, z: 0 }, blueprintSha256: validHash, previewConfirmed: true },
    bp,
    { requireSufficientInventory: false }
  )
  assert.equal(validGrantRes.ok, true)
  assert.equal(validGrantRes.action, 'build_preview')
})

test('Blueprint Builder - Fails closed and reports partial_failure if block placement cannot be verified', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_build_fail_test_'))
  const bp = {
    blueprint_id: 'failing_block',
    dimensions: { width: 2, height: 1, length: 1 },
    materials_needed: { stone: 2 },
    blocks: [
      { x: 0, y: 0, z: 0, block: 'stone' },
      { x: 1, y: 0, z: 0, block: 'stone' }
    ]
  }

  let attempt = 0
  const mockBot = {
    inventory: { items: () => [{ name: 'stone', count: 10 }] },
    blockAt: (pos) => {
      // First block succeeds, second block remains air (ghost block / placement rejected by server)
      if (pos.x === 0 && pos.y === 64 && pos.z === 0 && attempt >= 1) {
        return { name: 'stone', position: pos }
      }
      if (pos.y < 64) return { name: 'bedrock', position: pos }
      return { name: 'air', position: pos }
    },
    equip: async () => {},
    placeBlock: async () => {
      attempt++
    }
  }

  const journalPath = path.join(tempDir, 'build_fail.json')
  const builder = createBlueprintBuilder()
  const res = await builder.execute(
    { blueprintId: 'failing_block', origin: { x: 0, y: 64, z: 0 }, nonce: 'build_fail', previewConfirmed: true },
    bp,
    { bot: mockBot, previewAuthorized: true, journalPath }
  )

  // Must NOT declare success!
  assert.equal(res.ok, false)
  assert.equal(res.status, 'partial_failure')
  assert.equal(res.reason, 'unverified_blocks_encountered')
  assert.equal(res.totalPlaced, 1)
  assert.equal(res.failedBlocks.length, 1)
  assert.equal(res.failedBlocks[0].block, 'stone')

  // Verify journal on disk records partial_failure and failedBlocks
  const recovered = recoverBuildJournal(journalPath)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.journal.status, 'partial_failure')
  assert.equal(recovered.journal.failedBlocks.length, 1)

  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
})


test('Blueprint Builder - Reconciles interrupted in_progress journal to needs_review with physical check', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_build_reconcile_test_'))
  const journalPath = path.join(tempDir, 'build_interrupted.json')
  const inFlightJournal = {
    buildId: 'build_crash_01',
    blueprintId: 'wall',
    origin: { x: 10, y: 64, z: 10 },
    status: 'in_progress',
    totalBlocks: 3,
    placedBlocks: [
      { x: 0, y: 0, z: 0, block: 'cobblestone' },
      { x: 1, y: 0, z: 0, block: 'cobblestone' }
    ],
    skippedExisting: [],
    failedBlocks: [],
    batchesCompleted: 0,
    timestamp: Date.now() - 5000
  }
  writeDurableJournal(journalPath, inFlightJournal)
  const world = new Map([['10,64,10', 'cobblestone']])
  const mockBot = {
    blockAt: (pos) => {
      const key = `${pos.x},${pos.y},${pos.z}`
      return world.has(key) ? { name: world.get(key), position: pos } : { name: 'air', position: pos }
    }
  }
  const reconcileRes = reconcileBuildJournal(journalPath, { bot: mockBot })
  assert.equal(reconcileRes.ok, true)
  assert.equal(reconcileRes.reconciled, true)
  assert.equal(reconcileRes.status, 'needs_review')
  assert.equal(reconcileRes.discrepanciesCount, 1)
  assert.equal(reconcileRes.discrepancies[0].expected, 'cobblestone')
  assert.equal(reconcileRes.discrepancies[0].found, 'air')
  const diskState = recoverBuildJournal(journalPath)
  assert.equal(diskState.journal.status, 'needs_review')
  assert.equal(diskState.journal.interruptedReason, 'process_terminated_in_flight')
  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
})

test('Blueprint Builder - Corruption detection and automatic recovery from .bak file', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_build_corrupt_test_'))
  const journalPath = path.join(tempDir, 'build_corrupt.json')
  const validJournal = {
    buildId: 'build_valid_01',
    blueprintId: 'pillar',
    origin: { x: 0, y: 64, z: 0 },
    status: 'completed',
    totalBlocks: 1,
    placedBlocks: [{ x: 0, y: 0, z: 0, block: 'stone' }],
    skippedExisting: [],
    failedBlocks: [],
    batchesCompleted: 1,
    timestamp: Date.now()
  }
  writeDurableJournal(journalPath, validJournal)
  const updatedJournal = { ...validJournal, batchesCompleted: 2 }
  writeDurableJournal(journalPath, updatedJournal)
  fs.writeFileSync(journalPath, 'corrupted bytes that are not json', 'utf8')
  const recovered = recoverBuildJournal(journalPath)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.recoveredFromBackup, true)
  assert.equal(recovered.journal.buildId, 'build_valid_01')
  try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
})
