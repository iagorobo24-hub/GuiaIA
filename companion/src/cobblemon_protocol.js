'use strict'

/**
 * GuiaIA V1.1 - Cobblemon 1.8.2 Canonical Protocol Definitions and Adapter Bridge.
 *
 * This module distinguishes between:
 * 1. Official Canonical Cobblemon 1.8.2 Network Channels and Packets
 *    (Extracted directly from Cobblemon-fabric-1.8.2+1.21.1.jar bytecode).
 * 2. GuiaIA Dedicated Server-Side Adapter/Bridge Channels
 *    (Used when GuiaIA communicates via its authorized Fabric observer/bridge).
 * 3. Legacy Placeholder Channels (Supported for backwards compatibility with
 *    unit tests and synthetic mocks, explicitly tagged as PROVENANCE_LEGACY).
 */

const CANONICAL_CHANNELS = Object.freeze({
  // Entity Spawn & World Packets (Server -> Client)
  SPAWN_POKEMON_ENTITY: 'cobblemon:spawn_pokemon_entity',
  SPAWN_EMPTY_POKEBALL: 'cobblemon:spawn_empty_pokeball_entity',

  // Capture Packets (Server -> Client)
  CAPTURE_START: 'cobblemon:battle_capture_start',
  CAPTURE_SHAKE: 'cobblemon:battle_capture_shake',
  CAPTURE_END: 'cobblemon:battle_capture_end',

  // Battle Packets (Client -> Server)
  BATTLE_CHALLENGE: 'cobblemon:battle_challenge',
  BATTLE_CHALLENGE_RESPONSE: 'cobblemon:battle_challenge_response',
  BATTLE_SELECT_ACTIONS: 'cobblemon:battle_select_actions',
  SEND_OUT_POKEMON: 'cobblemon:send_out_pokemon',

  // Battle Packets (Server -> Client)
  BATTLE_INITIALIZE: 'cobblemon:battle_initialize',
  BATTLE_QUEUE_ACTION: 'cobblemon:battle_queue_action',
  BATTLE_END: 'cobblemon:battle_end',

  // PC & Storage Packets (Server -> Client)
  OPEN_PC: 'cobblemon:open_pc',
  INITIALIZE_PC: 'cobblemon:initialize_pc',
  SET_PC_BOX: 'cobblemon:set_pc_box',
  SET_PARTY_POKEMON: 'cobblemon:set_party_pokemon',
  CLOSE_PC: 'cobblemon:close_pc',

  // PC & Storage Packets (Client -> Server)
  MOVE_PARTY_TO_PC: 'cobblemon:move_party_pokemon_to_pc',
  MOVE_PC_TO_PARTY: 'cobblemon:move_pc_pokemon_to_party',
  SWAP_PC_POKEMON: 'cobblemon:swap_pc_pokemon',
  SWAP_PC_PARTY_POKEMON: 'cobblemon:swap_pc_party_pokemon',
  MOVE_PARTY_POKEMON: 'cobblemon:move_party_pokemon',
  MOVE_PC_POKEMON: 'cobblemon:move_pc_pokemon'
})

const BRIDGE_CHANNELS = Object.freeze({
  // Dedicated GuiaIA Adapter Bridge Channels
  ACTION: 'guiaia:cobblemon_action',
  RESULT: 'guiaia:cobblemon_result',
  OBSERVATION: 'guiaia:cobblemon_obs',
  PC_SYNC: 'guiaia:cobblemon_pc_sync'
})

const LEGACY_CHANNELS = Object.freeze({
  CAPTURE_RESULT: 'cobblemon:capture_result',
  BATTLE_START: 'cobblemon:battle_start',
  BATTLE_INIT: 'cobblemon:battle_init',
  PC_DATA: 'cobblemon:pc_data',
  STORAGE_DATA: 'cobblemon:storage_data'
})

const PROVENANCE = Object.freeze({
  CANONICAL_SERVER: 'CANONICAL_COBBLEMON_1_8_2',
  GUIAIA_BRIDGE: 'GUIAIA_AUTHORIZED_BRIDGE',
  LEGACY_SIMULATED: 'LEGACY_SYNTHETIC_ADAPTER'
})

/**
 * Classifies an incoming or outgoing protocol channel identifier.
 *
 * @param {string} channel Network channel string
 * @returns {Object} Detailed classification metadata
 */
