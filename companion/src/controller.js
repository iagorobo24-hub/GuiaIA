'use strict'

// This controller has only two movement actions: follow and stop.
// It cannot mine, place blocks, attack, chat, run RCON or execute shell commands.
const OWNER_MAX_DISTANCE = 18
const FOLLOW_DISTANCE = 2
const MIN_HEALTH = 12

function finiteDistance(a, b) {
  if (!a || !b || !['x', 'y', 'z'].every(k => Number.isFinite(a[k]) && Number.isFinite(b[k]))) {
    return Infinity
  }
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function createController(bot, { GoalFollow, Movements }, options = {}) {
  const ownerName = options.ownerName
  if (typeof ownerName !== 'string' || !/^[a-zA-Z0-9_]{3,16}$/.test(ownerName)) {
    throw new Error('QA owner username must be explicitly configured')
  }
  if (!bot.pathfinder || typeof bot.pathfinder.setGoal !== 'function') {
    throw new Error('Pathfinder plugin is required')
  }
  if (typeof GoalFollow !== 'function' || typeof Movements !== 'function') {
    throw new Error('Pathfinding classes are missing')
  }

  let mode = 'idle'
  let lastReason = 'initialized'
  const moves = new Movements(bot)
  // In a prototype, world mutation and hazardous shortcutting are prohibited.
  moves.canDig = false
  moves.canOpenDoors = false
  moves.allow1by1towers = false
  moves.allowFreeMotion = false
  moves.allowParkour = false
  moves.allowSprinting = false
  bot.pathfinder.setMovements(moves)

  function reject(reason) { lastReason = reason; return { ok: false, mode, reason } }
  function stop(reason = 'owner_stop') {
    bot.pathfinder.setGoal(null)
    if (typeof bot.clearControlStates === 'function') bot.clearControlStates()
    mode = 'idle'
    lastReason = reason
    return { ok: true, mode, reason }
  }
  function owner() { return bot.players?.[ownerName]?.entity || null }
  function safety() {
    const target = owner()
    if (!target || !bot.entity?.position) return { ok: false, reason: 'owner_not_visible' }
    if (!Number.isFinite(bot.health) || bot.health < MIN_HEALTH) return { ok: false, reason: 'low_health' }
    const separation = finiteDistance(bot.entity.position, target.position)
    if (separation > OWNER_MAX_DISTANCE) return { ok: false, reason: 'owner_out_of_range' }
    if (bot.entity === target) return { ok: false, reason: 'invalid_owner' }
    return { ok: true, target }
  }
  function follow() {
    if (mode === 'following') return { ok: true, mode, reason: 'already_following' }
    const checked = safety()
    if (!checked.ok) return reject(checked.reason)
    bot.pathfinder.setGoal(new GoalFollow(checked.target, FOLLOW_DISTANCE), true)
    mode = 'following'
    lastReason = 'authorized_local_qa_follow'
    return { ok: true, mode, reason: lastReason }
  }
  function monitor() {
    if (mode !== 'following') return { ok: true, mode }
    const checked = safety()
    return checked.ok ? { ok: true, mode } : stop(checked.reason)
  }
  function status() { return { mode, reason: lastReason, owner_visible: Boolean(owner()) } }

  // Stop on disconnection or error instead of persisting motion state.
  for (const event of ['end', 'kicked', 'death']) {
    bot.on(event, () => stop('connection_or_life_cycle_end'))
  }
  return { follow, stop, monitor, status }
}
module.exports = { createController, finiteDistance, OWNER_MAX_DISTANCE }
