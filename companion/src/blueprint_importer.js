'use strict'

const fs = require('node:fs')
const path = require('node:path')
const nbt = require('prismarine-nbt')

const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2 MB
const MAX_DECOMPRESSED_BYTES = 16 * 1024 * 1024 // 16 MB
const MAX_DIMENSION = 16
const MAX_BLOCKS = 4096

const FORBIDDEN_BLOCKS = Object.freeze(new Set([
  'tnt', 'lava', 'flowing_lava', 'fire', 'soul_fire',
  'bedrock', 'end_portal', 'nether_portal', 'end_portal_frame',
  'spawner', 'command_block', 'chain_command_block', 'repeating_command_block',
  'barrier', 'structure_block', 'structure_void',
  'piston', 'sticky_piston'
]))

function normalizeBlockName(name) {
  if (typeof name !== 'string') return 'air'
  let clean = name.trim().toLowerCase()
  if (clean.startsWith('minecraft:')) {
    clean = clean.slice(10)
  }
  // Strip block states like [facing=north,half=bottom]
  const bracketIdx = clean.indexOf('[')
  if (bracketIdx !== -1) {
    clean = clean.slice(0, bracketIdx)
  }
  return clean
}

function validateDimensions(w, h, l) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || !Number.isInteger(l) ||
      w < 1 || h < 1 || l < 1) {
    throw new Error(`Invalid blueprint dimensions: ${w}x${h}x${l}`)
  }
  if (w > MAX_DIMENSION || h > MAX_DIMENSION || l > MAX_DIMENSION) {
    throw new Error(`Blueprint dimensions exceed maximum of ${MAX_DIMENSION}x${MAX_DIMENSION}x${MAX_DIMENSION}: ${w}x${h}x${l}`)
  }
  const total = w * h * l
  if (total > MAX_BLOCKS) {
    throw new Error(`Blueprint volume exceeds maximum of ${MAX_BLOCKS} blocks: ${total}`)
  }
}

/**
 * Parses Sponge .schem format
 */
function parseSpongeSchem(simplified, blueprintId) {
  const w = simplified.Width || simplified.width
  const h = simplified.Height || simplified.height
  const l = simplified.Length || simplified.length

  validateDimensions(w, h, l)

  const paletteMap = simplified.Palette || simplified.palette || {}
  const blockData = simplified.BlockData || simplified.blockData || []

  // Invert palette: index -> blockName
  const indexToName = new Map()
  for (const [blockState, index] of Object.entries(paletteMap)) {
    const norm = normalizeBlockName(blockState)
    indexToName.set(Number(index), norm)
  }

  const blocks = []
  const materials = {}

  let idx = 0
  // Sponge format index formula: (y * length + z) * width + x
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < l; z++) {
      for (let x = 0; x < w; x++) {
        const blockId = blockData[idx++] || 0
        const blockName = indexToName.get(blockId) || 'air'
        if (blockName !== 'air') {
          if (FORBIDDEN_BLOCKS.has(blockName)) {
            throw new Error(`Forbidden hazardous block in blueprint: ${blockName}`)
          }
          blocks.push({ x, y, z, block: blockName })
          materials[blockName] = (materials[blockName] || 0) + 1
        }
      }
    }
  }

  return {
    blueprint_id: blueprintId || 'sponge_blueprint',
    format: 'schem',
    dimensions: { width: w, height: h, length: l },
    total_blocks: blocks.length,
    palette: Object.keys(materials),
    materials_needed: materials,
    blocks
  }
}

/**
 * Parses MCEdit legacy .schematic format
 */
function parseMCEditSchematic(simplified, blueprintId) {
  const w = simplified.Width || simplified.width
  const h = simplified.Height || simplified.height
  const l = simplified.Length || simplified.length

  validateDimensions(w, h, l)

  const rawBlocks = simplified.Blocks || simplified.blocks || []
  const blocks = []
  const materials = {}

  // MCEdit index formula: (y * length + z) * width + x
  let idx = 0
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < l; z++) {
      for (let x = 0; x < w; x++) {
        const blockId = rawBlocks[idx++] || 0
        if (blockId !== 0) {
          // Map legacy block IDs if needed, default to cobblestone/oak_planks for basic legacy IDs
          let blockName = 'cobblestone'
          if (blockId === 1) blockName = 'stone'
          else if (blockId === 4) blockName = 'cobblestone'
          else if (blockId === 5) blockName = 'oak_planks'
          else if (blockId === 17) blockName = 'oak_log'
          else if (blockId === 46) blockName = 'tnt'

          if (FORBIDDEN_BLOCKS.has(blockName)) {
            throw new Error(`Forbidden hazardous block in blueprint: ${blockName}`)
          }

          blocks.push({ x, y, z, block: blockName })
          materials[blockName] = (materials[blockName] || 0) + 1
        }
      }
    }
  }

  return {
    blueprint_id: blueprintId || 'mcedit_blueprint',
    format: 'schematic',
    dimensions: { width: w, height: h, length: l },
    total_blocks: blocks.length,
    palette: Object.keys(materials),
    materials_needed: materials,
    blocks
  }
}

