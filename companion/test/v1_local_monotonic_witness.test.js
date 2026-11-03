'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const { createLocalMonotonicWitness } = require('../src/local_monotonic_witness')

describe('V1 Durable Local Monotonic Witness (TASK-5.1)', () => {
  const worldId = 'vanilla:local:25565'
  const operatorPair = crypto.generateKeyPairSync('ed25519')
  const operatorPublicKeyPem = operatorPair.publicKey.export({ type: 'spki', format: 'pem' })

  function createAdvanceTicket({ previousSequence, previousSha256, sequence, registrySha256, expired = false }) {
    const now = Date.now()
    const opFingerprint = crypto.createHash('sha256')
      .update(operatorPair.publicKey.export({ format: 'der', type: 'spki' }))
      .digest('hex')

    const payload = {
      aud: 'guiaia:checkpoint-advance:v1',
      worldId,
      operatorFingerprint: opFingerprint,
      previousSequence,
      previousSha256,
      sequence,
      registrySha256,
      nonce: crypto.randomUUID(),
      issuedAt: expired ? now - 100000 : now - 500,
      expiresAt: expired ? now - 50000 : now + 60000
    }

    const data = Buffer.from(JSON.stringify(payload))
    const sig = crypto.sign(null, data, operatorPair.privateKey)
    return {
      payload,
      signature: sig.toString('base64url')
    }
  }

  test('genesis initializes durable log, head file and valid signature', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-witness-test-'))
    const witness = createLocalMonotonicWitness({
      directory: tmpDir,
      worldId,
      operatorPublicKeyPem
    })

    const head = witness.getHead()
    assert.equal(head.sequence, 0)
    assert.equal(head.worldId, worldId)
    assert.equal(head.registrySha256, '0'.repeat(64))

    assert.ok(fs.existsSync(path.join(tmpDir, 'head.json')))
    assert.ok(fs.existsSync(path.join(tmpDir, 'witness.log')))

    witness.close()
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  test('advances sequence monotonically with signed tickets and appends to log', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-witness-test-'))
    const witness = createLocalMonotonicWitness({
      directory: tmpDir,
      worldId,
      operatorPublicKeyPem
    })

    const hash1 = crypto.createHash('sha256').update('checkpoint-1').digest('hex')
    const ticket1 = createAdvanceTicket({
      previousSequence: 0,
      previousSha256: '0'.repeat(64),
      sequence: 1,
      registrySha256: hash1
    })

    const res1 = witness.advance(ticket1)
    assert.equal(res1.head.sequence, 1)
    assert.equal(res1.head.registrySha256, hash1)
    assert.equal(witness.getHead().sequence, 1)

    // Advance to sequence 2
    const hash2 = crypto.createHash('sha256').update('checkpoint-2').digest('hex')
    const ticket2 = createAdvanceTicket({
      previousSequence: 1,
      previousSha256: hash1,
      sequence: 2,
      registrySha256: hash2
    })

    const res2 = witness.advance(ticket2)
    assert.equal(res2.head.sequence, 2)
    assert.equal(res2.head.registrySha256, hash2)

    // Verify log content
    const logContent = fs.readFileSync(path.join(tmpDir, 'witness.log'), 'utf8')
    const lines = logContent.trim().split('\n')
    assert.equal(lines.length, 3) // genesis + 2 advances

    // verifyMatch
    assert.equal(witness.verifyMatch(res2.head), true)
    assert.equal(witness.verifyMatch(res1.head), false) // stale sequence

    witness.close()

    // Reload from disk
    const reloaded = createLocalMonotonicWitness({
      directory: tmpDir,
      worldId,
      operatorPublicKeyPem
    })
    assert.equal(reloaded.getHead().sequence, 2)
    assert.equal(reloaded.getHead().registrySha256, hash2)
    reloaded.close()

    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  test('rejects sequence regression (sequence <= currentSequence)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-witness-test-'))
    const witness = createLocalMonotonicWitness({
      directory: tmpDir,
      worldId,
      operatorPublicKeyPem
    })

    const hash = crypto.createHash('sha256').update('c1').digest('hex')
    const badTicket = createAdvanceTicket({
      previousSequence: 0,
      previousSha256: '0'.repeat(64),
      sequence: 0, // regression!
      registrySha256: hash
    })

    assert.throws(() => {
      witness.advance(badTicket)
    }, /Monotonic advance invariants violated/)

    witness.close()
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  test('rejects previousSha256 hash chain mismatch', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-witness-test-'))
    const witness = createLocalMonotonicWitness({
      directory: tmpDir,
      worldId,
      operatorPublicKeyPem
    })

    const hash = crypto.createHash('sha256').update('c1').digest('hex')
    const badTicket = createAdvanceTicket({
      previousSequence: 0,
      previousSha256: 'f'.repeat(64), // doesn't match current head!
      sequence: 1,
      registrySha256: hash
    })

    assert.throws(() => {
      witness.advance(badTicket)
    }, /Monotonic advance invariants violated/)

    witness.close()
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  test('rejects expired ticket', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guiaia-witness-test-'))
    const witness = createLocalMonotonicWitness({
      directory: tmpDir,
      worldId,
      operatorPublicKeyPem
    })

    const hash = crypto.createHash('sha256').update('c1').digest('hex')
    const expiredTicket = createAdvanceTicket({
      previousSequence: 0,
      previousSha256: '0'.repeat(64),
      sequence: 1,
      registrySha256: hash,
      expired: true
    })

    assert.throws(() => {
      witness.advance(expiredTicket)
    }, /Advance ticket outside valid time window/)

    witness.close()
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })
})
