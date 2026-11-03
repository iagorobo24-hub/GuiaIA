'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const {
  writeDurableCraftJournal,
  recoverCraftJournal,
  reconcileCraftJournal
} = require('../src/crafting_planner')

const {
  writeDurableBuildJournal,
  recoverBuildJournal,
  reconcileBuildJournal
} = require('../src/blueprint_builder')

test('Durable Craft Journal - fsync, checksums, and .bak recovery', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-craft-persist-'))
  const journalPath = path.join(tmpDir, 'craft_test.json')

  try {
    const journalData1 = {
      missionId: 'craft_m1',
      sequence: 1,
      completedSteps: 1,
      receipts: [{ target_item: 'oak_planks', delta: 4 }]
    }

    // 1. Initial write
    writeDurableCraftJournal(journalPath, journalData1)
    assert.equal(fs.existsSync(journalPath), true)

    const recovered1 = recoverCraftJournal(journalPath)
    assert.equal(recovered1.ok, true)
    assert.equal(recovered1.verifiedChecksum, true)
    assert.equal(recovered1.journal.sequence, 1)

    // 2. Second write updates .bak
    const journalData2 = {
      missionId: 'craft_m1',
      sequence: 2,
      completedSteps: 2,
      receipts: [
        { target_item: 'oak_planks', delta: 4 },
        { target_item: 'stick', delta: 4 }
      ]
    }
    writeDurableCraftJournal(journalPath, journalData2)
    assert.equal(fs.existsSync(`${journalPath}.bak`), true)

    const recovered2 = recoverCraftJournal(journalPath)
    assert.equal(recovered2.ok, true)
    assert.equal(recovered2.journal.sequence, 2)

    // 3. Corrupt primary (simulate torn write)
    fs.writeFileSync(journalPath, '{"format": "guiaia_durable_craft_journal_v1", "sha256": "corrupted", "payload": {}}')
    const recoveredAfterTornWrite = recoverCraftJournal(journalPath)
    assert.equal(recoveredAfterTornWrite.ok, true)
    assert.equal(recoveredAfterTornWrite.recoveredFromBackup, true)
    assert.equal(recoveredAfterTornWrite.journal.sequence, 1) // Fallback to intact backup

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('Durable Craft Journal - Rollback Detection against High-Water Mark', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-craft-rollback-'))
  const journalPath = path.join(tmpDir, 'craft_rollback.json')

  try {
    const oldJournal = {
      missionId: 'craft_rb_1',
      sequence: 3,
      completedSteps: 3,
      highestWitnessedSequence: 5 // Internal regression check
    }

    writeDurableCraftJournal(journalPath, oldJournal)

    // 1. Internal witness regression fails closed
    const internalRollback = recoverCraftJournal(journalPath)
    assert.equal(internalRollback.ok, false)
    assert.equal(internalRollback.reason, 'ROLLBACK_DETECTED')

    // 2. External high-water mark sequence regression fails closed
    const validJournal = {
      missionId: 'craft_rb_1',
      sequence: 4,
      completedSteps: 4
    }
    writeDurableCraftJournal(journalPath, validJournal)

    const externalRollbackSeq = recoverCraftJournal(journalPath, { highWaterSequence: 6 })
    assert.equal(externalRollbackSeq.ok, false)
    assert.equal(externalRollbackSeq.reason, 'ROLLBACK_DETECTED')
    assert.match(externalRollbackSeq.message, /rollback rejected/i)

    // 3. External high-water step regression fails closed
    const externalRollbackStep = recoverCraftJournal(journalPath, { highWaterStep: 5 })
    assert.equal(externalRollbackStep.ok, false)
    assert.equal(externalRollbackStep.reason, 'ROLLBACK_DETECTED')

    // 4. Equal or higher sequence succeeds
    const okRecover = recoverCraftJournal(journalPath, { highWaterSequence: 4 })
    assert.equal(okRecover.ok, true)
    assert.equal(okRecover.journal.sequence, 4)

    // 5. Reconcile craft journal propagates ROLLBACK_DETECTED
    const reconcileRes = reconcileCraftJournal(journalPath, { highWaterSequence: 6 })
    assert.equal(reconcileRes.ok, false)
    assert.equal(reconcileRes.reason, 'ROLLBACK_DETECTED')

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('Durable Build Journal - Rollback Detection and .bak recovery', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-build-rollback-'))
  const journalPath = path.join(tmpDir, 'build_rollback.json')

  try {
    const buildData = {
      buildId: 'b_01',
      blueprintId: 'bp_wall',
      sequence: 2,
      placedBlocks: [{ x: 0, y: 0, z: 0, block: 'cobblestone' }]
    }

    writeDurableBuildJournal(journalPath, buildData)

    // Rollback detection against high-water sequence
    const rollbackRes = recoverBuildJournal(journalPath, { highWaterSequence: 5 })
    assert.equal(rollbackRes.ok, false)
    assert.equal(rollbackRes.reason, 'ROLLBACK_DETECTED')

    // Rollback detection against placed blocks count
    const rollbackPlaced = recoverBuildJournal(journalPath, { highWaterPlaced: 3 })
    assert.equal(rollbackPlaced.ok, false)
    assert.equal(rollbackPlaced.reason, 'ROLLBACK_DETECTED')

    // Valid recovery with matching sequence
    const validRecover = recoverBuildJournal(journalPath, { highWaterSequence: 2 })
    assert.equal(validRecover.ok, true)

    // Reconcile propagates ROLLBACK_DETECTED
    const reconcileRes = reconcileBuildJournal(journalPath, { highWaterSequence: 5 })
    assert.equal(reconcileRes.ok, false)
    assert.equal(reconcileRes.reason, 'ROLLBACK_DETECTED')

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
