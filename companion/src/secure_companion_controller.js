'use strict'

// Secure Companion Controller (GuiaIA FASE 3)
// Governs all companion behaviors under cryptographic authority:
// 1. Follow authorized player with live presence and witness checks
// 2. Emergency stop with absolute priority
// 3. Bounded gathering of allowlisted resources with verified inventory drop
// 4. Bounded deposit into authorized containers with two-sided receipts and nonce barriers
// 5. Inventory capacity guard and unauthorized item rejection
// 6. Natural language instruction parser translating requests into typed contracts

const { Vec3 } = require('vec3')
const { createController, OWNER_MAX_DISTANCE, finiteDistance } = require('./controller')
const { createQaAuthorizedFollow } = require('./qa_authorized_follow')
const { createQaGather, RESOURCE_ITEMS, inventoryCount } = require('./gather')
const { createQaBoundedNavigation } = require('./qa_bounded_navigation')
const { verifySessionBundle, verifySessionFollowGrant, verifySessionDepositGrant, verifySessionGatherGrant,
  verifySessionCraftGrant, verifySessionBuildGrant, verifySessionPokemonGrant,
  createSessionAuthorizedQaDeposit } = require('./session_identity')
const { reserveGrantOnce } = require('./operator_authorization')
const { createCraftingPlanner } = require('./crafting_planner')
const { createBlueprintBuilder } = require('./blueprint_builder')
const { createCobblemonAdapter } = require('./cobblemon_adapter')
const {
  RemoteWitnessUnavailableError,
  RemoteWitnessRollbackError,
  RemoteWitnessDivergenceError
} = require('./remote_witness_client')

const ALLOWED_RESOURCES = Object.freeze({
  oak_log: 'oak_log',
  birch_log: 'birch_log',
  cobblestone: 'cobblestone',
  stone: 'cobblestone',
  coal: 'coal'
})

const MAX_INVENTORY_SLOTS = 36
const MAX_ITEM_COUNT_PER_STACK = 64

/**
 * Parses natural language or structured instruction into a typed command contract.
 * Rejects arbitrary strings, prompt injections, and unsupported commands.
 */