function classifyChannel(channel) {
  if (typeof channel !== 'string') {
    return { valid: false, reason: 'invalid_channel_type', category: 'unknown' }
  }

  // Check Canonical Cobblemon 1.8.2 Channels
  for (const [key, value] of Object.entries(CANONICAL_CHANNELS)) {
    if (value === channel) {
      let category = 'unknown'
      if (key.startsWith('CAPTURE_')) category = 'capture'
      else if (key.startsWith('BATTLE_') || key === 'SEND_OUT_POKEMON') category = 'battle'
      else if (key.includes('PC') || key.includes('PARTY')) category = 'pc'
      else if (key.startsWith('SPAWN_')) category = 'spawn'

      const direction = (key.startsWith('BATTLE_CHALLENGE') || key.startsWith('BATTLE_SELECT') ||
                         key === 'SEND_OUT_POKEMON' ||
                         key === 'MOVE_PARTY_TO_PC' || key === 'MOVE_PC_TO_PARTY' ||
                         key === 'SWAP_PC_POKEMON' || key === 'SWAP_PC_PARTY_POKEMON' ||
                         key === 'MOVE_PARTY_POKEMON' || key === 'MOVE_PC_POKEMON')
        ? 'C->S' : 'S->C'

      return {
        valid: true,
        channel,
        provenance: PROVENANCE.CANONICAL_SERVER,
        isCanonical: true,
        isBridge: false,
        isLegacy: false,
        category,
        direction,
        key
      }
    }
  }

  // Check GuiaIA Bridge Channels
  for (const [key, value] of Object.entries(BRIDGE_CHANNELS)) {
    if (value === channel) {
      return {
        valid: true,
        channel,
        provenance: PROVENANCE.GUIAIA_BRIDGE,
        isCanonical: false,
        isBridge: true,
        isLegacy: false,
        category: 'bridge',
        direction: channel.includes('action') ? 'C->S' : 'S->C',
        key
      }
    }
  }

  // Check Legacy Compatibility Channels
  for (const [key, value] of Object.entries(LEGACY_CHANNELS)) {
    if (value === channel) {
      let category = 'unknown'
      if (key.startsWith('CAPTURE')) category = 'capture'
      else if (key.startsWith('BATTLE')) category = 'battle'
      else if (key.startsWith('PC') || key.startsWith('STORAGE')) category = 'pc'

      return {
        valid: true,
        channel,
        provenance: PROVENANCE.LEGACY_SIMULATED,
        isCanonical: false,
        isBridge: false,
        isLegacy: true,
        category,
        direction: 'S->C',
        key
      }
    }
  }

  return {
    valid: false,
    channel,
    reason: 'unknown_protocol_channel',
    category: 'unknown'
  }
}

/**
 * Validates an incoming capture event packet across canonical, bridge, and legacy formats.
 */
function verifyCaptureEvent(event, expected = {}) {
  if (!event || typeof event !== 'object') {
    return { valid: false, reason: 'malformed_packet' }
  }

  const channelInfo = classifyChannel(event.channel)
  if (!channelInfo.valid || (channelInfo.category !== 'capture' && channelInfo.category !== 'bridge')) {
    return { valid: false, reason: 'untrusted_origin_channel', channel: event.channel }
  }

  // Target entity matching
  const eventTarget = event.targetId !== undefined ? event.targetId : event.targetPNX
  if (expected.targetId !== undefined && eventTarget !== undefined && eventTarget !== expected.targetId) {
    return { valid: false, reason: 'target_entity_mismatch' }
  }

  // Sequence matching if present
  if (expected.sequence !== undefined && event.sequence !== undefined && event.sequence !== expected.sequence) {
    return { valid: false, reason: 'sequence_out_of_order' }
  }

  // Canonical Cobblemon 1.8.2 BattleCaptureEndPacket
  if (event.channel === CANONICAL_CHANNELS.CAPTURE_END) {
    const isCaught = Boolean(event.caught !== undefined ? event.caught : (event.result === 'captured'))
    return {
      valid: true,
      provenance: channelInfo.provenance,
      channel: event.channel,
      result: isCaught ? 'captured' : 'escaped',
      caught: isCaught,
      targetId: eventTarget
    }
  }

  // Canonical Cobblemon 1.8.2 Shake / Start
  if (event.channel === CANONICAL_CHANNELS.CAPTURE_SHAKE || event.channel === CANONICAL_CHANNELS.CAPTURE_START) {
    return {
      valid: true,
      provenance: channelInfo.provenance,
      channel: event.channel,
      result: 'in_progress',
      targetId: eventTarget
    }
  }

  // GuiaIA Bridge or Legacy format
  if (event.result === 'captured' || event.result === 'escaped') {
    return {
      valid: true,
      provenance: channelInfo.provenance,
      channel: event.channel,
      result: event.result,
      caught: event.result === 'captured',
      targetId: eventTarget
    }
  }

  return { valid: false, reason: 'unknown_result_status', result: event.result }
}

