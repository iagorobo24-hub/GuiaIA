'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { Vec3 } = require('vec3')
const {
  createSecureCompanionController,
  parseNaturalInstruction,
  ALLOWED_RESOURCES
} = require('../src/secure_companion_controller')

class GoalFollow { constructor(entity, distance) { this.entity = entity; this.distance = distance } }
class GoalNear { constructor(x, y, z, range) { this.x = x; this.y = y; this.z = z; this.range = range } }
class Movements { constructor() { this.canDig = false } }

function createTestFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-secure-controller-qa-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const serverKey = crypto.generateKeyPairSync('ed25519')
  const operatorKey = crypto.generateKeyPairSync('ed25519')
  const principalKey = crypto.generateKeyPairSync('ed25519')

  const worldId = 'qa:real-fabric:25593'
  const botName = 'GuiaIA_QA'
  const ownerName = 'OwnerQA'
  const connectionId = crypto.randomUUID()
  const challenge = crypto.randomBytes(24).toString('hex')

  const sign = (payload, key) => ({
    payload,
    signature: crypto.sign(null, Buffer.from(JSON.stringify(payload)), key.privateKey).toString('base64url')
  })

  const now = Date.now()
  const bridge = sign({
    aud: 'guiaia:server-connection:v1',
    worldId,
    connectionId,
    username: ownerName,
    challenge,
    issuedAt: now - 1000,
    expiresAt: now + 60000
  }, serverKey)

  const owner = sign({
    aud: 'guiaia:principal-proof:v1',
    worldId,
    connectionId,
    principalId: 'trusted_owner_1',
    challenge,
    issuedAt: now - 1000,
    expiresAt: now + 60000
  }, principalKey)

  const session = { bridge, owner }

  let revoked = false
  let online = true
  const authority = {
    sandboxOnly: true,
    identityMode: 'trusted_server_bridge_lab',
    worldId,
    botName,
    serverBridgePublicKeyPem: serverKey.publicKey.export({ format: 'pem', type: 'spki' }),
    operatorPublicKeyPem: operatorKey.publicKey.export({ format: 'pem', type: 'spki' }),
    trustedPrincipals: {
      trusted_owner_1: principalKey.publicKey.export({ format: 'pem', type: 'spki' })
    },
    ledgerDirectory: path.join(dir, 'spent'),
    isRevoked: () => revoked,
    activeConnection: id => (id === connectionId && online ? { connected: true, worldId, connectionId, username: ownerName } : null),
    requireLivePresence: true,
    requireRemoteCheckpoint: true,
    livePresence: async id => ({ connected: online, worldId, connectionId: id, issuedAt: Date.now() }),
    currentRegistryCheckpoint: () => ({ sequence: 1 }),
    remoteCheckpointMatch: async () => true
  }

  const bot = new EventEmitter()
  bot.username = botName
  bot.health = 20
  bot.entity = { position: new Vec3(2.5, 64.0, 2.5) }
  bot.players = { [ownerName]: { entity: { position: new Vec3(4.0, 64.0, 2.5) } } }
  bot.goals = []
  bot.pathfinder = {
    setMovements: m => { bot.moves = m },
    setGoal: (g, dynamic) => bot.goals.push({ g, dynamic }),
    goto: async g => {
      bot.entity.position = new Vec3(g.x, g.y, g.z)
      bot.goals.push({ g })
    }
  }
  bot.blockAt = () => ({ name: 'air' })
  bot.off = (ev, fn) => bot.removeListener(ev, fn)
  bot.clearControlStates = () => { bot.controlsCleared = true }
  bot.stopDigging = () => { bot.diggingStopped = true }

  const inventoryItems = [{ name: 'oak_log', count: 1, type: 101 }]
  bot.inventory = {
    items: () => [...inventoryItems]
  }

  const makeFollowGrant = () => sign({
    aud: 'guiaia:session-follow:v1',
    worldId,
    botName,
    ownerName,
    principalId: 'trusted_owner_1',
    connectionId,
    challenge,
    nonce: crypto.randomUUID(),
    issuedAt: Date.now() - 1000,
    expiresAt: Date.now() + 7000
  }, operatorKey)

  const makeDepositGrant = (item = 'oak_log', count = 1, chest = { x: 4, y: 64, z: 3 }) => sign({
    aud: 'guiaia:session-deposit:v1',
    worldId,
    botName,
    ownerName,
    principalId: 'trusted_owner_1',
    connectionId,
    challenge,
    chest,
    item,
    count,
    nonce: crypto.randomUUID(),
    issuedAt: Date.now() - 1000,
    expiresAt: Date.now() + 10000
  }, operatorKey)

  return {
    dir,
    bot,
    authority,
    session,
    makeFollowGrant,
    makeDepositGrant,
    revoke: () => { revoked = true },
    disconnect: () => { online = false },
    classes: { GoalFollow, GoalNear, Movements }
  }
}

