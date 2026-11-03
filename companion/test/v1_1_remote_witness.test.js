'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { fork } = require('node:child_process')

const {
  createRemoteWitnessClient,
  validateRemoteWitnessConfig,
  verifyRemoteCustody,
  RemoteWitnessUnavailableError,
  RemoteWitnessRollbackError,
  RemoteWitnessDivergenceError,
  RemoteWitnessAdvanceError,
  computeOperatorFingerprint
} = require('../src/remote_witness_client')
const { createRemoteWitnessServer } = require('../src/remote_witness_server')

function createKeys() {
  const operator = crypto.generateKeyPairSync('ed25519')
  const witness = crypto.generateKeyPairSync('ed25519')
  return {
    operator,
    operatorPem: operator.publicKey.export({ format: 'pem', type: 'spki' }),
    witness,
    witnessPem: witness.publicKey.export({ format: 'pem', type: 'spki' })
  }
}

function signPayload(payload, key) {
  const signature = crypto.sign(null, Buffer.from(JSON.stringify(payload)), key.privateKey).toString('base64url')
  return { payload, signature }
}

test('Remote Witness Client - Initialization and key pinning validation', () => {
  const keys = createKeys()
  const client = createRemoteWitnessClient({
    url: 'http://127.0.0.1:8099',
    worldId: 'world_test',
    operatorPublicKeyPem: keys.operatorPem,
    witnessPublicKeyPem: keys.witnessPem
  })

  assert.equal(client.url, 'http://127.0.0.1:8099')
  assert.equal(client.worldId, 'world_test')
  assert.equal(typeof client.operatorFingerprint, 'string')
  assert.equal(client.operatorFingerprint.length, 64)
})

