'use strict'

// Integration test to run INSIDE the actual GuiaIA repository, with its real
// durable mission/deposit journals installed. Does not connect to Minecraft:
// journal adapters emit synthetic QA receipts to isolate orchestration logic.
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {randomUUID}=require('node:crypto')
const {openMission}=require('../src/mission')
const {openDepositJournal}=require('../src/deposit')
const {createQaDeliveryPipeline}=require('../src/qa_delivery_pipeline')

function testWorld(t,blocks=['oak_log','birch_log']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-delivery-real-journals-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const ownerName='OwnerQA',chest={x:5,y:64,z:3}
  const targets=blocks.map((block,i)=>({x:i+1,y:64,z:2,block}))
  const items=[...new Set(blocks)].map(name=>({name,count:blocks.filter(x=>x===name).length}))
  const approvedPlan={sandboxOnly:true,ownerName,chest,targets,items}
  const missionDir=path.join(root,'mission')
  const depositDir=path.join(root,'deposit')
  const mission=()=>openMission(missionDir,fs.existsSync(path.join(missionDir,'mission.json'))
    ?null:{sandboxOnly:true,ownerName,targets})
  const deposit=()=>openDepositJournal(depositDir,fs.existsSync(path.join(depositDir,'deposit.json'))
    ?null:{sandboxOnly:true,ownerName,chest,items})
  const events=[]
  function makePipeline(missionJournal,depositJournal,{
    failGather=false,failDeposit=false,approve=true}={}){
    const pinned={...approvedPlan,missionId:missionJournal.view().missionId,
      planId:depositJournal.view().planId}
    return createQaDeliveryPipeline({missionJournal,depositJournal,approvedPlan:pinned,
      authorizeDispatch:async()=>approve,
      createGatherAction:async target=>({sandboxOnly:true,ownerName,target,block:target.block,
        async gatherOne(){
          events.push('gather:'+target.block)
          if(failGather)return {ok:false,reason:'dig_failed',dig_attempted:true}
          return {ok:true,reason:'verified_inventory_drop',block:target.block,
            item:target.block,inventory_delta:1,dig_attempted:true}
        }}),
      createDepositAction:async item=>({sandboxOnly:true,ownerName,
        chest:item.chest,item:item.name,count:item.count,
        async depositOne(){
          events.push('deposit:'+item.name)
          if(failDeposit)return {ok:false,reason:'transfer_failed',transferAttempted:true}
          return {ok:true,reason:'both_inventory_deltas_verified',
            name:item.name,count:item.count,chest:item.chest,transferAttempted:true,
            playerBefore:item.count,playerAfter:0,chestBefore:0,chestAfter:item.count}
        }})})
  }
  return {root,missionDir,depositDir,mission,deposit,events,approvedPlan,makePipeline}
}

test('real journals finish gather then deposit and preserve 4 durable receipts',async t=>{
  const w=testWorld(t),mission=w.mission(),deposit=w.deposit()
  try{
    const pipe=w.makePipeline(mission,deposit)
    assert.equal((await pipe.runAll()).ok,true)
    assert.deepEqual(w.events,['gather:oak_log','gather:birch_log',
      'deposit:oak_log','deposit:birch_log'])
    assert.equal(mission.view().receipts.length,2)
    assert.equal(deposit.view().receipts.length,2)
    assert.equal(mission.view().phase,'completed')
    assert.equal(deposit.view().phase,'completed')
  }finally{mission.close();deposit.close()}
  const reopenedMission=w.mission(),reopenedDeposit=w.deposit()
  try{
    const pipe=w.makePipeline(reopenedMission,reopenedDeposit)
    assert.equal(pipe.status().phase,'completed')
    assert.equal((await pipe.runAll()).reason,'already_completed')
    assert.equal(w.events.length,4)
  }finally{reopenedMission.close();reopenedDeposit.close()}
})

