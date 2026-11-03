'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const EventEmitter = require('node:events')

const {
  getAuthStorageDir,
  hasCachedTokens,
  clearAuthTokens,
  buildMineflayerAuthOptions
} = require('../src/auth/microsoft_auth')

const {
  createOwnerPinPairing,
  generatePin
} = require('../src/auth/owner_pin_pairing')

describe('V1 Authentication & Owner Pairing (Phase 3)', () => {
  describe('Microsoft Auth & Token Storage (TASK-3.1)', () => {
    test('getAuthStorageDir returns valid path and creates directory', () => {
      const dir = getAuthStorageDir()
      assert.equal(typeof dir, 'string')
      assert.ok(dir.includes('GuiaIA'))
      assert.ok(fs.existsSync(dir))
      // Verify it is NOT inside git repository
      assert.ok(!dir.includes(path.join('GuiaIA', 'companion')))
    })

    test('buildMineflayerAuthOptions handles offline mode', () => {
      const opts = buildMineflayerAuthOptions({ username: 'TestBot', authMode: 'offline' })
      assert.equal(opts.username, 'TestBot')
      assert.equal(opts.auth, 'offline')
      assert.equal(opts.profilesFolder, undefined)
    })

    test('buildMineflayerAuthOptions handles microsoft mode', () => {
      let codeCaptured = null
      const opts = buildMineflayerAuthOptions({
        username: 'steve@example.com',
        authMode: 'microsoft',
        onMsaCode: (c) => { codeCaptured = c }
      })
      assert.equal(opts.username, 'steve@example.com')
      assert.equal(opts.auth, 'microsoft')
      assert.ok(opts.profilesFolder.includes('GuiaIA'))
      assert.equal(typeof opts.onMsaCode, 'function')
    })

    test('hasCachedTokens and clearAuthTokens work with custom storage dir', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-test-auth-'))
      const username = 'testuser@domain.com'

      assert.equal(hasCachedTokens(username, tmpDir), false)

      // Create synthetic token dir
      const userDir = path.join(tmpDir, username)
      fs.mkdirSync(userDir, { recursive: true })
      fs.writeFileSync(path.join(userDir, 'tokens.json'), '{"test":true}')

      assert.equal(hasCachedTokens(username, tmpDir), true)

      // Clear tokens
      const cleared = clearAuthTokens(username, tmpDir)
      assert.equal(cleared, true)
      assert.equal(hasCachedTokens(username, tmpDir), false)

      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    })
  })

  describe('Ephemeral Owner PIN Pairing (TASK-3.2)', () => {
    test('generatePin creates a 6-digit numeric string', () => {
      for (let i = 0; i < 20; i++) {
        const pin = generatePin()
        assert.equal(typeof pin, 'string')
        assert.equal(pin.length, 6)
        assert.ok(/^\d{6}$/.test(pin))
      }
    })

    test('pairing lifecycle: generate -> verify success -> locked', () => {
      let callbackFired = false
      const manager = createOwnerPinPairing({
        onPairSuccess: (owner) => {
          callbackFired = true
          assert.equal(owner.username, 'Alex')
        }
      })

      const status1 = manager.getStatus()
      assert.equal(status1.isPaired, false)
      assert.equal(status1.hasActivePin, false)

      const pinInfo = manager.generateNewPin()
      assert.equal(pinInfo.pin.length, 6)

      const status2 = manager.getStatus()
      assert.equal(status2.hasActivePin, true)

      // Verify with valid PIN
      const res = manager.verifyPin('Alex', pinInfo.pin)
      assert.equal(res.ok, true)
      assert.equal(res.owner.username, 'Alex')
      assert.ok(callbackFired)

      const status3 = manager.getStatus()
      assert.equal(status3.isPaired, true)
      assert.equal(status3.pairedOwner.username, 'Alex')
      assert.equal(status3.hasActivePin, false)

      // Attempting to pair again fails
      const duplicateRes = manager.verifyPin('Intruder', pinInfo.pin)
      assert.equal(duplicateRes.ok, false)
      assert.equal(duplicateRes.reason, 'already_paired')
    })

    test('pairing lockout after 3 incorrect attempts', () => {
      const manager = createOwnerPinPairing({ maxAttempts: 3 })
      const pinInfo = manager.generateNewPin()

      // Attempt 1: wrong PIN
      const res1 = manager.verifyPin('Alex', '000000')
      assert.equal(res1.ok, false)
      assert.equal(res1.reason, 'invalid_pin')
      assert.equal(res1.remainingAttempts, 2)

      // Attempt 2: wrong PIN
      const res2 = manager.verifyPin('Alex', '111111')
      assert.equal(res2.ok, false)
      assert.equal(res2.reason, 'invalid_pin')
      assert.equal(res2.remainingAttempts, 1)

      // Attempt 3: wrong PIN -> locks out
      const res3 = manager.verifyPin('Alex', '222222')
      assert.equal(res3.ok, false)
      assert.equal(res3.reason, 'invalid_pin')
      assert.equal(res3.remainingAttempts, 0)

      // Attempt 4: even with correct PIN, locked out!
      const res4 = manager.verifyPin('Alex', pinInfo.pin)
      assert.equal(res4.ok, false)
      assert.equal(res4.reason, 'pairing_expired')
    })

    test('pairing expires after TTL', async () => {
      const manager = createOwnerPinPairing({ ttlMs: 50 })
      const pinInfo = manager.generateNewPin()

      // Wait 70ms to exceed TTL
      await new Promise(resolve => setTimeout(resolve, 70))

      const res = manager.verifyPin('Alex', pinInfo.pin)
      assert.equal(res.ok, false)
      assert.equal(res.reason, 'pairing_expired')
    })

    test('attachToBot handles in-game chat pair commands', () => {
      const bot = new EventEmitter()
      bot.username = 'GuiaBot'
      let whispered = []
      bot.whisper = (target, msg) => {
        whispered.push({ target, msg })
      }

      const manager = createOwnerPinPairing()
      const pinInfo = manager.generateNewPin()
      const detach = manager.attachToBot(bot)

      // Simulate incoming whisper from player
      bot.emit('whisper', 'PlayerOne', `pair ${pinInfo.pin}`)

      assert.equal(whispered.length, 1)
      assert.equal(whispered[0].target, 'PlayerOne')
      assert.ok(whispered[0].msg.includes('Emparejamiento exitoso'))

      assert.equal(manager.getStatus().isPaired, true)
      assert.equal(manager.getStatus().pairedOwner.username, 'PlayerOne')

      detach()
    })
  })
})
