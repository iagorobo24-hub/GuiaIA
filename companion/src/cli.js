'use strict'

// This launch mode intentionally supports OFFLINE AUTH ONLY on the *local* QA
// server. An untrusted public offline-mode server provides no secure owner ID.
if (process.argv.length !== 3 || process.argv[2] !== '--qa-local-only') {
  console.error('Denied. The companion can only run in explicit loopback-only QA.')
  process.exit(2)
}
const ownerName = process.env.GUIAIA_QA_OWNER
if (typeof ownerName !== 'string' || !/^[a-zA-Z0-9_]{3,16}$/.test(ownerName)) {
  console.error('Set GUIAIA_QA_OWNER to a trusted local QA account name.')
  process.exit(2)
}
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { createController } = require('./controller')
const { executeQaRuntimeCommand } = require('./qa_runtime_commands')
const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25598, username: 'GuiaIA_QA',
  auth: 'offline', version: '1.21.1', hideErrors: true
})
bot.loadPlugin(pathfinder)
let controller = null
const emit = data => console.log(JSON.stringify({ source: 'guiaia-qa-companion', ...data }))
bot.once('spawn', () => {
  controller = createController(bot, { GoalFollow: goals.GoalFollow, Movements }, { ownerName })
  emit({ event: 'spawned', mode: 'idle', world_changes: 0 })
})
bot.on('error', () => emit({ event: 'error', reason: 'connection_or_protocol_failure' }))
bot.on('kicked', () => emit({ event: 'kicked', reason: 'server_denied' }))
bot.on('end', () => emit({ event: 'disconnected' }))
const monitor = setInterval(() => controller?.monitor(), 500)
monitor.unref()

// In this preview no game chat messages or LLM output can authorize motion.
// Commands are exact strings on the controlling local process stdin only.
process.stdin.setEncoding('utf8')
process.stdin.on('data', input => {
  if (input.length > 128) { emit({ ok: false, reason: 'input_too_long' }); return }
  for (const command of input.split(/\r?\n/).filter(Boolean)) {
    const result=executeQaRuntimeCommand(command,controller,bot)
    if(command !== 'quit')emit(result)
    else return
  }
})
