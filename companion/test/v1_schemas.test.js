'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SCHEMA_DIR = path.resolve(__dirname, '../../schemas/v1')

test('V1 schemas: all schemas exist and parse as valid JSON', () => {
  const files = [
    'mission_spec.json',
    'mission_state.json',
    'deposit_plan.json',
    'action_grant.json'
  ]
  for (const file of files) {
    const fullPath = path.join(SCHEMA_DIR, file)
    assert.equal(fs.existsSync(fullPath), true, `Schema ${file} should exist`)
    const raw = fs.readFileSync(fullPath, 'utf8')
    const parsed = JSON.parse(raw)
    assert.equal(typeof parsed, 'object')
    assert.equal(parsed.type, 'object')
    assert.ok(parsed.$schema.includes('json-schema.org'))
  }
})

test('V1 schemas: mission spec allows 1 to 16 targets', () => {
  const raw = fs.readFileSync(path.join(SCHEMA_DIR, 'mission_spec.json'), 'utf8')
  const schema = JSON.parse(raw)
  assert.equal(schema.properties.targets.minItems, 1)
  assert.equal(schema.properties.targets.maxItems, 16)
})

test('V1 schemas: deposit plan allows 1 to 16 items', () => {
  const raw = fs.readFileSync(path.join(SCHEMA_DIR, 'deposit_plan.json'), 'utf8')
  const schema = JSON.parse(raw)
  assert.equal(schema.properties.items.minItems, 1)
  assert.equal(schema.properties.items.maxItems, 16)
})
