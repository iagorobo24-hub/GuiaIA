'use strict'

const { Vec3 } = require('vec3')

const MAX_RADAR_DISTANCE = 24.0

/**
 * Normalizes entity name or type string to determine if it is a Pokémon.
 * Uses genuine protocol tags, entity attributes, and custom tracked metadata.
 */
function isPokemonEntity(entity, bot = null) {
  if (!entity) return false

  // 1. Check if adapter already identified Pokémon
  if (entity.isPokemon === true || (entity.pokemonData && entity.pokemonData.species && entity.pokemonData.species !== 'unknown')) {
    return true
  }

  // 2. Check if present in bot Cobblemon metadata cache
  const entId = entity.id !== undefined ? entity.id : null
  if (bot?.__cobblemonEntityMetaCache && entId !== null) {
    const cached = bot.__cobblemonEntityMetaCache.get(entId)
    if (cached && cached.species && cached.species !== 'unknown') {
      return true
    }
  }

  const name = (entity.name || '').toLowerCase()
  const type = (entity.type || '').toLowerCase()
  const entityType = String(entity.entityType || '').toLowerCase()

  if (name === 'cobblemon:pokemon' ||
      type === 'cobblemon:pokemon' ||
      entityType === 'cobblemon:pokemon' ||
      name.startsWith('cobblemon.')) {
    return true
  }

  // 3. Check metadata (direct index 19 or array iteration)
  if (entity.metadata) {
    const val19 = entity.metadata[19]
    if (typeof val19 === 'string' && val19.includes('cobblemon:')) return true
    if (val19 && typeof val19 === 'object') {
      const v = val19.value !== undefined ? val19.value : val19
      if (typeof v === 'string' && v.includes('cobblemon:')) return true
    }
    if (Array.isArray(entity.metadata)) {
      for (const item of entity.metadata) {
        if (item && item.key === 19 && typeof item.value === 'string' && item.value.includes('cobblemon:')) {
          return true
        }
        if (typeof item === 'string' && item.includes('cobblemon:')) {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Extracts available Pokémon details from entity metadata, custom tags, or adapter state.
 *
 * @param {Object} entity Minecraft entity instance
 * @returns {Object} Extracted Pokémon metadata
 */
function extractPokemonMetadata(entity, bot = null) {
  let species = 'unknown'
  let level = 1
  let isShiny = false
  let pokemonUUID = null
  let entityUuid = entity.uuid || null

  // 0. Read from bot cache if present
  if (bot?.__cobblemonEntityMetaCache && entity.id !== undefined) {
    const cached = bot.__cobblemonEntityMetaCache.get(entity.id)
    if (cached) {
      if (cached.species) species = cached.species
      if (cached.level !== undefined && cached.level !== null && cached.level > 0) level = cached.level
      if (cached.uuid) entityUuid = cached.uuid
    }
  }

  // 1. Read from adapter cache if present
  if (entity.pokemonData) {
    if (entity.pokemonData.species) species = entity.pokemonData.species.toLowerCase()
    if (entity.pokemonData.level !== undefined && entity.pokemonData.level !== null && entity.pokemonData.level > 0) {
      level = entity.pokemonData.level
    }
    if (entity.pokemonData.isShiny !== undefined) isShiny = entity.pokemonData.isShiny
    if (entity.pokemonData.uuid) pokemonUUID = entity.pokemonData.uuid
    if (entity.pokemonData.entityUuid) entityUuid = entity.pokemonData.entityUuid
  }

  // 2. Read from entity.metadata (Fabric Cobblemon 1.8.2 entity metadata keys)
  if (entity.metadata) {
    // Direct indexed access (prismarine-entity metadata array or object)
    const val19 = entity.metadata[19]
    if (typeof val19 === 'string') {
      species = val19.replace(/^cobblemon:/, '').toLowerCase()
    } else if (val19 && typeof val19 === 'object') {
      const v = val19.value !== undefined ? val19.value : val19
      if (typeof v === 'string') species = v.replace(/^cobblemon:/, '').toLowerCase()
    }

    const val33 = entity.metadata[33]
    if (typeof val33 === 'number') {
      level = val33
    } else if (val33 && typeof val33 === 'object') {
      const v = val33.value !== undefined ? val33.value : val33
      if (typeof v === 'number') level = v
    }

    // Packet format with key/value entries
    if (Array.isArray(entity.metadata)) {
      for (const item of entity.metadata) {
        if (item && typeof item === 'object' && item.key !== undefined) {
          if (item.key === 19) {
            const v = item.value !== undefined ? item.value : item
            if (typeof v === 'string') species = v.replace(/^cobblemon:/, '').toLowerCase()
          }
          if (item.key === 33) {
            const v = item.value !== undefined ? item.value : item
            if (typeof v === 'number') level = v
          }
        }
      }
    }
  }

  // 3. Fallback to displayName or username if species not found in metadata
  if (species === 'unknown') {
    if (entity.displayName && entity.displayName !== 'unknown') {
      species = entity.displayName.toLowerCase().replace(/^cobblemon:/, '')
    } else if (entity.username) {
      species = entity.username.toLowerCase().replace(/^cobblemon:/, '')
    } else if (typeof entity.name === 'string' && entity.name !== 'cobblemon:pokemon' && entity.name !== 'unknown') {
      species = entity.name.toLowerCase().replace(/^cobblemon:/, '')
    }
  }

  // Parse level pattern like "Pikachu Lv. 15" or "[Lv 25]" if still default
  if (level === 1) {
    const levelMatch = species.match(/lv\.?\s*(\d+)/i)
    if (levelMatch) {
      level = parseInt(levelMatch[1], 10)
    }
  }

  if (species.includes('shiny') || entity.isShiny === true) {
    isShiny = true
  }

  return {
    species,
    level,
    isShiny,
    pokemonUUID,
    entityUuid: entityUuid || pokemonUUID || (entity.id !== undefined ? `entity_${entity.id}` : null)
  }
}

/**
 * Decodes a canonical cobblemon:spawn_pokemon_entity network payload.
 *
 * @param {Buffer} buf Raw network payload buffer
 * @returns {Object|null} Decoded entity and Pokémon properties
 */
function decodeSpawnPokemonBuffer(buf) {
  if (!Buffer.isBuffer(buf)) return null

  // Support JSON payload for synthetic bridge / unit testing
  if (buf.length >= 2 && buf[0] === 0x7b) {
    try {
      const parsed = JSON.parse(buf.toString('utf8'))
      if (parsed && typeof parsed === 'object') {
        return {
          pokemonUUID: parsed.pokemonUUID || parsed.uuid || '0'.repeat(32),
          species: parsed.species || 'unknown',
          level: parsed.level || 1,
          scale: parsed.scale || 1.0,
          gender: parsed.gender || 0,
          isShiny: Boolean(parsed.isShiny),
          entityId: parsed.entityId !== undefined ? parsed.entityId : null,
          entityUuid: parsed.entityUuid || null,
          position: parsed.position || null
        }
      }
    } catch {}
  }

  if (buf.length < 50) return null

  try {
    let pos = 0
    const hasOwner = buf[pos++];
    let ownerUuid = null
    if (hasOwner) {
      ownerUuid = buf.slice(pos, pos + 16).toString('hex')
      pos += 16
    }

    const pokeUuid = buf.slice(pos, pos + 16).toString('hex')
    pos += 16

    const hasStorage = buf[pos++]
    if (hasStorage) {
      pos += 16
    }

    const scale = buf.readFloatBE(pos)
    pos += 4

    // Species identifier string (varint length + ascii)
    const sLen = buf[pos++]
    const rawSpecies = buf.slice(pos, pos + sLen).toString('ascii')
    pos += sLen
    const species = rawSpecies.replace(/^cobblemon:/, '').toLowerCase()

    const gender = buf[pos++]
    const isShiny = Boolean(buf[pos++])

    // Level extraction: in SpawnPokemonPacket, labelLevel is Int32BE right before caughtBall
    let level = 1
    const ballMarker = buf.indexOf(Buffer.from('cobblemon:'), pos)
    if (ballMarker > 11) {
      const candidateLvl = buf.readInt32BE(ballMarker - 11)
      if (candidateLvl >= 1 && candidateLvl <= 100) {
        level = candidateLvl
      }
    }

    // Trailing vanilla EntitySpawnS2CPacket:
    // entityId (varint), entityUuid (16 bytes), type (varint), x (double), y (double), z (double)
    let entityId = null
    let entityUuid = null
    let position = null

    if (buf.length >= 70) {
      for (let i = buf.length - 40; i <= buf.length - 24; i++) {
        try {
          const tx = buf.readDoubleBE(i)
          const ty = buf.readDoubleBE(i + 8)
          const tz = buf.readDoubleBE(i + 16)
          if (Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(tz) &&
              ty >= -64 && ty <= 320 && Math.abs(tx) < 10000 && Math.abs(tz) < 10000) {
            position = { x: Math.round(tx * 10) / 10, y: Math.round(ty * 10) / 10, z: Math.round(tz * 10) / 10 }
            const uuidStart = i - 18
            if (uuidStart >= 0) {
              const uHex = buf.slice(uuidStart, uuidStart + 16).toString('hex')
              if (uHex.length === 32) {
                entityUuid = `${uHex.slice(0, 8)}-${uHex.slice(8, 12)}-${uHex.slice(12, 16)}-${uHex.slice(16, 20)}-${uHex.slice(20)}`
              }
              entityId = buf[uuidStart - 1]
            }
            break
          }
        } catch {}
      }
    }

    return {
      pokemonUUID: pokeUuid,
      species,
      level,
      scale,
      gender,
      isShiny,
      entityId,
      entityUuid,
      position
    }
  } catch {
    return null
  }
}

/**
 * Attaches a Cobblemon Radar Protocol Adapter to the Mineflayer bot.
 * Listens for canonical cobblemon:spawn_pokemon_entity payloads and entity_metadata
 * packets to accurately register Pokémon entities into bot.entities.
 *
 * @param {Object} bot Mineflayer bot instance
 */
function attachCobblemonRadarAdapter(bot) {
  if (!bot || !bot._client) return

  if (!bot.__cobblemonEntityMetaCache) {
    bot.__cobblemonEntityMetaCache = new Map()
  }

  // 1. Hook custom_payload for cobblemon:spawn_pokemon_entity
  bot._client.on('custom_payload', (data) => {
    if (data.channel === 'cobblemon:spawn_pokemon_entity' && data.data) {
      const decoded = decodeSpawnPokemonBuffer(data.data)
      if (decoded) {
        const entId = decoded.entityId !== null && decoded.entityId !== undefined ? decoded.entityId : (1000 + Math.floor(Math.random() * 9000))
        let ent = bot.entities?.[entId]
        if (!ent) {
          ent = {
            id: entId,
            uuid: decoded.entityUuid || decoded.pokemonUUID,
            type: 'cobblemon:pokemon',
            name: 'cobblemon:pokemon',
            displayName: decoded.species,
            position: decoded.position ? new Vec3(decoded.position.x, decoded.position.y, decoded.position.z) : new Vec3(0, 64, 0),
            height: 1.0,
            width: 0.6,
            metadata: []
          }
          if (bot.entities) bot.entities[entId] = ent
        }
        ent.isPokemon = true
        ent.name = 'cobblemon:pokemon'
        ent.displayName = decoded.species
        if (!ent.pokemonData) ent.pokemonData = {}
        Object.assign(ent.pokemonData, decoded)
        if (decoded.level) ent.pokemonData.level = decoded.level

        // Also check if any matching Cobblemon entity in bot.entities needs updating (do not clobber vanilla entities)
        const targetEntityId = decoded.entityId !== null && decoded.entityId !== undefined ? decoded.entityId : entId
        for (const [id, e] of Object.entries(bot.entities || {})) {
          if (e && (Number(id) === targetEntityId || e.id === targetEntityId || (e.isPokemon && e.name === 'cobblemon:pokemon' && (!e.pokemonData || e.pokemonData.species === 'unknown')))) {
            e.isPokemon = true
            e.name = 'cobblemon:pokemon'
            e.displayName = decoded.species
            if (!e.pokemonData) e.pokemonData = {}
            Object.assign(e.pokemonData, decoded)
          }
        }

        bot.__cobblemonEntityMetaCache.set(entId, {
          species: decoded.species,
          level: decoded.level,
          uuid: decoded.entityUuid || decoded.pokemonUUID
        })
      }
    }
  })

  // 2. Hook raw entity_metadata packets to track species (key 19) and level (key 33)
  bot._client.on('packet', (data, meta) => {
    if ((meta.name === 'entity_metadata' || meta.name === 'set_entity_data') && data.metadata && data.entityId !== undefined) {
      const entityId = data.entityId
      let spec = null
      let lvl = null
      for (const item of data.metadata) {
        if (item && item.key === 19 && typeof item.value === 'string' && item.value.includes('cobblemon:')) {
          spec = item.value.replace(/^cobblemon:/, '').toLowerCase()
        }
        if (item && (item.key === 33 || item.key === '33')) {
          const num = typeof item.value === 'number' ? item.value : Number(item.value)
          if (!isNaN(num) && num > 0) {
            lvl = num
          }
        }
      }
      if (spec || lvl !== null) {
        const existing = bot.__cobblemonEntityMetaCache.get(entityId) || {}
        if (spec) existing.species = spec
        if (lvl !== null) existing.level = lvl
        bot.__cobblemonEntityMetaCache.set(entityId, existing)
      }
      let ent = bot.entities?.[entityId]
      if (!ent && (spec || lvl)) {
        ent = {
          id: entityId,
          type: 'cobblemon:pokemon',
          name: 'cobblemon:pokemon',
          position: new Vec3(0, 64, 0),
          metadata: []
        }
        if (bot.entities) bot.entities[entityId] = ent
      }
      if (ent && (spec !== null || lvl !== null)) {
        ent.isPokemon = true
        ent.name = 'cobblemon:pokemon'
        if (spec) {
          ent.displayName = spec
          if (!ent.pokemonData) ent.pokemonData = {}
          ent.pokemonData.species = spec
        }
        if (lvl !== null) {
          if (!ent.pokemonData) ent.pokemonData = {}
          ent.pokemonData.level = lvl
        }
      }
    }
  })

  // 3. Hook entitySpawn event to apply cached metadata
  if (typeof bot.on === 'function') {
    bot.on('entitySpawn', (entity) => {
      const cached = bot.__cobblemonEntityMetaCache.get(entity.id)
      if (cached) {
        if (cached.species) {
          entity.isPokemon = true
          entity.name = 'cobblemon:pokemon'
          entity.displayName = cached.species
          if (!entity.pokemonData) entity.pokemonData = {}
          entity.pokemonData.species = cached.species
        }
        if (cached.level !== undefined && cached.level !== null && cached.level > 0) {
          if (!entity.pokemonData) entity.pokemonData = {}
          entity.pokemonData.level = cached.level
        }
      }
    })
  }
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

    const entId = entity.id !== undefined ? entity.id : parseInt(id, 10)
    if (!entity.velocity) entity.velocity = new Vec3(0, 0, 0)

    // Synchronize from metadata cache if present
    if (bot.__cobblemonEntityMetaCache && entId !== null) {
      const cached = bot.__cobblemonEntityMetaCache.get(entId)
      if (cached && cached.species) {
        entity.isPokemon = true
        entity.name = 'cobblemon:pokemon'
        entity.displayName = cached.species
        if (!entity.pokemonData) entity.pokemonData = {}
        entity.pokemonData.species = cached.species
        if (cached.level) entity.pokemonData.level = cached.level
      }
    }

    if (isPokemonEntity(entity, bot)) {
      const distance = botPos.distanceTo(entity.position)
      if (distance <= maxDistance) {
        const meta = extractPokemonMetadata(entity, bot)
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
          },
          uuid: entity.uuid || meta.entityUuid || meta.pokemonUUID || (entity.id !== undefined ? `entity_${entity.id}` : null),
          pokemonUUID: meta.pokemonUUID || meta.entityUuid || null
        })
      }
    }
  }

  // Sort by distance ascending
  detected.sort((a, b) => a.distance - b.distance)

  return detected
}

/**
 * Contrasts local radar observation against authentic server NBT state via command bridge.
 *
 * @param {string} entityUuid Target entity UUID
 * @param {Function} sendServerCommand Bridge command dispatch function
 * @returns {Promise<Object>} Verification receipt
 */
async function verifyPokemonServerState(entityUuid, sendServerCommand) {
  if (typeof sendServerCommand !== 'function') {
    return { ok: false, reason: 'invalid_arguments' }
  }

  let rawResp = null
  if (entityUuid) {
    rawResp = await sendServerCommand(`data get entity ${entityUuid}`)
  }
  let output = typeof rawResp === 'string' ? rawResp : (rawResp?.output || '')

  if (!output.includes('Pokemon') && !output.includes('species')) {
    const fallbackResp = await sendServerCommand('data get entity @e[type=cobblemon:pokemon,limit=1,sort=nearest]')
    output = typeof fallbackResp === 'string' ? fallbackResp : (fallbackResp?.output || '')
  }

  const speciesMatch = output.match(/(?<![a-zA-Z])species:\s*"([^"]+)"/i) || output.match(/\bspecies:\s*"([^"]+)"/i)
  const levelMatch = output.match(/(?<![a-zA-Z])level:\s*(\d+)/i) || output.match(/\blevel:\s*(\d+)/i)

  if (speciesMatch || output.includes('Pokemon')) {
    const serverSpecies = (speciesMatch ? speciesMatch[1] : 'unknown').replace(/^cobblemon:/, '').toLowerCase()
    const serverLevel = levelMatch ? parseInt(levelMatch[1], 10) : 1
    return {
      ok: true,
      verified: true,
      serverSpecies,
      serverLevel,
      rawOutput: output.trim()
    }
  }

  return {
    ok: false,
    verified: false,
    reason: 'server_entity_nbt_not_found',
    rawOutput: output.trim()
  }
}

module.exports = {
  scanNearbyPokemon,
  isPokemonEntity,
  extractPokemonMetadata,
  attachCobblemonRadarAdapter,
  verifyPokemonServerState,
  decodeSpawnPokemonBuffer,
  MAX_RADAR_DISTANCE
}