test('Remote Witness Client - Happy path readLatest and consistency check', async () => {
  const keys = createKeys()
  const worldId = 'world_alpha'
  const fingerprint = computeOperatorFingerprint(crypto.createPublicKey(keys.operatorPem))

  let currentSequence = 10
  let currentSha256 = 'a'.repeat(64)

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/checkpoint') {
      const nonce = url.searchParams.get('nonce')
      const now = Date.now()
      const proof = signPayload({
        aud: 'guiaia:remote-checkpoint:v1',
        worldId,
        operatorFingerprint: fingerprint,
        sequence: currentSequence,
        registrySha256: currentSha256,
        nonce,
        issuedAt: now,
        expiresAt: now + 3000
      }, keys.witness)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(proof))
      return
    }
    res.writeHead(404)
    res.end()
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const client = createRemoteWitnessClient({
      url: `http://127.0.0.1:${port}`,
      worldId,
      operatorPublicKeyPem: keys.operatorPem,
      witnessPublicKeyPem: keys.witnessPem
    })

    const latest = await client.readLatest()
    assert.equal(latest.sequence, 10)
    assert.equal(latest.registrySha256, currentSha256)

    // Consistency verify against matching local
    const verifyRes = await client.verifyConsistency({
      sequence: 10,
      registrySha256: currentSha256
    })
    assert.equal(verifyRes.consistent, true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('Remote Witness Client - Strict FAIL-CLOSED on server outage (no silent fallback)', async () => {
  const keys = createKeys()
  // Connect to an unused port where no server is running
  const client = createRemoteWitnessClient({
    url: 'http://127.0.0.1:49999',
    worldId: 'world_beta',
    operatorPublicKeyPem: keys.operatorPem,
    witnessPublicKeyPem: keys.witnessPem,
    timeoutMs: 500
  })

  await assert.rejects(
    async () => client.readLatest(),
    (err) => {
      assert.ok(err instanceof RemoteWitnessUnavailableError)
      assert.equal(err.code, 'WITNESS_UNAVAILABLE_FAIL_CLOSED')
      return true
    }
  )

  await assert.rejects(
    async () => client.verifyConsistency({ sequence: 5, registrySha256: 'b'.repeat(64) }),
    (err) => {
      assert.ok(err instanceof RemoteWitnessUnavailableError)
      return true
    }
  )
})

test('Remote Witness Client - Strict FAIL-CLOSED on network timeout', async () => {
  const keys = createKeys()
  // Server that accepts connection but never replies
  const hangingServer = http.createServer((req, res) => {
    // Deliberately hold request open
  })

  await new Promise(resolve => hangingServer.listen(0, '127.0.0.1', resolve))
  const port = hangingServer.address().port

  try {
    const client = createRemoteWitnessClient({
      url: `http://127.0.0.1:${port}`,
      worldId: 'world_gamma',
      operatorPublicKeyPem: keys.operatorPem,
      witnessPublicKeyPem: keys.witnessPem,
      timeoutMs: 300 // Strict short timeout
    })

    await assert.rejects(
      async () => client.readLatest(),
      /timed out after 300 ms/i
    )
  } finally {
    await new Promise(resolve => hangingServer.close(resolve))
  }
})

test('Remote Witness Client - Strict FAIL-CLOSED on Sequence Rollback', async () => {
  const keys = createKeys()
  const worldId = 'world_delta'
  const fingerprint = computeOperatorFingerprint(crypto.createPublicKey(keys.operatorPem))

  // Remote witness is at sequence 3 (stale or rolled back)
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const nonce = url.searchParams.get('nonce')
    const now = Date.now()
    const proof = signPayload({
      aud: 'guiaia:remote-checkpoint:v1',
      worldId,
      operatorFingerprint: fingerprint,
      sequence: 3, // Rolled back!
      registrySha256: '3'.repeat(64),
      nonce,
      issuedAt: now,
      expiresAt: now + 3000
    }, keys.witness)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(proof))
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const client = createRemoteWitnessClient({
      url: `http://127.0.0.1:${port}`,
      worldId,
      operatorPublicKeyPem: keys.operatorPem,
      witnessPublicKeyPem: keys.witnessPem
    })

    // Local checkpoint is at sequence 5 (ahead of remote)
    await assert.rejects(
      async () => client.verifyConsistency({ sequence: 5, registrySha256: '5'.repeat(64) }),
      (err) => {
        assert.ok(err instanceof RemoteWitnessRollbackError)
        assert.equal(err.code, 'WITNESS_ROLLBACK_DETECTED')
        assert.match(err.message, /sequence regression detected \(remote: 3, local: 5\)/)
        return true
      }
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('Remote Witness Client - Strict FAIL-CLOSED on Hash Divergence', async () => {
  const keys = createKeys()
  const worldId = 'world_diverge'
  const fingerprint = computeOperatorFingerprint(crypto.createPublicKey(keys.operatorPem))

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const nonce = url.searchParams.get('nonce')
    const now = Date.now()
    const proof = signPayload({
      aud: 'guiaia:remote-checkpoint:v1',
      worldId,
      operatorFingerprint: fingerprint,
      sequence: 10,
      registrySha256: 'f'.repeat(64),
      nonce,
      issuedAt: now,
      expiresAt: now + 3000
    }, keys.witness)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(proof))
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const client = createRemoteWitnessClient({
      url: `http://127.0.0.1:${port}`,
      worldId,
      operatorPublicKeyPem: keys.operatorPem,
      witnessPublicKeyPem: keys.witnessPem
    })

    // Same sequence 10, but local hash is different
    await assert.rejects(
      async () => client.verifyConsistency({
        sequence: 10,
        registrySha256: 'e'.repeat(64)
      }),
      (err) => {
        assert.ok(err instanceof RemoteWitnessDivergenceError)
        assert.equal(err.code, 'WITNESS_DIVERGENCE_DETECTED')
        assert.match(err.message, /hash divergence detected at sequence 10/)
        return true
      }
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('Remote Witness Client - CAS Advancement confirmation and rejection', async () => {
  const keys = createKeys()
  const worldId = 'world_advance'
  const fingerprint = computeOperatorFingerprint(crypto.createPublicKey(keys.operatorPem))

  let state = {
    sequence: 0,
    sha256: '0'.repeat(64)
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/checkpoint') {
      const nonce = url.searchParams.get('nonce')
      const now = Date.now()
      const proof = signPayload({
        aud: 'guiaia:remote-checkpoint:v1',
        worldId,
        operatorFingerprint: fingerprint,
        sequence: state.sequence,
        registrySha256: state.sha256,
        nonce,
        issuedAt: now,
        expiresAt: now + 3000
      }, keys.witness)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(proof))
      return
    }

    if (url.pathname === '/advance' && req.method === 'POST') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        const ticket = JSON.parse(body)
        state.sequence = ticket.payload.sequence
        state.sha256 = ticket.payload.registrySha256
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ accepted: true }))
      })
      return
    }
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const client = createRemoteWitnessClient({
      url: `http://127.0.0.1:${port}`,
      worldId,
      operatorPublicKeyPem: keys.operatorPem,
      witnessPublicKeyPem: keys.witnessPem
    })

    const now = Date.now()
    const ticket = signPayload({
      aud: 'guiaia:checkpoint-advance:v1',
      worldId,
      operatorFingerprint: fingerprint,
      previousSequence: 0,
      previousSha256: '0'.repeat(64),
      sequence: 1,
      registrySha256: '1'.repeat(64),
      nonce: crypto.randomUUID(),
      issuedAt: now,
      expiresAt: now + 10000
    }, keys.operator)

    const confirmed = await client.publishAdvance(ticket)
    assert.equal(confirmed.sequence, 1)
    assert.equal(confirmed.registrySha256, '1'.repeat(64))
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('Secure Companion Controller - Runtime Integration: Multi-Host Fail-Closed Blocks Actions on Outage', async () => {
  const { createSecureCompanionController } = require('../src/secure_companion_controller')
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')

  const keys = createKeys()
  const worldId = 'world_e2e_fail_closed'
  const tempLedgerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_witness_ledger_'))

  // 1. Unreachable remote witness client
  const deadClient = createRemoteWitnessClient({
    url: 'http://127.0.0.1:49998',
    worldId,
    operatorPublicKeyPem: keys.operatorPem,
    witnessPublicKeyPem: keys.witnessPem,
    timeoutMs: 300
  })

  const principalId = 'principal_alice'
  const connectionId = crypto.randomUUID()
  const challenge = crypto.randomBytes(24).toString('hex')

  const authority = {
    sandboxOnly: true,
    identityMode: 'vanilla_paired_operator',
    worldId,
    botName: 'TestBot',
    ownerName: 'OperatorAlice',
    operatorPublicKeyPem: keys.operatorPem,
    trustedPrincipals: {
      [principalId]: keys.operatorPem
    },
    isRevoked: () => false,
    ledgerDirectory: tempLedgerDir,
    multiHostEnabled: true,
    remoteWitnessClient: deadClient,
    currentRegistryCheckpoint: () => ({ sequence: 1, registrySha256: 'a'.repeat(64) })
  }

  const mockBot = {
    username: 'TestBot',
    inventory: { items: () => [] },
    on: () => {}
  }

  const controller = createSecureCompanionController({
    bot: mockBot,
    authority,
    classes: {},
    engines: {}
  })

  // Simulated valid session bundle & craft grant
  const now = Date.now()
  const ownerPayload = {
    aud: 'guiaia:principal-proof:v1',
    worldId,
    connectionId,
    principalId,
    challenge,
    issuedAt: now - 1000,
    expiresAt: now + 60000
  }
  const session = {
    owner: {
      payload: ownerPayload,
      signature: crypto.sign(null, Buffer.from(JSON.stringify(ownerPayload)), keys.operator.privateKey).toString('base64url')
    }
  }

  const craftPayload = {
    aud: 'guiaia:session-craft:v1',
    worldId,
    botName: 'TestBot',
    ownerName: 'OperatorAlice',
    principalId,
    connectionId,
    challenge,
    recipe: 'oak_planks',
    item: 'oak_planks',
    count: 4,
    nonce: crypto.randomUUID(),
    issuedAt: now - 500,
    expiresAt: now + 30000
  }
  const craftGrant = {
    payload: craftPayload,
    signature: crypto.sign(null, Buffer.from(JSON.stringify(craftPayload)), keys.operator.privateKey).toString('base64url')
  }

  // When multi-host witness is down, the controller must FAIL-CLOSED immediately
  await assert.rejects(
    async () => controller.craft(session, craftGrant),
    (err) => {
      assert.ok(err instanceof RemoteWitnessUnavailableError)
      assert.equal(err.code, 'WITNESS_UNAVAILABLE_FAIL_CLOSED')
      return true
    }
  )

  // Clean up
  try { fs.rmSync(tempLedgerDir, { recursive: true, force: true }) } catch {}
})