/**
 * Validates an incoming battle start / initialize packet.
 */
function verifyServerBattlePacket(packet, expected = {}) {
  if (!packet || typeof packet !== 'object') {
    return { valid: false, reason: 'malformed_packet' }
  }

  const channelInfo = classifyChannel(packet.channel)
  if (!channelInfo.valid || (channelInfo.category !== 'battle' && channelInfo.category !== 'bridge')) {
    return { valid: false, reason: 'untrusted_origin_channel', channel: packet.channel }
  }

  if (expected.opponentId !== undefined && packet.opponentId !== undefined && packet.opponentId !== expected.opponentId) {
    return { valid: false, reason: 'opponent_id_mismatch' }
  }

  const battleId = packet.battleId || packet.battleUuid || `battle_${Date.now()}`
  return {
    valid: true,
    provenance: channelInfo.provenance,
    channel: packet.channel,
    battleId
  }
}

/**
 * Validates an incoming PC storage packet across canonical, bridge, and legacy formats.
 */
function verifyServerStoragePacket(packet, expectedPlayerUuid) {
  if (!packet || typeof packet !== 'object') {
    return { valid: false, reason: 'malformed_packet' }
  }

  const channelInfo = classifyChannel(packet.channel)
  if (!channelInfo.valid || (channelInfo.category !== 'pc' && channelInfo.category !== 'bridge')) {
    return { valid: false, reason: 'untrusted_origin_channel', channel: packet.channel }
  }

  if (expectedPlayerUuid && packet.playerUuid && packet.playerUuid !== expectedPlayerUuid) {
    return { valid: false, reason: 'player_uuid_mismatch' }
  }

  // Canonical Cobblemon 1.8.2 SetPCBoxPacket
  if (packet.channel === CANONICAL_CHANNELS.SET_PC_BOX) {
    const boxNum = packet.box !== undefined ? packet.box : packet.boxNumber
    const pokemonList = Array.isArray(packet.pokemon) ? packet.pokemon : (Array.isArray(packet.slots) ? packet.slots : null)
    if (boxNum === undefined || !pokemonList) {
      return { valid: false, reason: 'missing_box_or_pokemon_list' }
    }
    const boxes = { [String(boxNum)]: pokemonList }
    return {
      valid: true,
      provenance: channelInfo.provenance,
      channel: packet.channel,
      boxes,
      storeId: packet.storeID
    }
  }

  // Canonical Cobblemon 1.8.2 InitializePCPacket
  if (packet.channel === CANONICAL_CHANNELS.INITIALIZE_PC) {
    const rawPc = packet.pc || {}
    const boxes = rawPc.boxes || packet.boxes || {}
    return {
      valid: true,
      provenance: channelInfo.provenance,
      channel: packet.channel,
      boxes,
      storeId: packet.storeID
    }
  }

  // GuiaIA Bridge or Legacy format (cobblemon:pc_data, cobblemon:storage_data)
  if (packet.boxes && typeof packet.boxes === 'object') {
    return {
      valid: true,
      provenance: channelInfo.provenance,
      channel: packet.channel,
      boxes: packet.boxes
    }
  }

  return { valid: false, reason: 'missing_boxes_structure' }
}

/**
 * Builders for client-to-server outbound packets.
 */
function buildMovePartyToPcPacket(pokemonId, partyPosition, pcPosition) {
  return {
    channel: CANONICAL_CHANNELS.MOVE_PARTY_TO_PC,
    data: {
      pokemonID: pokemonId,
      partyPosition: Number(partyPosition),
      pcPosition: Number(pcPosition)
    }
  }
}

function buildMovePcToPartyPacket(pokemonId, pcPosition, partyPosition = 0) {
  return {
    channel: CANONICAL_CHANNELS.MOVE_PC_TO_PARTY,
    data: {
      pokemonID: pokemonId,
      pcPosition: Number(pcPosition),
      partyPosition: Number(partyPosition)
    }
  }
}

function buildBattleChallengePacket(selectedPokemonId, battleFormat = 'GEN_9_SINGLES') {
  return {
    channel: CANONICAL_CHANNELS.BATTLE_CHALLENGE,
    data: {
      selectedPokemonId,
      battleFormat
    }
  }
}

function buildGuiaiaCobblemonAction(action, target, options = {}) {
  return {
    channel: BRIDGE_CHANNELS.ACTION,
    data: {
      action,
      target,
      options,
      timestamp: Date.now()
    }
  }
}

module.exports = {
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
}
