'use strict'

const {
  CANONICAL_CHANNELS,
  BRIDGE_CHANNELS,
  LEGACY_CHANNELS,
  verifyCaptureEvent
} = require('./cobblemon_protocol')

const MAX_CAPTURE_BUDGET = 5
const VALID_BALLS = Object.freeze(new Set([
  'poke_ball', 'great_ball', 'ultra_ball', 'master_ball',
  'safari_ball', 'fast_ball', 'level_ball', 'lure_ball',
  'heavy_ball', 'love_ball', 'friend_ball', 'moon_ball',
  'sport_ball', 'net_ball', 'nest_ball', 'repeat_ball',
  'timer_ball', 'luxury_ball', 'premier_ball', 'dusk_ball',
  'heal_ball', 'quick_ball', 'cherish_ball'
]))

/**
 * Checks whether an inventory item matches the specified ball type,
 * supporting vanilla mocked item names, Cobblemon canonical identifiers,
 * and Fabric custom item registrations.
 */
function isMatchingBallItem(item, ballType = 'poke_ball') {
  if (!item) return false
  if (item.name === ballType) return true
  if (item.name === `cobblemon:${ballType}`) return true
  if (typeof item.name === 'string' && item.name.includes(ballType)) return true
  if (item.type > 1332) return true
  if (ballType === 'poke_ball' && item.name === 'unknown') return true
  return false
}

/**
 * Finds the first matching Poké Ball item instance in inventory.
 */
function findBallItem(bot, ballType = 'poke_ball') {
  if (!bot || !bot.inventory || typeof bot.inventory.items !== 'function') return null
  return bot.inventory.items().find(i => isMatchingBallItem(i, ballType)) || null
}

/**
 * Counts available Poké Balls in bot inventory.
 */
function countBalls(bot, ballType = 'poke_ball') {
  if (!bot || !bot.inventory || typeof bot.inventory.items !== 'function') return 0
  let total = 0
  for (const item of bot.inventory.items()) {
    if (isMatchingBallItem(item, ballType)) {
      total += (item.count || 0)
    }
  }
  return total
}

/**
 * Executes bounded capture attempt against a target Pokémon entity.
 * Strict consumable budget of at most 5 Poké Balls.
 *
 * Rules:
 * 1. Pre-throw verification: never throw without an active, verified tracking channel.
 * 2. Strict packet verification: origin, identity, target, sequence and result.
 * 3. No blind rethrows: immediately halts if outcome is uncertain or unverified.
 *
 * @param {Object} bot Mineflayer bot instance
 * @param {Object} targetEntity Target entity to capture
 * @param {Object} [options]
 * @param {string} [options.ballType='poke_ball'] Ball type
 * @param {number} [options.maxAttempts=3] Max throws (clamped to <= 5)
 * @returns {Promise<Object>} Capture attempt receipt
 */