function parseNaturalInstruction(input, options = {}) {
  const isV1Batch = options.v1Batch === true
  if (typeof input !== 'string' || input.length < 1 || input.length > 200) {
    throw new Error('Instruction must be a non-empty string under 200 characters')
  }
  const clean = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¡¿]/g, '')
    .trim()
    .replace(/^guia\s*ia[,:\s]*/i, '')
    .trim()

  // 1. Emergency Stop / Halt
  if (/^(?:para(?:r)?|alto|detente|stop|quieto|espera)[\s!.,]*$/i.test(clean)) {
    return Object.freeze({ kind: 'stop', raw: input })
  }

  // 2. Follow
  if (/^(?:sigue(?:me)?|ven(?:\s+conmigo)?|acompaname|follow)[\s!.,]*$/i.test(clean)) {
    return Object.freeze({ kind: 'follow', raw: input })
  }

  // 3. Inventory / Status
  if (/^(?:inventario|estado|status|inventory)[\s!.,]*$/i.test(clean)) {
    return Object.freeze({ kind: 'inventory', raw: input })
  }

  // 4. Gather
  const gatherMatch = clean.match(
    /^(?:recoge|consigue|recolecta|mina|trae)(?:\s+(\d{1,2}))?\s+(madera|troncos?\s+de\s+roble|troncos?\s+de\s+abedul|roble|abedul|oak_log|birch_log|piedra|adoquin|cobblestone|carbon|coal)(?:\s+(?:(?:en\s+la\s+posicion|en)\s+)?(-?\d+)\s+(-?\d+)\s+(-?\d+))?\s*$/i
  )
  if (gatherMatch) {
    const count = gatherMatch[1] !== undefined ? parseInt(gatherMatch[1], 10) : 1
    if (!isV1Batch && count !== 1) throw new Error('Only single-item bounded gathering authorized')
    if (isV1Batch && (count < 1 || count > 16)) throw new Error('Only bounded gathering (1-16) authorized')
    let rawResource = gatherMatch[2].replace(/\s+/g, '_')
    let resource = null
    if (/madera|roble|oak/.test(rawResource)) resource = 'oak_log'
    else if (/abedul|birch/.test(rawResource)) resource = 'birch_log'
    else if (/adoquin|cobble/.test(rawResource)) resource = 'cobblestone'
    else if (/piedra|stone/.test(rawResource)) resource = 'stone'
    else if (/carbon|coal/.test(rawResource)) resource = 'coal'
    if (!resource || !Object.hasOwn(ALLOWED_RESOURCES, resource)) {
      throw new Error('Unauthorized or unknown gathering resource')
    }
    const target = gatherMatch[3] !== undefined ? {
      x: parseInt(gatherMatch[3], 10),
      y: parseInt(gatherMatch[4], 10),
      z: parseInt(gatherMatch[5], 10)
    } : null
    return Object.freeze({ kind: 'gather', count, resource, target, raw: input })
  }

  // 5. Deposit
  const depositMatch = clean.match(
    /^(?:deposita|guarda|pon)(?:\s+(\d{1,2}))?\s+(madera|troncos?\s+de\s+roble|troncos?\s+de\s+abedul|roble|abedul|oak_log|birch_log|piedra|adoquin|cobblestone|carbon|coal)(?:\s+en\s+(?:el\s+)?cofre)?(?:\s+(?:(?:en\s+la\s+posicion|en)\s+)?(-?\d+)\s+(-?\d+)\s+(-?\d+))?\s*$/i
  )
  if (depositMatch) {
    const count = depositMatch[1] !== undefined ? parseInt(depositMatch[1], 10) : 1
    if (!isV1Batch && count !== 1) throw new Error('Only single-item bounded deposit authorized')
    if (isV1Batch && (count < 1 || count > 16)) throw new Error('Only bounded deposit (1-16) authorized')
    let rawResource = depositMatch[2].replace(/\s+/g, '_')
    let resource = null
    if (/madera|roble|oak/.test(rawResource)) resource = 'oak_log'
    else if (/abedul|birch/.test(rawResource)) resource = 'birch_log'
    else if (/piedra|adoquin|cobble/.test(rawResource)) resource = 'cobblestone'
    else if (/carbon|coal/.test(rawResource)) resource = 'coal'
    if (!resource || !Object.hasOwn(ALLOWED_RESOURCES, resource)) {
      throw new Error('Unauthorized or unknown deposit resource')
    }
    const chest = depositMatch[3] !== undefined ? {
      x: parseInt(depositMatch[3], 10),
      y: parseInt(depositMatch[4], 10),
      z: parseInt(depositMatch[5], 10)
    } : null
    return Object.freeze({ kind: 'deposit', count, resource, chest, raw: input })
  }

  // 6. Craft
  const craftMatch = clean.match(
    /^(?:fabrica|craftea|elabora|craft)(?:\s+(\d{1,2}))?\s+([a-z0-9_:-]+)\s*$/i
  )
  if (craftMatch) {
    const count = craftMatch[1] !== undefined ? parseInt(craftMatch[1], 10) : 1
    const maxCount = isV1Batch ? 64 : 16
    if (count < 1 || count > maxCount) {
      throw new Error(`Only bounded crafting (1-${maxCount}) authorized`)
    }
    const item = craftMatch[2]
    return Object.freeze({ kind: 'craft', count, item, recipe: item, raw: input })
  }

  // 7. Build
  const buildMatch = clean.match(
    /^(?:construye|edifica|build)\s+([a-z0-9_.-]+)(?:\s+(?:(?:en\s+la\s+posicion|en)\s+)?(-?\d+)\s+(-?\d+)\s+(-?\d+))?\s*$/i
  )
  if (buildMatch) {
    const blueprintId = buildMatch[1]
    const origin = buildMatch[2] !== undefined ? {
      x: parseInt(buildMatch[2], 10),
      y: parseInt(buildMatch[3], 10),
      z: parseInt(buildMatch[4], 10)
    } : null
    return Object.freeze({ kind: 'build', blueprintId, origin, raw: input })
  }

  // 8. Pokemon / Cobblemon
  const pokemonMatch = clean.match(
    /^pokemon(?:\s+(radar|buscar|scan|inspecciona|inspect|captura(?:r)?|capture|combate(?:r)?|batalla|battle_wild|pc|pc_deposit|pc_withdraw))?(?:\s+(.+))?\s*$/i
  )
  if (pokemonMatch) {
    const sub = pokemonMatch[1] || 'inspect'
    const rawTarget = pokemonMatch[2]?.trim()
    let action = 'inspect'
    if (/^(?:radar|buscar|scan|inspecciona|inspect)$/.test(sub)) {
      action = 'inspect'
    } else if (/^(?:captura(?:r)?|capture)$/.test(sub)) {
      action = 'capture'
    } else if (/^(?:combate(?:r)?|batalla|battle_wild)$/.test(sub)) {
      action = 'battle_wild'
    } else if (/^(?:pc|pc_deposit)$/.test(sub)) {
      action = 'pc_deposit'
    } else if (/^pc_withdraw$/.test(sub)) {
      action = 'pc_withdraw'
    }
    let target = rawTarget || 'nearby'
    if (/^\d+$/.test(target)) target = parseInt(target, 10)
    return Object.freeze({ kind: 'pokemon', action, target, raw: input })
  }

  throw new Error('unsupported_or_unsafe_instruction: ' + input.slice(0, 64))
}

