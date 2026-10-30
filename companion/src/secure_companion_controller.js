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
const { verifySessionBundle, verifySessionFollowGrant, verifySessionDepositGrant } = require('./session_identity')
const { reserveGrantOnce } = require('./operator_authorization')
const { chestCount } = require('./deposit')

const ALLOWED_RESOURCES = Object.freeze({
  oak_log: 'oak_log',
  birch_log: 'birch_log'
})

const MAX_INVENTORY_SLOTS = 36
const MAX_ITEM_COUNT_PER_STACK = 64

/**
 * Parses natural language or structured instruction into a typed command contract.
 * Rejects arbitrary strings, prompt injections, and unsupported commands.
 */
function parseNaturalInstruction(input) {
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
  if (/^(?:para|alto|detente|stop|quieto|espera)(?:[\s!.,]|$)/i.test(clean)) {
    return Object.freeze({ kind: 'stop', raw: input })
  }

  // 2. Follow
  if (/^(?:sigueme|ven(?:\s+conmigo)?|acompaname|follow)(?:[\s!.,]|$)/i.test(clean)) {
    return Object.freeze({ kind: 'follow', raw: input })
  }

  // 3. Inventory / Status
  if (/^(?:inventario|estado|status|inventory)(?:[\s!.,]|$)/i.test(clean)) {
    return Object.freeze({ kind: 'inventory', raw: input })
  }

  // 4. Gather
  const gatherMatch = clean.match(
    /^(?:recoge|consigue|recolecta|mina|trae)\s+(\d{1,2})\s+(troncos?\s+de\s+roble|troncos?\s+de\s+abedul|roble|abedul|oak_log|birch_log)(?:\s+(?:en|en\s+la\s+posicion)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+))?/i
  )
  if (gatherMatch) {
    const count = parseInt(gatherMatch[1], 10)
    if (count !== 1) throw new Error('Only single-item bounded gathering authorized')
    let rawResource = gatherMatch[2].replace(/\s+/g, '_')
    let resource = null
    if (/roble|oak/.test(rawResource)) resource = 'oak_log'
    else if (/abedul|birch/.test(rawResource)) resource = 'birch_log'
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
    /^(?:deposita|guarda|pon)\s+(\d{1,2})\s+(troncos?\s+de\s+roble|troncos?\s+de\s+abedul|roble|abedul|oak_log|birch_log)(?:\s+en\s+(?:el\s+)?cofre)?(?:\s+(?:en|en\s+la\s+posicion)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+))?/i
  )
  if (depositMatch) {
    const count = parseInt(depositMatch[1], 10)
    if (count !== 1) throw new Error('Only single-item bounded deposit authorized')
    let rawResource = depositMatch[2].replace(/\s+/g, '_')
    let resource = null
    if (/roble|oak/.test(rawResource)) resource = 'oak_log'
    else if (/abedul|birch/.test(rawResource)) resource = 'birch_log'
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

  throw new Error('unsupported_or_unsafe_instruction: ' + input.slice(0, 64))
}

