'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')

const {
  scanNearbyPokemon,
  isPokemonEntity,
  extractPokemonMetadata,
  MAX_RADAR_DISTANCE
} = require('../src/cobblemon_radar')

const {
  executeCaptureAttempt,
  countBalls,
  MAX_CAPTURE_BUDGET
} = require('../src/cobblemon_capture')

const {
  createCobblemonBattleController,
  BATTLE_STATES,
  TURN_TIMEOUT_MS
} = require('../src/cobblemon_battle')

const {
  createCobblemonPcController,
  validateBoxBounds,
  validateSlotBounds
} = require('../src/cobblemon_pc')

const { createCobblemonAdapter } = require('../src/cobblemon_adapter')

test('Cobblemon Radar - Identifies entities, extracts metadata and filters by 24m distance', () => {
  const mockBot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      '1': {
        id: 1,
        name: 'cobblemon:pokemon',
        displayName: 'Pikachu Lv. 25',
        position: new Vec3(5, 64, 0),
        isShiny: false
      },
      '2': {
        id: 2,
        name: 'cobblemon:pokemon',
        displayName: 'Charizard [Lv 50] shiny',
        position: new Vec3(15, 64, 0),
        isShiny: true
      },
      '3': {
        id: 3,
        name: 'cobblemon:pokemon',
        displayName: 'Pidgey Lv. 5',
        position: new Vec3(50, 64, 0) // Out of range (> 24)
      },
      '4': {
        id: 4,
        name: 'zombie', // Not a pokemon
        position: new Vec3(3, 64, 0)
      }
    }
  }

  const detected = scanNearbyPokemon(mockBot, { maxDistance: 24 })
  assert.equal(detected.length, 2)

  // Sorted by distance: Pikachu at 5m first, Charizard at 15m second
  assert.equal(detected[0].entityId, 1)
  assert.equal(detected[0].distance, 5.0)
  assert.equal(detected[0].level, 25)
  assert.equal(detected[0].isShiny, false)

  assert.equal(detected[1].entityId, 2)
  assert.equal(detected[1].distance, 15.0)
  assert.equal(detected[1].level, 50)
  assert.equal(detected[1].isShiny, true)
})

test('Cobblemon Capture - Consumable budget capped at <= 5 and checks inventory', async () => {
  const inventoryState = {
    items: () => [{ name: 'poke_ball', count: 2 }]
  }

  const lookedAt = []
  const equipped = []
  let activated = 0

  const mockBot = {
    inventory: inventoryState,
    lookAt: async (pos) => lookedAt.push(pos),
    equip: async (item, slot) => equipped.push({ item, slot }),
    activateItem: async () => {
      activated++
      // Decrease inventory on throw
      inventoryState.items = () => [{ name: 'poke_ball', count: 1 }]
    }
  }

  const target = {
    id: 10,
    height: 1.0,
    position: new Vec3(4, 64, 0),
    isValid: true
  }

  // Budget exceeding max 5 must be rejected
  await assert.rejects(
    async () => executeCaptureAttempt(mockBot, target, { maxAttempts: 6 }),
    /Capture budget must be an integer between 1 and 5/i
  )

  // 1. Pre-throw block: fails closed BEFORE throwing if no tracking channel exists
  const unverifiedRes = await executeCaptureAttempt(mockBot, target, {
    ballType: 'poke_ball',
    maxAttempts: 2
  })
  assert.equal(unverifiedRes.ok, false)
  assert.equal(unverifiedRes.status, 'blocked')
  assert.equal(unverifiedRes.reason, 'no_tracking_channel')
  assert.equal(unverifiedRes.throwsUsed, 0, 'No Poké Ball should be thrown without tracking channel')

  // 2. No blind rethrows: unknown/unverified outcome immediately halts further throws
  const uncertainRes = await executeCaptureAttempt(mockBot, target, {
    ballType: 'poke_ball',
    maxAttempts: 3,
    serverConfirmation: { result: 'corrupted_status' } // unverified event
  })
  assert.equal(uncertainRes.ok, false)
  assert.equal(uncertainRes.status, 'uncertain')
  assert.equal(uncertainRes.reason, 'unverified_server_response')
  assert.equal(uncertainRes.throwsUsed, 1, 'Must halt after first uncertain outcome; no blind rethrow')

  // 3. Valid capture execution with authentic server confirmation
  const res = await executeCaptureAttempt(mockBot, target, {
    ballType: 'poke_ball',
    maxAttempts: 2,
    serverConfirmation: { result: 'captured' }
  })

  assert.equal(res.ok, true)
  assert.equal(res.captured, true)
  assert.equal(res.status, 'confirmed')
  assert.equal(res.throwsUsed, 1)
  assert.equal(activated >= 1, true)
  assert.equal(lookedAt.length >= 1, true)
  assert.equal(equipped[0].item?.name || equipped[0].item, 'poke_ball')
})

