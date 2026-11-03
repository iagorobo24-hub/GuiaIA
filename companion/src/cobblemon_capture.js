'use strict'

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
 * Counts available Poké Balls in bot inventory.
 */
function countBalls(bot, ballType = 'poke_ball') {
  if (!bot || !bot.inventory || typeof bot.inventory.items !== 'function') return 0
  let total = 0
  for (const item of bot.inventory.items()) {
    if (item && item.name === ballType) {
      total += (item.count || 0)
    }
  }
  return total
}

/**
 * Validates an incoming server capture event packet.
 * Verifies origin, target entity identity, throw sequence, and explicit result code.
 */
function verifyCaptureEvent(event, expected) {
  if (!event || typeof event !== 'object') {
    return { valid: false, reason: 'malformed_packet' }
  }
  if (event.channel !== 'cobblemon:capture_result') {
    return { valid: false, reason: 'untrusted_origin_channel' }
  }
  if (event.targetId !== expected.targetId) {
    return { valid: false, reason: 'target_entity_mismatch' }
  }
  if (expected.sequence !== undefined && event.sequence !== undefined && event.sequence !== expected.sequence) {
    return { valid: false, reason: 'sequence_out_of_order' }
  }
  if (event.result !== 'captured' && event.result !== 'escaped') {
    return { valid: false, reason: 'unknown_result_status' }
  }
  return { valid: true, result: event.result }
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
        const timeout = setTimeout(() => resolve(null), options.packetTimeoutMs || 3000)
        timeout.unref?.()
        const handler = (packet) => {
          if (packet?.channel === 'cobblemon:capture_result') {
            clearTimeout(timeout)
            resolve(packet)
          }
        }
        bot._client.once('custom_payload', handler)
      })
    }

    // Aim at entity center
    const targetCenter = targetEntity.position.offset(0, (targetEntity.height || 1.0) / 2, 0)
    if (typeof bot.lookAt === 'function') {
      await bot.lookAt(targetCenter)
    }

    // Equip ball
    if (typeof bot.equip === 'function') {
      try {
        await bot.equip(ballType, 'hand')
      } catch (err) {
        throw new Error(`Failed to equip ${ballType}: ${err.message}`)
      }
    }

    // Throw / activate item
    if (typeof bot.activateItem === 'function') {
      await bot.activateItem()
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
      const verification = verifyCaptureEvent(
        { channel: 'cobblemon:capture_result', targetId: targetEntity.id, sequence: attempt, ...options.serverConfirmation },
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
        const parsed = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet
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
        remainingBalls: countBalls(bot, ballType),
        targetId: targetEntity?.id
      }
    }
  }

  return {
    ok: true,
    status: captured ? 'confirmed' : 'escaped',
    action: 'capture',
    captured,
    ballType,
    throwsUsed,
    remainingBalls: countBalls(bot, ballType),
    targetId: targetEntity?.id
  }
}

module.exports = {
  executeCaptureAttempt,
  verifyCaptureEvent,
  countBalls,
  VALID_BALLS,
  MAX_CAPTURE_BUDGET
}
