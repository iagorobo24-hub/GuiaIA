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
 * Executes bounded capture attempt against a target Pokémon entity.
 * Strict consumable budget of at most 5 Poké Balls.
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

  const budget = Math.min(requestedBudget, availableBalls, MAX_CAPTURE_BUDGET)

  let throwsUsed = 0
  let captured = false

  for (let attempt = 1; attempt <= budget; attempt++) {
    // Check if target is still valid and alive
    if (!targetEntity || !targetEntity.position || targetEntity.isValid === false) {
      break
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

    // Throw / activate
    if (typeof bot.activateItem === 'function') {
      await bot.activateItem()
    }

    throwsUsed++

    // Authentic protocol verification: require server confirmation
    if (typeof options.simulateCaptureOutcome === 'function') {
      captured = options.simulateCaptureOutcome(attempt)
      if (captured) break
    } else if (options.serverConfirmation && typeof options.serverConfirmation === 'object') {
      captured = Boolean(options.serverConfirmation.captured)
      if (captured) break
    } else if (bot?._client && typeof bot._client.on === 'function' && options.awaitServerPacket) {
      // Bounded wait for genuine custom_payload or entity removal packet
      captured = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), options.packetTimeoutMs || 3000)
        timer.unref?.()
        const handler = (packet) => {
          if (packet?.channel === 'cobblemon:capture_result') {
            clearTimeout(timer)
            resolve(Boolean(packet.data?.[0] === 1))
          }
        }
        bot._client.once('custom_payload', handler)
      })
      if (captured) break
    } else {
      // Without valid server confirmation or test hook, fail closed:
      // never declare capture success fictively.
      return {
        ok: false,
        status: 'blocked',
        reason: 'unverified_protocol_packet',
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
  countBalls,
  VALID_BALLS,
  MAX_CAPTURE_BUDGET
}
