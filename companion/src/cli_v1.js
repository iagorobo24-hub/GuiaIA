'use strict'

/**
 * GuiaIA V1 — Official Unified Interactive CLI / TUI Console
 * Connects an authorized intelligent companion to Minecraft Java 1.21.1 / Fabric.
 */

const readline = require('node:readline')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const EventEmitter = require('node:events')

const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')

const { createSecureCompanionController, ALLOWED_RESOURCES } = require('./secure_companion_controller')
const { buildMineflayerAuthOptions, getAuthStorageDir } = require('./auth/microsoft_auth')
const { createOwnerPinPairing } = require('./auth/owner_pin_pairing')
const { attachProfileDetector, ensureRecipeCompatibility } = require('./cobblemon_profile')
const { createLocalMonotonicWitness } = require('./local_monotonic_witness')
const { createRemoteWitnessClient, validateRemoteWitnessConfig } = require('./remote_witness_client')

// ANSI Color Helpers
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgBlue: '\x1b[44m'
}

function parseCliArgs(args) {
  const options = {
    host: '127.0.0.1',
    port: 25565,
    username: 'GuiaBot',
    auth: 'offline', // 'offline' | 'microsoft'
    owner: null,
    identityMode: 'vanilla_paired_operator', // 'vanilla_paired_operator' | 'trusted_server_bridge_lab'
    v1Batch: true,
    interactive: true,
    dashboard: false,
    dashboardPort: 8080,
    witnessUrl: process.env.GUIAIA_REMOTE_WITNESS_URL || null,
    witnessKey: process.env.GUIAIA_REMOTE_WITNESS_KEY || null,
    witnessTimeout: process.env.GUIAIA_REMOTE_WITNESS_TIMEOUT_MS ? parseInt(process.env.GUIAIA_REMOTE_WITNESS_TIMEOUT_MS, 10) : 2000
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--host' && args[i + 1]) options.host = args[++i]
    else if (arg === '--port' && args[i + 1]) options.port = parseInt(args[++i], 10)
    else if (arg === '--username' && args[i + 1]) options.username = args[++i]
    else if (arg === '--auth' && args[i + 1]) options.auth = args[++i].toLowerCase()
    else if (arg === '--owner' && args[i + 1]) options.owner = args[++i]
    else if (arg === '--mode' && args[i + 1]) options.identityMode = args[++i]
    else if (arg === '--witness-url' && args[i + 1]) options.witnessUrl = args[++i]
    else if (arg === '--witness-key' && args[i + 1]) options.witnessKey = args[++i]
    else if (arg === '--witness-timeout' && args[i + 1]) options.witnessTimeout = parseInt(args[++i], 10)
    else if (arg === '--dashboard' || arg === '--web') {
      options.dashboard = true
      if (args[i + 1] && /^\d+$/.test(args[i + 1])) {
        options.dashboardPort = parseInt(args[++i], 10)
      }
    }
    else if (arg === '--non-interactive') options.interactive = false
    else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  return options
}

function printHelp() {
  console.log(`
${C.cyan}${C.bold}GuiaIA V1 — Consola Oficial del Agente para Minecraft Java 1.21.1${C.reset}

Uso:
  node src/cli_v1.js [opciones]

Opciones:
  --host <direccion>      IP o nombre de host del servidor Minecraft (default: 127.0.0.1)
  --port <puerto>         Puerto del servidor Minecraft (default: 25565)
  --username <nombre>     Nombre del bot o correo Microsoft (default: GuiaBot)
  --auth <modo>           Modo de autenticacion: 'offline' o 'microsoft' (default: offline)
  --owner <nombre>        Nombre del jugador operador autorizado (opcional si se usa PIN)
  --mode <modo>           Modo de seguridad: 'vanilla_paired_operator' o 'trusted_server_bridge_lab'
  --witness-url <url>     URL del testigo remoto (ej: http://127.0.0.1:8090)
  --witness-key <path>    Ruta a clave pública Ed25519 o PEM del testigo remoto
  --witness-timeout <ms>  Timeout máximo de red para el testigo remoto (default: 2000)
  --non-interactive       Ejecuta sin prompt interactivo de configuracion
  --help, -h              Muestra esta ayuda

Comandos disponibles en la consola interactiva:
  recoge <N> <recurso>    Recolecta recursos en batch (1-16) (ej: 'recoge 5 madera')
  deposita <N> <recurso>  Deposita recursos en cofre (ej: 'deposita 5 roble en cofre 10 64 10')
  sigue                   Sigue al operador autorizado
  inventario              Muestra el inventario actual y slots disponibles
  parar, stop, ESC, q     ${C.red}${C.bold}[P0] Parada de emergencia instantanea${C.reset}
  pin                     Genera un nuevo PIN de emparejamiento para jugadores LAN
  estado                  Muestra salud, posicion y estado del agente
  salir, quit             Desconecta el bot y cierra la consola
`)
}

function printBanner() {
  console.log(`
${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗
║                   ${C.bold}GUIAIA V1 — AGENTE INTELIGENTE MINECRAFT${C.reset}${C.cyan}                 ║
║               Compatible con Fabric 1.21.1 / Vanilla / Cobblemon           ║
║               ${C.yellow}Presiona [ESC] o escribe 'parar' para Parada P0${C.reset}${C.cyan}              ║
╚════════════════════════════════════════════════════════════════════════════╝${C.reset}
`)
}

async function startInteractiveCli(options) {
  printBanner()

  let webServer = null

  // Persistent operator keypair for session signing and witness continuity
  const fs = require('node:fs')
  const authDir = getAuthStorageDir()
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true, mode: 0o700 })
  }
  const keyFile = path.join(authDir, 'operator_identity.json')
  let operatorPrivateKeyPem = null
  let operatorPublicKeyPem = null

  if (fs.existsSync(keyFile)) {
    try {
      const saved = JSON.parse(fs.readFileSync(keyFile, 'utf8'))
      operatorPrivateKeyPem = saved.privateKeyPem
      operatorPublicKeyPem = saved.publicKeyPem
    } catch {}
  }

  if (!operatorPrivateKeyPem || !operatorPublicKeyPem) {
    const pair = crypto.generateKeyPairSync('ed25519')
    operatorPrivateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
    operatorPublicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' })
    try {
      fs.writeFileSync(keyFile, JSON.stringify({
        privateKeyPem: operatorPrivateKeyPem,
        publicKeyPem: operatorPublicKeyPem
      }, null, 2), { mode: 0o600 })
    } catch {}
  }

  const operatorPrivateKey = crypto.createPrivateKey(operatorPrivateKeyPem)

  const sanitizedHost = String(options.host).replace(/[^a-zA-Z0-9_-]/g, '_')
  const worldId = `vanilla:${sanitizedHost}:${options.port}`.slice(0, 64)

  // Durable monotonic witness
  const witnessDir = path.join(getAuthStorageDir(), '..', 'witness')
  const witness = createLocalMonotonicWitness({
    directory: witnessDir,
    worldId,
    operatorPublicKeyPem
  })

  // Optional Remote Monotonic Witness for distributed multi-host deployments
  let remoteWitnessClient = null
  if (options.witnessUrl) {
    let witnessKeyPem = options.witnessKey
    if (witnessKeyPem && !witnessKeyPem.includes('BEGIN PUBLIC KEY')) {
      if (fs.existsSync(witnessKeyPem)) {
        witnessKeyPem = fs.readFileSync(witnessKeyPem, 'utf8')
      }
    }
    const witnessConfig = {
      url: options.witnessUrl,
      worldId,
      operatorPublicKeyPem,
      witnessPublicKeyPem: witnessKeyPem,
      timeoutMs: options.witnessTimeout || 2000
    }
    const validation = validateRemoteWitnessConfig(witnessConfig)
    if (!validation.valid) {
      console.error(`${C.red}Configuración de testigo remoto inválida: ${validation.error}${C.reset}`)
      process.exit(1)
    }
    remoteWitnessClient = createRemoteWitnessClient(witnessConfig)
    console.log(`${C.green}✔ Testigo remoto distribuido configurado: ${options.witnessUrl}${C.reset}`)
  }

  // PIN Pairing manager for offline / LAN authentication
  const pairingManager = createOwnerPinPairing({
    onPairSuccess: (paired) => {
      console.log(`\n${C.green}${C.bold}[EMPAREJAMIENTO EXITOSO]${C.reset} Operador vinculado: ${C.cyan}${paired.username}${C.reset}`)
      options.owner = paired.username
      if (authority) {
        authority.ownerName = paired.username
        authority.trustedPrincipals[`op_${paired.username}`] = operatorPublicKeyPem
      }
      promptUser()
    }
  })

  console.log(`${C.dim}Conectando a Minecraft en ${options.host}:${options.port} (${options.auth.toUpperCase()})...${C.reset}`)

  // Mineflayer connection configuration
  const botOptions = buildMineflayerAuthOptions({
    username: options.username,
    authMode: options.auth,
    onMsaCode: (data) => {
      console.log(`\n${C.yellow}════════════════ AUTENTICACION OFICIAL MICROSOFT ════════════════${C.reset}`)
      console.log(`1. Abre tu navegador y ve a:  ${C.bold}${C.cyan}${data.verification_uri}${C.reset}`)
      console.log(`2. Introduce el codigo:        ${C.bold}${C.green}${data.user_code}${C.reset}`)
      console.log(`${C.yellow}═════════════════════════════════════════════════════════════════${C.reset}\n`)
    }
  })

  botOptions.host = options.host
  botOptions.port = options.port
  botOptions.version = '1.21.1'
  botOptions.hideErrors = true

  // Ensure Fabric 1.21.1 / Cobblemon protocol recipe compatibility before bot creation
  ensureRecipeCompatibility()

  let bot = null
  let controller = null
  let authority = null
  let rl = null

  try {
    bot = mineflayer.createBot(botOptions)
  } catch (err) {
    console.error(`${C.red}Error iniciando bot Mineflayer: ${err.message}${C.reset}`)
    process.exit(1)
  }

  // Load pathfinder plugin
  bot.loadPlugin(pathfinder)

  // Attach Cobblemon profile detector
  const cobblemonDetector = attachProfileDetector(bot)

  // Attach PIN pairing whisper handler
  const detachPairing = pairingManager.attachToBot(bot)

  // Durable ledger directory for single-use grants
  const ledgerDir = path.join(getAuthStorageDir(), '..', 'ledger')
  if (!require('node:fs').existsSync(ledgerDir)) {
    require('node:fs').mkdirSync(ledgerDir, { recursive: true, mode: 0o700 })
  }

  bot.once('spawn', () => {
    console.log(`${C.green}${C.bold}✔ Bot conectado e inicializado en el mundo.${C.reset}`)

    const initialOwner = options.owner || 'Steve'
    const principalId = `op_${initialOwner}`
    authority = {
      sandboxOnly: true,
      identityMode: options.identityMode,
      botName: bot.username,
      worldId,
      ownerName: initialOwner,
      operatorPublicKeyPem,
      trustedPrincipals: {
        [principalId]: operatorPublicKeyPem
      },
      isRevoked: () => false,
      ledgerDirectory: ledgerDir,
      v1Batch: true,
      multiHostEnabled: Boolean(remoteWitnessClient),
      remoteWitnessClient: remoteWitnessClient || null
    }

    controller = createSecureCompanionController({
      bot,
      authority,
      classes: {
        GoalNear: goals.GoalNear,
        GoalFollow: goals.GoalFollow,
        Movements
      }
    })

    if (options.dashboard) {
      const { createWebDashboardServer } = require('./web/server')
      try {
        webServer = createWebDashboardServer({
          port: options.dashboardPort || 8080,
          host: '127.0.0.1',
          controller,
          bot,
          authority
        })
        console.log(`\n${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗`)
        console.log(`║ ${C.bold}PANEL DE CONTROL WEB ACTIVO (DASHBOARD LOCAL V1.1)${C.reset}${C.cyan}                        ║`)
        console.log(`║ URL:   ${C.bold}http://127.0.0.1:${options.dashboardPort || 8080}${C.reset}${C.cyan}                                           ║`)
        console.log(`║ PIN:   ${C.bold}${C.yellow}${webServer.pairingPin || 'N/A'}${C.reset}${C.cyan} (PIN de 6 dígitos para emparejar en el navegador)     ║`)
        console.log(`╚════════════════════════════════════════════════════════════════════════════╝${C.reset}\n`)
      } catch (err) {
        console.error(`${C.red}[DASHBOARD] Fallo iniciando servidor web: ${err.message}${C.reset}`)
      }
    }

    if (options.auth === 'offline' && !options.owner) {
      const pinInfo = pairingManager.generateNewPin()
      console.log(`
${C.yellow}┌────────────────────────────────────────────────────────────┐
│ ${C.bold}PIN DE EMPAREJAMIENTO LAN / OFFLINE (Valido por ${pinInfo.ttlSeconds}s):${C.reset}${C.yellow}          │
│                      ${C.bold}${C.white}${pinInfo.pin}${C.reset}${C.yellow}                                │
│ Escribe en el chat de Minecraft:  ${C.cyan}/msg ${bot.username} pair ${pinInfo.pin}${C.reset}${C.yellow}    │
└────────────────────────────────────────────────────────────┘${C.reset}
`)
    }

    // In-game whisper handler for paired owner
    bot.on('whisper', async (sender, message) => {
      if (!sender || sender === bot.username) return
      const currentOwner = options.owner || pairingManager.getStatus().pairedOwner?.username
      if (sender !== currentOwner) return
      const clean = String(message || '').trim()
      if (/^pair\s+\d{6}$/i.test(clean)) return
      console.log(`\n${C.cyan}[MENSAJE EN JUEGO de ${sender}]:${C.reset} ${clean}`)
      await handleUserInput(clean, { fromInGame: true, sender })
    })

    setupReadline()
  })

  bot.on('kicked', (reason) => {
    console.log(`\n${C.red}${C.bold}[EXPULSADO]${C.reset} El servidor cerro la conexion: ${reason}`)
    cleanup()
  })

  bot.on('error', (err) => {
    console.log(`\n${C.red}${C.bold}[ERROR DE CONEXION]${C.reset} ${err.message}`)
  })

  bot.on('end', () => {
    console.log(`\n${C.yellow}Conexion finalizada.${C.reset}`)
    cleanup()
  })

  function printStatusHud() {
    if (!bot || !bot.entity) return
    const pos = bot.entity.position
    const x = Math.round(pos.x)
    const y = Math.round(pos.y)
    const z = Math.round(pos.z)
    const hp = Math.round(bot.health || 20)
    const food = Math.round(bot.food || 20)
    const st = controller ? controller.status() : { mode: 'disconnected' }
    const profile = cobblemonDetector.getProfile()
    const ownerName = options.owner || pairingManager.getStatus().pairedOwner?.username || 'Sin emparejar'

    console.log(`
${C.dim}────────────────────────── ESTADO ACTUAL ──────────────────────────${C.reset}
  ${C.bold}Posicion:${C.reset} X: ${x}, Y: ${y}, Z: ${z}   ${C.bold}Salud:${C.reset} ${hp}/20   ${C.bold}Comida:${C.reset} ${food}/20
  ${C.bold}Modo:${C.reset}     ${C.cyan}${st.mode.toUpperCase()}${C.reset} (${st.lastReason})
  ${C.bold}Operador:${C.reset} ${C.green}${ownerName}${C.reset}   ${C.bold}Perfil:${C.reset} ${profile.profile}
${C.dim}───────────────────────────────────────────────────────────────────${C.reset}`)
  }

  function setupReadline() {
    printStatusHud()

    if (!options.interactive || !process.stdin.isTTY) {
      console.log(`${C.dim}Modo headless/background activo. Escuchando ordenes en el chat de Minecraft (/msg ${bot.username} ...)${C.reset}`)
      return
    }

    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: (line) => {
        const completions = ['recoge 5 madera', 'deposita 5 roble en cofre', 'sigue', 'inventario', 'parar', 'estado', 'pin', 'salir']
        const hits = completions.filter(c => c.startsWith(line))
        return [hits.length ? hits : completions, line]
      }
    })

    // Raw mode for single-key P0 Emergency Stop
    if (process.stdin.isTTY) {
      process.stdin.on('keypress', (str, key) => {
        if (key && (key.name === 'escape' || (key.ctrl && key.name === 'c'))) {
          executeEmergencyStop()
        }
      })
    }

    promptUser()
  }

  function promptUser() {
    if (!rl) return
    rl.question(`${C.cyan}GuiaIA>${C.reset} `, async (input) => {
      await handleUserInput(input.trim())
      promptUser()
    })
  }

  function executeEmergencyStop() {
    console.log(`\n${C.bgRed}${C.white}${C.bold} [P0 EMERGENCY STOP ACTIVADO] ${C.reset} Deteniendo todas las acciones inmediatamente...`)
    if (controller) {
      const res = controller.emergencyStop('operator_emergency_keypress')
      console.log(`${C.yellow}Estado: ${res.mode} (${res.reason})${C.reset}\n`)
    }
  }

  async function handleUserInput(input, meta = {}) {
    if (!input) return

    function reply(text) {
      if (meta.fromInGame && meta.sender) {
        try { bot.whisper(meta.sender, text) } catch {}
      }
    }

    // 1. Emergency stop aliases
    if (/^(?:parar|stop|alto|detente|cancelar)$/i.test(input)) {
      executeEmergencyStop()
      reply('Parada P0 activada. Todas las acciones detenidas.')
      return
    }

    // 2. Exit / Quit
    if (/^(?:salir|quit|exit)$/i.test(input)) {
      console.log(`${C.yellow}Cerrando GuiaIA...${C.reset}`)
      reply('Cerrando sesion de GuiaIA.')
      cleanup()
      process.exit(0)
    }

    // 3. Status HUD
    if (/^(?:estado|status|hud)$/i.test(input)) {
      printStatusHud()
      if (bot?.entity?.position) {
        const p = bot.entity.position
        reply(`Posicion: ${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}. Salud: ${Math.round(bot.health || 20)}/20. Modo: ${controller?.status()?.mode || 'idle'}`)
      }
      return
    }

    // 4. Generate PIN
    if (/^(?:pin|emparejar|pair)$/i.test(input)) {
      try {
        const pinInfo = pairingManager.generateNewPin()
        console.log(`\n${C.yellow}Nuevo PIN generado: ${C.bold}${C.white}${pinInfo.pin}${C.reset}${C.yellow} (valido ${pinInfo.ttlSeconds}s)${C.reset}`)
        console.log(`Escribe en Minecraft: ${C.cyan}/msg ${bot.username} pair ${pinInfo.pin}${C.reset}\n`)
        reply('Nuevo PIN generado en consola.')
      } catch (err) {
        console.log(`${C.red}${err.message}${C.reset}`)
        reply(err.message)
      }
      return
    }

    // 5. Check Inventory
    if (/^(?:inventario|inv|items)$/i.test(input)) {
      if (controller) {
        const inv = controller.checkInventory()
        console.log(`\n${C.bold}Inventario:${C.reset} ${inv.freeSlots} slots libres de 36`)
        for (const [item, count] of Object.entries(inv.items)) {
          console.log(`  - ${C.green}${item}${C.reset}: ${count}`)
        }
        if (inv.hasUnauthorizedItems) {
          console.log(`  ${C.red}Items no autorizados: ${JSON.stringify(inv.unauthorizedItems)}${C.reset}`)
        }
        console.log('')
        const summary = Object.entries(inv.items).map(([k, v]) => `${k}:${v}`).join(', ') || 'Vacio'
        reply(`Inventario (${inv.freeSlots} slots libres): ${summary}`)
      }
      return
    }

    // 6. Action instruction (follow, gather, deposit)
    if (!controller) {
      console.log(`${C.red}El controlador aun no esta listo. Espera a que el bot aparezca en el juego.${C.reset}`)
      reply('Controlador aun no listo.')
      return
    }

    const currentOwner = options.owner || pairingManager.getStatus().pairedOwner?.username
    if (!currentOwner) {
      console.log(`${C.red}Accion denegada: El bot requiere un operador emparejado antes de ejecutar acciones en el mundo.${C.reset}`)
      console.log(`Genera un PIN con 'pin' y emparejate en el chat de Minecraft primero.`)
      reply('Accion denegada: Requiere operador emparejado.')
      return
    }

    const principalId = `op_${currentOwner}`
    if (authority && !authority.trustedPrincipals[principalId]) {
      authority.trustedPrincipals[principalId] = operatorPublicKeyPem
    }
    if (authority) {
      authority.ownerName = currentOwner
    }

    // Generate local single-use signed grant and session bundle
    const now = Date.now()
    const connectionId = crypto.randomUUID()
    const challenge = crypto.randomBytes(24).toString('hex')

    const ownerPayload = {
      aud: 'guiaia:vanilla-paired-session:v1',
      worldId: authority.worldId,
      connectionId,
      principalId,
      challenge,
      username: currentOwner,
      issuedAt: now - 500,
      expiresAt: now + 60000
    }
    const ownerSig = crypto.sign(null, Buffer.from(JSON.stringify(ownerPayload)), operatorPrivateKey).toString('base64url')
    const sessionBundle = {
      owner: { payload: ownerPayload, signature: ownerSig }
    }

    try {
      const parsed = controller.parseNaturalInstruction(input, { v1Batch: true })
      console.log(`${C.dim}Ejecutando: ${parsed.kind} (rec: ${parsed.resource || 'n/a'}, count: ${parsed.count || 'n/a'})...${C.reset}`)

      let grantPayload = null
      let aud = ''
      if (parsed.kind === 'follow') {
        aud = 'guiaia:session-follow:v1'
        grantPayload = {
          aud,
          worldId: authority.worldId,
          botName: bot.username,
          ownerName: currentOwner,
          principalId,
          connectionId,
          challenge,
          nonce: crypto.randomUUID(),
          issuedAt: now - 500,
          expiresAt: now + 9000
        }
      } else if (parsed.kind === 'gather') {
        aud = 'guiaia:session-gather:v1'
        grantPayload = {
          aud,
          worldId: authority.worldId,
          botName: bot.username,
          ownerName: currentOwner,
          principalId,
          connectionId,
          challenge,
          target: parsed.target || { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) },
          item: parsed.resource,
          count: parsed.count || 1,
          nonce: crypto.randomUUID(),
          issuedAt: now - 500,
          expiresAt: now + 60000
        }
      } else if (parsed.kind === 'deposit') {
        aud = 'guiaia:session-deposit:v1'
        grantPayload = {
          aud,
          worldId: authority.worldId,
          botName: bot.username,
          ownerName: currentOwner,
          principalId,
          connectionId,
          challenge,
          chest: parsed.chest || { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) },
          item: parsed.resource,
          count: parsed.count || 1,
          nonce: crypto.randomUUID(),
          issuedAt: now - 500,
          expiresAt: now + 60000
        }
      } else if (parsed.kind === 'craft') {
        aud = 'guiaia:session-craft:v1'
        grantPayload = {
          aud,
          worldId: authority.worldId,
          botName: bot.username,
          ownerName: currentOwner,
          principalId,
          connectionId,
          challenge,
          recipe: parsed.recipe || parsed.item,
          item: parsed.item,
          count: parsed.count || 1,
          nonce: crypto.randomUUID(),
          issuedAt: now - 500,
          expiresAt: now + 60000
        }
      } else if (parsed.kind === 'build') {
        aud = 'guiaia:session-build:v1'
        grantPayload = {
          aud,
          worldId: authority.worldId,
          botName: bot.username,
          ownerName: currentOwner,
          principalId,
          connectionId,
          challenge,
          blueprintId: parsed.blueprintId,
          origin: parsed.origin || { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) },
          nonce: crypto.randomUUID(),
          issuedAt: now - 500,
          expiresAt: now + 60000
        }
      } else if (parsed.kind === 'pokemon') {
        aud = 'guiaia:session-pokemon:v1'
        grantPayload = {
          aud,
          worldId: authority.worldId,
          botName: bot.username,
          ownerName: currentOwner,
          principalId,
          connectionId,
          challenge,
          action: parsed.action,
          target: parsed.target,
          nonce: crypto.randomUUID(),
          issuedAt: now - 500,
          expiresAt: now + 60000
        }
      }

      let grant = null
      if (grantPayload) {
        const sig = crypto.sign(null, Buffer.from(JSON.stringify(grantPayload)), operatorPrivateKey)
        grant = { payload: grantPayload, signature: sig.toString('base64url') }
      }

      const result = await controller.dispatchInstruction(parsed, {
        session: sessionBundle,
        grant,
        v1Batch: true
      })

      if (result.ok) {
        console.log(`${C.green}✔ Accion completada con exito:${C.reset} ${result.reason || 'ok'}`)
        reply(`Accion completada: ${result.reason || 'ok'}`)
      } else {
        console.log(`${C.yellow}⚠ Resultado de accion:${C.reset} ${result.reason || 'fallo'}`)
        reply(`Resultado: ${result.reason || 'fallo'}`)
      }
    } catch (err) {
      console.log(`${C.red}Error en instruccion: ${err.message}${C.reset}`)
      reply(`Error: ${err.message}`)
    }
  }

  function cleanup() {
    try { webServer?.close() } catch {}
    try { detachPairing?.() } catch {}
    try { witness?.close() } catch {}
    try { bot?.quit() } catch {}
    try { rl?.close() } catch {}
  }
}

// Direct execution entrypoint
if (require.main === module) {
  const cliArgs = parseCliArgs(process.argv.slice(2))
  startInteractiveCli(cliArgs).catch((err) => {
    console.error(`${C.red}Error fatal en GuiaIA: ${err.stack || err.message}${C.reset}`)
    process.exit(1)
  })
}

module.exports = {
  parseCliArgs,
  startInteractiveCli
}