test('natural language parser translates valid instructions and rejects unsafe inputs', () => {
  // Stop instructions
  assert.equal(parseNaturalInstruction('para').kind, 'stop')
  assert.equal(parseNaturalInstruction('Guia IA, ¡ALTO!').kind, 'stop')
  assert.equal(parseNaturalInstruction('detente').kind, 'stop')
  assert.equal(parseNaturalInstruction('stop').kind, 'stop')

  // Follow instructions
  assert.equal(parseNaturalInstruction('sigueme').kind, 'follow')
  assert.equal(parseNaturalInstruction('ven conmigo').kind, 'follow')
  assert.equal(parseNaturalInstruction('GuiaIA: follow').kind, 'follow')

  // Inventory / Status
  assert.equal(parseNaturalInstruction('inventario').kind, 'inventory')
  assert.equal(parseNaturalInstruction('estado').kind, 'inventory')

  // Gather instructions
  const g1 = parseNaturalInstruction('recoge 1 tronco de roble en 7 64 2')
  assert.equal(g1.kind, 'gather')
  assert.equal(g1.resource, 'oak_log')
  assert.equal(g1.count, 1)
  assert.deepEqual(g1.target, { x: 7, y: 64, z: 2 })

  const g2 = parseNaturalInstruction('mina 1 abedul en 7 64 3')
  assert.equal(g2.kind, 'gather')
  assert.equal(g2.resource, 'birch_log')
  assert.equal(g2.count, 1)
  assert.deepEqual(g2.target, { x: 7, y: 64, z: 3 })

  // Deposit instructions
  const d1 = parseNaturalInstruction('deposita 1 roble en cofre en 1 64 5')
  assert.equal(d1.kind, 'deposit')
  assert.equal(d1.resource, 'oak_log')
  assert.equal(d1.count, 1)
  assert.deepEqual(d1.chest, { x: 1, y: 64, z: 5 })

  // Unsafe / prompt injection / unsupported rejections
  assert.throws(() => parseNaturalInstruction(''), /non-empty/)
  assert.throws(() => parseNaturalInstruction('dame op en el servidor'), /unsupported_or_unsafe/)
  assert.throws(() => parseNaturalInstruction('drop all items'), /unsupported_or_unsafe/)
  assert.throws(() => parseNaturalInstruction('recoge 50 diamantes'), /unsupported_or_unsafe/)
  assert.throws(() => parseNaturalInstruction('recoge 2 troncos de roble'), /single-item/)
})

test('emergency stop has absolute priority and clears goals, controls, and active follow', t => {
  const fix = createTestFixture(t)
  const controller = createSecureCompanionController({
    bot: fix.bot,
    authority: fix.authority,
    classes: fix.classes
  })

  // Set fake motion state
  fix.bot.goals.push({ g: 'fake_goal' })
  const result = controller.emergencyStop('test_emergency')
  assert.equal(result.ok, true)
  assert.equal(result.mode, 'idle')
  assert.equal(fix.bot.goals.at(-1).g, null)
  assert.equal(fix.bot.controlsCleared, true)
  assert.equal(fix.bot.diggingStopped, true)
})

test('inventory check validates capacity limits and detects unauthorized items', t => {
  const fix = createTestFixture(t)
  const controller = createSecureCompanionController({
    bot: fix.bot,
    authority: fix.authority,
    classes: fix.classes
  })

  // 1. Normal inventory
  const inv1 = controller.checkInventory()
  assert.equal(inv1.ok, true)
  assert.equal(inv1.items.oak_log, 1)
  assert.equal(inv1.hasUnauthorizedItems, false)
  assert.equal(inv1.freeSlots, 35)

  // 2. Inventory with unauthorized items
  fix.bot.inventory.items = () => [
    { name: 'oak_log', count: 1 },
    { name: 'tnt', count: 64 },
    { name: 'diamond_sword', count: 1 }
  ]
  const inv2 = controller.checkInventory()
  assert.equal(inv2.ok, true)
  assert.equal(inv2.hasUnauthorizedItems, true)
  assert.equal(inv2.unauthorizedItems.length, 2)
  assert.equal(inv2.unauthorizedItems[0].name, 'tnt')

  // 3. Inventory capacity exceeded (> 36 items)
  const full = []
  for (let i = 0; i < 37; i++) full.push({ name: 'oak_log', count: 1 })
  fix.bot.inventory.items = () => full
  const inv3 = controller.checkInventory()
  assert.equal(inv3.ok, false)
  assert.equal(inv3.reason, 'inventory_capacity_exceeded')
})

