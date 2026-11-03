'use strict'

const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function computeOperatorFingerprint(key) {
  return crypto.createHash('sha256')
    .update(key.export({ format: 'der', type: 'spki' }))
    .digest('hex')
}

function createRemoteWitnessServer(options = {}) {
  const port = options.port !== undefined ? options.port : 8090
  const host = options.host || '127.0.0.1'
  const worldId = options.worldId || 'guiaia_default_world'
  const witnessKey = options.witnessKey
  const operatorPublicKey = options.operatorPublicKey

  let witnessPrivateKey = witnessKey?.privateKey || witnessKey
  if (typeof witnessPrivateKey === 'string') {
    witnessPrivateKey = crypto.createPrivateKey(witnessPrivateKey)
  }

  let operatorKey = operatorPublicKey
  if (typeof operatorKey === 'string') {
    operatorKey = crypto.createPublicKey(operatorKey)
  }
  const operatorFingerprint = operatorKey ? computeOperatorFingerprint(operatorKey) : null

  const statePath = options.statePath || null
  let state = {
    sequence: options.initialSequence !== undefined ? options.initialSequence : 0,
    registrySha256: options.initialSha256 || '0'.repeat(64)
  }

  // Load state from disk if exists
  if (statePath && fs.existsSync(statePath)) {
    try {
      const content = fs.readFileSync(statePath, 'utf8')
      const data = JSON.parse(content)
      if (
        data &&
        Number.isSafeInteger(data.sequence) &&
        data.sequence >= 0 &&
        typeof data.registrySha256 === 'string' &&
        /^[0-9a-f]{64}$/.test(data.registrySha256)
      ) {
        state.sequence = data.sequence
        state.registrySha256 = data.registrySha256
      } else {
        throw new Error('sequence and registrySha256 must be valid safe integer >= 0 and 64-char hex')
      }
    } catch (err) {
      throw new Error(`Corrupt remote witness state file at ${statePath}: ${err.message}`)
    }
  }

  function saveState() {
    if (!statePath) return
    const dir = path.dirname(statePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tmp = `${statePath}.${Date.now()}.tmp`
    const fd = fs.openSync(tmp, 'w')
    try {
      fs.writeSync(fd, JSON.stringify(state, null, 2), 0, 'utf8')
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(tmp, statePath)
    try {
      const dirFd = fs.openSync(dir, 'r')
      try {
        fs.fsyncSync(dirFd)
      } finally {
        fs.closeSync(dirFd)
      }
    } catch {}
  }

  const seenNonces = new Set()

  function signPayload(payload) {
    const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload)), witnessPrivateKey).toString('base64url')
    return { payload, signature }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

    if (url.pathname === '/checkpoint' && req.method === 'GET') {
      const nonce = url.searchParams.get('nonce')
      if (!nonce) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing nonce' }))
        return
      }

      const now = Date.now()
      const proof = signPayload({
        aud: 'guiaia:remote-checkpoint:v1',
        worldId,
        operatorFingerprint,
        sequence: state.sequence,
        registrySha256: state.registrySha256,
        nonce,
        issuedAt: now,
        expiresAt: now + 5000
      })

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(proof))
      return
    }

    if (url.pathname === '/advance' && req.method === 'POST') {
      let body = ''
      req.setEncoding('utf8')
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        try {
          const envelope = JSON.parse(body)
          if (!envelope || !envelope.payload || !envelope.signature) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Malformed advance envelope' }))
            return
          }

          const ticket = envelope.payload
          // Verify ticket audience
          if (ticket.aud !== 'guiaia:checkpoint-advance:v1') {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid audience' }))
            return
          }

          // Verify operator signature if operatorKey provided
          if (operatorKey) {
            const sigBytes = Buffer.from(envelope.signature, 'base64url')
            const verified = crypto.verify(null, Buffer.from(JSON.stringify(ticket)), operatorKey, sigBytes)
            if (!verified) {
              res.writeHead(401, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'Untrusted operator signature' }))
              return
            }
          }

          // Check monotonicity and sequence continuity
          if (ticket.previousSequence !== state.sequence || ticket.previousSha256 !== state.registrySha256) {
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'CAS mismatch: sequence or sha256 mismatch' }))
            return
          }

          if (ticket.sequence <= state.sequence) {
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Monotonicity violation: sequence must increase' }))
            return
          }

          if (seenNonces.has(ticket.nonce)) {
            res.writeHead(409, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Replay attack: nonce already used' }))
            return
          }
          seenNonces.add(ticket.nonce)

          // Advance state
          state.sequence = ticket.sequence
          state.registrySha256 = ticket.registrySha256
          saveState()

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ accepted: true, sequence: state.sequence }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  })

  const listenPromise = new Promise((resolve, reject) => {
    server.listen(port, host, () => resolve(server.address()))
    server.on('error', reject)
  })

  function close() {
    return new Promise(resolve => server.close(resolve))
  }

  return {
    server,
    listenPromise,
    close,
    getState: () => ({ ...state }),
    setState: (newState) => { Object.assign(state, newState); saveState() }
  }
}

// Standalone execution entrypoint (supports fork/spawn IPC)
if (require.main === module) {
  const args = process.argv.slice(2)
  let port = 0
  let host = '127.0.0.1'
  let worldId = 'guiaia_standalone_world'
  let statePath = null
  let witnessPrivKeyPem = null
  let operatorPubKeyPem = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10)
    else if (args[i] === '--host' && args[i + 1]) host = args[++i]
    else if (args[i] === '--world' && args[i + 1]) worldId = args[++i]
    else if (args[i] === '--state' && args[i + 1]) statePath = args[++i]
    else if (args[i] === '--witness-priv-key' && args[i + 1]) witnessPrivKeyPem = args[++i]
    else if (args[i] === '--operator-pub-key' && args[i + 1]) operatorPubKeyPem = args[++i]
  }

  if (!witnessPrivKeyPem && process.env.GUIAIA_WITNESS_PRIV_KEY) witnessPrivKeyPem = process.env.GUIAIA_WITNESS_PRIV_KEY
  if (!operatorPubKeyPem && process.env.GUIAIA_OPERATOR_PUB_KEY) operatorPubKeyPem = process.env.GUIAIA_OPERATOR_PUB_KEY

  if (!witnessPrivKeyPem) {
    const pair = crypto.generateKeyPairSync('ed25519')
    witnessPrivKeyPem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' })
  }

  const witnessServer = createRemoteWitnessServer({
    port,
    host,
    worldId,
    statePath,
    witnessKey: witnessPrivKeyPem,
    operatorPublicKey: operatorPubKeyPem
  })

  witnessServer.listenPromise.then(addr => {
    if (process.send) {
      process.send({ type: 'ready', port: addr.port, host: addr.address })
    }
  }).catch(err => {
    console.error('Remote witness server error:', err)
    process.exit(1)
  })
}

module.exports = {
  createRemoteWitnessServer
}