test('real mission unknown dig outcome remains needs_review after reopen',async t=>{
  const w=testWorld(t),mission=w.mission(),deposit=w.deposit()
  try{
    const pipe=w.makePipeline(mission,deposit,{failGather:true})
    assert.equal((await pipe.runAll()).ok,false)
    assert.equal(mission.view().phase,'needs_review')
    assert.equal(w.events.length,1)
  }finally{mission.close();deposit.close()}
  const m=w.mission(),d=w.deposit()
  try{
    const pipe=w.makePipeline(m,d)
    assert.equal(pipe.status().phase,'blocked')
    assert.equal((await pipe.runAll()).ok,false)
    assert.equal(w.events.length,1)
  }finally{m.close();d.close()}
})

test('real deposit unknown transfer remains needs_review after reopen',async t=>{
  const w=testWorld(t),mission=w.mission(),deposit=w.deposit()
  try{
    const pipe=w.makePipeline(mission,deposit,{failDeposit:true})
    assert.equal((await pipe.runAll()).ok,false)
    assert.equal(deposit.view().phase,'needs_review')
    assert.equal(w.events.length,3)
  }finally{mission.close();deposit.close()}
  const m=w.mission(),d=w.deposit()
  try{
    const pipe=w.makePipeline(m,d)
    assert.equal(pipe.status().phase,'blocked')
    assert.equal((await pipe.runAll()).ok,false)
    assert.equal(w.events.length,3)
  }finally{m.close();d.close()}
})

test('real mission interrupted write-ahead state is not replayed after simulated crash',async t=>{
  const w=testWorld(t),mission=w.mission(),deposit=w.deposit()
  mission.close();deposit.close()
  const file=path.join(w.missionDir,'mission.json')
  const raw=JSON.parse(fs.readFileSync(file,'utf8'))
  raw.phase='dispatching';raw.operationId=randomUUID()
  fs.writeFileSync(file,JSON.stringify(raw)+'\n')
  const m=w.mission(),d=w.deposit()
  try{
    assert.equal(m.view().phase,'needs_review')
    const pipe=w.makePipeline(m,d)
    assert.equal(pipe.status().phase,'blocked')
    assert.equal((await pipe.runAll()).ok,false)
    assert.equal(w.events.length,0)
  }finally{m.close();d.close()}
})

test('real journals cannot dispatch when external approval is refused',async t=>{
  const w=testWorld(t),mission=w.mission(),deposit=w.deposit()
  try{
    const pipe=w.makePipeline(mission,deposit,{approve:false})
    assert.equal((await pipe.runNext()).reason,'authorization_unavailable')
    assert.equal(mission.view().phase,'ready')
    assert.equal(deposit.view().phase,'ready')
    assert.equal(w.events.length,0)
  }finally{mission.close();deposit.close()}
})

test('real journals persist cancellation before the first dispatch and deny reopening',async t=>{
  const w=testWorld(t),m=w.mission(),d=w.deposit()
  try{
    const p=w.makePipeline(m,d)
    assert.equal(p.stop().reason,'operator_stopped')
    assert.equal(m.view().phase,'cancelled')
    assert.equal(d.view().phase,'cancelled')
    assert.equal((await p.runAll()).reason,'pipeline_stopped')
    assert.equal(w.events.length,0)
  }finally{m.close();d.close()}
  const m2=w.mission(),d2=w.deposit()
  try{
    assert.equal(w.makePipeline(m2,d2).status().phase,'blocked')
    assert.equal((await w.makePipeline(m2,d2).runAll()).ok,false)
    assert.equal(w.events.length,0)
  }finally{m2.close();d2.close()}
})

test('real mission write-ahead in progress: stop calls adapter cancel, requires review',async t=>{
  const w=testWorld(t),m=w.mission(),d=w.deposit()
  let begun,release,cancelled=false,attempts=0
  const entered=new Promise(resolve=>{begun=resolve})
  try{
    const view=m.view(),deposit=d.view()
    const pipeline=createQaDeliveryPipeline({missionJournal:m,depositJournal:d,
      approvedPlan:{...w.approvedPlan,missionId:view.missionId,planId:deposit.planId},
      authorizeDispatch:async()=>true,
      createGatherAction:async target=>({sandboxOnly:true,ownerName:'OwnerQA',target,
        block:target.block,cancel(){cancelled=true},
        async gatherOne(){attempts++;begun();await new Promise(resolve=>{release=resolve})
          return {ok:true,reason:'verified_inventory_drop',block:target.block,
            item:target.block,inventory_delta:1,dig_attempted:true}
        }}),
      createDepositAction:async()=>{throw Error('deposit not expected')}
    })
    const pending=pipeline.runNext()
    await entered
    assert.equal(m.view().phase,'dispatching')
    assert.equal(attempts,1)
    assert.equal(pipeline.stop().reason,'operator_stopped')
    assert.equal(cancelled,true)
    release()
    const result=await pending
    assert.equal(result.ok,false)
    assert.equal(m.view().phase,'needs_review')
    assert.equal(m.view().receipts.length,0)
    assert.equal(d.view().phase,'cancelled')
    assert.equal((await pipeline.runNext()).reason,'pipeline_stopped')
  }finally{m.close();d.close()}
  const reopened=w.mission(),deposits=w.deposit()
  try{
    assert.equal(w.makePipeline(reopened,deposits).status().phase,'blocked')
    assert.equal(attempts,1)
  }finally{reopened.close();deposits.close()}
})

