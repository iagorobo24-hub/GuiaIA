'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const {EventEmitter}=require('node:events')
const {randomUUID}=require('node:crypto')
const {createQaChestDeposit,openDepositJournal,chestCount}=require('../src/deposit')

const chest={x:4,y:64,z:3}
const plan={sandboxOnly:true,ownerName:'OwnerQA',chest,items:[
  {name:'oak_log',count:1},{name:'birch_log',count:1}
]}
function dir(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-deposit-unit-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  return path.join(root,'ledger')
}
function fixture({resource='oak_log',amount=1,owner=true,health=20,
                  chestType='chest',transfer='success',reach=2}={}){
  const bot=new EventEmitter()
  let player=amount
  const window={inventoryStart:27,inventoryEnd:63,slots:Array(63).fill(null),
    close(){this.closed=true},
    async deposit(_type,_meta,count){
      if(transfer==='throws')throw Error('simulated_chest_rejection')
      if(transfer==='partial'){
        player=Math.max(0,player-count)
        window.slots[27]=null
        return
      }
      player-=count
      window.slots[27]=player>0?{name:resource,count:player}:null
      window.slots[0]={name:resource,count}
    }
  }
  window.slots[27]={name:resource,count:amount}
  bot.players=owner?{OwnerQA:{entity:{position:{x:0,y:64,z:2}}}}:{}
  bot.health=health
  bot.entity={position:{x:4-reach,y:64,z:3}}
  bot.blockAt=()=>({name:chestType})
  bot.openContainer=async()=>window
  bot.inventory={items:()=>player>0?[{name:resource,count:player}]:[]}
  bot.registry={itemsByName:{oak_log:{id:30},birch_log:{id:31}}}
  return {bot,window,get player(){return player}}
}
function action(f,resource='oak_log',count=1){
  return createQaChestDeposit(f.bot,{sandboxOnly:true,ownerName:'OwnerQA',
    chest,item:resource,count})
}
test('realistic chest slots: deposits one oak log with two independent inventory deltas',async()=>{
  const f=fixture()
  const r=await action(f).depositOne()
  assert.equal(r.ok,true)
  assert.equal(r.reason,'both_inventory_deltas_verified')
  assert.equal(r.playerBefore,1)
  assert.equal(r.playerAfter,0)
  assert.equal(r.chestBefore,0)
  assert.equal(r.chestAfter,1)
  assert.equal(f.window.closed,true)
})
test('deposit journal persists two different receipts with exclusive UUIDs',async t=>{
  const folder=dir(t)
  const journal=openDepositJournal(folder,plan)
  for(const name of ['oak_log','birch_log']){
    const f=fixture({resource:name})
    const result=await journal.runNext(action(f,name))
    assert.equal(result.ok,true)
  }
  const state=journal.view()
  assert.equal(state.phase,'completed')
  assert.deepEqual(state.receipts.map(r=>r.name),['oak_log','birch_log'])
  assert.equal(new Set(state.receipts.map(r=>r.operationId)).size,2)
  assert.equal(fs.statSync(folder).mode&0o777,0o700)
  assert.equal(fs.statSync(path.join(folder,'deposit.json')).mode&0o777,0o600)
  journal.close()
  const restored=openDepositJournal(folder)
  assert.equal(restored.view().phase,'completed')
  assert.equal((await restored.runNext({})).reason,'not_ready')
  restored.close()
})
test('rejects an unauthorized resource or unsafe plan before opening anything',t=>{
  const root=dir(t)
  assert.throws(()=>openDepositJournal(root,{...plan,items:[{name:'diamond',count:1}]}),/Unauthorized/)
  assert.throws(()=>openDepositJournal(root,{...plan,items:[{name:'oak_log',count:5}]}),/Unauthorized/)
  assert.throws(()=>openDepositJournal(root,{...plan,chest:{x:NaN,y:64,z:3}}),/Invalid/)
  assert.throws(()=>openDepositJournal(root,{...plan,ownerName:'bad;command'}),/Invalid/)
  assert.equal(fs.existsSync(path.join(root,'deposit.lock')),false)
})
test('wrong container type is denied without transfer',async()=>{
  const f=fixture({chestType:'barrel'})
  assert.equal((await action(f).depositOne()).reason,'chest_not_authorized')
  assert.equal(f.player,1)
})
test('owner absent, low health and distant chest reject without transfer',async()=>{
  for(const config of [{owner:false},{health:2},{reach:10}]){
    const f=fixture(config)
    const r=await action(f).depositOne()
    assert.equal(r.ok,false)
    assert.equal(r.transferAttempted,false)
    assert.equal(f.player,1)
  }
})
test('missing item in player inventory does not open container',async()=>{
  const f=fixture({amount:0})
  let opened=false
  f.bot.openContainer=async()=>{opened=true;return f.window}
  const r=await action(f).depositOne()
  assert.equal(r.reason,'insufficient_inventory')
  assert.equal(opened,false)
})
test('chest received an item but player inventory did not update: never acknowledge',async()=>{
  const f=fixture({transfer:'partial'})
  const r=await action(f).depositOne()
  assert.equal(r.ok,false)
  assert.equal(r.transferAttempted,true)
  assert.equal(r.reason,'unverified_inventory_transfer')
})
test('failed transfer stays needs_review, never deposits again after journal reopen',async t=>{
  const folder=dir(t)
  const j=openDepositJournal(folder,{...plan,items:[plan.items[0]]})
  const f=fixture({transfer:'throws'})
  const failure=await j.runNext(action(f))
  assert.equal(failure.ok,false)
  assert.equal(j.view().phase,'needs_review')
  assert.equal(j.view().receipts.length,0)
  j.close()
  const recovered=openDepositJournal(folder)
  assert.equal((await recovered.runNext(action(f))).reason,'not_ready')
  assert.equal(recovered.resume().ok,false)
  recovered.close()
})
test('preflight denied leaves paused and allows explicit operator-only retry',async t=>{
  const folder=dir(t)
  const j=openDepositJournal(folder,{...plan,items:[plan.items[0]]})
  const absent=fixture({owner:false})
  const result=await j.runNext(action(absent))
  assert.equal(result.ok,false)
  assert.equal(j.view().phase,'paused')
  assert.equal(j.resume().ok,true)
  assert.equal((await j.runNext(action(fixture()))).ok,true)
  j.close()
})
test('simulated crash after write-ahead transfer barrier requires manual review',async t=>{
  const folder=dir(t)
  const j=openDepositJournal(folder,{...plan,items:[plan.items[0]]})
  j.close()
  const file=path.join(folder,'deposit.json')
  const state=JSON.parse(fs.readFileSync(file))
  state.phase='transferring'
  state.operationId=randomUUID()
  fs.writeFileSync(file,JSON.stringify(state))
  const later=openDepositJournal(folder)
  assert.equal(later.view().phase,'needs_review')
  assert.equal(later.view().reason,'unknown_outcome_after_restart')
  assert.equal((await later.runNext(action(fixture()))).reason,'not_ready')
  later.close()
})
test('cancellation during transfer prevents late success receipt',async t=>{
  const folder=dir(t)
  const j=openDepositJournal(folder,{...plan,items:[plan.items[0]]})
  let resolve
  const transfer={sandboxOnly:true,ownerName:'OwnerQA',chest,item:'oak_log',count:1,
    depositOne:()=>new Promise(r=>{resolve=r}),cancel(){this.cancelled=true}}
  const pending=j.runNext(transfer)
  assert.equal(j.view().phase,'transferring')
  assert.throws(()=>j.close(),/during transfer/)
  j.stop()
  assert.equal(transfer.cancelled,true)
  resolve({ok:true,reason:'both_inventory_deltas_verified',name:'oak_log',count:1,
    chest,transferAttempted:true,playerBefore:1,playerAfter:0,chestBefore:0,chestAfter:1})
  assert.equal((await pending).reason,'interrupted')
  assert.equal(j.view().receipts.length,0)
  j.close()
})
test('mismatched chest, resource or amount is rejected before dispatch',async t=>{
  const j=openDepositJournal(dir(t),{...plan,items:[plan.items[0]]})
  const correct=action(fixture())
  for(const fake of [
    {...correct,chest:{x:6,y:64,z:3}},
    {...correct,item:'birch_log'},
    {...correct,count:2}
  ]){
    await assert.rejects(j.runNext(fake),/does not match/)
    assert.equal(j.view().phase,'ready')
  }
  j.close()
})
test('tampered two-sided receipt cannot survive reopening',async t=>{
  const folder=dir(t)
  const j=openDepositJournal(folder,{...plan,items:[plan.items[0]]})
  assert.equal((await j.runNext(action(fixture()))).ok,true)
  j.close()
  const file=path.join(folder,'deposit.json')
  const state=JSON.parse(fs.readFileSync(file))
  state.receipts[0].chestAfter=999
  fs.writeFileSync(file,JSON.stringify(state))
  assert.throws(()=>openDepositJournal(folder),/Invalid durable deposit receipt/)
  assert.equal(fs.existsSync(path.join(folder,'deposit.lock')),false)
})
test('exclusive active process lock and operator review for abandoned lock',t=>{
  const folder=dir(t)
  const j=openDepositJournal(folder,{...plan,items:[plan.items[0]]})
  assert.throws(()=>openDepositJournal(folder),/EEXIST/)
  j.close()
  fs.writeFileSync(path.join(folder,'deposit.lock'),'synthetic previous process')
  assert.throws(()=>openDepositJournal(folder),/EEXIST/)
})
test('container slots must expose a bounded chest inventory',()=>{
  assert.equal(chestCount({inventoryStart:100,slots:[]},'oak_log'),null)
  assert.equal(chestCount({inventoryStart:27,slots:Array(27).fill(null)},'oak_log'),0)
})
