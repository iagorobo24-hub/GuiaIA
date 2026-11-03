'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const {
  verifySessionBundle,
  verifySessionCraftGrant,
  verifySessionBuildGrant,
  verifySessionPokemonGrant,
  CRAFT_FIELDS,
  BUILD_FIELDS,
  POKEMON_FIELDS
} = require('../src/session_identity')

const {
  createSecureCompanionController,
  parseNaturalInstruction
} = require('../src/secure_companion_controller')

function createDispatcherLab(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-dispatcher-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const serverKey = crypto.generateKeyPairSync('ed25519')
  const operatorKey = crypto.generateKeyPairSync('ed25519')
  const principalKey = crypto.generateKeyPairSync('ed25519')

  const worldId = 'qa:v1_1:dispatch_lab'
  const botName = 'GuiaIA_V1_1'
  const ownerName = 'OwnerDuran'
  const principalId = 'player_duran_01'
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
    principalId,
    challenge,
    issuedAt: now - 1000,
    expiresAt: now + 60000
  }, principalKey)

  const session = { bridge, owner }

  let online = true
  const authority = {
    sandboxOnly: true,
    identityMode: 'trusted_server_bridge_lab',
    worldId,
    botName,
    serverBridgePublicKeyPem: serverKey.publicKey.export({ format: 'pem', type: 'spki' }),
    operatorPublicKeyPem: operatorKey.publicKey.export({ format: 'pem', type: 'spki' }),
    trustedPrincipals: {
      [principalId]: principalKey.publicKey.export({ format: 'pem', type: 'spki' })
    },
    ledgerDirectory: path.join(dir, 'spent'),
    isRevoked: () => false,
    activeConnection: id => (id === connectionId && online ? { connected: true, worldId, connectionId, username: ownerName } : null),
    requireLivePresence: true,
    requireRemoteCheckpoint: true,
    livePresence: async id => ({ connected: online, worldId, connectionId: id, issuedAt: Date.now() }),
    currentRegistryCheckpoint: () => ({ sequence: 10 }),
    remoteCheckpointMatch: async () => true,
    v1Batch: true
  }

  const makeCraftGrant = (item = 'crafting_table', count = 1, recipe = 'crafting_table') => sign({
    aud: 'guiaia:session-craft:v1',
    worldId,
    botName,
    ownerName,
    principalId,
    connectionId,
    challenge,
    recipe,
    item,
    count,
    nonce: crypto.randomUUID(),
    issuedAt: Date.now() - 500,
    expiresAt: Date.now() + 30000
  }, operatorKey)

  const makeBuildGrant = (blueprintId = 'small_hut', origin = { x: 10, y: 64, z: -20 }) => sign({
    aud: 'guiaia:session-build:v1',
    worldId,
    botName,
    ownerName,
    principalId,
    connectionId,
    challenge,
    blueprintId,
    origin,
    nonce: crypto.randomUUID(),
    issuedAt: Date.now() - 500,
    expiresAt: Date.now() + 30000
  }, operatorKey)

  const makePokemonGrant = (action = 'inspect', target = 'nearby') => sign({
    aud: 'guiaia:session-pokemon:v1',
    worldId,
    botName,
    ownerName,
    principalId,
    connectionId,
    challenge,
    action,
    target,
    nonce: crypto.randomUUID(),
    issuedAt: Date.now() - 500,
    expiresAt: Date.now() + 30000
  }, operatorKey)

  const bot = new EventEmitter()
  bot.username = botName
  bot.health = 20
  bot.inventory = { items: () => [] }

  return {
    dir,
    session,
    authority,
    bot,
    makeCraftGrant,
    makeBuildGrant,
    makePokemonGrant,
    operatorKey
  }
}

