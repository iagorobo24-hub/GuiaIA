'use strict'

const MAX_RADAR_DISTANCE = 24.0

/**
 * Normalizes entity name or type string to determine if it is a Pokémon.
 */
function isPokemonEntity(entity) {
  if (!entity) return false
  const name = (entity.name || '').toLowerCase()
  const type = (entity.type || '').toLowerCase()
  const entityType = (entity.entityType || '').toLowerCase()

  return name === 'cobblemon:pokemon' ||
         type === 'cobblemon:pokemon' ||
         entityType === 'cobblemon:pokemon' ||
         name.startsWith('cobblemon.') ||
         (entity.metadata && entity.metadata.some && entity.metadata.some(m => typeof m === 'string' && m.includes('cobblemon')))
}

/**
 * Extracts available Pokémon details from entity metadata or custom tags.
 */
function extractPokemonMetadata(entity) {
  let species = 'unknown'
  let level = 1
  let isShiny = false

  // Inspect custom name tag or metadata array if present
  if (entity.displayName) {
    species = entity.displayName.toLowerCase()
  } else if (entity.username) {
    species = entity.username.toLowerCase()
  } else if (typeof entity.name === 'string' && entity.name !== 'cobblemon:pokemon') {
    species = entity.name.toLowerCase()
  }

  // Parse level pattern like "Pikachu Lv. 15" or "[Lv 25]"
  const levelMatch = species.match(/lv\.?\s*(\d+)/i)
  if (levelMatch) {
    level = parseInt(levelMatch[1], 10)
  }

  if (species.includes('shiny') || entity.isShiny === true) {
    isShiny = true
  }

  return { species, level, isShiny }
}

/**
 * Scans entities around the bot for wild or spawned Pokémon within radius.
 *
 * @param {Object} bot Mineflayer bot instance
 * @param {Object} [options]
 * @param {number} [options.maxDistance=24] Max scan radius (clamped to <= 24)
 * @returns {Array<Object>} List of detected Pokémon sorted by distance ascending
 */
function scanNearbyPokemon(bot, options = {}) {
  if (!bot || !bot.entity || !bot.entity.position) return []
  const maxDistance = Math.min(MAX_RADAR_DISTANCE, options.maxDistance || MAX_RADAR_DISTANCE)
  const botPos = bot.entity.position

  const detected = []
  const entities = bot.entities || {}

  for (const [id, entity] of Object.entries(entities)) {
    if (!entity || entity === bot.entity || !entity.position) continue

    if (isPokemonEntity(entity)) {
      const distance = botPos.distanceTo(entity.position)
      if (distance <= maxDistance) {
        const meta = extractPokemonMetadata(entity)
        detected.push({
          entityId: entity.id !== undefined ? entity.id : parseInt(id, 10),
          species: meta.species,
          level: meta.level,
          isShiny: meta.isShiny,
          distance: Math.round(distance * 10) / 10,
          position: {
            x: Math.round(entity.position.x * 10) / 10,
            y: Math.round(entity.position.y * 10) / 10,
            z: Math.round(entity.position.z * 10) / 10
          }
        })
      }
    }
  }

  // Sort by distance ascending
  detected.sort((a, b) => a.distance - b.distance)

  return detected
}

module.exports = {
  scanNearbyPokemon,
  isPokemonEntity,
  extractPokemonMetadata,
  MAX_RADAR_DISTANCE
}