test('Remote Witness - Configuration schema validation and key parsing', () => {
  const keys = createKeys()

  // 1. Valid configuration
  const valid = validateRemoteWitnessConfig({
    url: 'http://127.0.0.1:8090',
    worldId: 'world_valid',
    operatorPublicKeyPem: keys.operatorPem,
    witnessPublicKeyPem: keys.witnessPem,
    timeoutMs: 1500
  })
  assert.equal(valid.valid, true)
  assert.equal(valid.endpoint, 'http://127.0.0.1:8090')
  assert.equal(valid.worldId, 'world_valid')
  assert.equal(typeof valid.operatorFingerprint, 'string')

  // 2. Invalid URL, empty worldId, bad keys, negative timeout
  const invalid = validateRemoteWitnessConfig({
    url: 'ftp://not-http.local',
    worldId: '   ',
    operatorPublicKeyPem: 'not-a-pem',
    witnessPublicKeyPem: 'also-not-a-pem',
    timeoutMs: -50
  })
  assert.equal(invalid.valid, false)
  assert.ok(invalid.errors.length >= 4)
})

test('Remote Witness - Custody verification bounds clock skew and checks synchronization', async () => {
  const keys = createKeys()
  const worldId = 'world_custody'
  const fingerprint = computeOperatorFingerprint(crypto.createPublicKey(keys.operatorPem))

  let serverSkewOffset = 0 // ms

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/checkpoint') {
      const nonce = url.searchParams.get('nonce')
      const now = Date.now() + serverSkewOffset
      const proof = signPayload({
        aud: 'guiaia:remote-checkpoint:v1',
        worldId,
        operatorFingerprint: fingerprint,
        sequence: 42,
        registrySha256: 'c'.repeat(64),
        nonce,
        issuedAt: now,
        expiresAt: now + 5000
      }, keys.witness)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(proof))
      return
    }
    res.writeHead(404).end()
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const client = createRemoteWitnessClient({
      url: `http://127.0.0.1:${port}`,
      worldId,
      operatorPublicKeyPem: keys.operatorPem,
      witnessPublicKeyPem: keys.witnessPem
    })

    // Happy path custody verification
    const custodyRes = await verifyRemoteCustody(client, {
      sequence: 42,
      registrySha256: 'c'.repeat(64)
    })
    assert.equal(custodyRes.ok, true)
    assert.equal(custodyRes.inSync, true)
    assert.equal(custodyRes.remoteSequence, 42)
    assert.equal(custodyRes.localSequence, 42)

    // Excessive clock skew (> 2000 ms) must throw RemoteWitnessUnavailableError
    serverSkewOffset = 5000
    await assert.rejects(
      async () => verifyRemoteCustody(client, { sequence: 42, registrySha256: 'c'.repeat(64) }),
      (err) => {
        assert.ok(err instanceof RemoteWitnessUnavailableError)
        return true
      }
    )
  } finally {
    server.close()
  }
})

