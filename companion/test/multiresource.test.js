'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {EventEmitter}=require('node:events')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {createQaGather}=require('../src/gather')
const {openMission}=require('../src/mission')

const targets=[{x:3,y:64,z:2,block:'oak_log'},{x:9,y:64,z:2,block:'birch_log'}]
function newBot(target) {
  const bot=new EventEmitter()
  let block=target.block, position={x:2,y:64,z:2}, count=0, digs=0
  bot.entity={get position(){return position},set position(value){position=value}}
  bot.players={OwnerQA:{entity:{position:{x:2,y:64,z:5}}}}
  bot.health=20
  bot.inventory={items:()=>count?[{name:target.block,count}]:[]}
  bot.blockAt=p=>
    p.x===target.x&&p.y===target.y&&p.z===target.z?
      {name:block,position:{...target}}:{name:'air'}
  bot.canDigBlock=()=>true
  bot.dig=async()=>{digs++;block='air';count++}
  bot.stopDigging=()=>{}
  bot.pathfinder={setGoal(){}}
  return {bot, get digs(){return digs}, advance(){position={x:target.x-1,y:64,z:target.z}}}
}
function tempDir(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-typed-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  return path.join(root,'ledger')
}
function action(target,gather) {
  return {ownerName:'OwnerQA',sandboxOnly:true,target,block:target.block,
    gatherOne:()=>gather.gatherOne(),cancel:()=>gather.cancel()}
}
test('mixed oak and birch mission persists type-specific validated receipts',async t=>{
  const ledger=openMission(tempDir(t),{sandboxOnly:true,ownerName:'OwnerQA',targets})
  for(let i=0;i<2;i++){
    const {bot,advance}=newBot(targets[i])
    const gather=createQaGather(bot,{sandboxOnly:true,ownerName:'OwnerQA',
      target:targets[i],resource:targets[i].block,pickupTimeoutMs:1000,
      preDigApproach:async()=>advance()})
    const result=await ledger.runNext(action(targets[i],gather))
    assert.equal(result.ok,true)
  }
  assert.equal(ledger.view().phase,'completed')
  assert.deepEqual(ledger.view().receipts.map(r=>r.item),['oak_log','birch_log'])
  assert.deepEqual(ledger.view().receipts.map(r=>r.inventoryDelta),[1,1])
  ledger.close()
})
test('typed mission refuses an adapter for a different resource',async t=>{
  const dir=tempDir(t)
  const m=openMission(dir,{sandboxOnly:true,ownerName:'OwnerQA',targets:[targets[1]]})
  const {bot}=newBot(targets[1])
  const gather=createQaGather(bot,{sandboxOnly:true,ownerName:'OwnerQA',
    target:targets[1],resource:'oak_log'})
  await assert.rejects(m.runNext(action({...targets[1],block:'oak_log'},gather)),
    /does not match/)
  assert.equal(m.view().phase,'ready')
  m.close()
})
test('typed journal rejects cross-resource forged inventory receipt',async t=>{
  const dir=tempDir(t)
  const m=openMission(dir,{sandboxOnly:true,ownerName:'OwnerQA',targets:[targets[1]]})
  const fake={
    ...action(targets[1],{gatherOne:()=>({})}),
    gatherOne:async()=>({ok:true,reason:'verified_inventory_drop',item:'oak_log',
      block:'oak_log',inventory_delta:1,dig_attempted:true})
  }
  const result=await m.runNext(fake)
  assert.equal(result.ok,false)
  assert.equal(m.view().phase,'needs_review')
  m.close()
})
test('birch dig without permitted approach is denied while distant',async()=>{
  const {bot,digs}=newBot(targets[1])
  const gather=createQaGather(bot,{sandboxOnly:true,ownerName:'OwnerQA',
    target:targets[1],resource:'birch_log'})
  const result=await gather.gatherOne()
  assert.equal(result.reason,'block_out_of_reach')
  assert.equal(result.dig_attempted,false)
  assert.equal(digs,0)
})
test('navigation exceeding 10 blocks is denied before invoking callback',async()=>{
  const target={x:16,y:64,z:2,block:'birch_log'}
  const {bot}=newBot(target)
  let called=false
  const gather=createQaGather(bot,{sandboxOnly:true,ownerName:'OwnerQA',
    target,resource:'birch_log',preDigApproach:async()=>{called=true}})
  const result=await gather.gatherOne()
  assert.equal(result.ok,false)
  assert.equal(called,false)
})
test('navigation failure does not dig and mission only pauses safely',async t=>{
  const m=openMission(tempDir(t),{sandboxOnly:true,ownerName:'OwnerQA',
    targets:[targets[1]]})
  const {bot}=newBot(targets[1])
  let called=false
  bot.dig=async()=>{called=true}
  const gather=createQaGather(bot,{sandboxOnly:true,ownerName:'OwnerQA',
    target:targets[1],resource:'birch_log',
    preDigApproach:async()=>{throw Error('no_safe_path')}})
  const result=await m.runNext(action(targets[1],gather))
  assert.equal(result.ok,false)
  assert.equal(m.view().phase,'paused')
  assert.equal(called,false)
  m.close()
})
test('legacy oak-only mission journal remains accepted',async t=>{
  const m=openMission(tempDir(t),{sandboxOnly:true,ownerName:'OwnerQA',
    targets:[{x:3,y:64,z:2}]})
  const receipt=await m.runNext({ownerName:'OwnerQA',sandboxOnly:true,
    target:{x:3,y:64,z:2},gatherOne:async()=>({
      ok:true,reason:'verified_inventory_drop',dig_attempted:true,
      inventory_delta:1})})
  assert.equal(receipt.ok,true)
  assert.equal(receipt.state.receipts[0].item,'oak_log')
  m.close()
})
