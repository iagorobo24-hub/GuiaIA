'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { verifySessionBundle } = require('../src/session_identity')
const { createSecureCompanionController } = require('../src/secure_companion_controller')

function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' })
  }
}

function signPayload(payload, privateKeyPem) {
  const privateKey = crypto.createPrivateKey(privateKeyPem)
  const data = Buffer.from(JSON.stringify(payload))
  const signature = crypto.sign(null, data, privateKey).toString('base64url')
  return { payload, signature }
}

test('Vanilla paired operator: authorizes valid owner session without server bridge', () => {
  const ownerKeys = generateKeyPair()
  const worldId = 'vanilla:local:25565'
  const principalId = 'owner_principal_1'
  const now = Date.now()

  const authority = {
    sandboxOnly: true,
    identityMode: 'vanilla_paired_operator',
    worldId,
    botName: 'GuiaIA_Bot',
    ownerName: 'PlayerOne',
    trustedPrincipals: {
      [principalId]: ownerKeys.publicPem
    },
    isRevoked: () => false
  }

  const ownerPayload = {
    aud: 'guiaia:vanilla-paired-session:v1',
    worldId,
    connectionId: crypto.randomUUID(),
    principalId,
    challenge: crypto.randomBytes(24).toString('hex'),
    username: 'PlayerOne',
    issuedAt: now,
    expiresAt: now + 60000
  }

  const bundle = {
    owner: signPayload(ownerPayload, ownerKeys.privatePem)
  }

  const session = verifySessionBundle(bundle, authority)
  assert.equal(session.worldId, worldId)
  assert.equal(session.principalId, principalId)
  assert.equal(session.username, 'PlayerOne')
})

test('Vanilla paired operator: rejects revoked owner session', () => {
  const ownerKeys = generateKeyPair()
  const worldId = 'vanilla:local:25565'
  const principalId = 'owner_principal_revoked'
  const now = Date.now()

  const authority = {
    sandboxOnly: true,
    identityMode: 'vanilla_paired_operator',
    worldId,
    botName: 'GuiaIA_Bot',
    ownerName: 'PlayerRevoked',
    trustedPrincipals: {
      [principalId]: ownerKeys.publicPem
    },
    isRevoked: (pid) => pid === principalId
  }

  const ownerPayload = {
    aud: 'guiaia:vanilla-paired-session:v1',
    worldId,
    connectionId: crypto.randomUUID(),
    principalId,
    challenge: crypto.randomBytes(24).toString('hex'),
    username: 'PlayerRevoked',
    issuedAt: now,
    expiresAt: now + 60000
  }

  const bundle = {
    owner: signPayload(ownerPayload, ownerKeys.privatePem)
  }

  assert.throws(() => {
    verifySessionBundle(bundle, authority)
  }, /revoked/)
})

test('Vanilla paired operator: controller initializes cleanly under vanilla_paired_operator mode', () => {
  const mockBot = {
    username: 'GuiaIA_Bot',
    on: () => {},
    inventory: { items: () => [] }
  }

  const authority = {
    sandboxOnly: true,
    identityMode: 'vanilla_paired_operator',
    worldId: 'vanilla:local',
    botName: 'GuiaIA_Bot',
    ownerName: 'OwnerPlayer',
    trustedPrincipals: {},
    isRevoked: () => false
  }

  const controller = createSecureCompanionController({
    bot: mockBot,
    authority,
    classes: {}
  })

  assert.equal(typeof controller.dispatchInstruction, 'function')
  assert.equal(typeof controller.emergencyStop, 'function')
  const status = controller.status()
  assert.equal(status.mode, 'idle')
})