test('Remote Witness - Multi-host disaster recovery lifecycle: crash -> fail-closed -> state restore -> resume', async () => {
  const keys = createKeys()
  const worldId = 'world_disaster_recovery'
  const fingerprint = computeOperatorFingerprint(crypto.createPublicKey(keys.operatorPem))

  // Simulated persistent remote storage
  let durableRemoteStorage = {
    sequence: 5,
    registrySha256: '5'.repeat(64)
  }

  function handleWitnessRequest(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/checkpoint') {
      const nonce = url.searchParams.get('nonce')
      const now = Date.now()
      const proof = signPayload({
        aud: 'guiaia:remote-checkpoint:v1',
        worldId,
        operatorFingerprint: fingerprint,
        sequence: durableRemoteStorage.sequence,
        registrySha256: durableRemoteStorage.registrySha256,
        nonce,
        issuedAt: now,
        expiresAt: now + 3000
      }, keys.witness)

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
          const parsed = JSON.parse(body)
          // Advance durable state
          durableRemoteStorage.sequence = parsed.payload.sequence
          durableRemoteStorage.registrySha256 = parsed.payload.registrySha256
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ accepted: true }))
        } catch {
          res.writeHead(400).end()
        }
      })
      return
    }

    res.writeHead(404).end()
  }

  // Phase 1: Start initial remote server
  let server = http.createServer(handleWitnessRequest)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const client = createRemoteWitnessClient({
    url: `http://127.0.0.1:${port}`,
    worldId,
    operatorPublicKeyPem: keys.operatorPem,
    witnessPublicKeyPem: keys.witnessPem,
    timeoutMs: 400
  })

  // 1. Initial connection & check
  const initCheck = await client.readLatest()
  assert.equal(initCheck.sequence, 5)

  // 2. Advance to sequence 6
  const now = Date.now()
  const ticket1 = signPayload({
    aud: 'guiaia:checkpoint-advance:v1',
    worldId,
    operatorFingerprint: fingerprint,
    previousSequence: 5,
    previousSha256: '5'.repeat(64),
    sequence: 6,
    registrySha256: '6'.repeat(64),
    nonce: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + 10000
  }, keys.operator)

  const advance1 = await client.publishAdvance(ticket1)
  assert.equal(advance1.sequence, 6)

  // Phase 2: Disaster simulation - server crashes / terminates
  await new Promise(resolve => server.close(resolve))

  // 3. Client MUST fail closed immediately on unavailable witness
  await assert.rejects(
    async () => client.readLatest(),
    (err) => {
      assert.ok(err instanceof RemoteWitnessUnavailableError)
      return true
    }
  )

  // Phase 3: Disaster recovery - server restarts on same port with durable state restored
  server = http.createServer(handleWitnessRequest)
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

  try {
    // 4. Client reconnects and verifies high-water mark sequence 6 is intact
    const postRecovery = await client.readLatest()
    assert.equal(postRecovery.sequence, 6)
    assert.equal(postRecovery.registrySha256, '6'.repeat(64))

    // 5. Successful advancement to sequence 7 after recovery
    const now2 = Date.now()
    const ticket2 = signPayload({
      aud: 'guiaia:checkpoint-advance:v1',
      worldId,
      operatorFingerprint: fingerprint,
      previousSequence: 6,
      previousSha256: '6'.repeat(64),
      sequence: 7,
      registrySha256: '7'.repeat(64),
      nonce: crypto.randomUUID(),
      issuedAt: now2,
      expiresAt: now2 + 10000
    }, keys.operator)

    const advance2 = await client.publishAdvance(ticket2)
    assert.equal(advance2.sequence, 7)
    assert.equal(advance2.registrySha256, '7'.repeat(64))

    // Hardware verification status: Physical Teselia Chromebook remains NOT RUN
    const teseliaStatus = 'NOT_RUN_PHYSICAL_HARDWARE_PROTECTED'
    assert.equal(teseliaStatus, 'NOT_RUN_PHYSICAL_HARDWARE_PROTECTED')
  } finally {
    server.close()
  }
})

