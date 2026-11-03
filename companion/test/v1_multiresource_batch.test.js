'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const { parseNaturalInstruction, ALLOWED_RESOURCES } = require('../src/secure_companion_controller')
const { RESOURCE_ITEMS } = require('../src/gather')
const { openMission } = require('../src/mission')
const { openDepositJournal } = require('../src/deposit')
const {
  verifySessionDepositGrant,
  verifySessionGatherGrant
} = require('../src/session_identity')

describe('V1 Multi-Resource & Batch Capabilities (TASK-2.1)', () => {
  describe('Resource Catalog Extensions', () => {
    test('RESOURCE_ITEMS in gather maps block to drops: stone->cobblestone, coal_ore->coal', () => {
      assert.equal(RESOURCE_ITEMS.oak_log, 'oak_log')
      assert.equal(RESOURCE_ITEMS.stone, 'cobblestone')
      assert.equal(RESOURCE_ITEMS.cobblestone, 'cobblestone')
      assert.equal(RESOURCE_ITEMS.coal, 'coal')
      assert.equal(RESOURCE_ITEMS.coal_ore, 'coal')
    })

    test('ALLOWED_RESOURCES in controller includes stone, cobblestone, coal', () => {
      assert.equal(ALLOWED_RESOURCES.oak_log, 'oak_log')
      assert.equal(ALLOWED_RESOURCES.stone, 'cobblestone')
      assert.equal(ALLOWED_RESOURCES.cobblestone, 'cobblestone')
      assert.equal(ALLOWED_RESOURCES.coal, 'coal')
    })
  })

  describe('Natural Language Batch Parsing', () => {
    test('parses single gather instruction without v1Batch', () => {
      const res = parseNaturalInstruction('recoge madera')
      assert.equal(res.kind, 'gather')
      assert.equal(res.resource, 'oak_log')
      assert.equal(res.count, 1)
    })

    test('parses batch gather up to 16 when v1Batch is enabled', () => {
      const res1 = parseNaturalInstruction('recoge 5 troncos de roble', { v1Batch: true })
      assert.equal(res1.kind, 'gather')
      assert.equal(res1.resource, 'oak_log')
      assert.equal(res1.count, 5)

      const res2 = parseNaturalInstruction('recoge 16 piedra en 10 64 10', { v1Batch: true })
      assert.equal(res2.kind, 'gather')
      assert.equal(res2.resource, 'stone')
      assert.equal(res2.count, 16)
      assert.deepEqual(res2.target, { x: 10, y: 64, z: 10 })

      const res3 = parseNaturalInstruction('recoge 8 carbon', { v1Batch: true })
      assert.equal(res3.kind, 'gather')
      assert.equal(res3.resource, 'coal')
      assert.equal(res3.count, 8)
    })

    test('rejects batch gather exceeding 16', () => {
      assert.throws(() => {
        parseNaturalInstruction('recoge 17 troncos de roble', { v1Batch: true })
      }, /Only bounded gathering \(1-16\) authorized/)
    })

    test('rejects batch gather > 1 when v1Batch is false', () => {
      assert.throws(() => {
        parseNaturalInstruction('recoge 5 troncos de roble', { v1Batch: false })
      }, /Only single-item bounded gathering authorized/)
    })

    test('parses batch deposit up to 16 when v1Batch is enabled', () => {
      const res = parseNaturalInstruction('deposita 10 roble en cofre 10 64 10', { v1Batch: true })
      assert.equal(res.kind, 'deposit')
      assert.equal(res.resource, 'oak_log')
      assert.equal(res.count, 10)
      assert.deepEqual(res.chest, { x: 10, y: 64, z: 10 })
    })

    test('rejects batch deposit exceeding 16', () => {
      assert.throws(() => {
        parseNaturalInstruction('deposita 20 roble en cofre 10 64 10', { v1Batch: true })
      }, /Only bounded deposit \(1-16\) authorized/)
    })
  })

  describe('Durable Batch Mission Journal', () => {
    let tmpDir

    test('creates and reloads batch mission journal with multiple targets (up to 16)', () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-batch-mission-'))
      const targets = []
      for (let i = 0; i < 8; i++) {
        targets.push({ x: 10, y: 64 + i, z: 10, block: 'oak_log' })
      }

      const journal = openMission(tmpDir, {
        sandboxOnly: true,
        ownerName: 'OperatorSteve',
        v1Batch: true,
        targets
      })

      const state = journal.view()
      assert.equal(state.phase, 'ready')
      assert.equal(state.targets.length, 8)
      assert.equal(state.v1Batch, true)
      assert.equal(state.index, 0)
      journal.close?.()

      // Reload from disk
      const reloaded = openMission(tmpDir)
      const reloadedState = reloaded.view()
      assert.equal(reloadedState.phase, 'ready')
      assert.equal(reloadedState.targets.length, 8)
      assert.equal(reloadedState.v1Batch, true)
      reloaded.close?.()
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })

    test('rejects batch mission with > 16 targets', () => {
      const overDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-over-mission-'))
      const targets = []
      for (let i = 0; i < 17; i++) {
        targets.push({ x: 10, y: 64 + i, z: 10, block: 'oak_log' })
      }
      assert.throws(() => {
        openMission(overDir, {
          sandboxOnly: true,
          ownerName: 'OperatorSteve',
          v1Batch: true,
          targets
        })
      }, /Only a bounded owner-authorized QA mission is permitted/)
      try { fs.rmSync(overDir, { recursive: true, force: true }) } catch {}
    })
  })

  describe('Durable Batch Deposit Journal', () => {
    test('creates and reloads batch deposit journal with count up to 16', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-batch-deposit-'))
      const journal = openDepositJournal(tmpDir, {
        sandboxOnly: true,
        ownerName: 'OperatorSteve',
        chest: { x: 10, y: 64, z: 10 },
        v1Batch: true,
        items: [
          { name: 'oak_log', count: 12 },
          { name: 'cobblestone', count: 4 }
        ]
      })

      const state = journal.view()
      assert.equal(state.phase, 'ready')
      assert.equal(state.items.length, 2)
      assert.equal(state.v1Batch, true)
      journal.close?.()

      const reloaded = openDepositJournal(tmpDir)
      const reloadedState = reloaded.view()
      assert.equal(reloadedState.phase, 'ready')
      assert.equal(reloadedState.items.length, 2)
      assert.equal(reloadedState.v1Batch, true)
      reloaded.close?.()
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })

    test('rejects batch deposit plan with count > 16', () => {
      const overDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-over-deposit-'))
      assert.throws(() => {
        openDepositJournal(overDir, {
          sandboxOnly: true,
          ownerName: 'OperatorSteve',
          chest: { x: 10, y: 64, z: 10 },
          v1Batch: true,
          items: [{ name: 'oak_log', count: 17 }]
        })
      }, /Unauthorized QA item or count/)
      try { fs.rmSync(overDir, { recursive: true, force: true }) } catch {}
    })
  })

  describe('Session Identity Batch Capabilities', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    const operatorPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' })

    function signPayload(payload) {
      const data = Buffer.from(JSON.stringify(payload))
      const sig = crypto.sign(null, data, privateKey)
      return { payload, signature: sig.toString('base64url') }
    }

    const session = {
      worldId: 'vanilla:local:25565',
      principalId: 'op-1234',
      connectionId: crypto.randomUUID(),
      challenge: crypto.randomBytes(16).toString('hex'),
      username: 'Steve'
    }

    const authority = {
      botName: 'GuiaBot',
      operatorPublicKeyPem,
      v1Batch: true
    }

    test('verifySessionDepositGrant allows count up to 16 when v1Batch is true', () => {
      const now = Date.now()
      const grant = signPayload({
        aud: 'guiaia:session-deposit:v1',
        worldId: session.worldId,
        botName: authority.botName,
        ownerName: session.username,
        principalId: session.principalId,
        connectionId: session.connectionId,
        challenge: session.challenge,
        chest: { x: 10, y: 64, z: 10 },
        item: 'oak_log',
        count: 15,
        nonce: crypto.randomUUID(),
        issuedAt: now - 500,
        expiresAt: now + 60000
      })

      const verified = verifySessionDepositGrant(grant, session, authority)
      assert.equal(verified.count, 15)
    })

    test('verifySessionDepositGrant rejects count > 2 when v1Batch is false', () => {
      const now = Date.now()
      const grant = signPayload({
        aud: 'guiaia:session-deposit:v1',
        worldId: session.worldId,
        botName: authority.botName,
        ownerName: session.username,
        principalId: session.principalId,
        connectionId: session.connectionId,
        challenge: session.challenge,
        chest: { x: 10, y: 64, z: 10 },
        item: 'oak_log',
        count: 5,
        nonce: crypto.randomUUID(),
        issuedAt: now - 500,
        expiresAt: now + 60000
      })

      assert.throws(() => {
        verifySessionDepositGrant(grant, session, { ...authority, v1Batch: false })
      }, /Session-scoped deposit capability invalid/)
    })

    test('verifySessionGatherGrant allows count up to 16 when v1Batch is true', () => {
      const now = Date.now()
      const grant = signPayload({
        aud: 'guiaia:session-gather:v1',
        worldId: session.worldId,
        botName: authority.botName,
        ownerName: session.username,
        principalId: session.principalId,
        connectionId: session.connectionId,
        challenge: session.challenge,
        target: { x: 10, y: 64, z: 10 },
        item: 'stone',
        count: 10,
        nonce: crypto.randomUUID(),
        issuedAt: now - 500,
        expiresAt: now + 60000
      })

      const verified = verifySessionGatherGrant(grant, session, authority)
      assert.equal(verified.count, 10)
    })

    test('verifySessionGatherGrant rejects count > 1 when v1Batch is false', () => {
      const now = Date.now()
      const grant = signPayload({
        aud: 'guiaia:session-gather:v1',
        worldId: session.worldId,
        botName: authority.botName,
        ownerName: session.username,
        principalId: session.principalId,
        connectionId: session.connectionId,
        challenge: session.challenge,
        target: { x: 10, y: 64, z: 10 },
        item: 'stone',
        count: 2,
        nonce: crypto.randomUUID(),
        issuedAt: now - 500,
        expiresAt: now + 60000
      })

      assert.throws(() => {
        verifySessionGatherGrant(grant, session, { ...authority, v1Batch: false })
      }, /Session-scoped gather capability invalid/)
    })
  })
})
