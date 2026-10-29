'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {openMission}=require('../src/mission')
const {openDepositJournal}=require('../src/deposit')
const {createQaDeliveryReadout}=require('../src/qa_delivery_readout')
const {createQaDeliveryPipeline}=require('../src/qa_delivery_pipeline')

function fixture(t,blocks=['oak_log','birch_log']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-readout-v6-'))
  const pair=crypto.generateKeyPairSync('ed25519')
  const authority={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId:'qa:delivery',botName:'GuiaIA_QA',
    operatorPublicKeyPem:pair.publicKey.export({format:'pem',type:'spki'})}
  const targets=blocks.map((block,i)=>({x:i+1,y:64,z:2,block}))
  const chest={x:5,y:64,z:3}
  const items=[...new Set(blocks)].map(name=>({name,
    count:blocks.filter(v=>v===name).length}))
  const missionDir=path.join(root,'mission'),depositDir=path.join(root,'deposit')
  const mission=openMission(missionDir,{sandboxOnly:true,ownerName:'OwnerQA',targets})
  const deposit=openDepositJournal(depositDir,{sandboxOnly:true,ownerName:'OwnerQA',chest,items})
  let closed=false
  function close(){if(closed)return;closed=true;mission.close();deposit.close()}
  t.after(()=>{if(!closed)close();fs.rmSync(root,{recursive:true,force:true})})
  let now=Date.now()
  const sign=payload=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),pair.privateKey).toString('base64url')})
  const payload={aud:'guiaia:session-delivery-plan:v1',sandboxOnly:true,
    worldId:authority.worldId,botName:authority.botName,ownerName:'OwnerQA',
    principalId:'owner_approved',connectionId:crypto.randomUUID(),
    challenge:crypto.randomBytes(24).toString('hex'),
    missionId:mission.view().missionId,planId:deposit.view().planId,
    targets,chest,items,nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+30000}
  let token=sign(payload)
  const read=(overrides={})=>createQaDeliveryReadout({signedPlan:token,authority,
    missionJournal:mission,depositJournal:deposit,now,...overrides})
  const completedActions=[]
  const pipeline=()=>createQaDeliveryPipeline({missionJournal:mission,
    depositJournal:deposit,
    approvedPlan:{sandboxOnly:true,ownerName:payload.ownerName,
      missionId:payload.missionId,planId:payload.planId,targets,chest,items},
    authorizeDispatch:async()=>true,
    createGatherAction:async target=>({sandboxOnly:true,ownerName:'OwnerQA',
      target,block:target.block,async gatherOne(){completedActions.push('gather')
        return {ok:true,reason:'verified_inventory_drop',dig_attempted:true,
          block:target.block,item:target.block,inventory_delta:1}}}),
    createDepositAction:async step=>({sandboxOnly:true,ownerName:'OwnerQA',
      chest:step.chest,item:step.name,count:step.count,
      async depositOne(){completedActions.push('deposit')
        return {ok:true,reason:'both_inventory_deltas_verified',transferAttempted:true,
          name:step.name,count:step.count,chest:step.chest,playerBefore:step.count,
          playerAfter:0,chestBefore:0,chestAfter:step.count}}})})
  return {root,mission,deposit,authority,payload,sign,
    get token(){return token},setToken(v){token=v},read,pipeline,close,
    get actions(){return completedActions.length},setNow(v){now=v},now}
}
function journalBytes(x){return [fs.readFileSync(path.join(x.root,'mission','mission.json')),
  fs.readFileSync(path.join(x.root,'deposit','deposit.json'))]}