/**
 * Parses native JSON structure format
 */
function parseJsonStructure(data, blueprintId = null, options = {}) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid JSON blueprint structure')
  }

  const dims = data.dimensions || {}
  validateDimensions(dims.width, dims.height, dims.length)

  if (!Array.isArray(data.blocks)) {
    throw new Error('Blueprint blocks must be an array')
  }

  const blocks = []
  const materials = {}

  for (const b of data.blocks) {
    if (!b || !Number.isInteger(b.x) || !Number.isInteger(b.y) || !Number.isInteger(b.z) ||
        b.x < 0 || b.x >= dims.width ||
        b.y < 0 || b.y >= dims.height ||
        b.z < 0 || b.z >= dims.length) {
      throw new Error(`Block coordinates out of bounds: ${JSON.stringify(b)}`)
    }
    const blockName = normalizeBlockName(b.block)
    if (blockName !== 'air') {
      if (FORBIDDEN_BLOCKS.has(blockName)) {
        throw new Error(`Forbidden hazardous block in blueprint: ${blockName}`)
      }
      blocks.push({ x: b.x, y: b.y, z: b.z, block: blockName })
      materials[blockName] = (materials[blockName] || 0) + 1
    }
  }

  return {
    blueprint_id: options.blueprintId || blueprintId || data.blueprint_id || 'json_blueprint',
    format: 'json_structure',
    dimensions: { width: dims.width, height: dims.height, length: dims.length },
    total_blocks: blocks.length,
    palette: Object.keys(materials),
    materials_needed: materials,
    blocks
  }
}

/**
 * Main parser entrypoint.
 * Automatically detects whether input is a file path, buffer or JSON object.
 */
async function parseBlueprint(input, options = {}) {
  let buffer
  let blueprintId = options.blueprintId || input?.blueprint_id || 'blueprint'

  if (typeof input === 'string') {
    // If input is a file path
    if (fs.existsSync(input)) {
      const stats = fs.statSync(input)
      if (stats.size > MAX_FILE_BYTES) {
        throw new Error(`Blueprint file exceeds maximum quota of 2 MB: ${stats.size} bytes`)
      }
      buffer = fs.readFileSync(input)
      blueprintId = path.basename(input, path.extname(input))
    } else {
      // Try parsing as JSON string
      try {
        const json = JSON.parse(input)
        return parseJsonStructure(json, blueprintId)
      } catch {
        throw new Error(`Blueprint file not found or invalid JSON string: ${input}`)
      }
    }
  } else if (Buffer.isBuffer(input)) {
    if (input.length > MAX_FILE_BYTES) {
      throw new Error(`Blueprint buffer exceeds maximum quota of 2 MB: ${input.length} bytes`)
    }
    buffer = input
  } else if (typeof input === 'object' && input !== null) {
    return parseJsonStructure(input, blueprintId)
  } else {
    throw new Error('Unsupported blueprint input type')
  }

  // Parse NBT
  let nbtResult
  try {
    nbtResult = await nbt.parse(buffer)
  } catch (err) {
    // If NBT parse fails, try JSON
    try {
      const text = buffer.toString('utf8')
      const json = JSON.parse(text)
      return parseJsonStructure(json, blueprintId)
    } catch {
      throw new Error(`Failed to parse blueprint NBT or JSON: ${err.message}`)
    }
  }

  const simplified = nbt.simplify(nbtResult.parsed)

  // Detect Sponge vs MCEdit
  if (simplified.Palette !== undefined || simplified.palette !== undefined) {
    return parseSpongeSchem(simplified, blueprintId)
  }
  if (simplified.Blocks !== undefined || simplified.blocks !== undefined) {
    return parseMCEditSchematic(simplified, blueprintId)
  }

  // Nested root wrapper check (e.g. { Schematic: { ... } })
  for (const val of Object.values(simplified)) {
    if (val && typeof val === 'object') {
      if (val.Palette !== undefined || val.palette !== undefined) {
        return parseSpongeSchem(val, blueprintId)
      }
      if (val.Blocks !== undefined || val.blocks !== undefined) {
        return parseMCEditSchematic(val, blueprintId)
      }
    }
  }

  throw new Error('Unrecognized schematic NBT schema (missing Palette or Blocks)')
}

module.exports = {
  parseBlueprint,
  parseJsonStructure,
  parseSpongeSchem,
  parseMCEditSchematic,
  normalizeBlockName,
  validateDimensions,
  MAX_FILE_BYTES,
  MAX_DECOMPRESSED_BYTES,
  MAX_DIMENSION,
  MAX_BLOCKS,
  FORBIDDEN_BLOCKS
}
