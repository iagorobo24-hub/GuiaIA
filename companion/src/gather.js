'use strict'

// Experimental gather primitive. It exists ONLY for a disposable, loopback QA
// world. No input from chat/LLM/MCP and no arbitrary block selection.
const { finiteDistance, OWNER_MAX_DISTANCE } = require('./controller')
const HAZARDS = new Set(['water','lava','fire','soul_fire','cactus','powder_snow'])
const ALLOWED_BLOCK = 'oak_log'
const ALLOWED_ITEM = 'oak_log'

function inventoryCount(bot, name) {
  if (!bot.inventory || typeof bot.inventory.items !== 'function') return null
  const items = bot.inventory.items()
  if (!Array.isArray(items)) return null
  return items.filter(item => item.name === name &&
    Number.isInteger(item.count) && item.count > 0).reduce((sum, item) => sum + item.count, 0)
}
function validPosition(position) {
  return position && ['x', 'y', 'z'].every(k =>
    Number.isInteger(position[k]) && Math.abs(position[k]) <= 30000000)
}
function createQaGather(bot, options) {
  const { ownerName, target, sandboxOnly, pickupTimeoutMs = 12000 } = options || {}
  if (sandboxOnly !== true || !/^[a-zA-Z0-9_]{3,16}$/.test(ownerName || '') ||
      !validPosition(target) || pickupTimeoutMs < 1 || pickupTimeoutMs > 30000) {
    throw new Error('Gathering denied: explicitly configured local QA only')
  }
  if (typeof bot.blockAt !== 'function' || typeof bot.dig !== 'function' ||
      !bot.inventory || typeof bot.inventory.items !== 'function') {
    throw new Error('Gathering denied: missing Minecraft observation or dig interface')
  }
  let busy = false
  let cancelled = false
  function cancel() {
    cancelled = true
    if (typeof bot.stopDigging === 'function') {
      try { bot.stopDigging() } catch {}
    }
  }
  for (const event of ['end', 'kicked', 'death']) bot.on(event, cancel)
  function safety() {
    const owner = bot.players?.[ownerName]?.entity
    const position = bot.entity?.position
    if (!owner || !position) return 'owner_not_visible'
    if (!Number.isFinite(bot.health) || bot.health < 12) return 'low_health'
    if (finiteDistance(position, owner.position) > OWNER_MAX_DISTANCE) return 'owner_out_of_range'
    if (finiteDistance(position, target) > 4.2) return 'block_out_of_reach'
    const feet = bot.blockAt(position.floored ? position.floored() : position)
    if (!feet || HAZARDS.has(feet.name)) return 'unsafe_feet'
    const head = bot.blockAt(position.offset ? position.offset(0,1,0) : position)
    if (!head || HAZARDS.has(head.name)) return 'unsafe_head'
    return null
  }
  async function gatherOne() {
    if (busy) return { ok:false, reason:'already_gathering', executed:false }
    busy = true
    cancelled = false
    let digAttempted = false
    const finish = (ok, reason, delta=0) =>
      ({ ok, reason, mode:'single_block_local_qa', block:ALLOWED_BLOCK,
         item:ALLOWED_ITEM, inventory_delta:delta, dig_attempted:digAttempted,
         world_changes_authorized:1, production:false })
    try {
      const unsafe = safety()
      if (unsafe) return finish(false, unsafe)
      const before = inventoryCount(bot, ALLOWED_ITEM)
      if (before === null) return finish(false, 'inventory_unavailable')
      const current = bot.blockAt(target)
      if (!current || current.name !== ALLOWED_BLOCK) return finish(false, 'block_not_allowlisted')
      if (typeof bot.canDigBlock === 'function' && !bot.canDigBlock(current)) {
        return finish(false, 'block_not_diggable')
      }
      if (cancelled) return finish(false, 'cancelled')
      digAttempted = true
      try {
        await bot.dig(current)
      } catch {
        return finish(false, 'dig_failed')
      }
      if (cancelled) return finish(false, 'cancelled')
      if (safety()) return finish(false, 'post_dig_safety_stop')
      const deadline = Date.now() + pickupTimeoutMs
      do {
        if (cancelled) return finish(false, 'cancelled')
        const count = inventoryCount(bot, ALLOWED_ITEM)
        const afterBlock = bot.blockAt(target)
        if (count !== null && count >= before + 1 && afterBlock &&
            afterBlock.name !== ALLOWED_BLOCK) return finish(true, 'verified_inventory_drop', count - before)
        if (Date.now() >= deadline) break
        await new Promise(resolve => setTimeout(resolve, 250))
      } while (true)
      return finish(false, 'item_not_verified')
    } finally {
      busy = false
    }
  }
  return { gatherOne, cancel, get busy() {return busy} }
}
module.exports = { createQaGather, inventoryCount, ALLOWED_BLOCK }
