'use strict'

const TURN_TIMEOUT_MS = 15000 // 15s per turn
const BATTLE_TIMEOUT_MS = 60000 // 60s total

const BATTLE_STATES = Object.freeze(new Set([
  'idle',
  'challenging',
  'in_battle',
  'turn_active',
  'fleeing',
  'victory',
  'defeated',
  'emergency_halted'
]))

function verifyServerBattlePacket(packet, expected = {}) {
  if (!packet || typeof packet !== 'object') {
    return { valid: false, reason: 'malformed_packet' }
  }
  if (packet.channel !== 'cobblemon:battle_start' && packet.channel !== 'cobblemon:battle_init') {
    return { valid: false, reason: 'untrusted_origin_channel' }
  }
  if (expected.opponentId !== undefined && packet.opponentId !== expected.opponentId) {
    return { valid: false, reason: 'opponent_id_mismatch' }
  }
  return { valid: true, battleId: packet.battleId }
}

/**
 * Creates a Cobblemon Battle Controller FSM.
 */
function createCobblemonBattleController(options = {}) {
  const bot = options.bot
  let state = 'idle'
  let currentTurn = 0
  let battleStartTime = null
  let turnTimer = null
  let battleTimer = null
  let activeOpponent = null
  let lastAction = null

  function cleanupTimers() {
    if (turnTimer) {
      clearTimeout(turnTimer)
      turnTimer = null
    }
    if (battleTimer) {
      clearTimeout(battleTimer)
      battleTimer = null
    }
  }

  function emergencyStop(reason = 'p0_emergency_stop') {
    cleanupTimers()
    const previousState = state
    state = 'emergency_halted'
    lastAction = `halted:${reason}`

    // Attempt instant flee or forfeit packet if bot connection is live
    if (bot?._client && typeof bot._client.write === 'function' && previousState !== 'idle') {
      try {
        bot._client.write('custom_payload', {
          channel: 'cobblemon:battle_turn',
          data: Buffer.from([0x04]) // 0x04 = flee/forfeit opcode
        })
      } catch {}
    }

    return {
      ok: true,
      state: 'emergency_halted',
      reason,
      turnsCompleted: currentTurn
    }
  }

  async function challengeWild(targetEntity, battleOptions = {}) {
    if (state !== 'idle') {
      throw new Error(`Cannot start battle while in state ${state}`)
    }

    state = 'challenging'
    activeOpponent = targetEntity
    currentTurn = 0
    battleStartTime = Date.now()

    // Overall battle watchdog (60s)
    battleTimer = setTimeout(() => {
      if (state !== 'victory' && state !== 'defeated' && state !== 'idle') {
        flee('battle_timeout_exceeded')
      }
    }, BATTLE_TIMEOUT_MS)
    if (battleTimer.unref) battleTimer.unref()

    // Send battle challenge packet if live client present
    if (bot?._client && typeof bot._client.write === 'function') {
      try {
        bot._client.write('custom_payload', {
          channel: 'cobblemon:battle_challenge',
          data: Buffer.from(JSON.stringify({ targetId: targetEntity?.id }))
        })
      } catch {}
    }

    let serverConfirmed = false
    let battleId = null

    // Authenticate battle start strictly against genuine server source of truth
    if (battleOptions.serverBattlePacket && typeof battleOptions.serverBattlePacket === 'object') {
      const verified = verifyServerBattlePacket(battleOptions.serverBattlePacket, { opponentId: targetEntity?.id })
      if (verified.valid) {
        serverConfirmed = true
        battleId = verified.battleId || `battle_${Date.now()}`
      }
    } else if (bot?._client && typeof bot._client.on === 'function' && battleOptions.awaitServerPacket) {
      const packet = await new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), battleOptions.packetTimeoutMs || 3000)
        timeout.unref?.()
        bot._client.once('custom_payload', (p) => {
          if (p?.channel === 'cobblemon:battle_start') {
            clearTimeout(timeout)
            resolve(p)
          }
        })
      })
      if (packet) {
        const parsed = typeof packet.data === 'string' ? JSON.parse(packet.data) : packet
        const verified = verifyServerBattlePacket(parsed, { opponentId: targetEntity?.id })
        if (verified.valid) {
          serverConfirmed = true
          battleId = verified.battleId
        }
      }
    }

    if (!serverConfirmed) {
      cleanupTimers()
      state = 'idle'
      activeOpponent = null
      return {
        ok: false,
        status: 'blocked',
        reason: 'unverified_server_source_of_truth',
        message: 'Cobblemon battle blocked: server battle handshake not verified'
      }
    }

    state = 'in_battle'
    return { ok: true, state: 'in_battle', battleId, opponentId: targetEntity?.id }
  }

  function startTurn(turnData = {}) {
    if (state !== 'in_battle' && state !== 'turn_active') {
      return { ok: false, reason: `Invalid state for startTurn: ${state}` }
    }

    currentTurn++
    state = 'turn_active'

    if (turnTimer) clearTimeout(turnTimer)

    // Turn watchdog (15s)
    turnTimer = setTimeout(() => {
      if (state === 'turn_active') {
        // Auto-flee on turn timeout
        flee('turn_timeout_exceeded')
      }
    }, TURN_TIMEOUT_MS)
    if (turnTimer.unref) turnTimer.unref()

    return { ok: true, turn: currentTurn, state: 'turn_active' }
  }

  async function chooseAction(action = 'attack', actionParams = {}) {
    if (state !== 'turn_active') {
      throw new Error(`Cannot choose action while in state ${state}`)
    }

    if (turnTimer) {
      clearTimeout(turnTimer)
      turnTimer = null
    }

    lastAction = action

    if (action === 'flee') {
      return flee('operator_run')
    }

    // Default or custom action handling
    state = 'in_battle'
    return { ok: true, action, turn: currentTurn, state: 'in_battle' }
  }

  function flee(reason = 'player_run') {
    cleanupTimers()
    state = 'fleeing'
    lastAction = `flee:${reason}`

    if (bot?._client && typeof bot._client.write === 'function') {
      try {
        bot._client.write('custom_payload', {
          channel: 'cobblemon:battle_turn',
          data: Buffer.from([0x04])
        })
      } catch {}
    }

    state = 'idle'
    return { ok: true, state: 'idle', reason, turnsCompleted: currentTurn }
  }

  function concludeBattle(outcome = 'victory') {
    cleanupTimers()
    state = outcome === 'victory' ? 'victory' : 'defeated'
    const result = {
      ok: true,
      outcome: state,
      totalTurns: currentTurn,
      durationMs: battleStartTime ? Date.now() - battleStartTime : 0
    }
    state = 'idle'
    activeOpponent = null
    return result
  }

  function getStatus() {
    return {
      state,
      currentTurn,
      hasActiveOpponent: Boolean(activeOpponent),
      lastAction,
      elapsedMs: battleStartTime ? Date.now() - battleStartTime : 0
    }
  }

  return {
    challengeWild,
    startTurn,
    chooseAction,
    flee,
    concludeBattle,
    emergencyStop,
    getStatus,
    TURN_TIMEOUT_MS,
    BATTLE_TIMEOUT_MS
  }
}

module.exports = {
  createCobblemonBattleController,
  verifyServerBattlePacket,
  BATTLE_STATES,
  TURN_TIMEOUT_MS,
  BATTLE_TIMEOUT_MS
}