test('Cobblemon Capture - Fails closed when no Poké Balls in inventory', async () => {
  const mockBot = {
    inventory: { items: () => [] }
  }
  const target = { id: 20, position: new Vec3(5, 64, 0) }

  const res = await executeCaptureAttempt(mockBot, target, { ballType: 'ultra_ball' })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'insufficient_balls')
  assert.equal(res.available, 0)
})

test('Cobblemon Battle FSM - Unverified challenge is blocked fail-closed', async () => {
  const controller = createCobblemonBattleController({})
  const blockedRes = await controller.challengeWild({ id: 45 })
  assert.equal(blockedRes.ok, false)
  assert.equal(blockedRes.status, 'blocked')
  assert.equal(blockedRes.reason, 'unverified_server_source_of_truth')
  assert.equal(controller.getStatus().state, 'idle')
})

test('Cobblemon Battle FSM - Turn cycle and victory outcome with authentic server packet', async () => {
  const controller = createCobblemonBattleController({})
  assert.equal(controller.getStatus().state, 'idle')

  // Start battle against wild Pokémon with verified server packet
  const validServerPacket = {
    channel: 'cobblemon:battle_start',
    battleId: 'battle_alpha_99',
    opponentId: 50
  }
  const challengeRes = await controller.challengeWild({ id: 50 }, { serverBattlePacket: validServerPacket })
  assert.equal(challengeRes.ok, true)
  assert.equal(challengeRes.battleId, 'battle_alpha_99')
  assert.equal(controller.getStatus().state, 'in_battle')

  // Turn 1
  const turn1 = controller.startTurn()
  assert.equal(turn1.ok, true)
  assert.equal(turn1.turn, 1)
  assert.equal(controller.getStatus().state, 'turn_active')

  // Choose attack
  const actionRes = await controller.chooseAction('attack')
  assert.equal(actionRes.ok, true)
  assert.equal(controller.getStatus().state, 'in_battle')

  // Conclude battle with victory
  const endRes = controller.concludeBattle('victory')
  assert.equal(endRes.ok, true)
  assert.equal(endRes.outcome, 'victory')
  assert.equal(controller.getStatus().state, 'idle')
})

test('Cobblemon Battle FSM - P0 Emergency Stop halts battle instantly', async () => {
  const writtenPackets = []
  const mockBot = {
    _client: {
      write: (channel, data) => writtenPackets.push({ channel, data })
    }
  }

  const controller = createCobblemonBattleController({ bot: mockBot })
  await controller.challengeWild({ id: 55 }, { serverBattlePacket: { channel: 'cobblemon:battle_start', opponentId: 55 } })
  controller.startTurn()
  assert.equal(controller.getStatus().state, 'turn_active')

  // Trigger P0 emergency stop
  const stopRes = controller.emergencyStop('p0_operator_override')
  assert.equal(stopRes.ok, true)
  assert.equal(stopRes.state, 'emergency_halted')
  assert.equal(controller.getStatus().state, 'emergency_halted')
  assert.equal(writtenPackets.length >= 1, true)
})

