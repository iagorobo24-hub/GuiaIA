'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createQaGather, inventoryCount } = require('../src/gather')

const target = { x:3, y:64, z:2 }
function fakeBot({block='oak_log', owner=true, health=20, dist=1, drop=true} = {}) {
  const bot = new EventEmitter()
  let name = block
  let stored = 0
  const at = { x:2, y:64, z:2,
    floored() { return this },
    offset(x,y,z) {return { x:this.x+x,y:this.y+y,z:this.z+z }} }
  bot.entity = {position:at}
  bot.players = owner ? {OwnerQA: {entity:{position:{x:2+dist,y:64,z:2}}}} : {}
  bot.health = health
  bot.inventory = {items:()=> stored ? [{name:'oak_log',count:stored}] : []}
  bot.blockAt = p => (p.x===3 && p.y===64 && p.z===2)
    ? {name,position:target} : {name:'air'}
  bot.canDigBlock = () => true
  bot.dig = async () => { name='air'; if(drop) stored+=1 }
  bot.stopDigging = () => {}
  return bot
}
function creator(bot, extra={}) {
  return createQaGather(bot, {ownerName:'OwnerQA', target, sandboxOnly:true, ...extra})
}
test('QA only and explicit owner/coordinates are required', () => {
  const bot=fakeBot()
  assert.throws(()=>createQaGather(bot,{ownerName:'OwnerQA',target,sandboxOnly:false}))
  assert.throws(()=>createQaGather(bot,{ownerName:'owner;cmd',target,sandboxOnly:true}))
  assert.throws(()=>createQaGather(bot,{ownerName:'OwnerQA',target:{x:NaN,y:64,z:2},sandboxOnly:true}))
})
test('one allowlisted oak log produces verified inventory delta', async () => {
  const bot=fakeBot()
  const result=await creator(bot).gatherOne()
  assert.equal(result.ok,true)
  assert.equal(result.reason,'verified_inventory_drop')
  assert.equal(result.inventory_delta,1)
  assert.equal(result.dig_attempted,true)
})
test('unauthorized block is not dug',async()=>{
  const bot=fakeBot({block:'diamond_ore'})
  let called=false
  bot.dig=async()=>{called=true}
  const result=await creator(bot).gatherOne()
  assert.equal(result.reason,'block_not_allowlisted')
  assert.equal(called,false)
})
test('owner absence rejects mining',async()=>{
  const bot=fakeBot({owner:false})
  assert.equal((await creator(bot).gatherOne()).reason,'owner_not_visible')
})
test('low health blocks mining',async()=>{
  const bot=fakeBot({health:3})
  assert.equal((await creator(bot).gatherOne()).reason,'low_health')
})
test('out-of-range owner blocks mining',async()=>{
  const bot=fakeBot({dist:30})
  assert.equal((await creator(bot).gatherOne()).reason,'owner_out_of_range')
})
test('block must be within reach',async()=>{
  const bot=fakeBot()
  bot.entity.position.x=-80
  bot.players.OwnerQA.entity.position.x=-80
  assert.equal((await creator(bot).gatherOne()).reason,'block_out_of_reach')
})
test('inventory delta required; no unearned success',async()=>{
  const bot=fakeBot({drop:false})
  const result=await creator(bot,{pickupTimeoutMs:1}).gatherOne()
  assert.equal(result.ok,false)
  assert.equal(result.reason,'item_not_verified')
})
test('cancelled at disconnect cannot report successful mining', async()=>{
  const bot=fakeBot()
  bot.dig=async()=>{bot.emit('end')}
  const result=await creator(bot).gatherOne()
  assert.equal(result.ok,false)
  assert.equal(result.reason,'cancelled')
})
test('concurrent mining calls are rejected',async()=>{
  const bot=fakeBot()
  let release
  bot.dig=()=>new Promise(resolve=>{release=resolve})
  const worker=creator(bot)
  const promise=worker.gatherOne()
  assert.equal((await worker.gatherOne()).reason,'already_gathering')
  worker.cancel()
  release()
  assert.equal((await promise).reason,'cancelled')
})
test('owner disappears during a real dig: stopDigging and deny success',async()=>{
  const bot=fakeBot()
  let release
  let stopped=false
  bot.dig=()=>new Promise(resolve=>{release=resolve})
  bot.stopDigging=()=>{stopped=true}
  const gather=creator(bot)
  const active=gather.gatherOne()
  bot.players={}
  await new Promise(resolve=>setTimeout(resolve,320))
  release()
  const result=await active
  assert.equal(stopped,true)
  assert.equal(result.ok,false)
  assert.equal(result.reason,'cancelled')
})

test('inventory counting rejects malformed data',()=>{
  assert.equal(inventoryCount({inventory:{items:()=>[{name:'oak_log',count:2},{name:'oak_log',count:3}]}},'oak_log'),5)
  assert.equal(inventoryCount({},'oak_log'),null)
})
