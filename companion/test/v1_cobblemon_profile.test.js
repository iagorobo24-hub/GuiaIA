'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')

const {
  detectServerProfile,
  ensureRecipeCompatibility,
  attachProfileDetector
} = require('../src/cobblemon_profile')

describe('V1 Cobblemon Profile Detection (TASK-4.1)', () => {
  test('detects vanilla profile when brand is standard', () => {
    const mockBot = {
      game: { serverBrand: 'vanilla' }
    }
    const profile = detectServerProfile(mockBot)
    assert.equal(profile.profile, 'vanilla_standard')
    assert.equal(profile.isCobblemon, false)
    assert.equal(profile.serverBrand, 'vanilla')
  })

  test('detects cobblemon profile when brand contains cobblemon', () => {
    const mockBot = {
      game: { serverBrand: 'Fabric:Cobblemon-1.8.2' }
    }
    const profile = detectServerProfile(mockBot)
    assert.equal(profile.profile, 'cobblemon_v1')
    assert.equal(profile.isCobblemon, true)
    assert.ok(profile.serverBrand.includes('cobblemon'))
  })

  test('ensureRecipeCompatibility applies cleanly without throwing', () => {
    const result = ensureRecipeCompatibility()
    assert.equal(typeof result, 'boolean')
  })

  test('attachProfileDetector with forceCobblemon sets profile immediately', () => {
    const mockBot = new EventEmitter()
    const detector = attachProfileDetector(mockBot, { forceCobblemon: true })
    const p = detector.getProfile()
    assert.equal(p.profile, 'cobblemon_v1')
    assert.equal(p.isCobblemon, true)
    assert.equal(p.recipeCompatibilityApplied, true)
  })

  test('attachProfileDetector detects cobblemon on bot login event', () => {
    const mockBot = new EventEmitter()
    mockBot.game = { serverBrand: 'vanilla' }
    const detector = attachProfileDetector(mockBot)

    assert.equal(detector.getProfile().isCobblemon, false)

    // Simulate login where brand is Cobblemon
    mockBot.game.serverBrand = 'Fabric/Cobblemon'
    mockBot.emit('login')

    const p = detector.getProfile()
    assert.equal(p.isCobblemon, true)
    assert.equal(p.profile, 'cobblemon_v1')
  })
})