function createSecureCompanionController({ bot, authority, classes }) {
  if (authority?.sandboxOnly !== true ||
      authority?.identityMode !== 'trusted_server_bridge_lab' ||
      !authority?.worldId || !authority?.botName ||
      bot?.username !== authority.botName) {
    throw new Error('Secure companion requires valid sandbox authority matching bot username')
  }

  let activeFollow = null
  let activeOperation = null
  let mode = 'idle'
  let lastReason = 'initialized'

  function emergencyStop(reason = 'operator_stop') {
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

  async function gather(session, target, resource = 'oak_log', pickupTimeoutMs = 12000) {
    emergencyStop('switch_to_gather')
    const verifiedSession = verifySessionBundle(session, authority)
    if (!Object.hasOwn(ALLOWED_RESOURCES, resource)) {
      throw new Error('Unauthorized resource for gather')
    }
    if (!target || !['x', 'y', 'z'].every(k => Number.isInteger(target[k]))) {
      throw new Error('Target block position must have integer coordinates')
    }

    const inv = checkInventory()
    if (!inv.ok || inv.freeSlots <= 0) {
      return Object.freeze({ ok: false, reason: 'inventory_capacity_exceeded' })
    }

    const point = new Vec3(target.x, target.y, target.z)
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
      ...(nav ? {
        preDigApproach: pt => nav.approach(pt, { desiredDistance: 3.2 }),
        pickupApproach: pt => nav.approach(pt, { desiredDistance: 0 })
      } : {})
    })

    activeOperation = operation
    try {
      const proof = await operation.gatherOne()
      return proof
    } finally {
      activeOperation = null
    }
  }

  async function deposit(session, grant, chestTarget) {
    emergencyStop('switch_to_deposit')
    const verifiedSession = verifySessionBundle(session, authority)
    const verifiedGrant = verifySessionDepositGrant(grant, verifiedSession, authority)

    const chestCoord = chestTarget || verifiedGrant.chest
    if (!chestCoord || !['x', 'y', 'z'].every(k => Number.isInteger(chestCoord[k]))) {
      throw new Error('Chest coordinates required')
    }

    // Reserve operator nonce atomically before touching chest
    reserveGrantOnce(authority.ledgerDirectory, verifiedGrant.nonce)

    // Bounded approach to chest
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

    const playerBefore = inventoryCount(bot, verifiedGrant.item)
    if (playerBefore === null || playerBefore < verifiedGrant.count) {
      return Object.freeze({ ok: false, transferAttempted: false, reason: 'missing_item_to_deposit' })
    }

    const chestBlock = bot.blockAt(new Vec3(chestCoord.x, chestCoord.y, chestCoord.z))
    if (!chestBlock || chestBlock.name !== 'chest') {
      return Object.freeze({ ok: false, transferAttempted: false, reason: 'chest_unavailable' })
    }

    const container = await bot.openContainer(chestBlock)
    let chestBefore, chestAfter, playerAfter
    try {
      chestBefore = chestCount(container, verifiedGrant.item)
      const itemToDeposit = container.items().find(i => i.name === verifiedGrant.item)
      if (!itemToDeposit) {
        return Object.freeze({ ok: false, transferAttempted: false, reason: 'item_not_in_container_slots' })
      }
      await container.deposit(itemToDeposit.type, null, verifiedGrant.count)
      chestAfter = chestCount(container, verifiedGrant.item)
    } finally {
      container.close()
    }

    playerAfter = inventoryCount(bot, verifiedGrant.item)
    const verified = (chestAfter === chestBefore + verifiedGrant.count) &&
                     (playerAfter === playerBefore - verifiedGrant.count)

    return Object.freeze({
      ok: verified,
      reason: verified ? 'deposit_verified' : 'inventory_delta_mismatch',
      transferAttempted: true,
      item: verifiedGrant.item,
      count: verifiedGrant.count,
      playerBefore, playerAfter,
      chestBefore, chestAfter
    })
  }

  async function dispatchInstruction(input, context = {}) {
    const parsed = typeof input === 'string' ? parseNaturalInstruction(input) : input
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
      if (!context.session) {
        return Object.freeze({ ok: false, reason: 'signed_session_required' })
      }
      const target = parsed.target || context.target
      return gather(context.session, target, parsed.resource, context.pickupTimeoutMs)
    }

    if (parsed.kind === 'deposit') {
      if (!context.session || !context.grant) {
        return Object.freeze({ ok: false, reason: 'signed_session_and_grant_required' })
      }
      return deposit(context.session, context.grant, parsed.chest || context.chest)
    }

    throw new Error('unsupported_action: ' + parsed.kind)
  }

  function status() {
    return Object.freeze({
      mode,
      lastReason,
      activeFollow: Boolean(activeFollow),
      activeOperation: Boolean(activeOperation)
    })
  }

  return Object.freeze({
    dispatchInstruction,
    emergencyStop,
    checkInventory,
    follow,
    gather,
    deposit,
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