test('V1.1 Natural Instruction Parser - Craft, Build, Pokemon', () => {
  // Craft
  assert.deepEqual(parseNaturalInstruction('fabrica 4 crafting_table'), {
    kind: 'craft', count: 4, item: 'crafting_table', recipe: 'crafting_table', raw: 'fabrica 4 crafting_table'
  })
  assert.deepEqual(parseNaturalInstruction('craftea stick'), {
    kind: 'craft', count: 1, item: 'stick', recipe: 'stick', raw: 'craftea stick'
  })
  assert.deepEqual(parseNaturalInstruction('craft 16 oak_planks', { v1Batch: true }), {
    kind: 'craft', count: 16, item: 'oak_planks', recipe: 'oak_planks', raw: 'craft 16 oak_planks'
  })

  // Build
  assert.deepEqual(parseNaturalInstruction('construye shelter_5x5'), {
    kind: 'build', blueprintId: 'shelter_5x5', origin: null, raw: 'construye shelter_5x5'
  })
  assert.deepEqual(parseNaturalInstruction('edifica tower en 10 64 -20'), {
    kind: 'build', blueprintId: 'tower', origin: { x: 10, y: 64, z: -20 }, raw: 'edifica tower en 10 64 -20'
  })

  // Pokemon
  assert.deepEqual(parseNaturalInstruction('pokemon radar'), {
    kind: 'pokemon', action: 'inspect', target: 'nearby', raw: 'pokemon radar'
  })
  assert.deepEqual(parseNaturalInstruction('pokemon captura 105'), {
    kind: 'pokemon', action: 'capture', target: 105, raw: 'pokemon captura 105'
  })
  assert.deepEqual(parseNaturalInstruction('pokemon combate pikachu_wild'), {
    kind: 'pokemon', action: 'battle_wild', target: 'pikachu_wild', raw: 'pokemon combate pikachu_wild'
  })
  assert.deepEqual(parseNaturalInstruction('pokemon pc'), {
    kind: 'pokemon', action: 'pc_deposit', target: 'nearby', raw: 'pokemon pc'
  })
  assert.deepEqual(parseNaturalInstruction('pokemon pc_withdraw 2'), {
    kind: 'pokemon', action: 'pc_withdraw', target: 2, raw: 'pokemon pc_withdraw 2'
  })
})

test('V1.1 Session Identity - Craft grant verification and tampering rejection', (t) => {
  const lab = createDispatcherLab(t)
  const verifiedSession = verifySessionBundle(lab.session, lab.authority)

  const grant = lab.makeCraftGrant('crafting_table', 1)
  const verified = verifySessionCraftGrant(grant, verifiedSession, lab.authority)
  assert.equal(verified.item, 'crafting_table')
  assert.equal(verified.count, 1)

  // Tampered payload
  const tampered = { ...grant, payload: { ...grant.payload, count: 64 } }
  assert.throws(() => verifySessionCraftGrant(tampered, verifiedSession, lab.authority), /Signed evidence verification failed/)

  // Wrong audience
  const badAud = lab.makeCraftGrant()
  badAud.payload.aud = 'guiaia:session-gather:v1'
  assert.throws(() => verifySessionCraftGrant(badAud, verifiedSession, lab.authority))
})

test('V1.1 Session Identity - Build grant verification and coordinate validation', (t) => {
  const lab = createDispatcherLab(t)
  const verifiedSession = verifySessionBundle(lab.session, lab.authority)

  const grant = lab.makeBuildGrant('hut_v1', { x: 100, y: 70, z: -50 })
  const verified = verifySessionBuildGrant(grant, verifiedSession, lab.authority)
  assert.equal(verified.blueprintId, 'hut_v1')
  assert.deepEqual(verified.origin, { x: 100, y: 70, z: -50 })

  // Invalid coordinates
  const badOriginGrant = {
    ...grant,
    payload: { ...grant.payload, origin: { x: 'invalid', y: 70, z: 0 } }
  }
  assert.throws(() => verifySessionBuildGrant(badOriginGrant, verifiedSession, lab.authority))
})

