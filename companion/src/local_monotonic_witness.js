'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const MAX_LOG_SIZE = 16 * 1024 * 1024 // 16MB

function getWitnessStorageDir() {
  let baseDir
  if (process.platform === 'win32') {
    baseDir = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  } else {
    baseDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  }

  const witnessDir = path.join(baseDir, 'GuiaIA', 'witness')
  if (!fs.existsSync(witnessDir)) {
    fs.mkdirSync(witnessDir, { recursive: true, mode: 0o700 })
  }
  return witnessDir
}

function computeFingerprint(keyPem) {
  const pub = crypto.createPublicKey(keyPem)
  return crypto.createHash('sha256')
    .update(pub.export({ format: 'der', type: 'spki' }))
    .digest('hex')
}

/**
 * Creates a durable local monotonic witness backed by an append-only fsynced JSONL log.
 */
function createLocalMonotonicWitness({
  directory = null,
  worldId,
  operatorPublicKeyPem,
  witnessPrivateKey = null
} = {}) {
  if (!worldId || typeof worldId !== 'string') {
    throw new Error('Valid worldId required for monotonic witness')
  }
  if (!operatorPublicKeyPem || typeof operatorPublicKeyPem !== 'string') {
    throw new Error('Valid operatorPublicKeyPem required for monotonic witness')
  }

  const witnessDir = directory || getWitnessStorageDir()
  if (!fs.existsSync(witnessDir)) {
    fs.mkdirSync(witnessDir, { recursive: true, mode: 0o700 })
  }

  const operatorFingerprint = computeFingerprint(operatorPublicKeyPem)
  const operatorKey = crypto.createPublicKey(operatorPublicKeyPem)

  // Load or generate witness keypair
  let privKey = witnessPrivateKey
  const keyFile = path.join(witnessDir, 'witness_key.pem')
  if (!privKey) {
    if (fs.existsSync(keyFile)) {
      const pem = fs.readFileSync(keyFile, 'utf8')
      privKey = crypto.createPrivateKey(pem)
    } else {
      const pair = crypto.generateKeyPairSync('ed25519')
      privKey = pair.privateKey
      fs.writeFileSync(keyFile, privKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    }
  }

  const witnessPublicKey = crypto.createPublicKey(privKey)
  const witnessPublicKeyPem = witnessPublicKey.export({ type: 'spki', format: 'pem' })

  const logFile = path.join(witnessDir, 'witness.log')
  const headFile = path.join(witnessDir, 'head.json')
  const lockFile = path.join(witnessDir, 'witness.lock')

  // Acquire exclusive file lock
  let lockFd = null
  try {
    lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
  } catch (err) {
    throw new Error('Monotonic witness locked by concurrent process: ' + err.message)
  }

  let closed = false
  let currentHead = null

  function signEnvelope(headObj) {
    const data = Buffer.from(JSON.stringify(headObj))
    const sig = crypto.sign(null, data, privKey)
    return {
      head: headObj,
      signature: sig.toString('base64url')
    }
  }

  function verifyEnvelope(env) {
    if (!env || !env.head || typeof env.signature !== 'string') return false
    const data = Buffer.from(JSON.stringify(env.head))
    const sig = Buffer.from(env.signature, 'base64url')
    return crypto.verify(null, data, witnessPublicKey, sig)
  }

  // Load existing head or initialize genesis
  if (fs.existsSync(headFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(headFile, 'utf8'))
      if (!verifyEnvelope(raw)) {
        throw new Error('Corrupt or untrusted witness head signature')
      }
      if (raw.head.worldId !== worldId || raw.head.operatorFingerprint !== operatorFingerprint) {
        throw new Error('Witness head belongs to different world or operator')
      }
      currentHead = raw.head
    } catch (err) {
      fs.closeSync(lockFd)
      try { fs.unlinkSync(lockFile) } catch {}
      throw err
    }
  } else {
    // Genesis checkpoint (sequence: 0, genesis hash: 64 zeros)
    const genesisHash = '0'.repeat(64)
    currentHead = {
      version: 1,
      worldId,
      operatorFingerprint,
      sequence: 0,
      registrySha256: genesisHash
    }
    const env = signEnvelope(currentHead)
    // 1. Initial append to durable witness log with fsync
    const logFd = fs.openSync(logFile, 'a', 0o600)
    try {
      fs.writeSync(logFd, JSON.stringify({ type: 'genesis', ...currentHead, timestamp: Date.now() }) + '\n')
      fs.fsyncSync(logFd)
    } finally {
      fs.closeSync(logFd)
    }

    // 2. Initial atomic head write with tmp file + rename + fsync
    const tmpGenesisHead = path.join(witnessDir, '.head-' + crypto.randomUUID() + '.tmp')
    const headFd = fs.openSync(tmpGenesisHead, 'wx', 0o600)
    try {
      fs.writeSync(headFd, JSON.stringify(env, null, 2) + '\n')
      fs.fsyncSync(headFd)
      fs.closeSync(headFd)
      fs.renameSync(tmpGenesisHead, headFile)
      try {
        const dirFd = fs.openSync(witnessDir, 'r')
        try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
      } catch {}
    } finally {
      if (fs.existsSync(tmpGenesisHead)) {
        try { fs.unlinkSync(tmpGenesisHead) } catch {}
      }
    }
  }

  function advance(ticket) {
    if (closed) throw new Error('Witness is closed')
    if (!ticket || !ticket.payload || typeof ticket.signature !== 'string') {
      throw new Error('Signed checkpoint advance ticket required')
    }

    // Verify operator signature on advance ticket
    const p = ticket.payload
    const data = Buffer.from(JSON.stringify(p))
    const sig = Buffer.from(ticket.signature, 'base64url')
    if (!crypto.verify(null, data, operatorKey, sig)) {
      throw new Error('Advance ticket signature verification failed')
    }

    // Verify ticket invariants
    if (p.aud !== 'guiaia:checkpoint-advance:v1' ||
        p.worldId !== worldId ||
        p.operatorFingerprint !== operatorFingerprint ||
        !Number.isSafeInteger(p.sequence) ||
        p.sequence <= currentHead.sequence ||
        p.previousSequence !== currentHead.sequence ||
        p.previousSha256 !== currentHead.registrySha256 ||
        !/^[0-9a-f]{64}$/.test(p.registrySha256 || '')) {
      throw new Error('Monotonic advance invariants violated')
    }

    const now = Date.now()
    if (!Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt) ||
        p.issuedAt > now + 5000 || p.expiresAt < now) {
      throw new Error('Advance ticket outside valid time window')
    }

    // Prepare new head
    const newHead = {
      version: 1,
      worldId,
      operatorFingerprint,
      sequence: p.sequence,
      registrySha256: p.registrySha256
    }
    const env = signEnvelope(newHead)

    // 1. Append to durable witness log with fsync
    const logEntry = JSON.stringify({
      type: 'advance',
      sequence: newHead.sequence,
      previousSequence: currentHead.sequence,
      registrySha256: newHead.registrySha256,
      previousSha256: currentHead.registrySha256,
      nonce: p.nonce,
      timestamp: now
    }) + '\n'

    const logFd = fs.openSync(logFile, 'a', 0o600)
    try {
      fs.writeSync(logFd, logEntry)
      fs.fsyncSync(logFd)
    } finally {
      fs.closeSync(logFd)
    }

    // 2. Atomic head update with tmp file + rename + fsync
    const tmpHead = path.join(witnessDir, '.head-' + crypto.randomUUID() + '.tmp')
    const headFd = fs.openSync(tmpHead, 'wx', 0o600)
    try {
      fs.writeSync(headFd, JSON.stringify(env, null, 2) + '\n')
      fs.fsyncSync(headFd)
      fs.closeSync(headFd)
      fs.renameSync(tmpHead, headFile)
      try {
        const dirFd = fs.openSync(witnessDir, 'r')
        try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
      } catch {}
    } finally {
      if (fs.existsSync(tmpHead)) {
        try { fs.unlinkSync(tmpHead) } catch {}
      }
    }

    currentHead = newHead
    return Object.freeze({ ...env })
  }

  function getHead() {
    return Object.freeze({ ...currentHead })
  }

  function verifyMatch(checkpoint) {
    if (!checkpoint) return false
    return checkpoint.sequence === currentHead.sequence &&
           checkpoint.registrySha256 === currentHead.registrySha256 &&
           checkpoint.worldId === currentHead.worldId &&
           checkpoint.operatorFingerprint === currentHead.operatorFingerprint
  }

  function close() {
    if (closed) return
    closed = true
    if (lockFd !== null) {
      try { fs.closeSync(lockFd) } catch {}
      try { fs.unlinkSync(lockFile) } catch {}
      lockFd = null
    }
  }

  return Object.freeze({
    worldId,
    operatorFingerprint,
    witnessPublicKeyPem,
    getHead,
    advance,
    verifyMatch,
    close
  })
}

module.exports = {
  createLocalMonotonicWitness,
  getWitnessStorageDir
}
