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
 * Creates PC Storage Controller for managing Pokémon boxes and transfers.
 * Enforces genuine server data attestation; fails closed without server confirmation.
 */
function createCobblemonPcController(options = {}) {
  const bot = options.bot
  let serverAttested = Boolean(options.serverAttested)
  const boxes = new Map()

  if (options.initialStorageData && typeof options.initialStorageData === 'object') {
    loadServerStorageData(options.initialStorageData)
    serverAttested = true
  }

  function loadServerStorageData(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid server storage data payload')
    }
    boxes.clear()
    if (data.boxes && typeof data.boxes === 'object') {
      for (const [boxKey, boxSlots] of Object.entries(data.boxes)) {
        const boxIdx = parseInt(boxKey, 10)
        if (Number.isInteger(boxIdx) && boxIdx >= 0 && boxIdx < TOTAL_BOXES) {
          const slotArr = new Array(SLOTS_PER_BOX).fill(null)
          if (Array.isArray(boxSlots)) {
            for (let i = 0; i < Math.min(boxSlots.length, SLOTS_PER_BOX); i++) {
              slotArr[i] = boxSlots[i] || null
            }
          }
          boxes.set(boxIdx, slotArr)
        }
      }
    }
    serverAttested = true
    return { ok: true, loadedBoxes: boxes.size }
  }

  function getBox(boxIndex) {
    validateBoxBounds(boxIndex)
    if (!boxes.has(boxIndex)) {
      boxes.set(boxIndex, new Array(SLOTS_PER_BOX).fill(null))
    }
    return boxes.get(boxIndex)
  }

  function queryBox(boxIndex = 0) {
    if (!serverAttested) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'unverified_protocol_packet',
        message: 'Cobblemon PC protocol data not received or attested from server'
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
    if (!serverAttested) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'unverified_protocol_packet',
        message: 'Cobblemon PC protocol data not received or attested from server'
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

    // Move genuine pokemon data to box
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
    if (!serverAttested) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'unverified_protocol_packet',
        message: 'Cobblemon PC protocol data not received or attested from server'
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

    // Remove from PC slot
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
    loadServerStorageData,
    isServerAttested: () => serverAttested,
    TOTAL_BOXES,
    SLOTS_PER_BOX,
    PARTY_SLOTS
  }
}

module.exports = {
  createCobblemonPcController,
  validateBoxBounds,
  validateSlotBounds,
  validatePartySlotBounds,
  TOTAL_BOXES,
  SLOTS_PER_BOX,
  PARTY_SLOTS
}