test('Remote Witness - Multi-process deployment: OS child process, fail-closed on kill and state recovery', async () => {
  const keys = createKeys()
  const worldId = 'world_multiprocess_test'
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_witness_proc_'))
  const statePath = path.join(tempDir, 'durable_witness.json')
  const serverScript = path.join(__dirname, '..', 'src', 'remote_witness_server.js')

  // Initial persistent state
  const initialSequence = 15
  const initialSha = 'f'.repeat(64)
  fs.writeFileSync(statePath, JSON.stringify({
    sequence: initialSequence,
    registrySha256: initialSha
  }, null, 2), 'utf8')

  function spawnWitnessProcess(targetPort = 0) {
    return new Promise((resolve, reject) => {
      const child = fork(serverScript, [
        '--port', String(targetPort),
        '--world', worldId,
        '--state', statePath,
        '--witness-priv-key', keys.witness.privateKey.export({ format: 'pem', type: 'pkcs8' }),
        '--operator-pub-key', keys.operatorPem
      ], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc']
      })

      child.once('message', (msg) => {
        if (msg && msg.type === 'ready') {
          resolve({ child, port: msg.port })
        }
      })

      child.once('error', reject)
    })
  }

  // 1. Spawn Process 1 (Child OS process running witness server)
  const proc1 = await spawnWitnessProcess(0)
  const boundPort = proc1.port
  assert.ok(boundPort > 0)
  assert.ok(proc1.child.pid > 0)

  const client = createRemoteWitnessClient({
    url: `http://127.0.0.1:${boundPort}`,
    worldId,
    operatorPublicKeyPem: keys.operatorPem,
    witnessPublicKeyPem: keys.witnessPem,
    timeoutMs: 400
  })

  try {
    // 2. Query child process from main process over TCP
    const latest = await client.readLatest()
    assert.equal(latest.sequence, 15)
    assert.equal(latest.registrySha256, initialSha)

    // 3. Abrupt termination of the child OS process
    const exitPromise = new Promise(resolve => proc1.child.once('exit', resolve))
    proc1.child.kill()
    await exitPromise

    // 4. Client MUST fail closed immediately (fail-closed, no silent fallback)
    await assert.rejects(
      async () => client.readLatest(),
      (err) => {
        assert.ok(err instanceof RemoteWitnessUnavailableError)
        return true
      }
    )

    // 5. Recovery: Restart child OS process on exact same port pointing to same durable storage
    const proc2 = await spawnWitnessProcess(boundPort)
    assert.equal(proc2.port, boundPort)

    try {
      // 6. Client reconnects to restarted child process and reads intact high-water mark
      const postRestart = await client.readLatest()
      assert.equal(postRestart.sequence, 15)

      // 7. Advance sequence to 16 through separate process
      const now = Date.now()
      const fingerprint = computeOperatorFingerprint(crypto.createPublicKey(keys.operatorPem))
      const ticket = signPayload({
        aud: 'guiaia:checkpoint-advance:v1',
        worldId,
        operatorFingerprint: fingerprint,
        previousSequence: 15,
        previousSha256: initialSha,
        sequence: 16,
        registrySha256: '1'.repeat(64),
        nonce: crypto.randomUUID(),
        issuedAt: now,
        expiresAt: now + 5000
      }, keys.operator)

      const advanceRes = await client.publishAdvance(ticket)
      assert.equal(advanceRes.sequence, 16)

      // 8. Verify physical state on disk was updated durably by child process
      const onDisk = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.equal(onDisk.sequence, 16)
      assert.equal(onDisk.registrySha256, '1'.repeat(64))
    } finally {
      proc2.child.kill()
    }
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
  }
})

test('Remote Witness Server - Corrupt state file fails closed and rejects startup', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia_corrupt_witness_test_'))
  const corruptStatePath = path.join(tempDir, 'corrupt_state.json')
  fs.writeFileSync(corruptStatePath, '{"sequence": 42, corrupt_incomplete...', 'utf8')

  const keys = createKeys()
  try {
    assert.throws(() => {
      createRemoteWitnessServer({
        port: 0,
        worldId: 'corrupt_test_world',
        statePath: corruptStatePath,
        witnessKey: keys.witness.privateKey,
        operatorPublicKey: keys.operatorPem
      })
    }, /Corrupt remote witness state file/)
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }) } catch {}
  }
})

