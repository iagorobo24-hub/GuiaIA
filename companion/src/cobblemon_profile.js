'use strict'

const { applyUpstreamQaRecipeIds } = require('../test/qa_cobblemon_recipe_ids_qa')

/**
 * Detects server runtime profile (Vanilla vs Fabric Cobblemon) from bot connection.
 */
function detectServerProfile(bot) {
  if (!bot) {
    return Object.freeze({
      profile: 'vanilla_standard',
      isCobblemon: false,
      serverBrand: 'unknown',
      recipeCompatibilityApplied: false
    })
  }

  let serverBrand = 'vanilla'
  let isCobblemon = false

  // Inspect brand channel if already negotiated
  const clientBrand = bot._client?.customChannels?.['minecraft:brand'] ||
                      bot._client?.serverBrand ||
                      bot.game?.serverBrand

  if (typeof clientBrand === 'string') {
    serverBrand = clientBrand.toLowerCase()
    if (serverBrand.includes('fabric') || serverBrand.includes('cobblemon')) {
      isCobblemon = serverBrand.includes('cobblemon')
    }
  }

  return Object.freeze({
    profile: isCobblemon ? 'cobblemon_v1' : 'vanilla_standard',
    isCobblemon,
    serverBrand,
    recipeCompatibilityApplied: false
  })
}

/**
 * Applies recipe protocol compatibility for Fabric 1.21.1 / Cobblemon if required.
 */
function ensureRecipeCompatibility() {
  try {
    return applyUpstreamQaRecipeIds()
  } catch {
    // Already applied or schemas already in sync
    return false
  }
}

/**
 * Attaches profile detector to a bot on spawn/login.
 */
function attachProfileDetector(bot, options = {}) {
  const forceCobblemon = Boolean(options.forceCobblemon)
  if (forceCobblemon) {
    ensureRecipeCompatibility()
  }

  let currentProfile = Object.freeze({
    profile: forceCobblemon ? 'cobblemon_v1' : 'vanilla_standard',
    isCobblemon: forceCobblemon,
    serverBrand: forceCobblemon ? 'fabric:cobblemon' : 'unknown',
    recipeCompatibilityApplied: forceCobblemon
  })

  if (bot && typeof bot.on === 'function') {
    bot.on('login', () => {
      if (forceCobblemon) return
      const detected = detectServerProfile(bot)
      if (detected.isCobblemon) {
        ensureRecipeCompatibility()
        currentProfile = Object.freeze({
          ...detected,
          recipeCompatibilityApplied: true
        })
      } else {
        currentProfile = detected
      }
    })
  }

  return Object.freeze({
    getProfile: () => currentProfile,
    ensureRecipeCompatibility
  })
}

module.exports = {
  detectServerProfile,
  ensureRecipeCompatibility,
  attachProfileDetector
}
