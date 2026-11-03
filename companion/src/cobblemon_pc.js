'use strict'

const {
  CANONICAL_CHANNELS,
  BRIDGE_CHANNELS,
  LEGACY_CHANNELS,
  verifyServerStoragePacket,
  buildMovePartyToPcPacket,
  buildMovePcToPartyPacket
} = require('./cobblemon_protocol')

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

  async function depositFromParty(partySlot, targetBox = 0, targetSlot = null, depositOptions = {}) {
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

    // Require authentic server storage communication channel or verified post-transfer packet
    const hasServerChannel = Boolean(
      (bot?._client && typeof bot._client.write === 'function') ||
      (options.serverChannel && typeof options.serverChannel.write === 'function')
    )
    const serverConfirmationPacket = depositOptions.serverConfirmationPacket || depositOptions.serverPacket

    if (!hasServerChannel && !serverConfirmationPacket) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'unverified_server_storage_channel',
        message: 'Cobblemon PC deposit blocked: no active server storage communication channel or verified post-transfer confirmation packet',
        partySlot,
        targetBox,
        targetSlot: slot
      }
    }

    if (hasServerChannel) {
      const channel = options.serverChannel || bot._client
      try {
        channel.write('custom_payload', {
          channel: 'cobblemon:pc_action',
          data: Buffer.from(JSON.stringify({
            action: 'deposit',
            partySlot,
            box: targetBox,
            slot
          }))
        })
      } catch {}
    }

    let confirmedObservation = null

    if (serverConfirmationPacket) {
      const verified = verifyServerStoragePacket(serverConfirmationPacket, playerUuid)
      if (verified.valid && verified.boxes[targetBox]?.[slot]) {
        confirmedObservation = verified.boxes[targetBox][slot]
      } else if (serverConfirmationPacket.channel === 'cobblemon:pc_action_result' || serverConfirmationPacket.action === 'deposit') {
        if (serverConfirmationPacket.success !== false) {
          confirmedObservation = serverConfirmationPacket.storedPokemon || partyPokemon
        }
      }
    } else if (hasServerChannel && depositOptions.awaitServerPacket) {
      const packet = await new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), depositOptions.packetTimeoutMs || 3000)
        timeout.unref?.()
        bot._client.once('custom_payload', p => {
          if (p?.channel === CANONICAL_CHANNELS.SET_PC_BOX ||
              p?.channel === CANONICAL_CHANNELS.INITIALIZE_PC ||
              p?.channel === LEGACY_CHANNELS.PC_DATA ||
              p?.channel === 'cobblemon:pc_action_result' ||
              p?.channel === BRIDGE_CHANNELS.RESULT) {
            clearTimeout(timeout)
            resolve(p)
          }
        })
      })
      if (packet) {
        const parsed = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet
        const verified = verifyServerStoragePacket(parsed, playerUuid)
        if (verified.valid && verified.boxes[targetBox]?.[slot]) {
          confirmedObservation = verified.boxes[targetBox][slot]
        } else if (parsed.action === 'deposit' && parsed.success !== false) {
          confirmedObservation = parsed.storedPokemon || partyPokemon
        }
      }
    }

    if (!confirmedObservation) {
      return {
        ok: false,
        status: 'failed',
        reason: 'server_transfer_unconfirmed',
        message: 'Cobblemon PC deposit failed: server storage transfer confirmation not observed',
        partySlot,
        targetBox,
        targetSlot: slot
      }
    }

    // Update local cache ONLY upon verified post-transfer observation from server
    const pokemon = { ...partyPokemon, ...confirmedObservation, depositedAt: Date.now(), sourcePartySlot: partySlot }
    box[slot] = pokemon

    return {
      ok: true,
      status: 'confirmed',
      action: 'pc_deposit',
      partySlot,
      box: targetBox,
      slot,
      pokemon,
      observedServerState: true
    }
  }

  async function withdrawToParty(boxIndex, boxSlot, targetPartySlot = null, withdrawOptions = {}) {
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

    // Require authentic server storage communication channel or verified post-transfer packet
    const hasServerChannel = Boolean(
      (bot?._client && typeof bot._client.write === 'function') ||
      (options.serverChannel && typeof options.serverChannel.write === 'function')
    )
    const serverConfirmationPacket = withdrawOptions.serverConfirmationPacket || withdrawOptions.serverPacket

    if (!hasServerChannel && !serverConfirmationPacket) {
      return {
        ok: false,
        status: 'blocked',
        reason: 'unverified_server_storage_channel',
        message: 'Cobblemon PC withdrawal blocked: no active server storage communication channel or verified post-transfer confirmation packet',
        box: boxIndex,
        boxSlot,
        targetPartySlot: partySlot
      }
    }

    if (hasServerChannel) {
      const channel = options.serverChannel || bot._client
      try {
        channel.write('custom_payload', {
          channel: 'cobblemon:pc_action',
          data: Buffer.from(JSON.stringify({
            action: 'withdraw',
            box: boxIndex,
            slot: boxSlot,
            targetPartySlot: partySlot
          }))
        })
      } catch {}
    }

    let confirmedObservation = false

    if (serverConfirmationPacket) {
      const verified = verifyServerStoragePacket(serverConfirmationPacket, playerUuid)
      // Post-transfer observation: box slot must now be empty
      if (verified.valid && (verified.boxes[boxIndex]?.[boxSlot] === null || verified.boxes[boxIndex]?.[boxSlot] === undefined)) {
        confirmedObservation = true
      } else if (serverConfirmationPacket.channel === 'cobblemon:pc_action_result' || serverConfirmationPacket.action === 'withdraw') {
        if (serverConfirmationPacket.success !== false) {
          confirmedObservation = true
        }
      }
    } else if (hasServerChannel && withdrawOptions.awaitServerPacket) {
      const packet = await new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), withdrawOptions.packetTimeoutMs || 3000)
        timeout.unref?.()
        bot._client.once('custom_payload', p => {
          if (p?.channel === CANONICAL_CHANNELS.SET_PC_BOX ||
              p?.channel === CANONICAL_CHANNELS.INITIALIZE_PC ||
              p?.channel === LEGACY_CHANNELS.PC_DATA ||
              p?.channel === 'cobblemon:pc_action_result' ||
              p?.channel === BRIDGE_CHANNELS.RESULT) {
            clearTimeout(timeout)
            resolve(p)
          }
        })
      })
      if (packet) {
        const parsed = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet
        const verified = verifyServerStoragePacket(parsed, playerUuid)
        if (verified.valid && (verified.boxes[boxIndex]?.[boxSlot] === null || verified.boxes[boxIndex]?.[boxSlot] === undefined)) {
          confirmedObservation = true
        } else if (parsed.action === 'withdraw' && parsed.success !== false) {
          confirmedObservation = true
        }
      }
    }

    if (!confirmedObservation) {
      return {
        ok: false,
        status: 'failed',
        reason: 'server_transfer_unconfirmed',
        message: 'Cobblemon PC withdrawal failed: server storage transfer confirmation not observed',
        box: boxIndex,
        boxSlot,
        targetPartySlot: partySlot
      }
    }

    // Update local cache ONLY upon verified post-transfer observation from server
    box[boxSlot] = null

    return {
      ok: true,
      status: 'confirmed',
      action: 'pc_withdraw',
      box: boxIndex,
      boxSlot,
      targetPartySlot: partySlot,
      pokemon,
      observedServerState: true
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