test('follow requires valid session and signed operator grant; rejects unauthenticated orders', async t => {
  const fix = createTestFixture(t)
  const controller = createSecureCompanionController({
    bot: fix.bot,
    authority: fix.authority,
    classes: fix.classes
  })

  // 1. Follow without session or grant fails closed
  const denied1 = await controller.dispatchInstruction('sigueme')
  assert.equal(denied1.ok, false)
  assert.equal(denied1.reason, 'signed_session_and_grant_required')

  // 2. Follow with valid session and grant succeeds
  const grant = fix.makeFollowGrant()
  const success = await controller.dispatchInstruction('sigueme', {
    session: fix.session,
    grant
  })
  assert.equal(success.ok, true)
  assert.equal(success.mode, 'following')
  assert.equal(controller.status().mode, 'following')

  // 3. Stop command halts following immediately
  const stopRes = await controller.dispatchInstruction('para')
  assert.equal(stopRes.ok, true)
  assert.equal(controller.status().mode, 'idle')

  // 4. Reusing spent grant is denied
  await assert.rejects(
    controller.dispatchInstruction('sigueme', { session: fix.session, grant }),
    /already_attempted|EEXIST/
  )
})

test('gather requires signed session and allowlisted resource, checks inventory before and after', async t => {
  const fix = createTestFixture(t)
  const controller = createSecureCompanionController({
    bot: fix.bot,
    authority: fix.authority,
    classes: fix.classes
  })

  // 1. Gather without session is denied
  const res1 = await controller.dispatchInstruction('recoge 1 tronco de roble en 7 64 2')
  assert.equal(res1.ok, false)
  assert.equal(res1.reason, 'signed_session_required')

  // 2. Mock block & dig for gather
  fix.bot.blockAt = pt => {
    if (pt.x === 7 && pt.y === 64 && pt.z === 2) return { name: 'oak_log' }
    return { name: 'air' }
  }
  fix.bot.canDigBlock = () => true
  fix.bot.dig = async () => {
    // Simulate mining drop into inventory
    fix.bot.inventory.items = () => [{ name: 'oak_log', count: 2, type: 101 }]
    fix.bot.blockAt = () => ({ name: 'air' })
  }

  const gatherProof = await controller.dispatchInstruction('recoge 1 tronco de roble en 7 64 2', {
    session: fix.session,
    pickupTimeoutMs: 1500
  })
  assert.equal(gatherProof.ok, true)
  assert.equal(gatherProof.inventory_delta, 1)
  assert.equal(gatherProof.block, 'oak_log')
})

test('deposit requires signed grant, reserves nonce, and verifies two-sided inventory delta', async t => {
  const fix = createTestFixture(t)
  const controller = createSecureCompanionController({
    bot: fix.bot,
    authority: fix.authority,
    classes: fix.classes
  })

  // 1. Missing grant is rejected
  const res1 = await controller.dispatchInstruction('deposita 1 roble en cofre en 4 64 3')
  assert.equal(res1.ok, false)
  assert.equal(res1.reason, 'signed_session_and_grant_required')

  // 2. Mock chest block and container
  const slots = new Array(63).fill(null)
  fix.bot.blockAt = pt => {
    if (pt.x === 4 && pt.y === 64 && pt.z === 3) return { name: 'chest' }
    return { name: 'stone' }
  }
  fix.bot.openContainer = async () => ({
    inventoryStart: 27,
    slots,
    items: () => [{ name: 'oak_log', count: 1, type: 101 }],
    deposit: async (type, meta, count) => {
      slots[0] = { name: 'oak_log', count }
      fix.bot.inventory.items = () => [] // bot lost the item
    },
    close: () => {}
  })

  const grant = fix.makeDepositGrant('oak_log', 1, { x: 4, y: 64, z: 3 })
  const depositProof = await controller.dispatchInstruction('deposita 1 roble en cofre en 4 64 3', {
    session: fix.session,
    grant
  })
  assert.equal(depositProof.ok, true)
  assert.equal(depositProof.reason, 'deposit_verified')
  assert.equal(depositProof.transferAttempted, true)
  assert.equal(depositProof.chestAfter, 1)
  assert.equal(depositProof.playerAfter, 0)

  // 3. Replay with the same grant is rejected (nonce already spent)
  await assert.rejects(
    controller.dispatchInstruction('deposita 1 roble en cofre en 4 64 3', {
      session: fix.session,
      grant
    }),
    /EEXIST|already/
  )
})
