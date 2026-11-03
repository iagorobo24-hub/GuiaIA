'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const { openMission } = require('../src/mission')
const { openDepositJournal } = require('../src/deposit')

describe('V1 Durable Journal Guided Reconciliation (TASK-2.2)', () => {
  describe('Mission Journal Reconciliation', () => {
    test('reconcile reject when phase is ready (reconciliation not needed)', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-mission-rec-'))
      const journal = openMission(tmpDir, {
        sandboxOnly: true,
        ownerName: 'OperatorSteve',
        targets: [{ x: 1, y: 64, z: 1 }]
      })

      const res = journal.reconcile('retry')
      assert.equal(res.ok, false)
      assert.equal(res.reason, 'reconciliation_not_required')
      journal.close()
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })

    test('reconcile cancel when needs_review', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-mission-rec-'))
      const journal = openMission(tmpDir, {
        sandboxOnly: true,
        ownerName: 'OperatorSteve',
        targets: [{ x: 1, y: 64, z: 1 }]
      })

      // Simulate mid-dispatch crash by editing the journal on disk
      const filePath = path.join(tmpDir, 'mission.json')
      journal.close()

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      raw.phase = 'dispatching'
      raw.operationId = crypto.randomUUID()
      fs.writeFileSync(filePath, JSON.stringify(raw) + '\n')

      // Re-opening automatically transitions dispatching -> needs_review
      const reloaded = openMission(tmpDir)
      assert.equal(reloaded.view().phase, 'needs_review')

      // Operator reconciles: cancel
      const res = reloaded.reconcile('cancel')
      assert.equal(res.ok, true)
      assert.equal(res.decision, 'cancelled')
      assert.equal(res.state.phase, 'cancelled')
      reloaded.close()

      // Reload verifies durable cancellation
      const verified = openMission(tmpDir)
      assert.equal(verified.view().phase, 'cancelled')
      verified.close()
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })

    test('reconcile retry when needs_review', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-mission-rec-'))
      const journal = openMission(tmpDir, {
        sandboxOnly: true,
        ownerName: 'OperatorSteve',
        targets: [{ x: 1, y: 64, z: 1 }]
      })
      const filePath = path.join(tmpDir, 'mission.json')
      journal.close()

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      raw.phase = 'dispatching'
      raw.operationId = crypto.randomUUID()
      fs.writeFileSync(filePath, JSON.stringify(raw) + '\n')

      const reloaded = openMission(tmpDir)
      assert.equal(reloaded.view().phase, 'needs_review')

      // Operator reconciles: retry
      const res = reloaded.reconcile('retry')
      assert.equal(res.ok, true)
      assert.equal(res.decision, 'ready_for_retry')
      assert.equal(res.state.phase, 'ready')
      assert.equal(res.state.operationId, null)
      reloaded.close()

      const verified = openMission(tmpDir)
      assert.equal(verified.view().phase, 'ready')
      verified.close()
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })

    test('reconcile mark_step_completed advances index and completes mission', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-mission-rec-'))
      const journal = openMission(tmpDir, {
        sandboxOnly: true,
        ownerName: 'OperatorSteve',
        targets: [
          { x: 1, y: 64, z: 1, block: 'oak_log' },
          { x: 1, y: 65, z: 1, block: 'oak_log' }
        ],
        v1Batch: true
      })
      const filePath = path.join(tmpDir, 'mission.json')
      journal.close()

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      raw.phase = 'dispatching'
      raw.operationId = crypto.randomUUID()
      fs.writeFileSync(filePath, JSON.stringify(raw) + '\n')

      const reloaded = openMission(tmpDir)
      assert.equal(reloaded.view().phase, 'needs_review')

      // Step 1 completed manually
      const res1 = reloaded.reconcile('mark_step_completed')
      assert.equal(res1.ok, true)
      assert.equal(res1.state.index, 1)
      assert.equal(res1.state.phase, 'ready') // target 2 still remaining

      // Simulate interruption on step 2
      reloaded.close()
      const raw2 = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      raw2.phase = 'dispatching'
      raw2.operationId = crypto.randomUUID()
      fs.writeFileSync(filePath, JSON.stringify(raw2) + '\n')

      const reloaded2 = openMission(tmpDir)
      assert.equal(reloaded2.view().phase, 'needs_review')

      // Step 2 completed manually
      const res2 = reloaded2.reconcile('mark_step_completed')
      assert.equal(res2.ok, true)
      assert.equal(res2.state.index, 2)
      assert.equal(res2.state.phase, 'completed')
      reloaded2.close()

      // Reload verifies fully completed durable journal
      const finalCheck = openMission(tmpDir)
      assert.equal(finalCheck.view().phase, 'completed')
      assert.equal(finalCheck.view().receipts.length, 2)
      finalCheck.close()
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })
  })

  describe('Deposit Journal Reconciliation', () => {
    test('reconcile reject when phase is ready (reconciliation not needed)', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-deposit-rec-'))
      const journal = openDepositJournal(tmpDir, {
        sandboxOnly: true,
        ownerName: 'OperatorSteve',
        chest: { x: 10, y: 64, z: 10 },
        items: [{ name: 'oak_log', count: 1 }]
      })

      const res = journal.reconcile('retry')
      assert.equal(res.ok, false)
      assert.equal(res.reason, 'reconciliation_not_required')
      journal.close()
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })

    test('reconcile cancel when needs_review', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-deposit-rec-'))
      const journal = openDepositJournal(tmpDir, {
        sandboxOnly: true,
        ownerName: 'OperatorSteve',
        chest: { x: 10, y: 64, z: 10 },
        items: [{ name: 'oak_log', count: 1 }]
      })
      const filePath = path.join(tmpDir, 'deposit.json')
      journal.close()

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      raw.phase = 'transferring'
      raw.operationId = crypto.randomUUID()
      fs.writeFileSync(filePath, JSON.stringify(raw) + '\n')

      // Re-opening automatically transitions transferring -> needs_review
      const reloaded = openDepositJournal(tmpDir)
      assert.equal(reloaded.view().phase, 'needs_review')

      const res = reloaded.reconcile('cancel')
      assert.equal(res.ok, true)
      assert.equal(res.decision, 'cancelled')
      assert.equal(res.state.phase, 'cancelled')
      reloaded.close()

      const verified = openDepositJournal(tmpDir)
      assert.equal(verified.view().phase, 'cancelled')
      verified.close()
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })

    test('reconcile retry when needs_review', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-deposit-rec-'))
      const journal = openDepositJournal(tmpDir, {
        sandboxOnly: true,
        ownerName: 'OperatorSteve',
        chest: { x: 10, y: 64, z: 10 },
        items: [{ name: 'oak_log', count: 1 }]
      })
      const filePath = path.join(tmpDir, 'deposit.json')
      journal.close()

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      raw.phase = 'transferring'
      raw.operationId = crypto.randomUUID()
      fs.writeFileSync(filePath, JSON.stringify(raw) + '\n')

      const reloaded = openDepositJournal(tmpDir)
      assert.equal(reloaded.view().phase, 'needs_review')

      const res = reloaded.reconcile('retry')
      assert.equal(res.ok, true)
      assert.equal(res.decision, 'ready_for_retry')
      assert.equal(res.state.phase, 'ready')
      assert.equal(res.state.operationId, null)
      reloaded.close()

      const verified = openDepositJournal(tmpDir)
      assert.equal(verified.view().phase, 'ready')
      verified.close()
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })

    test('reconcile mark_step_completed completes deposit and satisfies durable validation', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-deposit-rec-'))
      const journal = openDepositJournal(tmpDir, {
        sandboxOnly: true,
        ownerName: 'OperatorSteve',
        chest: { x: 10, y: 64, z: 10 },
        items: [{ name: 'oak_log', count: 2 }]
      })
      const filePath = path.join(tmpDir, 'deposit.json')
      journal.close()

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      raw.phase = 'transferring'
      raw.operationId = crypto.randomUUID()
      fs.writeFileSync(filePath, JSON.stringify(raw) + '\n')

      const reloaded = openDepositJournal(tmpDir)
      assert.equal(reloaded.view().phase, 'needs_review')

      const res = reloaded.reconcile('mark_step_completed')
      assert.equal(res.ok, true)
      assert.equal(res.state.index, 1)
      assert.equal(res.state.phase, 'completed')
      reloaded.close()

      const verified = openDepositJournal(tmpDir)
      assert.equal(verified.view().phase, 'completed')
      assert.equal(verified.view().receipts.length, 1)
      verified.close()
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })
  })
})
