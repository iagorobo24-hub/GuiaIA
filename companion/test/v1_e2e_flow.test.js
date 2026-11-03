'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const EventEmitter = require('node:events')

const { createSecureCompanionController } = require('../src/secure_companion_controller')
const { createOwnerPinPairing } = require('../src/auth/owner_pin_pairing')
const { createLocalMonotonicWitness } = require('../src/local_monotonic_witness')
const { openMission } = require('../src/mission')

describe('V1 End-to-End System Integration Flow (TASK-8.1)', () => {
  test('complete operator lifecycle: PIN pairing -> batch instruction -> emergency stop -> witness advance', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-v1-e2e-'))
    const witnessDir = path.join(tmpDir, 'witness')
    const ledgerDir = path.join(tmpDir, 'ledger')
    fs.mkdirSync(witnessDir, { recursive: true, mode: 0o700 })
    fs.mkdirSync(ledgerDir, { recursive: true, mode: 0o700 })

    // 1. Setup operator cryptographic keys
    const operatorPair = crypto.generateKeyPairSync('ed25519')
    const operatorPublicKeyPem = operatorPair.publicKey.export({ type: 'spki', format: 'pem' })
    const worldId = 'vanilla:local:25565'

    // 2. Initialize durable monotonic witness
    const witness = createLocalMonotonicWitness({
      directory: witnessDir,
      worldId,
      operatorPublicKeyPem
    })
    assert.equal(witness.getHead().sequence, 0)

    // 3. Mock Mineflayer bot
    const bot = new EventEmitter()
    bot.username = 'GuiaBot'
    bot.health = 20
    bot.food = 20
    bot.entity = { position: { x: 10, y: 64, z: 10 } }
    let whisperedMessages = []
    bot.whisper = (target, msg) => {
      whisperedMessages.push({ target, msg })
    }
    bot.inventory = {
      items: () => [
        { name: 'oak_log', count: 5 }
      ]
    }
    bot.pathfinder = { setGoal: () => {} }
    bot.clearControlStates = () => {}
    bot.stopDigging = () => {}

    // 4. Initialize ephemeral PIN pairing
    let pairedEvent = null
    const pairingManager = createOwnerPinPairing({
      onPairSuccess: (owner) => { pairedEvent = owner }
    })
    const detachPairing = pairingManager.attachToBot(bot)

    // Generate PIN and simulate in-game player whisper
    const pinInfo = pairingManager.generateNewPin()
    assert.equal(typeof pinInfo.pin, 'string')
    assert.equal(pinInfo.pin.length, 6)

    bot.emit('whisper', 'SteveOperator', `pair ${pinInfo.pin}`)

    assert.ok(pairedEvent)
    assert.equal(pairedEvent.username, 'SteveOperator')
    assert.equal(pairingManager.getStatus().isPaired, true)
    assert.ok(whisperedMessages[0].msg.includes('Emparejamiento exitoso'))

    // 5. Initialize secure companion controller in vanilla_paired_operator mode
    const authority = {
      sandboxOnly: true,
      identityMode: 'vanilla_paired_operator',
      botName: bot.username,
      worldId,
      ownerName: pairedEvent.username,
      operatorPublicKeyPem,
      ledgerDirectory: ledgerDir,
      v1Batch: true
    }

    const controller = createSecureCompanionController({
      bot,
      authority,
      classes: {}
    })

    // 6. Natural Language Parse & Inventory Check
    const inv = controller.checkInventory()
    assert.equal(inv.ok, true)
    assert.equal(inv.freeSlots, 35)
    assert.equal(inv.items.oak_log, 5)

    const parsedGather = controller.parseNaturalInstruction('recoge 5 troncos de roble', { v1Batch: true })
    assert.equal(parsedGather.kind, 'gather')
    assert.equal(parsedGather.resource, 'oak_log')
    assert.equal(parsedGather.count, 5)

    // 7. Verify P0 Emergency Stop
    const stopResult = controller.emergencyStop('operator_p0_panic')
    assert.equal(stopResult.ok, true)
    assert.equal(stopResult.mode, 'idle')
    assert.equal(stopResult.reason, 'operator_p0_panic')
    assert.equal(controller.status().mode, 'idle')

    // 8. Witness advance verification with signed ticket
    const now = Date.now()
    const opFingerprint = crypto.createHash('sha256')
      .update(operatorPair.publicKey.export({ format: 'der', type: 'spki' }))
      .digest('hex')

    const newHash = crypto.createHash('sha256').update('v1-e2e-hash').digest('hex')
    const ticketPayload = {
      aud: 'guiaia:checkpoint-advance:v1',
      worldId,
      operatorFingerprint: opFingerprint,
      previousSequence: 0,
      previousSha256: '0'.repeat(64),
      sequence: 1,
      registrySha256: newHash,
      nonce: crypto.randomUUID(),
      issuedAt: now - 500,
      expiresAt: now + 60000
    }
    const ticketSig = crypto.sign(null, Buffer.from(JSON.stringify(ticketPayload)), operatorPair.privateKey)
    const advanceRes = witness.advance({ payload: ticketPayload, signature: ticketSig.toString('base64url') })

    assert.equal(advanceRes.head.sequence, 1)
    assert.equal(advanceRes.head.registrySha256, newHash)
    assert.equal(witness.verifyMatch(advanceRes.head), true)

    // Cleanup
    detachPairing()
    witness.close()
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })
})
