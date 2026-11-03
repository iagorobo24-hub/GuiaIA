'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const schemaDir = path.resolve(__dirname, '../../schemas/v1')

test('V1.1 schemas: all schemas exist and parse as valid JSON', () => {
  const schemas = [
    'compound_mission_spec.json',
    'blueprint_spec.json',
    'pokemon_action_spec.json',
    'web_telemetry_event.json'
  ]

  for (const name of schemas) {
    const file = path.join(schemaDir, name)
    assert.ok(fs.existsSync(file), `Schema file ${name} should exist`)
    const content = fs.readFileSync(file, 'utf8')
    const parsed = JSON.parse(content)
    assert.equal(typeof parsed, 'object')
    assert.equal(parsed.type, 'object')
    assert.ok(parsed.$id)
    assert.ok(parsed.title)
  }
})

test('V1.1 schemas: compound mission spec enforces max 10 steps and valid kinds', () => {
  const file = path.join(schemaDir, 'compound_mission_spec.json')
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(schema.properties.maxSteps.maximum, 10)
  assert.equal(schema.properties.steps.maxItems, 10)
  const kinds = schema.properties.steps.items.properties.kind.enum
  assert.deepEqual(kinds, ['gather', 'craft', 'smelt', 'place', 'deposit'])
})

test('V1.1 schemas: blueprint spec bounds dimensions to 16 and maxBlocks to 64', () => {
  const file = path.join(schemaDir, 'blueprint_spec.json')
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'))
  const dim = schema.properties.dimensions.properties
  assert.equal(dim.width.maximum, 16)
  assert.equal(dim.height.maximum, 16)
  assert.equal(dim.length.maximum, 16)
  assert.equal(schema.properties.maxBlocks.maximum, 64)
  assert.equal(schema.properties.blocks.maxItems, 64)
})

test('V1.1 schemas: pokemon action spec bounds consumables to max 5 and validates kinds', () => {
  const file = path.join(schemaDir, 'pokemon_action_spec.json')
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(schema.properties.maxConsumables.maximum, 5)
  const kinds = schema.properties.kind.enum
  assert.ok(kinds.includes('capture'))
  assert.ok(kinds.includes('battle_wild'))
  assert.ok(kinds.includes('pc_query'))
  assert.ok(kinds.includes('inspect'))
})

test('V1.1 schemas: web telemetry event spec enforces required fields', () => {
  const file = path.join(schemaDir, 'web_telemetry_event.json')
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'))
  const req = schema.required
  assert.ok(req.includes('timestamp'))
  assert.ok(req.includes('botStatus'))
  assert.ok(req.includes('operator'))
  assert.ok(req.includes('witnessStatus'))
})