test('Cobblemon Battle FSM - Turn timeout triggers automatic flee', async () => {
  const controller = createCobblemonBattleController({})
  await controller.challengeWild({ id: 60 }, { serverBattlePacket: { channel: 'cobblemon:battle_start', opponentId: 60 } })
  controller.startTurn()

  // Simulate timeout trigger
  const fleeRes = controller.flee('turn_timeout_exceeded')
  assert.equal(fleeRes.ok, true)
  assert.equal(controller.getStatus().state, 'idle')
  assert.equal(fleeRes.reason, 'turn_timeout_exceeded')
})

test('Cobblemon PC Controller - Fails closed when server packet is unverified', async () => {
  const unverifiedPc = createCobblemonPcController({})
  const queryRes = unverifiedPc.queryBox(0)
  assert.equal(queryRes.ok, false)
  assert.equal(queryRes.status, 'blocked')
  assert.equal(queryRes.reason, 'unverified_server_source_of_truth')

  const depRes = await unverifiedPc.depositFromParty(0, 0, 0)
  assert.equal(depRes.ok, false)
  assert.equal(depRes.status, 'blocked')
  assert.equal(depRes.reason, 'unverified_server_source_of_truth')

  const withRes = await unverifiedPc.withdrawToParty(0, 0)
  assert.equal(withRes.ok, false)
  assert.equal(withRes.status, 'blocked')
  assert.equal(withRes.reason, 'unverified_server_source_of_truth')
})

test('Cobblemon PC Controller - Bounds validation, deposit and withdrawal with authentic server packet', async () => {
  // Bounds check
  assert.doesNotThrow(() => validateBoxBounds(0))
  assert.doesNotThrow(() => validateBoxBounds(31))
  assert.throws(() => validateBoxBounds(32), /Invalid PC box index: 32/i)
  assert.throws(() => validateBoxBounds(-1), /Invalid PC box index: -1/i)

  const botUuid = '11111111-2222-3333-4444-555555555555'
  const realParty = {
    1: { species: 'pikachu', level: 25, ivs: { hp: 31 } }
  }

  const pc = createCobblemonPcController({
    playerUuid: botUuid,
    party: realParty
  })

  // Ingest authentic server packet
  const serverPacket = {
    channel: 'cobblemon:pc_data',
    playerUuid: botUuid,
    boxes: {
      '0': new Array(30).fill(null)
    }
  }
  const ingestRes = pc.ingestServerStoragePacket(serverPacket)
  assert.equal(ingestRes.ok, true)
  assert.equal(pc.isVerified(), true)

  // Query empty box 0
  const emptyQuery = pc.queryBox(0)
  assert.equal(emptyQuery.ok, true)
  assert.equal(emptyQuery.totalStored, 0)
  assert.equal(emptyQuery.freeSlots, 30)

  // 1. Attempt deposit WITHOUT server channel or confirmation -> must fail closed
  const blockedDep = await pc.depositFromParty(1, 0, 5)
  assert.equal(blockedDep.ok, false)
  assert.equal(blockedDep.status, 'blocked')
  assert.equal(blockedDep.reason, 'unverified_server_storage_channel')

  // 2. Deposit genuine pokemon from party slot 1 into box 0 slot 5 with server confirmation packet
  const depositRes = await pc.depositFromParty(1, 0, 5, {
    serverConfirmationPacket: {
      channel: 'cobblemon:pc_data',
      playerUuid: botUuid,
      boxes: {
        '0': [
          ...new Array(5).fill(null),
          { species: 'pikachu', level: 25 },
          ...new Array(24).fill(null)
        ]
      }
    }
  })
  assert.equal(depositRes.ok, true)
  assert.equal(depositRes.status, 'confirmed')
  assert.equal(depositRes.observedServerState, true)
  assert.equal(depositRes.slot, 5)
  assert.equal(depositRes.pokemon.species, 'pikachu')

  // Query box 0 after deposit
  const queryAfter = pc.queryBox(0)
  assert.equal(queryAfter.totalStored, 1)
  assert.equal(queryAfter.slots[0].slot, 5)
  assert.equal(queryAfter.slots[0].pokemon.species, 'pikachu')

  // Re-depositing to same slot must throw
  await assert.rejects(async () => pc.depositFromParty(1, 0, 5), /already occupied/i)

  // 3. Attempt withdrawal WITHOUT server channel or confirmation -> must fail closed
  const blockedWith = await pc.withdrawToParty(0, 5, 1)
  assert.equal(blockedWith.ok, false)
  assert.equal(blockedWith.status, 'blocked')
  assert.equal(blockedWith.reason, 'unverified_server_storage_channel')

  // 4. Withdraw back to party with server confirmation packet
  const withdrawRes = await pc.withdrawToParty(0, 5, 1, {
    serverConfirmationPacket: {
      channel: 'cobblemon:pc_data',
      playerUuid: botUuid,
      boxes: {
        '0': new Array(30).fill(null) // Empty now
      }
    }
  })
  assert.equal(withdrawRes.ok, true)
  assert.equal(withdrawRes.status, 'confirmed')
  assert.equal(withdrawRes.observedServerState, true)
  assert.equal(withdrawRes.boxSlot, 5)
  assert.equal(withdrawRes.pokemon.species, 'pikachu')

  // Query box 0 after withdrawal
  const queryEmptyAgain = pc.queryBox(0)
  assert.equal(queryEmptyAgain.totalStored, 0)
})

