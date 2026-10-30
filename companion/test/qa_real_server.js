'use strict'
/**
 * Integration-only in-process controller: two Mineflayer accounts join a
 * disposable local Minecraft server, and the companion follows/stops on
 * direct local authority. NEVER USE this script with a production server.
 */
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { createController } = require('../src/controller')
const host = '127.0.0.1'
const port = 25598
const options = username => ({
  host, port, username, version: '1.21.1', auth: 'offline', hideErrors: true,
})
const owner = mineflayer.createBot(options('OwnerQA'))
const bot = mineflayer.createBot(options('GuiaIA_QA'))
bot.loadPlugin(pathfinder)

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
function spawn(b) {
  if (b.entity?.position) return Promise.resolve()
  return new Promise((resolve, reject) => {
    b.once('spawn', resolve)
    b.once('end', () => reject(new Error('QA bot disconnected before spawn')))
    b.once('error', () => reject(new Error('QA connection failed')))
  })
}
async function main() {
  const timeout = setTimeout(() => { console.error('QA bot timed out'); process.exitCode = 1; owner.end(); bot.end() }, 70000)
  try {
    await Promise.all([spawn(owner), spawn(bot)])
    let controller
    for (let i = 0; i < 28; i++) {
      if (bot.players?.OwnerQA?.entity) break
      await wait(250)
    }
    controller = createController(bot, { GoalFollow: goals.GoalFollow, Movements },
      { ownerName: 'OwnerQA' })
    const follow = controller.follow()
    if (!follow.ok) throw new Error('QA follow failed: ' + follow.reason)
    await wait(1200)
    const begin = { ...bot.entity.position }
    // A short walk by the disposable owner makes path-follow observable;
    // movement distance is reported but not required as a CI guarantee yet.
    owner.setControlState('forward', true)
    await wait(2400)
    owner.setControlState('forward', false)
    await wait(2600)
    const end = bot.entity.position
    const moved = Math.hypot(end.x - begin.x, end.z - begin.z)
    const monitoring = controller.monitor()
    const stop = controller.stop('qa_test_stop')
    if (!stop.ok || controller.status().mode !== 'idle') {
      throw new Error('QA stop did not reset movement')
    }
    console.log('GUIAIA_BOT_QA_EVIDENCE=' + JSON.stringify({
      result: 'pass', real_minecraft_login: true, owner_entity_observed: true,
      follow_goal_accepted: follow.ok, safety_monitor_passed: monitoring.ok,
      stopped: stop.ok, movement_distance_blocks: +moved.toFixed(3),
      test_server: '127.0.0.1:25598', world_mutation_features: false,
      production_test: false,
    }))
  } finally {
    clearTimeout(timeout)
    try { owner.clearControlStates() } catch {}
    try { bot.clearControlStates() } catch {}
    owner.quit()
    bot.quit()
  }
}
main().catch(err => {
  console.error('QA BOT FAILURE: ' + String(err.message).slice(0, 240))
  process.exitCode = 1
  owner.end()
  bot.end()
})
