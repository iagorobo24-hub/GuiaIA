'use strict'

const crypto = require('node:crypto')
const http = require('node:http')
const https = require('node:https')

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX_SHA256 = /^[0-9a-f]{64}$/

const PROOF_FIELDS = ['aud', 'worldId', 'operatorFingerprint', 'sequence', 'registrySha256', 'nonce', 'issuedAt', 'expiresAt']
const TICKET_FIELDS = ['aud', 'worldId', 'operatorFingerprint', 'previousSequence', 'previousSha256', 'sequence', 'registrySha256', 'nonce', 'issuedAt', 'expiresAt']

class RemoteWitnessUnavailableError extends Error {
  constructor(message = 'Remote witness unavailable: fail closed (silent fallback strictly prohibited)') {
    super(message)
    this.name = 'RemoteWitnessUnavailableError'
    this.code = 'WITNESS_UNAVAILABLE_FAIL_CLOSED'
  }
}

class RemoteWitnessRollbackError extends Error {
  constructor(message = 'Remote witness sequence regression detected: fail closed') {
    super(message)
    this.name = 'RemoteWitnessRollbackError'
    this.code = 'WITNESS_ROLLBACK_DETECTED'
  }
}

class RemoteWitnessDivergenceError extends Error {
  constructor(message = 'Remote witness hash divergence detected: fail closed') {
    super(message)
    this.name = 'RemoteWitnessDivergenceError'
    this.code = 'WITNESS_DIVERGENCE_DETECTED'
  }
}

class RemoteWitnessAdvanceError extends Error {
  constructor(message = 'Witness advancement not confirmed by remote authority: fail closed') {
    super(message)
    this.name = 'RemoteWitnessAdvanceError'
    this.code = 'WITNESS_ADVANCE_FAILED'
  }
}

function exactMatch(obj, fields) {
  return obj !== null && typeof obj === 'object' &&
    Object.getPrototypeOf(obj) === Object.prototype &&
    Object.keys(obj).length === fields.length &&
    fields.every(k => Object.hasOwn(obj, k))
}

