'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {openMission}=require('../src/mission')

const points=[{x:3,y:64,z:2},{x:5,y:64,z:2}]
const spec={sandboxOnly:true,ownerName:'OwnerQA',targets:points}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-mission-unit-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  return path.join(root,'journal')
}
function adapter(index=0,behavior=async()=>({ok:true,reason:'verified_inventory_drop',inventory_delta:1,dig_attempted:true})){
  return {sandboxOnly:true,ownerName:'OwnerQA',target:points[index],gatherOne:behavior,cancel(){}}
}
test('two acknowledged oak steps complete with separate durable receipts',async t=>{
  const dir=fixture(t)
  const m=openMission(dir,spec)
  assert.equal(m.view().phase,'ready')
  assert.equal((await m.runNext(adapter(0))).ok,true)
  assert.equal(m.view().phase,'ready')
  assert.equal(m.view().index,1)
  assert.equal((await m.runNext(adapter(1))).ok,true)
  assert.equal(m.view().phase,'completed')
  assert.equal(m.view().receipts.length,2)
  assert.equal(new Set(m.view().receipts.map(x=>x.operationId)).size,2)
  assert.equal((await m.runNext(adapter(1))).reason,'mission_not_ready')
  const data=JSON.parse(fs.readFileSync(path.join(dir,'mission.json')))
  assert.equal(data.index,2)
  if(process.platform!=='win32'){assert.equal(fs.statSync(dir).mode & 0o777,0o700)
  assert.equal(fs.statSync(path.join(dir,'mission.json')).mode & 0o777,0o600)}
  m.close()
  const reopened=openMission(dir)
  assert.equal(reopened.view().phase,'completed')
  assert.equal(reopened.view().receipts.length,2)
  reopened.close()
})
test('unsafe or mismatched step never dispatched',async t=>{
  const m=openMission(fixture(t),spec)
  let calls=0
  assert.rejects(m.runNext(adapter(1,async()=>{calls++; return {}})),/does not match/)
  assert.equal(calls,0)
  assert.equal(m.view().phase,'ready')
  assert.equal(m.view().index,0)
  m.close()
})
test('missing owner and early fail: pause and explicit safe resume',async t=>{
  const m=openMission(fixture(t),spec)
  const failure=adapter(0,async()=>({ok:false,reason:'owner_not_visible',dig_attempted:false}))
  assert.equal((await m.runNext(failure)).ok,false)
  assert.equal(m.view().phase,'paused')
  assert.equal(m.resume().ok,true)
  assert.equal((await m.runNext(adapter(0))).ok,true)
  m.close()
})
test('attempted but unverified mining cannot replay, even on restart',async t=>{
  const dir=fixture(t)
  const m=openMission(dir,spec)
  const result=await m.runNext(adapter(0,async()=>({ok:false,reason:'item_not_verified',dig_attempted:true})))
  assert.equal(result.ok,false)
  assert.equal(m.view().phase,'needs_review')
  assert.equal(m.view().receipts.length,0)
  assert.equal(m.resume().ok,false)
  assert.equal((await m.runNext(adapter(0))).ok,false)
  m.close()
  const later=openMission(dir)
  assert.equal(later.view().phase,'needs_review')
  assert.equal((await later.runNext(adapter(0))).reason,'mission_not_ready')
  later.close()
})
test('crash after durable dispatch forbids replay on recovery',async t=>{
  const dir=fixture(t)
  const m=openMission(dir,spec)
  const file=path.join(dir,'mission.json')
  // Simulate an interrupted process at the exact durable dispatch barrier.
  const data=JSON.parse(fs.readFileSync(file,'utf8'))
  data.phase='dispatching'
  data.operationId='synthetic-unique-operation'
  fs.writeFileSync(file,JSON.stringify(data))
  m.close()
  const recovered=openMission(dir)
  assert.equal(recovered.view().phase,'needs_review')
  assert.equal(recovered.view().reason,'unverified_dispatch_after_restart')
  assert.equal(recovered.view().operationId,'synthetic-unique-operation')
  assert.equal(recovered.resume().ok,false)
  recovered.close()
})
test('concurrent instance and stale process lock fail closed',t=>{
  const dir=fixture(t)
  const m=openMission(dir,spec)
  assert.throws(()=>openMission(dir),/EEXIST/)
  m.close()
  fs.writeFileSync(path.join(dir,'mission.lock'),'previous-process')
  assert.throws(()=>openMission(dir),/EEXIST/)
  // Synthetic stale-lock clearance done only when the test owns the process.
  fs.unlinkSync(path.join(dir,'mission.lock'))
  const recovered=openMission(dir)
  assert.equal(recovered.view().phase,'ready')
  recovered.close()
})
test('stop while in-flight prevents a late successful receipt',async t=>{
  const m=openMission(fixture(t),spec)
  let release
  let cancellations=0
  const action=adapter(0,()=>new Promise(resolve=>{release=resolve}))
  action.cancel=()=>{cancellations++}
  const pending=m.runNext(action)
  assert.equal(m.view().phase,'dispatching')
  assert.throws(()=>m.close(),/while operation runs/)
  assert.equal(m.stop().phase,'needs_review')
  assert.equal(cancellations,1)
  release({ok:true,reason:'verified_inventory_drop',inventory_delta:1,dig_attempted:true})
  const done=await pending
  assert.equal(done.ok,false)
  assert.equal(m.view().receipts.length,0)
  assert.equal(m.view().index,0)
  m.close()
})
test('operator can cancel unattempted mission, never resume',async t=>{
  const m=openMission(fixture(t),spec)
  assert.equal(m.stop().phase,'cancelled')
  assert.equal(m.resume().ok,false)
  assert.equal((await m.runNext(adapter(0))).reason,'mission_not_ready')
  m.close()
})
test('tampered journal receipts or fake success are rejected',async t=>{
  const dir=fixture(t)
  const m=openMission(dir,spec)
  const fake=adapter(0,async()=>({ok:true,reason:'verified_inventory_drop',dig_attempted:false,inventory_delta:1}))
  assert.equal((await m.runNext(fake)).ok,false)
  assert.equal(m.view().phase,'needs_review')
  m.close()
  const file=path.join(dir,'mission.json')
  const data=JSON.parse(fs.readFileSync(file))
  data.phase='completed'
  fs.writeFileSync(file,JSON.stringify(data))
  assert.throws(()=>openMission(dir),/Unverified mission completion/)
  assert.equal(fs.existsSync(path.join(dir,'mission.lock')),false)
})
test('duplicate targets, arbitrary owner, overly long mission, symlinks denied',t=>{
  const dir=fixture(t)
  assert.throws(()=>openMission(dir,{...spec,targets:[points[0],points[0]]}),/Duplicate/)
  assert.throws(()=>openMission(dir,{...spec,ownerName:'bad;admin'}),/authorized/)
  assert.throws(()=>openMission(dir,{...spec,targets:Array(4).fill(points[0])}),/authorized/)
  const link=path.join(path.dirname(dir),'alias')
  fs.symlinkSync(dir,link)
  assert.throws(()=>openMission(link,spec),/symlink/)
})