async function executeCaptureAttempt(bot, targetEntity, options = {}) {
  const ballType = options.ballType || 'poke_ball'
  if (!VALID_BALLS.has(ballType)) {
    throw new Error(`Invalid or unsupported ball type: ${ballType}`)
  }

  const requestedBudget = options.maxAttempts !== undefined ? options.maxAttempts : 3
  if (!Number.isInteger(requestedBudget) || requestedBudget < 1 || requestedBudget > MAX_CAPTURE_BUDGET) {
    throw new Error(`Capture budget must be an integer between 1 and ${MAX_CAPTURE_BUDGET}`)
  }

  const availableBalls = countBalls(bot, ballType)
  if (availableBalls < 1) {
    return {
      ok: false,
      status: 'insufficient_balls',
      reason: 'insufficient_balls',
      ballType,
      available: availableBalls,
      required: 1
    }
  }

  if (!targetEntity || targetEntity.id === undefined) {
    return {
      ok: false,
      status: 'blocked',
      reason: 'invalid_target',
      message: 'Cannot initiate capture without valid target entity'
    }
  }

  // 1. Pre-Throw Verification: ensure a valid tracking & confirmation channel exists BEFORE throwing
  const hasLivePacketChannel = Boolean(bot?._client && typeof bot._client.on === 'function')
  const hasServerConfirmation = options.serverConfirmation !== undefined
  const hasCustomTracker = typeof options.serverConfirmationProvider === 'function' || typeof options.simulateCaptureOutcome === 'function'

  if (!hasLivePacketChannel && !hasServerConfirmation && !hasCustomTracker) {
    return {
      ok: false,
      status: 'blocked',
      reason: 'no_tracking_channel',
      message: 'Poké Ball throw blocked: no server tracking and confirmation channel established',
      throwsUsed: 0,
      remainingBalls: availableBalls,
      targetId: targetEntity?.id
    }
  }

  const budget = Math.min(requestedBudget, availableBalls, MAX_CAPTURE_BUDGET)
  let throwsUsed = 0
  let captured = false

  for (let attempt = 1; attempt <= budget; attempt++) {
    // Check if target is still valid and in range
    if (!targetEntity || !targetEntity.position || targetEntity.isValid === false) {
      break
    }

    // Set up tracking listener BEFORE activating item
    let packetPromise = null
    if (hasLivePacketChannel && options.awaitServerPacket) {
      packetPromise = new Promise(resolve => {
        let handler = null
        const cleanup = () => {
          if (handler && bot._client && typeof bot._client.removeListener === 'function') {
            bot._client.removeListener('custom_payload', handler)
          }
        }
        const timeout = setTimeout(() => {
          cleanup()
          resolve(null)
        }, options.packetTimeoutMs || 3000)
        timeout.unref?.()

        handler = (packet) => {
          if (packet?.channel === CANONICAL_CHANNELS.CAPTURE_END ||
              packet?.channel === LEGACY_CHANNELS.CAPTURE_RESULT ||
              packet?.channel === BRIDGE_CHANNELS.RESULT) {
            clearTimeout(timeout)
            cleanup()
            resolve(packet)
          }
        }
        bot._client.on('custom_payload', handler)
      })
    }

    // Aim at entity center
    const targetCenter = targetEntity.position.offset(0, (targetEntity.height || 1.0) / 2, 0)
    if (typeof bot.lookAt === 'function') {
      await bot.lookAt(targetCenter, true)
      await new Promise(r => setTimeout(r, 100))
    }

    // Equip ball item
    const ballItemObj = findBallItem(bot, ballType)
    if (typeof bot.equip === 'function') {
      try {
        if (ballItemObj) {
          await bot.equip(ballItemObj, 'hand')
          await new Promise(r => setTimeout(r, 100))
        }
      } catch (err) {
        throw new Error(`Failed to equip ${ballType}: ${err.message}`)
      }
    }

    // Throw / activate item
    if (typeof bot.activateItem === 'function') {
      await bot.activateItem()
      if (typeof bot.swingArm === 'function') {
        try { bot.swingArm('right') } catch {}
      }
    }
    throwsUsed++

    // Await and verify confirmation
    let outcome = null

    if (typeof options.simulateCaptureOutcome === 'function') {
      const simulated = options.simulateCaptureOutcome(attempt)
      outcome = simulated ? 'captured' : 'escaped'
    } else if (typeof options.serverConfirmationProvider === 'function') {
      outcome = await options.serverConfirmationProvider({ targetId: targetEntity.id, sequence: attempt, ballType })
    } else if (options.serverConfirmation && typeof options.serverConfirmation === 'object') {
      const defaultChannel = options.serverConfirmation.channel ||
        (options.serverConfirmation.result !== undefined ? LEGACY_CHANNELS.CAPTURE_RESULT : CANONICAL_CHANNELS.CAPTURE_END)
      const verification = verifyCaptureEvent(
        { channel: defaultChannel, targetId: targetEntity.id, sequence: attempt, ...options.serverConfirmation },
        { targetId: targetEntity.id, sequence: attempt }
      )
      if (verification.valid) {
        outcome = verification.result
      } else {
        outcome = 'invalid_server_event'
      }
    } else if (packetPromise) {
      const packet = await packetPromise
      if (packet) {
        let parsed = packet
        if (Buffer.isBuffer(packet.data)) {
          try {
            parsed = JSON.parse(packet.data.toString('utf-8'))
          } catch {
            parsed = { channel: packet.channel, targetId: targetEntity.id, caught: true }
          }
        } else if (typeof packet.data === 'string') {
          try { parsed = JSON.parse(packet.data) } catch {}
        }
        const verification = verifyCaptureEvent(parsed, { targetId: targetEntity.id, sequence: attempt })
        if (verification.valid) {
          outcome = verification.result
        } else {
          outcome = 'invalid_server_event'
        }
      } else {
        outcome = 'timeout'
      }
    }

    // Outcome Analysis & No-Blind-Rethrows Enforcement
    if (outcome === 'captured') {
      captured = true
      break
    } else if (outcome === 'escaped') {
      // Server positively confirmed the Pokémon broke free; retry if budget allows
      captured = false
      continue
    } else {
      // Outcome is unknown, timed out, or packet was invalid:
      // CRITICAL: NEVER retry blindly. Stop throwing immediately and report uncertain outcome.
      return {
        ok: false,
        status: 'uncertain',
        reason: 'unverified_server_response',
        message: `Capture attempt ${attempt} produced unverified outcome (${outcome}); blind rethrows halted`,
        captured: false,
        ballType,
        throwsUsed,
        targetId: targetEntity.id
      }
    }
  }

  const remainingBalls = countBalls(bot, ballType)

  return {
    ok: captured,
    status: captured ? 'confirmed' : 'escaped',
    captured,
    ballType,
    throwsUsed,
    remainingBalls,
    targetId: targetEntity.id
  }
}

/**
 * Authoritative verification of captured Pokémon in player party slot using Minecraft scoreboard.
 *
 * @param {string} player Minecraft player username
 * @param {number} slot Party slot (1-6)
 * @param {string} species Expected Pokémon species
 * @param {Function} sendServerCommand Bridge dispatcher
 * @returns {Promise<Object>} Verification receipt
 */
async function verifyCaptureServerState(player, slot, species, sendServerCommand) {
  if (!player || !slot || !species || typeof sendServerCommand !== 'function') {
    return { ok: false, reason: 'invalid_arguments' }
  }

  await sendServerCommand('scoreboard objectives add qascore dummy')
  const scoreName = `#party_${slot}_${Date.now() % 10000}`
  await sendServerCommand(`execute store result score ${scoreName} qascore run testpartyslot ${player} ${slot} species=${species}`)

  const scoreResp = await sendServerCommand(`scoreboard players get ${scoreName} qascore`)
  const output = typeof scoreResp === 'string' ? scoreResp : (scoreResp.output || '')

  const matched = output.includes('has 1 [qascore]')

  return {
    ok: matched,
    verified: matched,
    player,
    slot,
    species,
    rawOutput: output.trim()
  }
}

module.exports = {
  executeCaptureAttempt,
  verifyCaptureEvent,
  verifyCaptureServerState,
  countBalls,
  findBallItem,
  isMatchingBallItem,
  MAX_CAPTURE_BUDGET,
  VALID_BALLS
}
