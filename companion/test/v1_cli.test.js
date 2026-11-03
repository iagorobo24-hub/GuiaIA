'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')

const { parseCliArgs } = require('../src/cli_v1')

describe('V1 Unified Interactive CLI (TASK-6.1)', () => {
  test('parseCliArgs returns defaults when no flags passed', () => {
    const opts = parseCliArgs([])
    assert.equal(opts.host, '127.0.0.1')
    assert.equal(opts.port, 25565)
    assert.equal(opts.username, 'GuiaBot')
    assert.equal(opts.auth, 'offline')
    assert.equal(opts.v1Batch, true)
    assert.equal(opts.identityMode, 'vanilla_paired_operator')
  })

  test('parseCliArgs parses custom parameters accurately', () => {
    const opts = parseCliArgs([
      '--host', 'minecraft.local',
      '--port', '25590',
      '--username', 'CompanionPro',
      '--auth', 'microsoft',
      '--owner', 'SteveMaster',
      '--mode', 'trusted_server_bridge_lab'
    ])

    assert.equal(opts.host, 'minecraft.local')
    assert.equal(opts.port, 25590)
    assert.equal(opts.username, 'CompanionPro')
    assert.equal(opts.auth, 'microsoft')
    assert.equal(opts.owner, 'SteveMaster')
    assert.equal(opts.identityMode, 'trusted_server_bridge_lab')
  })

  test('companion/src/cli_v1 exports startInteractiveCli function', () => {
    const cli = require('../src/cli_v1')
    assert.equal(typeof cli.startInteractiveCli, 'function')
    assert.equal(typeof cli.parseCliArgs, 'function')
  })
})