function createSecureCompanionController({ bot, authority, classes, engines = {} }) {
  const isFabricLab = authority?.identityMode === 'trusted_server_bridge_lab'
  const isVanillaPaired = authority?.identityMode === 'vanilla_paired_operator'
  if (authority?.sandboxOnly !== true ||
      (!isFabricLab && !isVanillaPaired) ||
      !authority?.worldId || !authority?.botName ||
      bot?.username !== authority.botName) {
    throw new Error('Secure companion requires valid sandbox authority matching bot username')
  }

  let activeFollow = null
  let activeOperation = null
  let mode = 'idle'
  let lastReason = 'initialized'
  let generation = 0

  function emergencyStop(reason = 'operator_stop') {
    generation += 1
    // 1. Cancel active follow lease if any
    if (activeFollow) {
      try { activeFollow.stop(reason) } catch {}
      activeFollow = null
    }
    // 2. Cancel in-flight gather or deposit
    if (activeOperation?.cancel) {
      try { activeOperation.cancel() } catch {}
      activeOperation = null
    }
    // 3. Clear pathfinder goals and control states immediately
    if (typeof bot?.pathfinder?.setGoal === 'function') {
      try { bot.pathfinder.setGoal(null) } catch {}
    }
    if (typeof bot?.clearControlStates === 'function') {
      try { bot.clearControlStates() } catch {}
    }
    if (typeof bot?.stopDigging === 'function') {
      try { bot.stopDigging() } catch {}
    }
    mode = 'idle'
    lastReason = reason
    return Object.freeze({ ok: true, mode: 'idle', reason })
  }

  // Automatic stops on connection loss or bot death
  for (const event of ['end', 'kicked', 'death']) {
    bot.on?.(event, () => emergencyStop('connection_or_life_cycle_end'))
  }

  function checkInventory() {
    if (!bot?.inventory || typeof bot.inventory.items !== 'function') {
      return Object.freeze({ ok: false, reason: 'inventory_unavailable' })
    }
    const items = bot.inventory.items()
    if (!Array.isArray(items)) {
      return Object.freeze({ ok: false, reason: 'invalid_inventory_items' })
    }
    const totalSlots = items.length
    if (totalSlots > MAX_INVENTORY_SLOTS) {
      return Object.freeze({ ok: false, reason: 'inventory_capacity_exceeded', totalSlots })
    }
    const counts = {}
    const unauthorized = []
    for (const item of items) {
      if (!item || typeof item.name !== 'string' || !Number.isInteger(item.count) || item.count <= 0) {
        continue
      }
      if (!Object.hasOwn(ALLOWED_RESOURCES, item.name)) {
        unauthorized.push({ name: item.name, count: item.count })
      }
      counts[item.name] = (counts[item.name] || 0) + item.count
    }
    return Object.freeze({
      ok: true,
      items: counts,
      totalSlots,
      freeSlots: Math.max(0, MAX_INVENTORY_SLOTS - totalSlots),
      unauthorizedItems: unauthorized,
      hasUnauthorizedItems: unauthorized.length > 0
    })
  }

  async function follow(session, grant) {
    emergencyStop('switch_to_follow')
    const verifiedSession = verifySessionBundle(session, authority)
    const verifiedGrant = verifySessionFollowGrant(grant, verifiedSession, authority)

    if (authority.identityMode === 'vanilla_paired_operator') {
      const vanillaCtrl = createController(bot, classes, { ownerName: verifiedSession.username })
      const res = vanillaCtrl.follow()
      if (res.ok) {
        mode = 'following'
        lastReason = res.reason
        activeFollow = vanillaCtrl
      } else {
        emergencyStop(res.reason || 'follow_failed')
      }
      return res
    }

    activeFollow = createQaAuthorizedFollow(bot, classes, session, grant, authority)
    const result = await activeFollow.start()
    if (result.ok) {
      mode = 'following'
      lastReason = result.reason
    } else {
      emergencyStop(result.reason || 'follow_failed')
    }
    return result
  }

  function samePosition(a, b) {
    return a && b && ['x', 'y', 'z'].every(k =>
      Number.isInteger(a[k]) && a[k] === b[k])
  }

  // In Fabric lab mode, both live server presence and independent checkpoint are mandatory.
  // In Vanilla paired mode, session bundle and local grant validation govern the action authority.
  // In Multi-Host mode, remote witness consistency check is mandatory and strictly fail-closed.
  async function freshActionAuthority(session, grant, verifyGrant) {
    if (authority.multiHostEnabled === true) {
      if (!authority.remoteWitnessClient || typeof authority.remoteWitnessClient.verifyConsistency !== 'function') {
        throw new RemoteWitnessUnavailableError('Remote witness client required when multiHostEnabled is true')
      }
      const localCheckpoint = typeof authority.currentRegistryCheckpoint === 'function'
        ? authority.currentRegistryCheckpoint()
        : { sequence: authority.sequence || 0, registrySha256: authority.registrySha256 || '0'.repeat(64) }
      await authority.remoteWitnessClient.verifyConsistency(localCheckpoint)
    }

    if (authority.identityMode === 'trusted_server_bridge_lab') {
      if (authority.requireLivePresence !== true ||
          authority.requireRemoteCheckpoint !== true ||
          typeof authority.livePresence !== 'function' ||
          typeof authority.remoteCheckpointMatch !== 'function' ||
          typeof authority.currentRegistryCheckpoint !== 'function') {
        throw Error('Independent live authority required before world modification')
      }
      const initial = verifySessionBundle(session, authority)
      verifyGrant(grant, initial, authority)
      const live = await authority.livePresence(initial.connectionId)
      const now = Date.now()
      if (!live || live.connected !== true || live.worldId !== initial.worldId ||
          live.connectionId !== initial.connectionId ||
          !Number.isSafeInteger(live.issuedAt) ||
          live.issuedAt > now + 1000 || now - live.issuedAt > 1500) {
        throw Error('Fresh signed Fabric presence unavailable')
      }
      if (await authority.remoteCheckpointMatch(authority.currentRegistryCheckpoint()) !== true) {
        throw Error('Independent authority checkpoint unavailable')
      }
      const current = verifySessionBundle(session, authority)
      verifyGrant(grant, current, authority)
      return current
    } else if (authority.identityMode === 'vanilla_paired_operator') {
      const current = verifySessionBundle(session, authority)
      verifyGrant(grant, current, authority)
      return current
    }
    throw Error('Unsupported identity mode for action authority')
  }

  async function gather(session, grant, target, resource = 'oak_log', pickupTimeoutMs = 12000) {
    const verifiedSession = verifySessionBundle(session, authority)
    const verifiedGrant = verifySessionGatherGrant(grant, verifiedSession, authority)
    const approvedTarget = Object.freeze({ ...verifiedGrant.target })
    if (!Object.hasOwn(ALLOWED_RESOURCES, resource) ||
        !samePosition(target, approvedTarget) ||
        resource !== verifiedGrant.item) {
      throw Error('Gather target or resource does not match signed permit')
    }
    if (typeof authority.ledgerDirectory !== 'string') {
      throw Error('Durable one-time action ledger required')
    }
    emergencyStop('switch_to_gather')
    const ticket = generation
    await freshActionAuthority(session, grant, verifySessionGatherGrant)
    if (generation !== ticket) return { ok: false, reason: 'cancelled', dig_attempted: false }

    const inv = checkInventory()
    if (!inv.ok || inv.freeSlots <= 0 || inv.hasUnauthorizedItems) {
      return Object.freeze({ ok: false, reason: 'unsafe_inventory' })
    }
    // A lost result or process crash cannot authorize a second dig.
    reserveGrantOnce(authority.ledgerDirectory, verifiedGrant.nonce)

    const point = new Vec3(approvedTarget.x, approvedTarget.y, approvedTarget.z)
    const nav = (classes?.GoalNear && classes?.Movements) ? createQaBoundedNavigation({
      bot,
      GoalNear: classes.GoalNear,
      Movements: classes.Movements,
      ownerName: verifiedSession.username,
      sandboxOnly: true
    }) : null
    const operation = createQaGather(bot, {
      sandboxOnly: true,
      ownerName: verifiedSession.username,
      target: point,
      resource,
      pickupTimeoutMs,
      authorizeBeforeDig: async () => {
        if (generation !== ticket) return false
        await freshActionAuthority(session, grant, verifySessionGatherGrant)
        return generation === ticket
      },
      ...(nav ? {
        preDigApproach: pt => nav.approach(pt, { desiredDistance: 3.2 }),
        pickupApproach: pt => nav.approach(pt, { desiredDistance: 0 })
      } : {})
    })

    activeOperation = operation
    try {
      return await operation.gatherOne()
    } finally {
      if (activeOperation === operation) activeOperation = null
    }
  }

  async function deposit(session, grant, chestTarget) {
    const verifiedSession = verifySessionBundle(session, authority)
    const verifiedGrant = verifySessionDepositGrant(grant, verifiedSession, authority)
    const chestCoord = Object.freeze({ ...verifiedGrant.chest })
    if (chestTarget && !samePosition(chestTarget, chestCoord)) {
      throw Error('Chest coordinates do not match signed deposit permit')
    }
    emergencyStop('switch_to_deposit')
    const ticket = generation
    await freshActionAuthority(session, grant, verifySessionDepositGrant)
    if (generation !== ticket) return { ok: false, reason: 'cancelled', transferAttempted: false }

    // Reuse the already hardened adapter: real player/chest slots, bounds,
    // two-sided inventory deltas and atomic one-use nonce consumption.
    const operation = createSessionAuthorizedQaDeposit(bot, session, grant, authority)
    activeOperation = operation
    try {
      if (classes?.GoalNear && classes?.Movements) {
        const nav = createQaBoundedNavigation({
          bot,
          GoalNear: classes.GoalNear,
          Movements: classes.Movements,
          ownerName: verifiedSession.username,
          sandboxOnly: true
        })
        await nav.approach(chestCoord, { desiredDistance: 3.2 })
      }
      if (generation !== ticket) {
        return { ok: false, reason: 'cancelled', transferAttempted: false }
      }
      return await operation.depositOne()
    } finally {
      if (activeOperation === operation) activeOperation = null
    }
  }

  async function craft(session, grant, options = {}) {
    const verifiedSession = verifySessionBundle(session, authority)
    const verifiedGrant = verifySessionCraftGrant(grant, verifiedSession, authority)
    if (typeof authority.ledgerDirectory !== 'string') {
      throw Error('Durable one-time action ledger required')
    }
    emergencyStop('switch_to_craft')
    const ticket = generation
    await freshActionAuthority(session, grant, verifySessionCraftGrant)
    if (generation !== ticket) return { ok: false, reason: 'cancelled' }

    reserveGrantOnce(authority.ledgerDirectory, verifiedGrant.nonce)

    const planner = engines?.craftPlanner !== undefined ? engines.craftPlanner : createCraftingPlanner({ version: '1.21.1' })
    if (planner && typeof planner.execute === 'function') {
      return await planner.execute(verifiedGrant, { bot, inventory: bot?.inventory, ...options })
    }
    return Object.freeze({
      ok: true,
      action: 'craft',
      item: verifiedGrant.item,
      recipe: verifiedGrant.recipe,
      count: verifiedGrant.count,
      nonce: verifiedGrant.nonce
    })
  }

  async function build(session, grant, blueprint = null) {
    const verifiedSession = verifySessionBundle(session, authority)
    const verifiedGrant = verifySessionBuildGrant(grant, verifiedSession, authority)
    if (typeof authority.ledgerDirectory !== 'string') {
      throw Error('Durable one-time action ledger required')
    }
    emergencyStop('switch_to_build')
    const ticket = generation
    await freshActionAuthority(session, grant, verifySessionBuildGrant)
    if (generation !== ticket) return { ok: false, reason: 'cancelled' }

    reserveGrantOnce(authority.ledgerDirectory, verifiedGrant.nonce)

    const builder = engines?.blueprintBuilder !== undefined ? engines.blueprintBuilder : createBlueprintBuilder()
    if (builder && typeof builder.execute === 'function') {
      return await builder.execute(verifiedGrant, blueprint, { bot, inventory: bot?.inventory, previewAuthorized: true })
    }
    return Object.freeze({
      ok: true,
      action: 'build',
      blueprintId: verifiedGrant.blueprintId,
      origin: Object.freeze({ ...verifiedGrant.origin }),
      nonce: verifiedGrant.nonce
    })
  }

  async function pokemonAction(session, grant, options = {}) {
    const verifiedSession = verifySessionBundle(session, authority)
    const verifiedGrant = verifySessionPokemonGrant(grant, verifiedSession, authority)
    if (typeof authority.ledgerDirectory !== 'string') {
      throw Error('Durable one-time action ledger required')
    }
    emergencyStop('switch_to_pokemon')
    const ticket = generation
    await freshActionAuthority(session, grant, verifySessionPokemonGrant)
    if (generation !== ticket) return { ok: false, reason: 'cancelled' }

    reserveGrantOnce(authority.ledgerDirectory, verifiedGrant.nonce)

    const adapter = engines?.cobblemonAdapter !== undefined ? engines.cobblemonAdapter : createCobblemonAdapter({ bot })
    if (adapter && typeof adapter.execute === 'function') {
      return await adapter.execute(verifiedGrant, { bot, ...options })
    }
    return Object.freeze({
      ok: true,
      action: 'pokemon',
      subAction: verifiedGrant.action,
      target: verifiedGrant.target,
      nonce: verifiedGrant.nonce
    })
  }

  async function dispatchInstruction(input, context = {}) {
    const allowBatch = Boolean(context.v1Batch || authority?.v1Batch)
    const parsed = typeof input === 'string' ? parseNaturalInstruction(input, { v1Batch: allowBatch }) : input
    if (!parsed || typeof parsed.kind !== 'string') {
      throw new Error('Invalid instruction contract')
    }

    // Emergency stop has absolute priority and requires no session / grant
    if (parsed.kind === 'stop') {
      return emergencyStop('operator_stop')
    }

    if (parsed.kind === 'inventory') {
      return checkInventory()
    }

    if (parsed.kind === 'follow') {
      if (!context.session || !context.grant) {
        return Object.freeze({ ok: false, reason: 'signed_session_and_grant_required' })
      }
      return follow(context.session, context.grant)
    }

    if (parsed.kind === 'gather') {
      if (!context.session || !context.grant) {
        return Object.freeze({ ok: false, reason: 'signed_session_and_grant_required' })
      }
      const maxCount = allowBatch ? 16 : 1
      if (!Number.isInteger(parsed.count) || parsed.count < 1 || parsed.count > maxCount) {
        return { ok: false, reason: 'invalid_gather_count' }
      }
      const target = parsed.target || context.target
      return gather(context.session, context.grant, target, parsed.resource, context.pickupTimeoutMs)
    }

    if (parsed.kind === 'deposit') {
      if (!context.session || !context.grant) {
        return Object.freeze({ ok: false, reason: 'signed_session_and_grant_required' })
      }
      const maxCount = allowBatch ? 16 : 1
      if (!Number.isInteger(parsed.count) || parsed.count < 1 || parsed.count > maxCount) {
        return { ok: false, reason: 'invalid_deposit_count' }
      }
      if (parsed.count !== context.grant.payload?.count ||
          parsed.resource !== context.grant.payload?.item) {
        return { ok: false, reason: 'deposit_instruction_scope_mismatch' }
      }
      return deposit(context.session, context.grant, parsed.chest || context.chest)
    }

    if (parsed.kind === 'craft') {
      if (!context.session || !context.grant) {
        return Object.freeze({ ok: false, reason: 'signed_session_and_grant_required' })
      }
      if (parsed.item !== context.grant.payload?.item || parsed.count !== context.grant.payload?.count) {
        return Object.freeze({ ok: false, reason: 'craft_instruction_scope_mismatch' })
      }
      return craft(context.session, context.grant, context.options)
    }

    if (parsed.kind === 'build') {
      if (!context.session || !context.grant) {
        return Object.freeze({ ok: false, reason: 'signed_session_and_grant_required' })
      }
      if (parsed.blueprintId !== context.grant.payload?.blueprintId) {
        return Object.freeze({ ok: false, reason: 'build_instruction_scope_mismatch' })
      }
      return build(context.session, context.grant, context.blueprint)
    }

    if (parsed.kind === 'pokemon') {
      if (!context.session || !context.grant) {
        return Object.freeze({ ok: false, reason: 'signed_session_and_grant_required' })
      }
      if (parsed.action !== context.grant.payload?.action) {
        return Object.freeze({ ok: false, reason: 'pokemon_instruction_scope_mismatch' })
      }
      return pokemonAction(context.session, context.grant, context.options)
    }

    throw new Error('unsupported_action: ' + parsed.kind)
  }

  function status() {
    // A follow lease can expire on its own timer. Reflect actual movement,
    // never a stale cached 'following' flag in the operator UI.
    if (mode === 'following' && activeFollow &&
        activeFollow.status().mode !== 'following') {
      lastReason = activeFollow.status().reason
      activeFollow = null
      mode = 'idle'
    }
    return Object.freeze({
      mode,
      lastReason,
      activeFollow: Boolean(activeFollow),
      activeOperation: Boolean(activeOperation)
    })
  }

  return Object.freeze({
    dispatchInstruction,
    authorizeAction: (session, grant, kind) => {
      if (kind === 'gather') return freshActionAuthority(session, grant, verifySessionGatherGrant)
      if (kind === 'deposit') return freshActionAuthority(session, grant, verifySessionDepositGrant)
      if (kind === 'craft') return freshActionAuthority(session, grant, verifySessionCraftGrant)
      if (kind === 'build') return freshActionAuthority(session, grant, verifySessionBuildGrant)
      if (kind === 'pokemon') return freshActionAuthority(session, grant, verifySessionPokemonGrant)
      throw Error('Only exact signed world actions may be authorized')
    },
    emergencyStop,
    checkInventory,
    follow,
    gather,
    deposit,
    craft,
    build,
    pokemonAction,
    status,
    parseNaturalInstruction
  })
}

module.exports = {
  createSecureCompanionController,
  parseNaturalInstruction,
  ALLOWED_RESOURCES,
  MAX_INVENTORY_SLOTS
}
