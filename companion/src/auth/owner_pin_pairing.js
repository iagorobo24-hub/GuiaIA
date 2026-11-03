'use strict'

const crypto = require('node:crypto')

const DEFAULT_TTL_MS = 180000 // 3 minutes
const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Generates a cryptographically secure 6-digit numeric PIN string.
 */
function generatePin() {
  const num = crypto.randomInt(100000, 1000000)
  return num.toString()
}

/**
 * Creates an ephemeral PIN pairing manager for LAN / offline Minecraft sessions.
 */
function createOwnerPinPairing(options = {}) {
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS
  const maxAttempts = options.maxAttempts || DEFAULT_MAX_ATTEMPTS
  const onPairSuccess = options.onPairSuccess || null

  let activePin = null
  let expiresAt = 0
  let attempts = 0
  let pairedOwner = null

  function generateNewPin() {
    if (pairedOwner) {
      throw new Error('Cannot generate new PIN while session is already paired. Reset pairing first.')
    }
    activePin = generatePin()
    expiresAt = Date.now() + ttlMs
    attempts = 0
    return {
      pin: activePin,
      expiresAt,
      ttlSeconds: Math.round(ttlMs / 1000)
    }
  }

  function getStatus() {
    const isExpired = Date.now() > expiresAt
    return Object.freeze({
      isPaired: Boolean(pairedOwner),
      pairedOwner: pairedOwner ? { ...pairedOwner } : null,
      hasActivePin: Boolean(activePin && !isExpired && !pairedOwner),
      remainingTtlMs: Math.max(0, expiresAt - Date.now()),
      attempts,
      maxAttempts
    })
  }

  function verifyPin(username, inputPin, connectionId = null) {
    if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,16}$/.test(username)) {
      return { ok: false, reason: 'invalid_username' }
    }
    if (pairedOwner) {
      return { ok: false, reason: 'already_paired', owner: pairedOwner.username }
    }
    if (!activePin || Date.now() > expiresAt) {
      activePin = null
      return { ok: false, reason: 'pairing_expired' }
    }
    if (attempts >= maxAttempts) {
      activePin = null
      return { ok: false, reason: 'too_many_attempts' }
    }

    const cleanInput = String(inputPin || '').trim()
    if (cleanInput.length !== 6 || cleanInput !== activePin) {
      attempts++
      const remainingAttempts = Math.max(0, maxAttempts - attempts)
      if (remainingAttempts === 0) {
        activePin = null
      }
      return { ok: false, reason: 'invalid_pin', remainingAttempts }
    }

    // Success! Lock pairing to this owner
    pairedOwner = Object.freeze({
      username,
      connectionId: connectionId || crypto.randomUUID(),
      pairedAt: Date.now()
    })
    activePin = null // Single-use consumption
    attempts = 0

    if (typeof onPairSuccess === 'function') {
      try { onPairSuccess(pairedOwner) } catch {}
    }

    return { ok: true, owner: pairedOwner }
  }

  function reset() {
    activePin = null
    expiresAt = 0
    attempts = 0
    pairedOwner = null
  }

  /**
   * Attaches chat/whisper listeners to a Mineflayer bot instance.
   */
  function attachToBot(bot) {
    if (!bot || typeof bot.on !== 'function') {
      throw new Error('Valid bot instance required to attach pairing')
    }

    function onWhisper(sender, message) {
      handleIncomingChat(sender, message)
    }

    function onChat(sender, message) {
      handleIncomingChat(sender, message)
    }

    function handleIncomingChat(sender, message) {
      if (!sender || sender === bot.username) return
      const clean = String(message || '').trim()
      const match = clean.match(/^pair\s+(\d{6})$/i)
      if (!match) return

      const pin = match[1]
      const result = verifyPin(sender, pin)
      if (result.ok) {
        bot.whisper?.(sender, `Emparejamiento exitoso. Eres el operador autorizado para ${bot.username}.`)
      } else {
        if (result.reason === 'invalid_pin') {
          bot.whisper?.(sender, `PIN incorrecto. Intentos restantes: ${result.remainingAttempts}`)
        } else if (result.reason === 'pairing_expired') {
          bot.whisper?.(sender, `El codigo de emparejamiento ha expirado. Genera uno nuevo en la consola.`)
        } else if (result.reason === 'too_many_attempts') {
          bot.whisper?.(sender, `Demasiados intentos fallidos. Genera un nuevo PIN en la consola.`)
        } else if (result.reason === 'already_paired') {
          bot.whisper?.(sender, `El agente ya esta emparejado con ${result.owner}.`)
        }
      }
    }

    bot.on('whisper', onWhisper)
    bot.on('chat', onChat)

    return function detach() {
      bot.removeListener?.('whisper', onWhisper)
      bot.removeListener?.('chat', onChat)
    }
  }

  return Object.freeze({
    generateNewPin,
    getStatus,
    verifyPin,
    reset,
    attachToBot
  })
}

module.exports = {
  createOwnerPinPairing,
  generatePin
}