test('signed readout shows pending steps and no world action or journal writes',t=>{
  const x=fixture(t),before=journalBytes(x)
  const report=x.read()
  assert.equal(report.phase,'gather')
  assert.equal(report.readOnly,true)
  assert.equal(report.completedSteps,0)
  assert.equal(report.totalSteps,4)
  assert.equal(report.signedWindow,'within_signed_window')
  assert.equal(report.steps[0].state,'next_step_requires_live_authorization')
  assert.equal(report.steps[1].state,'not_started')
  assert.equal(report.steps[2].state,'waiting_for_prior_steps')
  assert.equal(report.canDispatchWithoutFreshAuthorization,false)
  assert.equal(report.liveFabricPresenceChecked,false)
  assert.equal(report.independentWitnessChecked,false)
  assert.equal(x.actions,0)
  const after=journalBytes(x)
  assert.deepEqual(after,before)
  assert.equal(fs.existsSync(path.join(x.root,'action-ledger')),false)
})
test('readout immutably seals all nested coordinates, receipts, and statuses',t=>{
  const x=fixture(t),report=x.read()
  assert.ok(Object.isFrozen(report))
  assert.ok(Object.isFrozen(report.steps))
  assert.ok(Object.isFrozen(report.steps[0].target))
  assert.throws(()=>{report.steps[0].target.x=1000},TypeError)
  assert.throws(()=>{report.steps.push({})},TypeError)
})
test('readout reflects verified journal progress without declaring world verification',async t=>{
  const x=fixture(t),pipe=x.pipeline()
  assert.equal((await pipe.runNext()).ok,true)
  const report=x.read()
  assert.equal(report.phase,'gather')
  assert.equal(report.completedSteps,1)
  assert.equal(report.steps[0].state,'journal_receipt_present')
  assert.ok(report.steps[0].receipt.operationId)
  assert.equal(report.steps[1].state,'next_step_requires_live_authorization')
  assert.equal(report.evidenceQualification,
    'journal_receipts_only_not_independently_verified_world_state')
})
test('readout switches gather to deposit only after all gather receipts',async t=>{
  const x=fixture(t),p=x.pipeline()
  await p.runNext();await p.runNext()
  const report=x.read()
  assert.equal(report.phase,'deposit')
  assert.equal(report.completedSteps,2)
  assert.equal(report.steps[2].state,'next_step_requires_live_authorization')
  assert.equal(report.steps[3].state,'not_started')
})
test('readout distinguishes fully completed mission from permission to execute',async t=>{
  const x=fixture(t)
  await x.pipeline().runAll()
  const report=x.read()
  assert.equal(report.phase,'completed')
  assert.equal(report.operatorNext,'archive_completed_qa_evidence')
  assert.equal(report.completedSteps,4)
  assert.ok(report.steps.every(s=>s.state==='journal_receipt_present'))
  assert.equal(report.canDispatchWithoutFreshAuthorization,false)
  assert.equal(report.steps[2].receipt.chestAfter,1)
})
test('readout reports uncertain extraction as manual-review-only',async t=>{
  const x=fixture(t)
  const p=createQaDeliveryPipeline({missionJournal:x.mission,depositJournal:x.deposit,
    approvedPlan:{sandboxOnly:true,ownerName:x.payload.ownerName,
      missionId:x.payload.missionId,planId:x.payload.planId,
      targets:x.payload.targets,chest:x.payload.chest,items:x.payload.items},
    authorizeDispatch:async()=>true,
    createGatherAction:async target=>({sandboxOnly:true,ownerName:'OwnerQA',
      target,block:target.block,async gatherOne(){return {ok:false,dig_attempted:true,
        reason:'unknown_dig'}}}),createDepositAction:async()=>{throw Error('not used')}})
  assert.equal((await p.runNext()).ok,false)
  const report=x.read()
  assert.equal(report.phase,'blocked')
  assert.equal(report.requiresManualReview,true)
  assert.equal(report.journalPhases.gather,'needs_review')
  assert.equal(report.operatorNext,'inspect_uncertain_journal_and_reconcile_world_manually')
  assert.equal(x.actions,0)
})
test('cancelled mission reports blocked, never silently starts again',t=>{
  const x=fixture(t)
  const p=x.pipeline();p.stop()
  const report=x.read()
  assert.equal(report.phase,'blocked')
  assert.equal(report.requiresManualReview,true)
  assert.equal(report.journalPhases.deposit,'cancelled')
  assert.equal(report.steps[0].state,'blocked_for_manual_review')
})
test('expired signed plan remains readable for forensics, but cannot dispatch',t=>{
  const x=fixture(t)
  const report=x.read({now:x.payload.expiresAt+45000})
  assert.equal(report.signedWindow,'expired')
  assert.equal(report.operatorNext,'operator_review_new_approval_required_no_automatic_reissue')
  assert.equal(report.canDispatchWithoutFreshAuthorization,false)
})
test('not-yet-valid signed plan never appears runnable',t=>{
  const x=fixture(t)
  const report=x.read({now:x.payload.issuedAt-1000})
  assert.equal(report.signedWindow,'not_yet_valid')
  assert.equal(report.canDispatchWithoutFreshAuthorization,false)
})
test('expired plan tampering still rejected even when history readout requested',t=>{
  const x=fixture(t)
  x.setToken({...x.token,payload:{...x.payload,chest:{x:999,y:64,z:3}}})
  assert.throws(()=>x.read({now:x.payload.expiresAt+100000}),/signature/)
})
test('wrong operator key is rejected for readout',t=>{
  const x=fixture(t)
  const pair=crypto.generateKeyPairSync('ed25519')
  assert.throws(()=>x.read({authority:{...x.authority,
    operatorPublicKeyPem:pair.publicKey.export({format:'pem',type:'spki'})}}),/signature/)
})
test('forged but correctly signed journal identifier is rejected',t=>{
  const x=fixture(t)
  x.setToken(x.sign({...x.payload,missionId:crypto.randomUUID()}))
  assert.throws(()=>x.read(),/approved plan/)
})
test('forged but correctly signed target change is rejected against journals',t=>{
  const x=fixture(t)
  const altered=[{...x.payload.targets[0],x:33},x.payload.targets[1]]
  x.setToken(x.sign({...x.payload,targets:altered}))
  assert.throws(()=>x.read(),/approved plan/)
})
test('readout detects journals changing between its reads and refuses a stable report',t=>{
  const x=fixture(t),view=x.mission.view.bind(x.mission)
  let reads=0
  const unstable={...x.mission,view(){const v=view();reads++
    if(reads>3)v.reason='simulated_concurrent_update_'+reads
    return v}}
  assert.throws(()=>x.read({missionJournal:unstable}),/changing during inspection/)
})
test('readout never calls journal mutation or dispatch methods',t=>{
  const x=fixture(t),throwMutation=()=>{throw Error('unexpected mutation')}
  const m={view:x.mission.view,stop:throwMutation,runNext:throwMutation}
  const d={view:x.deposit.view,stop:throwMutation,runNext:throwMutation}
  assert.equal(x.read({missionJournal:m,depositJournal:d}).phase,'gather')
})
test('one-resource mission has exactly two bounded steps',t=>{
  const x=fixture(t,['birch_log']),report=x.read()
  assert.equal(report.totalSteps,2)
  assert.deepEqual(report.steps.map(s=>s.kind),['gather','deposit'])
})