test('V1.1 Session Identity - Pokemon grant verification and action validation', (t) => {
  const lab = createDispatcherLab(t)
  const verifiedSession = verifySessionBundle(lab.session, lab.authority)

  const grant = lab.makePokemonGrant('capture', 42)
  const verified = verifySessionPokemonGrant(grant, verifiedSession, lab.authority)
  assert.equal(verified.action, 'capture')
  assert.equal(verified.target, 42)

  // Invalid action
  const badActionGrant = lab.makePokemonGrant('delete_all_pokemon', 1)
  assert.throws(() => verifySessionPokemonGrant(badActionGrant, verifiedSession, lab.authority))
})

test('V1.1 Controller Dispatcher - Craft execution with engine delegation and nonce barrier', async (t) => {
  const lab = createDispatcherLab(t)
  let plannedCount = 0
  const mockCraftEngine = {
    execute: async (grant, options) => {
      plannedCount += grant.count
      return { ok: true, executedRecipe: grant.recipe, count: grant.count }
    }
  }

  const controller = createSecureCompanionController({
    bot: lab.bot,
    authority: lab.authority,
    classes: {},
    engines: { craftPlanner: mockCraftEngine }
  })

  const grant = lab.makeCraftGrant('crafting_table', 2)

  // Dispatch via typed instruction
  const res = await controller.dispatchInstruction(
    { kind: 'craft', item: 'crafting_table', count: 2 },
    { session: lab.session, grant }
  )
  assert.equal(res.ok, true)
  assert.equal(res.executedRecipe, 'crafting_table')
  assert.equal(plannedCount, 2)

  // Replay attempt must fail at nonce barrier
  await assert.rejects(
    async () => controller.craft(lab.session, grant),
    /EEXIST|already/i
  )
})

test('V1.1 Controller Dispatcher - Build execution with engine delegation', async (t) => {
  const lab = createDispatcherLab(t)
  let builtBlueprint = null
  const mockBuildEngine = {
    execute: async (grant, blueprint) => {
      builtBlueprint = grant.blueprintId
      return { ok: true, built: true, origin: grant.origin }
    }
  }

  const controller = createSecureCompanionController({
    bot: lab.bot,
    authority: lab.authority,
    classes: {},
    engines: { blueprintBuilder: mockBuildEngine }
  })

  const grant = lab.makeBuildGrant('shelter_5x5', { x: 5, y: 64, z: 5 })
  const res = await controller.dispatchInstruction(
    { kind: 'build', blueprintId: 'shelter_5x5' },
    { session: lab.session, grant }
  )
  assert.equal(res.ok, true)
  assert.equal(builtBlueprint, 'shelter_5x5')
})

test('V1.1 Controller Dispatcher - Pokemon execution with action scope verification', async (t) => {
  const lab = createDispatcherLab(t)
  let executedAction = null
  const mockPokemonEngine = {
    execute: async (grant, options) => {
      executedAction = grant.action
      return { ok: true, executedAction: grant.action, target: grant.target }
    }
  }

  const controller = createSecureCompanionController({
    bot: lab.bot,
    authority: lab.authority,
    classes: {},
    engines: { cobblemonAdapter: mockPokemonEngine }
  })

  const grant = lab.makePokemonGrant('battle_wild', 77)

  // Scope mismatch: instruction says 'capture' but grant is for 'battle_wild'
  const mismatch = await controller.dispatchInstruction(
    { kind: 'pokemon', action: 'capture', target: 77 },
    { session: lab.session, grant }
  )
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.reason, 'pokemon_instruction_scope_mismatch')

  // Matching instruction succeeds
  const match = await controller.dispatchInstruction(
    { kind: 'pokemon', action: 'battle_wild', target: 77 },
    { session: lab.session, grant }
  )
  assert.equal(match.ok, true)
  assert.equal(executedAction, 'battle_wild')
})

test('V1.1 Controller Dispatcher - Emergency stop interrupts active dispatching', async (t) => {
  const lab = createDispatcherLab(t)
  const controller = createSecureCompanionController({
    bot: lab.bot,
    authority: lab.authority,
    classes: {}
  })

  const stopRes = controller.emergencyStop('qa_manual_stop')
  assert.equal(stopRes.ok, true)
  assert.equal(stopRes.mode, 'idle')
  assert.equal(stopRes.reason, 'qa_manual_stop')
})
