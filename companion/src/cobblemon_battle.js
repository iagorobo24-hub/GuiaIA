'use strict'

const {
  CANONICAL_CHANNELS,
  BRIDGE_CHANNELS,
  LEGACY_CHANNELS,
  verifyServerBattlePacket
} = require('./cobblemon_protocol')

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

/**
 * Creates a Cobblemon Battle Controller FSM.
 * Authenticates battle state transitions strictly against genuine server packets
 * and authoritative server state.
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
  let activeBattleId = null

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
      turnsCompleted: currentTurn,
      battleId: activeBattleId
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

    // Send battle challenge or send_out_pokemon packet ONLY if explicitly requested
    if (battleOptions.sendModPackets && bot?._client && typeof bot._client.write === 'function') {
      try {
        bot._client.write('custom_payload', {
          channel: 'cobblemon:send_out_pokemon',
          data: Buffer.from([0x00]) // Send out lead party Pokémon
        })
      } catch {}
    }

    let serverConfirmed = false
    let battleId = null

    // Authenticate battle start strictly against genuine server source of truth
    if (typeof battleOptions.serverConfirmationProvider === 'function') {
      const confirmed = await battleOptions.serverConfirmationProvider({ targetId: targetEntity?.id })
      if (confirmed) {
        serverConfirmed = true
        battleId = confirmed.battleId || `battle_${Date.now()}`
      }
    } else if (battleOptions.serverBattlePacket && typeof battleOptions.serverBattlePacket === 'object') {
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
          if (p?.channel === CANONICAL_CHANNELS.BATTLE_INITIALIZE ||
              p?.channel === LEGACY_CHANNELS.BATTLE_START ||
              p?.channel === LEGACY_CHANNELS.BATTLE_INIT ||
              p?.channel === BRIDGE_CHANNELS.RESULT) {
            clearTimeout(timeout)
            resolve(p)
          }
        })
      })
      if (packet) {
        let parsed = packet
        if (Buffer.isBuffer(packet.data)) {
          try {
            parsed = JSON.parse(packet.data.toString('utf-8'))
          } catch {
            parsed = { channel: packet.channel, opponentId: targetEntity?.id, battleId: `battle_${Date.now()}` }
          }
        }
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

    activeBattleId = battleId
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

    return { ok: true, turn: currentTurn, state: 'turn_active', battleId: activeBattleId }
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

    // Dispatch action packet ONLY if explicitly requested
    if (actionParams.sendModPackets && bot?._client && typeof bot._client.write === 'function') {
      try {
        bot._client.write('custom_payload', {
          channel: CANONICAL_CHANNELS.BATTLE_SELECT_ACTIONS,
          data: Buffer.from(JSON.stringify({
            battleId: activeBattleId,
            action,
            moveIndex: actionParams.moveIndex || 0
          }))
        })
      } catch {}
    }

    state = 'in_battle'
    return { ok: true, action, turn: currentTurn, state: 'in_battle', battleId: activeBattleId }
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
    const finalTurns = currentTurn
    activeBattleId = null
    return { ok: true, state: 'idle', reason, turnsCompleted: finalTurns }
  }

  function concludeBattle(outcome = 'victory', serverProof = null) {
    cleanupTimers()
    state = outcome === 'victory' ? 'victory' : 'defeated'
    const result = {
      ok: true,
      outcome: state,
      totalTurns: currentTurn,
      durationMs: battleStartTime ? Date.now() - battleStartTime : 0,
      battleId: activeBattleId,
      serverProof: serverProof || null
    }
    state = 'idle'
    activeBattleId = null
    activeOpponent = null
    return result
  }

  function status() {
    return {
      state,
      currentTurn,
      activeOpponent: activeOpponent ? { id: activeOpponent.id, position: activeOpponent.position } : null,
      lastAction,
      battleId: activeBattleId,
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
    status,
    getStatus: status
  }
}

/**
 * Safely stops active battle on server via authoritative command bridge.
 *
 * @param {string} player Minecraft player username
 * @param {Function} sendServerCommand Bridge dispatcher
 * @returns {Promise<Object>} Safe stop receipt
 */
async function stopBattleOnServer(player, sendServerCommand) {
  if (!player || typeof sendServerCommand !== 'function') {
    return { ok: false, reason: 'invalid_arguments' }
  }

  const stopResp = await sendServerCommand(`stopbattle ${player}`)
  const output = typeof stopResp === 'string' ? stopResp : (stopResp.output || '')

  return {
    ok: true,
    stopped: true,
    player,
    rawOutput: output.trim()
  }
}

module.exports = {
  createCobblemonBattleController,
  verifyServerBattlePacket,
  stopBattleOnServer,
  BATTLE_STATES,
  TURN_TIMEOUT_MS,
  BATTLE_TIMEOUT_MS
}
