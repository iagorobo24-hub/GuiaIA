'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CANONICAL_CHANNELS,
  BRIDGE_CHANNELS,
  LEGACY_CHANNELS,
  PROVENANCE,
  classifyChannel,
  verifyCaptureEvent,
  verifyServerBattlePacket,
  verifyServerStoragePacket,
  buildMovePartyToPcPacket,
  buildMovePcToPartyPacket,
  buildBattleChallengePacket,
  buildGuiaiaCobblemonAction
} = require('../src/cobblemon_protocol')

const { createCobblemonBattleController } = require('../src/cobblemon_battle')
const { createCobblemonPcController } = require('../src/cobblemon_pc')
const { executeCaptureAttempt } = require('../src/cobblemon_capture')

test('Cobblemon 1.8.2 Protocol - Canonical channel classification and provenance tagging', () => {
  // Canonical capture channels
  const capStart = classifyChannel(CANONICAL_CHANNELS.CAPTURE_START)
  assert.equal(capStart.valid, true)
  assert.equal(capStart.isCanonical, true)
  assert.equal(capStart.provenance, PROVENANCE.CANONICAL_SERVER)
  assert.equal(capStart.category, 'capture')
  assert.equal(capStart.direction, 'S->C')

  const capEnd = classifyChannel(CANONICAL_CHANNELS.CAPTURE_END)
  assert.equal(capEnd.isCanonical, true)
  assert.equal(capEnd.channel, 'cobblemon:battle_capture_end')

  // Canonical battle channels
  const bChal = classifyChannel(CANONICAL_CHANNELS.BATTLE_CHALLENGE)
  assert.equal(bChal.isCanonical, true)
  assert.equal(bChal.direction, 'C->S')

  const bInit = classifyChannel(CANONICAL_CHANNELS.BATTLE_INITIALIZE)
  assert.equal(bInit.isCanonical, true)
  assert.equal(bInit.direction, 'S->C')

  // Canonical PC channels
  const pcInit = classifyChannel(CANONICAL_CHANNELS.INITIALIZE_PC)
  assert.equal(pcInit.isCanonical, true)
  assert.equal(pcInit.category, 'pc')

  const pcSetBox = classifyChannel(CANONICAL_CHANNELS.SET_PC_BOX)
  assert.equal(pcSetBox.isCanonical, true)
  assert.equal(pcSetBox.channel, 'cobblemon:set_pc_box')

  // GuiaIA bridge channels
  const bridgeAction = classifyChannel(BRIDGE_CHANNELS.ACTION)
  assert.equal(bridgeAction.isBridge, true)
  assert.equal(bridgeAction.isCanonical, false)
  assert.equal(bridgeAction.provenance, PROVENANCE.GUIAIA_BRIDGE)

  // Legacy channels
  const legCap = classifyChannel(LEGACY_CHANNELS.CAPTURE_RESULT)
  assert.equal(legCap.isLegacy, true)
  assert.equal(legCap.provenance, PROVENANCE.LEGACY_SIMULATED)

  // Unknown channel fails closed
  const fake = classifyChannel('some:random_payload')
  assert.equal(fake.valid, false)
  assert.equal(fake.reason, 'unknown_protocol_channel')
})

test('Cobblemon 1.8.2 Protocol - Canonical capture event verification', () => {
  // Canonical battle_capture_end with caught: true
  const canonicalCaught = verifyCaptureEvent({
    channel: 'cobblemon:battle_capture_end',
    targetPNX: 1234,
    caught: true
  }, { targetId: 1234 })
  assert.equal(canonicalCaught.valid, true)
  assert.equal(canonicalCaught.provenance, PROVENANCE.CANONICAL_SERVER)
  assert.equal(canonicalCaught.result, 'captured')
  assert.equal(canonicalCaught.caught, true)

  // Canonical battle_capture_end with caught: false (breakout)
  const canonicalEscaped = verifyCaptureEvent({
    channel: 'cobblemon:battle_capture_end',
    targetPNX: 1234,
    caught: false
  }, { targetId: 1234 })
  assert.equal(canonicalEscaped.valid, true)
  assert.equal(canonicalEscaped.result, 'escaped')
  assert.equal(canonicalEscaped.caught, false)

  // Untrusted channel rejected
  const untrusted = verifyCaptureEvent({
    channel: 'untrusted:fake_capture',
    targetPNX: 1234
  }, { targetId: 1234 })
  assert.equal(untrusted.valid, false)
  assert.equal(untrusted.reason, 'untrusted_origin_channel')
})

test('Cobblemon 1.8.2 Protocol - Canonical battle initialization packet', () => {
  const verified = verifyServerBattlePacket({
    channel: 'cobblemon:battle_initialize',
    battleId: 'canon_battle_uuid_99',
    opponentId: 42
  }, { opponentId: 42 })

  assert.equal(verified.valid, true)
  assert.equal(verified.provenance, PROVENANCE.CANONICAL_SERVER)
  assert.equal(verified.battleId, 'canon_battle_uuid_99')

  // Opponent mismatch rejected
  const mismatch = verifyServerBattlePacket({
    channel: 'cobblemon:battle_initialize',
    opponentId: 999
  }, { opponentId: 42 })
  assert.equal(mismatch.valid, false)
  assert.equal(mismatch.reason, 'opponent_id_mismatch')
})

test('Cobblemon 1.8.2 Protocol - Canonical SetPCBoxPacket storage verification', () => {
  const verified = verifyServerStoragePacket({
    channel: 'cobblemon:set_pc_box',
    storeID: 'storage_store_uuid',
    box: 2,
    pokemon: [
      { species: 'charmander', level: 12 }
    ]
  })

  assert.equal(verified.valid, true)
  assert.equal(verified.provenance, PROVENANCE.CANONICAL_SERVER)
  assert.equal(verified.storeId, 'storage_store_uuid')
  assert.equal(Array.isArray(verified.boxes['2']), true)
  assert.equal(verified.boxes['2'][0].species, 'charmander')
})

test('Cobblemon 1.8.2 Protocol - Packet builders produce expected structures', () => {
  const partyToPc = buildMovePartyToPcPacket('pokemon-uuid-1', 0, 5)
  assert.equal(partyToPc.channel, 'cobblemon:move_party_pokemon_to_pc')
  assert.equal(partyToPc.data.pokemonID, 'pokemon-uuid-1')
  assert.equal(partyToPc.data.partyPosition, 0)
  assert.equal(partyToPc.data.pcPosition, 5)

  const pcToParty = buildMovePcToPartyPacket('pokemon-uuid-2', 5, 1)
  assert.equal(pcToParty.channel, 'cobblemon:move_pc_pokemon_to_party')
  assert.equal(pcToParty.data.pokemonID, 'pokemon-uuid-2')
  assert.equal(pcToParty.data.pcPosition, 5)
  assert.equal(pcToParty.data.partyPosition, 1)

  const chal = buildBattleChallengePacket('lead-pokemon-uuid', 'GEN_9_SINGLES')
  assert.equal(chal.channel, 'cobblemon:battle_challenge')
  assert.equal(chal.data.selectedPokemonId, 'lead-pokemon-uuid')
  assert.equal(chal.data.battleFormat, 'GEN_9_SINGLES')

  const guiaiaAction = buildGuiaiaCobblemonAction('inspect', null)
  assert.equal(guiaiaAction.channel, 'guiaia:cobblemon_action')
  assert.equal(guiaiaAction.data.action, 'inspect')
})
