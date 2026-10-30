'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {openDepositJournal}=require('../src/deposit')
const {readDepositJournalPassive,reconcileDepositSnapshot}=require('../src/recovery')
const items=[{name:'oak_log',count:1},{name:'birch_log',count:1}]
const chest={x:4,y:64,z:3}
const spec={sandboxOnly:true,ownerName:'OwnerQA',chest,items}
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-recovery-qa-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  return path.join(root,'ledger')
}
function observed(p={oak_log:0,birch_log:0},c={oak_log:1,birch_log:1}) {
  return {source:'live_minecraft_after_restart',ownerName:'OwnerQA',
    chest:{...chest},chestBlock:'chest',player:p,container:c}
}
function actual(item) {
  return {sandboxOnly:true,ownerName:'OwnerQA',chest,item:item.name,count:item.count,
    depositOne:async()=>({ok:true,reason:'both_inventory_deltas_verified',
      name:item.name,count:item.count,transferAttempted:true,chest,
      playerBefore:1,playerAfter:0,chestBefore:0,chestAfter:1})}
}
async function complete(t) {
  const directory=fixture(t),journal=openDepositJournal(directory,spec)
  for(const item of items)assert.equal((await journal.runNext(actual(item))).ok,true)
  journal.close()
  return directory
}
test('realistic persisted completed receipts verify both inventories without replay',async t=>{
  const directory=await complete(t)
  const before=fs.readFileSync(path.join(directory,'deposit.json'))
  const state=readDepositJournalPassive(directory)
  const checked=reconcileDepositSnapshot(state,observed())
  assert.equal(checked.ok,true)
  assert.equal(checked.status,'completed_inventory_verified')
  assert.equal(checked.canAutoReplay,false)
  assert.equal(checked.receiptCount,2)
  assert.deepEqual(fs.readFileSync(path.join(directory,'deposit.json')),before)
  assert.equal(fs.existsSync(path.join(directory,'deposit.lock')),false)
})
test('audit is passive even if crash left transferring operation',t=>{
  const directory=fixture(t),journal=openDepositJournal(directory,spec)
  journal.close()
  const filename=path.join(directory,'deposit.json')
  const state=JSON.parse(fs.readFileSync(filename))
  state.phase='transferring'
  state.operationId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
  fs.writeFileSync(filename,JSON.stringify(state))
  const exact=fs.readFileSync(filename)
  const phase=readDepositJournalPassive(directory)
  assert.equal(phase.phase,'transferring')
  const result=reconcileDepositSnapshot(phase,observed({oak_log:1,birch_log:1},{oak_log:0,birch_log:0}))
  assert.equal(result.status,'manual_review_required')
  assert.equal(result.canAutoReplay,false)
  assert.deepEqual(fs.readFileSync(filename),exact)
  assert.equal(fs.existsSync(path.join(directory,'deposit.lock')),false)
})
test('completed ledger but missing chest item is a hard mismatch',async t=>{
  const state=readDepositJournalPassive(await complete(t))
  const result=reconcileDepositSnapshot(state,observed(undefined,{oak_log:1,birch_log:0}))
  assert.equal(result.status,'inventory_mismatch')
  assert.deepEqual(result.discrepancies,['birch_log'])
  assert.equal(result.canAutoReplay,false)
})
test('completed ledger but player still has an item is a hard mismatch',async t=>{
  const state=readDepositJournalPassive(await complete(t))
  const result=reconcileDepositSnapshot(state,observed({oak_log:1,birch_log:0}))
  assert.equal(result.status,'inventory_mismatch')
  assert.deepEqual(result.discrepancies,['oak_log'])
})
test('forged owner, wrong chest, wrong block and stale source refuse',async t=>{
  const state=readDepositJournalPassive(await complete(t))
  for(const change of [
    {ownerName:'AnotherPlayer'},
    {chest:{x:40,y:64,z:3}},
    {chestBlock:'barrel'},
    {source:'from_test_mock'},
    {container:{oak_log:'1',birch_log:1}},
    {player:{oak_log:0}}
  ]) {
    const proof=reconcileDepositSnapshot(state,{...observed(),...change})
    assert.equal(proof.ok,false)
    assert.equal(proof.status,'untrusted_or_incomplete_observation')
  }
})
test('unattempted ready and partially completed steps are not automatic replay authority',async t=>{
  const directory=fixture(t),journal=openDepositJournal(directory,spec)
  const state=journal.view()
  journal.close()
  const result=reconcileDepositSnapshot(state,observed({oak_log:1,birch_log:1},{oak_log:0,birch_log:0}))
  assert.equal(result.status,'unfinished_requires_operator')
  assert.equal(result.canAutoReplay,false)
})
test('needs_review stays blocked even if inventory appears perfectly complete',async t=>{
  const directory=await complete(t),file=path.join(directory,'deposit.json')
  const state=JSON.parse(fs.readFileSync(file))
  state.phase='needs_review'
  fs.writeFileSync(file,JSON.stringify(state))
  const result=reconcileDepositSnapshot(readDepositJournalPassive(directory),observed())
  assert.equal(result.status,'manual_review_required')
  assert.equal(result.ok,false)
})
test('passive reader rejects journal and directory symlinks without modifying their targets',async t=>{
  const directory=await complete(t)
  const root=path.dirname(directory)
  const alias=path.join(root,'alias')
  fs.symlinkSync(directory,alias)
  assert.throws(()=>readDepositJournalPassive(alias),/Unsafe/)
  const file=path.join(directory,'deposit.json')
  const copy=path.join(root,'original.json')
  fs.copyFileSync(file,copy)
  fs.unlinkSync(file)
  fs.symlinkSync(copy,file)
  assert.throws(()=>readDepositJournalPassive(directory),/ELOOP|Unsafe/)
  assert.equal(fs.existsSync(path.join(directory,'deposit.lock')),false)
})
test('malformed or inconsistent journal is not treated as verified',async t=>{
  const directory=await complete(t),file=path.join(directory,'deposit.json')
  const state=JSON.parse(fs.readFileSync(file))
  state.receipts[0].chestAfter=99
  fs.writeFileSync(file,JSON.stringify(state))
  assert.throws(()=>readDepositJournalPassive(directory),/Invalid durable deposit receipt/)
})