function parsePublicKey(pem, description = 'authority') {
  let key
  try {
    key = crypto.createPublicKey(pem)
  } catch (err) {
    throw new Error(`Invalid pinned ${description} public key: ${err.message}`)
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${description} requires Ed25519 key`)
  }
  return key
}

function computeOperatorFingerprint(key) {
  return crypto.createHash('sha256')
    .update(key.export({ format: 'der', type: 'spki' }))
    .digest('hex')
}

function verifySignedEnvelope(token, key, expectedAudience) {
  if (!exactMatch(token, ['payload', 'signature']) ||
      typeof token.signature !== 'string' ||
      !/^[A-Za-z0-9_-]{86}$/.test(token.signature)) {
    throw new Error('Invalid signed witness envelope format')
  }

  const sigBytes = Buffer.from(token.signature, 'base64url')
  if (sigBytes.length !== 64 ||
      !crypto.verify(null, Buffer.from(JSON.stringify(token.payload)), key, sigBytes)) {
    throw new Error('Untrusted witness cryptographic signature')
  }

  if (expectedAudience && token.payload?.aud !== expectedAudience) {
    throw new Error(`Mismatched witness envelope audience: expected ${expectedAudience}, got ${token.payload?.aud}`)
  }

  return token.payload
}

/**
 * Creates a robust, fail-closed remote witness client for multi-host deployments.
 *
 * @param {Object} config
 * @param {string} config.url Remote endpoint (e.g. 'http://127.0.0.1:8090' or 'https://...')
 * @param {string} config.worldId Canonical world identifier
 * @param {string} config.operatorPublicKeyPem Pinned operator public key PEM
 * @param {string} config.witnessPublicKeyPem Pinned remote witness public key PEM
 * @param {number} [config.timeoutMs=2000] Bounded network deadline (max 2000 ms)
 * @returns {Object} Remote witness client
 */
function createRemoteWitnessClient({
  url,
  worldId,
  operatorPublicKeyPem,
  witnessPublicKeyPem,
  timeoutMs = 2000
} = {}) {
  if (!url || typeof url !== 'string') {
    throw new Error('Remote witness requires explicit url')
  }
  if (!worldId || typeof worldId !== 'string') {
    throw new Error('Remote witness requires explicit worldId')
  }
  if (!operatorPublicKeyPem || !witnessPublicKeyPem) {
    throw new Error('Pinned operator and witness Ed25519 keys required')
  }

  const endpoint = new URL(url)
  const isHttps = endpoint.protocol === 'https:'
  const httpModule = isHttps ? https : http

  const operatorKey = parsePublicKey(operatorPublicKeyPem, 'operator')
  const witnessKey = parsePublicKey(witnessPublicKeyPem, 'witness')
  const operatorFingerprint = computeOperatorFingerprint(operatorKey)

  function executeRequest(method, route, bodyData = null) {
    return new Promise((resolve, reject) => {
      const rawBody = bodyData ? Buffer.from(JSON.stringify(bodyData)) : null

      const reqOptions = {
        hostname: endpoint.hostname,
        port: endpoint.port || (isHttps ? 443 : 80),
        method,
        path: route,
        headers: {
          'Host': endpoint.host,
          ...(rawBody ? {
            'Content-Type': 'application/json',
            'Content-Length': rawBody.length
          } : {})
        }
      }

      const req = httpModule.request(reqOptions, (res) => {
        let responseText = ''
        res.setEncoding('utf8')
        res.on('data', chunk => {
          responseText += chunk
          if (responseText.length > 8192) {
            req.destroy(new Error('Oversized witness response payload'))
          }
        })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new RemoteWitnessUnavailableError(`Witness rejected request with HTTP status ${res.statusCode}`))
          }
          try {
            resolve(JSON.parse(responseText))
          } catch (err) {
            reject(new RemoteWitnessUnavailableError('Malformed JSON in witness response'))
          }
        })
      })

      // Strict fail-closed deadline
      const deadlineTimer = setTimeout(() => {
        req.destroy(new RemoteWitnessUnavailableError(`Remote witness request timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      deadlineTimer.unref()

      req.once('close', () => clearTimeout(deadlineTimer))
      req.on('error', (err) => {
        if (err instanceof RemoteWitnessUnavailableError) {
          reject(err)
        } else {
          reject(new RemoteWitnessUnavailableError(`Remote witness connection failed: ${err.message}`))
        }
      })

      if (rawBody) req.write(rawBody)
      req.end()
    })
  }

  async function readLatest() {
    const nonce = crypto.randomUUID()
    const now = Date.now()

    let response
    try {
      response = await executeRequest('GET', `/checkpoint?nonce=${nonce}`)
    } catch (err) {
      // Re-throw strictly as fail-closed
      if (err instanceof RemoteWitnessUnavailableError) throw err
      throw new RemoteWitnessUnavailableError(err.message)
    }

    const payload = verifySignedEnvelope(response, witnessKey, 'guiaia:remote-checkpoint:v1')

    if (!exactMatch(payload, PROOF_FIELDS) ||
        payload.worldId !== worldId ||
        payload.operatorFingerprint !== operatorFingerprint ||
        payload.nonce !== nonce ||
        !Number.isSafeInteger(payload.sequence) || payload.sequence < 0 ||
        !HEX_SHA256.test(payload.registrySha256) ||
        !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) ||
        payload.issuedAt > now + 2000 || now - payload.issuedAt > 3000 || payload.expiresAt < now) {
      throw new RemoteWitnessUnavailableError('Mismatched, expired, or invalid witness checkpoint proof: fail closed')
    }

    return Object.freeze({
      version: 1,
      worldId,
      operatorFingerprint,
      sequence: payload.sequence,
      registrySha256: payload.registrySha256,
      issuedAt: payload.issuedAt
    })
  }

  async function verifyConsistency(localCheckpoint) {
    if (!localCheckpoint || typeof localCheckpoint !== 'object') {
      throw new Error('Valid local checkpoint object required for consistency verification')
    }

    const remote = await readLatest()

    // 1. Check sequence rollback
    if (remote.sequence < localCheckpoint.sequence) {
      throw new RemoteWitnessRollbackError(
        `Remote witness sequence regression detected (remote: ${remote.sequence}, local: ${localCheckpoint.sequence}): fail closed`
      )
    }

    // 2. Check hash divergence on matching sequence
    if (remote.sequence === localCheckpoint.sequence &&
        remote.registrySha256 !== localCheckpoint.registrySha256) {
      throw new RemoteWitnessDivergenceError(
        `Remote witness hash divergence detected at sequence ${remote.sequence} (remote: ${remote.registrySha256}, local: ${localCheckpoint.registrySha256}): fail closed`
      )
    }

    return Object.freeze({
      consistent: true,
      sequence: remote.sequence,
      registrySha256: remote.registrySha256
    })
  }

  async function publishAdvance(signedTicket) {
    if (!signedTicket) {
      throw new Error('Operator signed ticket required for advancement')
    }

    const ticketPayload = verifySignedEnvelope(signedTicket, operatorKey, 'guiaia:checkpoint-advance:v1')
    if (!exactMatch(ticketPayload, TICKET_FIELDS) ||
        ticketPayload.worldId !== worldId ||
        ticketPayload.operatorFingerprint !== operatorFingerprint ||
        !HEX_SHA256.test(ticketPayload.registrySha256)) {
      throw new Error('Malformed or scope-invalid operator advancement ticket')
    }

    const response = await executeRequest('POST', '/advance', signedTicket)
    if (response?.accepted !== true) {
      throw new RemoteWitnessAdvanceError('Witness rejected advancement ticket')
    }

    // Read back to confirm application
    const confirmed = await readLatest()
    if (confirmed.sequence !== ticketPayload.sequence ||
        confirmed.registrySha256 !== ticketPayload.registrySha256) {
      throw new RemoteWitnessAdvanceError(
        `Advancement confirmation mismatch (expected seq ${ticketPayload.sequence}, got ${confirmed.sequence}): fail closed`
      )
    }

    return confirmed
  }

  return Object.freeze({
    url,
    worldId,
    operatorFingerprint,
    readLatest,
    verifyConsistency,
    publishAdvance
  })
}

module.exports = {
  createRemoteWitnessClient,
  RemoteWitnessUnavailableError,
  RemoteWitnessRollbackError,
  RemoteWitnessDivergenceError,
  RemoteWitnessAdvanceError,
  computeOperatorFingerprint
}
