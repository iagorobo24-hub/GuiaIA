'use strict'

const TOTAL_BOXES = 32
const SLOTS_PER_BOX = 30
const PARTY_SLOTS = 6

function validateBoxBounds(box) {
  if (!Number.isInteger(box) || box < 0 || box >= TOTAL_BOXES) {
    throw new Error(`Invalid PC box index: ${box}. Must be between 0 and ${TOTAL_BOXES - 1}`)
  }
}

function validateSlotBounds(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS_PER_BOX) {
    throw new Error(`Invalid PC slot index: ${slot}. Must be between 0 and ${SLOTS_PER_BOX - 1}`)
  }
}

function validatePartySlotBounds(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PARTY_SLOTS) {
    throw new Error(`Invalid party slot index: ${slot}. Must be between 0 and ${PARTY_SLOTS - 1}`)
  }
}

/**
 * Verifies and decodes an authentic Cobblemon PC server storage packet envelope.
 *
 * @param {Object} packet Incoming network packet or payload
 * @param {string} expectedPlayerUuid Expected player/bot UUID
 * @returns {Object} { valid: boolean, data?: Object, reason?: string }
 */
function verifyServerStoragePacket(packet, expectedPlayerUuid) {
  if (!packet || typeof packet !== 'object') {
    return { valid: false, reason: 'malformed_packet' }
  }
  if (packet.channel !== 'cobblemon:pc_data' && packet.channel !== 'cobblemon:storage_data') {
    return { valid: false, reason: 'untrusted_origin_channel' }
  }
  if (expectedPlayerUuid && packet.playerUuid !== expectedPlayerUuid) {
    return { valid: false, reason: 'player_uuid_mismatch' }
  }
  if (!packet.boxes || typeof packet.boxes !== 'object') {
    return { valid: false, reason: 'missing_boxes_structure' }
  }
  return { valid: true, boxes: packet.boxes }
}

/**
 * Creates PC Storage Controller for managing Pokémon boxes and transfers.
 * Enforces genuine server packet verification; fail closed without verified server source of truth.
 */
function createCobblemonPcController(options = {}) {
  const bot = options.bot
  const playerUuid = options.playerUuid || bot?.player?.uuid || null
  let lastVerifiedPacket = null
  const boxes = new Map()

  function ingestServerStoragePacket(packet) {
    const verified = verifyServerStoragePacket(packet, playerUuid)
    if (!verified.valid) {
      return { ok: false, status: 'blocked', reason: verified.reason }
    }

    boxes.clear()
    for (const [boxKey, boxSlots] of Object.entries(verified.boxes)) {
      const boxIdx = parseInt(boxKey, 10)
      if (Number.isInteger(boxIdx) && boxIdx >= 0 && boxIdx < TOTAL_BOXES) {
        const slotArr = new Array(SLOTS_PER_BOX).fill(null)
        if (Array.isArray(boxSlots)) {
          for (let i = 0; i < Math.min(boxSlots.length, SLOTS_PER_BOX); i++) {
            if (boxSlots[i] && typeof boxSlots[i] === 'object') {
              slotArr[i] = { ...boxSlots[i] }
            }
          }
        }
        boxes.set(boxIdx, slotArr)
      }
    }

    lastVerifiedPacket = {
      receivedAt: Date.now(),
      boxCount: boxes.size
    }

    return { ok: true, loadedBoxes: boxes.size }
  }

  function isVerified() {
    return Boolean(lastVerifiedPacket !== null)
  }

  function getBox(boxIndex) {
    validateBoxBounds(boxIndex)
    if (!boxes.has(boxIndex)) {
      boxes.set(boxIndex, new Array(SLOTS_PER_BOX).fill(null))
    }
    return boxes.get(boxIndex)
  }

  function queryBox(boxIndex = 0) {
    if (!isVerified()) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'unverified_server_source_of_truth',
        message: 'Cobblemon PC operations blocked: no authentic server packet verified'
      }
    }
    validateBoxBounds(boxIndex)
    const box = getBox(boxIndex)
    const stored = []
    for (let slot = 0; slot < box.length; slot++) {
      if (box[slot] !== null) {
        stored.push({ slot, pokemon: box[slot] })
      }
    }
    return {
      ok: true,
      box: boxIndex,
      totalStored: stored.length,
      freeSlots: SLOTS_PER_BOX - stored.length,
      slots: stored
    }
  }

  function depositFromParty(partySlot, targetBox = 0, targetSlot = null, depositOptions = {}) {
    if (!isVerified()) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'unverified_server_source_of_truth',
        message: 'Cobblemon PC operations blocked: no authentic server packet verified'
      }
    }
    validatePartySlotBounds(partySlot)
    validateBoxBounds(targetBox)

    const partyPokemon = depositOptions.partyMember || options.party?.[partySlot]
    if (!partyPokemon || typeof partyPokemon !== 'object') {
      throw new Error(`Party slot ${partySlot} has no valid Pokémon to deposit`)
    }

    const box = getBox(targetBox)

    // Find target slot if not specified
    let slot = targetSlot
    if (slot === null || slot === undefined) {
      slot = box.findIndex(s => s === null)
      if (slot === -1) {
        throw new Error(`PC Box ${targetBox} is full`)
      }
    } else {
      validateSlotBounds(slot)
      if (box[slot] !== null) {
        throw new Error(`PC Box ${targetBox} slot ${slot} is already occupied`)
      }
    }

    const pokemon = { ...partyPokemon, depositedAt: Date.now(), sourcePartySlot: partySlot }
    box[slot] = pokemon

    return {
      ok: true,
      action: 'pc_deposit',
      partySlot,
      box: targetBox,
      slot,
      pokemon
    }
  }

  function withdrawToParty(boxIndex, boxSlot, targetPartySlot = null) {
    if (!isVerified()) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'unverified_server_source_of_truth',
        message: 'Cobblemon PC operations blocked: no authentic server packet verified'
      }
    }
    validateBoxBounds(boxIndex)
    validateSlotBounds(boxSlot)

    const box = getBox(boxIndex)
    const pokemon = box[boxSlot]
    if (!pokemon) {
      throw new Error(`No Pokémon found in PC Box ${boxIndex} slot ${boxSlot}`)
    }

    let partySlot = targetPartySlot
    if (partySlot !== null && partySlot !== undefined) {
      validatePartySlotBounds(partySlot)
    } else {
      partySlot = 0
    }

    box[boxSlot] = null

    return {
      ok: true,
      action: 'pc_withdraw',
      box: boxIndex,
      boxSlot,
      targetPartySlot: partySlot,
      pokemon
    }
  }

  return {
    queryBox,
    depositFromParty,
    withdrawToParty,
    ingestServerStoragePacket,
    isVerified,
    TOTAL_BOXES,
    SLOTS_PER_BOX,
    PARTY_SLOTS
  }
}

module.exports = {
  createCobblemonPcController,
  verifyServerStoragePacket,
  validateBoxBounds,
  validateSlotBounds,
  validatePartySlotBounds,
  TOTAL_BOXES,
  SLOTS_PER_BOX,
  PARTY_SLOTS
}