test('Cobblemon Unified Adapter - Dispatches inspect, capture, battle and PC actions with server protocol verification', async () => {
  const mockBot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: 'poke_ball', count: 5 }] },
    entities: {
      '10': {
        id: 10,
        name: 'cobblemon:pokemon',
        displayName: 'Snorlax Lv. 30',
        position: new Vec3(6, 64, 0)
      }
    },
    lookAt: async () => {},
    equip: async () => {},
    activateItem: async () => {}
  }

  const adapter = createCobblemonAdapter({ bot: mockBot })

  // 1. Inspect
  const inspectRes = await adapter.execute({ action: 'inspect' })
  assert.equal(inspectRes.ok, true)
  assert.equal(inspectRes.count, 1)
  assert.equal(inspectRes.pokemon[0].species, 'snorlax lv. 30')

  // 2. Capture (fail-closed when no tracking channel)
  const unverifiedCap = await adapter.execute({ action: 'capture', target: 10 })
  assert.equal(unverifiedCap.ok, false)
  assert.equal(unverifiedCap.status, 'blocked')
  assert.equal(unverifiedCap.reason, 'no_tracking_channel')

  // 2b. Capture (confirmed with verified server packet)
  const captureRes = await adapter.execute(
    { action: 'capture', target: 10 },
    { serverConfirmation: { result: 'captured' } }
  )
  assert.equal(captureRes.ok, true)
  assert.equal(captureRes.captured, true)

  // 3. Battle (confirmed with authentic server battle packet)
  const battleRes = await adapter.execute(
    { action: 'battle_wild', target: 10 },
    { serverBattlePacket: { channel: 'cobblemon:battle_start', opponentId: 10 } }
  )
  assert.equal(battleRes.ok, true)
  assert.equal(battleRes.state, 'in_battle')

  // 4. PC Deposit (with authentic server storage packet and confirmation)
  adapter.pc.ingestServerStoragePacket({
    channel: 'cobblemon:pc_data',
    boxes: { '1': new Array(30).fill(null) }
  })
  const pcDepRes = await adapter.execute(
    { action: 'pc_deposit' },
    {
      partySlot: 0,
      box: 1,
      partyMember: { species: 'snorlax', level: 30 },
      serverConfirmationPacket: {
        channel: 'cobblemon:pc_data',
        boxes: {
          '1': [{ species: 'snorlax', level: 30 }, ...new Array(29).fill(null)]
        }
      }
    }
  )
  assert.equal(pcDepRes.ok, true)
  assert.equal(pcDepRes.box, 1)
  assert.equal(pcDepRes.observedServerState, true)
  assert.equal(pcDepRes.pokemon.species, 'snorlax')
})
