'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createController, finiteDistance } = require('../src/controller')

class GoalFollow { constructor(entity, distance) { this.entity = entity; this.distance = distance } }
class Movements { constructor() { this.canDig = true } }
function mockBot({ distance = 5, health = 20, ownerVisible = true } = {}) {
  const bot = new EventEmitter()
  bot.entity = { position: { x: 0, y: 64, z: 0 } }
  const ownerEntity = { position: { x: distance, y: 64, z: 0 } }
  bot.players = ownerVisible ? { OwnerQA: { entity: ownerEntity } } : {}
  bot.health = health
  bot.goals = []
  bot.pathfinder = {
    setMovements: (m) => { bot.moves = m },
    setGoal: (goal, dynamic) => bot.goals.push({ goal, dynamic })
  }
  bot.clearControlStates = () => { bot.controlsCleared = true }
  return { bot, ownerEntity }
}
function build(bot) {
  return createController(bot, { GoalFollow, Movements }, { ownerName: 'OwnerQA' })
}
test('follow only when owner visible, healthy and within bounded distance', () => {
  const { bot, ownerEntity } = mockBot()
  const c = build(bot)
  assert.equal(c.follow().ok, true)
  assert.equal(c.status().mode, 'following')
  assert.equal(bot.goals[0].goal.entity, ownerEntity)
  assert.equal(bot.goals[0].goal.distance, 2)
  assert.equal(bot.goals[0].dynamic, true)
})
test('movement cannot dig/build or perform hazardous shortcuts', () => {
  const { bot } = mockBot()
  build(bot)
  for (const key of ['canDig', 'canOpenDoors', 'allow1by1towers', 'allowFreeMotion', 'allowParkour', 'allowSprinting']) {
    assert.equal(bot.moves[key], false, key)
  }
})
test('owner absent -> fail closed, never starts walking', () => {
  const { bot } = mockBot({ ownerVisible: false })
  const c = build(bot)
  assert.equal(c.follow().ok, false)
  assert.equal(c.status().mode, 'idle')
  assert.equal(bot.goals.length, 0)
})
test('distant owner -> deny', () => {
  const { bot } = mockBot({ distance: 19 })
  assert.equal(build(bot).follow().reason, 'owner_out_of_range')
})
test('low or unknown health -> deny', () => {
  for (const health of [5, NaN, undefined]) {
    const { bot } = mockBot()
    bot.health = health
    assert.equal(build(bot).follow().ok, false)
  }
})
test('stop cancels goal and all control states', () => {
  const { bot } = mockBot()
  const c = build(bot)
  c.follow()
  const out = c.stop('operator_stop')
  assert.equal(out.mode, 'idle')
  assert.equal(bot.goals.at(-1).goal, null)
  assert.equal(bot.controlsCleared, true)
})
test('monitor aborts when owner disappears or exceeds range', () => {
  const { bot, ownerEntity } = mockBot()
  const c = build(bot)
  c.follow()
  ownerEntity.position.x = 100
  assert.equal(c.monitor().mode, 'idle')
  assert.equal(bot.goals.at(-1).goal, null)
  const again = mockBot()
  const d = build(again.bot)
  d.follow()
  again.bot.players = {}
  assert.equal(d.monitor().reason, 'owner_not_visible')
})
test('end, kicked and death trigger stop', () => {
  for (const event of ['end', 'kicked', 'death']) {
    const { bot } = mockBot()
    const c = build(bot)
    c.follow()
    bot.emit(event)
    assert.equal(c.status().mode, 'idle')
    assert.equal(bot.goals.at(-1).goal, null)
  }
})
test('unverified owner name rejected and never allowed to follow', () => {
  const { bot } = mockBot()
  assert.throws(() => createController(bot, { GoalFollow, Movements }, { ownerName: 'anyone;op' }))
  assert.throws(() => createController(bot, { GoalFollow, Movements }, { ownerName: '' }))
})
test('invalid/missing coordinates are treated as infinitely far', () => {
  assert.equal(finiteDistance({ x: 0, y: 2, z: 2 }, { x: NaN, y: 2, z: 2 }), Infinity)
  assert.equal(finiteDistance({}, null), Infinity)
})