test('real chest journal write-ahead in progress: cancellation forbids success receipt',async t=>{
  const w=testWorld(t,['oak_log']),m=w.mission(),d=w.deposit()
  try{
    assert.equal((await w.makePipeline(m,d).runNext()).ok,true)
    assert.equal(m.view().phase,'completed')
    const mission=m.view(),deposit=d.view()
    let started,release,cancelled=false,attempts=0
    const entered=new Promise(resolve=>{started=resolve})
    const pipeline=createQaDeliveryPipeline({missionJournal:m,depositJournal:d,
      approvedPlan:{...w.approvedPlan,missionId:mission.missionId,planId:deposit.planId},
      authorizeDispatch:async()=>true,
      createGatherAction:async()=>{throw Error('unexpected gathering')},
      createDepositAction:async step=>({sandboxOnly:true,ownerName:'OwnerQA',
        item:step.name,count:step.count,chest:step.chest,cancel(){cancelled=true},
        async depositOne(){attempts++;started();await new Promise(resolve=>{release=resolve})
          return {ok:true,reason:'both_inventory_deltas_verified',
            name:step.name,count:step.count,chest:step.chest,transferAttempted:true,
            playerBefore:1,playerAfter:0,chestBefore:0,chestAfter:1}
        }})
    })
    const pending=pipeline.runNext()
    await entered
    assert.equal(d.view().phase,'transferring')
    pipeline.stop()
    assert.equal(cancelled,true)
    release()
    assert.equal((await pending).ok,false)
    assert.equal(d.view().phase,'needs_review')
    assert.equal(d.view().receipts.length,0)
    assert.equal(attempts,1)
    assert.equal(m.view().phase,'completed')
  }finally{m.close();d.close()}
  const m2=w.mission(),d2=w.deposit()
  try{
    assert.equal(w.makePipeline(m2,d2).status().phase,'blocked')
    assert.equal(d2.view().receipts.length,0)
  }finally{m2.close();d2.close()}
})

test('real mission journal prevents concurrent coordinators from dispatching twice',async t=>{
  const w=testWorld(t,['oak_log']),m=w.mission(),d=w.deposit()
  let start,release,ops=0
  const begun=new Promise(resolve=>{start=resolve})
  const make=()=>{
    const pinned={...w.approvedPlan,missionId:m.view().missionId,planId:d.view().planId}
    return createQaDeliveryPipeline({missionJournal:m,depositJournal:d,
      approvedPlan:pinned,authorizeDispatch:async()=>true,
      createGatherAction:async target=>({sandboxOnly:true,ownerName:'OwnerQA',target,
        block:target.block,async gatherOne(){ops++;start();await new Promise(resolve=>{release=resolve})
          return {ok:true,reason:'verified_inventory_drop',
            block:target.block,item:target.block,inventory_delta:1,dig_attempted:true}
        }}),
      createDepositAction:async()=>{throw Error('not expected')}
    })
  }
  try{
    const first=make(),second=make()
    const ongoing=first.runNext()
    await begun
    assert.equal((await second.runNext()).ok,false)
    assert.equal(ops,1)
    release()
    assert.equal((await ongoing).ok,true)
    assert.equal(m.view().phase,'completed')
    assert.equal(m.view().receipts.length,1)
  }finally{m.close();d.close()}
})
