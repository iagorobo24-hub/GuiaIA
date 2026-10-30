'use strict'

// Trusted, same-process terminal surface. No Minecraft chat, HTTP, socket,
// LLM output, or untrusted pipe is an operator identity or action permit.
// The caller must supply a separately initialized, signed QA runtime.
const readline = require('node:readline')

const COMMANDS = Object.freeze({
  estado: 'status', status: 'status',
  inventario: 'inventory', inventory: 'inventory',
  sigueme: 'follow', follow: 'follow',
  siguiente: 'next', next: 'next',
  mision: 'mission', mission: 'mission',
  para: 'stop', stop: 'stop',
  ayuda: 'help', help: 'help',
  salir: 'quit', quit: 'quit'
})
const HELP = Object.freeze(Object.keys(COMMANDS))

function createTrustedLocalOperatorConsole(runtime) {
  if (!runtime || !['status','inventory','follow','runNext','runAll','stop']
    .every(name => typeof runtime[name] === 'function')) {
    throw Error('Signed runtime required for local operator console')
  }
  async function execute(line) {
    if (typeof line !== 'string' || line.length > 128 || /[\r\n\0]/.test(line)) {
      return Object.freeze({ok:false,reason:'invalid_operator_input'})
    }
    const normalized = line.trim().toLowerCase()
    // Never consult inherited Object.prototype keys: 'constructor' and
    // '__proto__' must not fall through to the executable mission route.
    if (!Object.hasOwn(COMMANDS,normalized)) {
      return Object.freeze({ok:false,reason:'unsupported_operator_command'})
    }
    const kind = COMMANDS[normalized]
    try {
      if (kind === 'help') return {ok:true,commands:HELP}
      if (kind === 'status') return {ok:true,state:runtime.status()}
      if (kind === 'inventory') return runtime.inventory()
      if (kind === 'stop' || kind === 'quit') return runtime.stop()
      if (kind === 'follow') return await runtime.follow()
      if (kind === 'next') return await runtime.runNext()
      return await runtime.runAll()
    } catch {
      // Do not disclose signed payloads, private key material or local paths.
      return Object.freeze({ok:false,reason:'operator_operation_failed'})
    }
  }
  return Object.freeze({execute})
}

function attachTrustedLocalOperatorStdin(operator, {
  input = process.stdin, output = process.stdout
} = {}) {
  if (!operator || typeof operator.execute !== 'function' ||
      input?.isTTY !== true || typeof output?.write !== 'function') {
    throw Error('Interactive operator requires a trusted local TTY and signed runtime')
  }
  const lineReader=readline.createInterface({input,output,terminal:true})
  let closed=false
  const stopOnClose=()=>{
    if (closed) return
    closed=true
    // EOF/terminal close is an emergency stop, not a silent detachment.
    void operator.execute('para')
  }
  lineReader.on('close',stopOnClose)
  lineReader.on('line',line=>{
    const normalized=line.trim().toLowerCase()
    // execute() synchronously reaches stop() before it returns a Promise.
    // A stop is not placed behind a pending asynchronous mission.
    void operator.execute(line).then(result=>{
      output.write(JSON.stringify({source:'guiaia-local-operator',command:normalized,
        result})+'\n')
      if (normalized==='salir' || normalized==='quit')lineReader.close()
    })
  })
  return Object.freeze({close:()=>lineReader.close()})
}

module.exports={createTrustedLocalOperatorConsole,attachTrustedLocalOperatorStdin}
