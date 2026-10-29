'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {randomUUID}=require('node:crypto')
const {createQaDeliveryPipeline,AUTH_TIMEOUT_MS}=require('../src/qa_delivery_pipeline')

// A file-backed simulation of existing journal APIs. The coordinator is
// tested here without Mineflayer or Minecraft; it does not replace tests
// of openMission/openDepositJournal in the real repository.
function fixture(t,types=['oak_log','birch_log']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-delivery-lab-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const paths={mission:path.join(root,'mission.json'),deposit:path.join(root,'deposit.json')}
  let gathers=0,deposits=0,authorizeCalls=0,grant=true
  let gatherOverrides=null,depositOverrides=null,authorize=null
  let customGatherFactory=null,customDepositFactory=null
  const ownerName='OwnerQA',chest={x:5,y:64,z:3}
  const targets=types.map((block,i)=>({x:i+1,y:64,z:2,block}))
  const items=[...new Set(types)].map(name=>({name,count:types.filter(x=>x===name).length}))
  const mission={sandboxOnly:true,missionId:randomUUID(),ownerName,
    targets,index:0,phase:'ready',receipts:[]}
  const deposit={sandboxOnly:true,planId:randomUUID(),ownerName,
    chest,items,index:0,phase:'ready',receipts:[]}
  const write=(kind,value)=>fs.writeFileSync(paths[kind],JSON.stringify(value)+'\n',{mode:0o600})
  const read=kind=>JSON.parse(fs.readFileSync(paths[kind],'utf8'))
  write('mission',mission);write('deposit',deposit)
  const j={
    mission:{view:()=>read('mission'),stop(){
      const s=read('mission')
      if(s.phase==='ready'||s.phase==='paused')s.phase='cancelled'
      else if(s.phase==='dispatching')s.phase='needs_review'
      write('mission',s)
      return s
    },async runNext(action){
      const state=read('mission');state.phase='dispatching';write('mission',state)
      gathers++
      let result
      try{result=await action.gatherOne()}
      catch{result={ok:false,dig_attempted:true}}
      if(result.ok===true){
        const step=state.index
        state.receipts.push({step,item:state.targets[step].block,
          inventoryDelta:result.inventory_delta||1,operationId:randomUUID()})
        state.index++
        state.phase=state.index===state.targets.length?'completed':'ready'
        write('mission',state)
        return {ok:true}
      }
      state.phase=result.dig_attempted===false?'paused':'needs_review'
      write('mission',state)
      return {ok:false,reason:state.phase}
    }},
    deposit:{view:()=>read('deposit'),stop(){
      const s=read('deposit')
      if(s.phase==='ready'||s.phase==='paused')s.phase='cancelled'
      else if(s.phase==='transferring')s.phase='needs_review'
      write('deposit',s)
      return s
    },async runNext(action){
      const state=read('deposit');state.phase='transferring';write('deposit',state)
      deposits++
      let result
      try{result=await action.depositOne()}
      catch{result={ok:false,transferAttempted:true}}
      if(result.ok===true){
        const step=state.index,claim=state.items[step]
        state.receipts.push({step,name:claim.name,count:claim.count,
          playerBefore:claim.count,chestBefore:0,playerAfter:0,chestAfter:claim.count})
        state.index++
        state.phase=state.index===state.items.length?'completed':'ready'
        write('deposit',state)
        return {ok:true}
      }
      state.phase=result.transferAttempted===false?'paused':'needs_review'
      write('deposit',state)
      return {ok:false,reason:state.phase}
    }}
  }
  const approvedPlan={sandboxOnly:true,ownerName,
    missionId:mission.missionId,planId:deposit.planId,targets:JSON.parse(JSON.stringify(targets)),
    items:JSON.parse(JSON.stringify(items)),chest:{...chest}}
  const factory=()=>createQaDeliveryPipeline({missionJournal:j.mission,depositJournal:j.deposit,approvedPlan,
    authorizeDispatch:async summary=>{
      authorizeCalls++
      if(authorize)return authorize(summary)
      return grant
    },
    createGatherAction:async step=>customGatherFactory
      ?customGatherFactory(step):({sandboxOnly:true,target:step,
      gatherOne:()=>gatherOverrides?gatherOverrides(step):{
        ok:true,reason:'verified_inventory_drop',inventory_delta:1,dig_attempted:true}}),
    createDepositAction:async step=>customDepositFactory
      ?customDepositFactory(step):({sandboxOnly:true,chest:step.chest,
      depositOne:()=>depositOverrides?depositOverrides(step):{
        ok:true,reason:'both_inventory_deltas_verified',transferAttempted:true}})
  })
  return {paths,read,write,j,root,factory,
    get gathers(){return gathers},get deposits(){return deposits},
    get authorizeCalls(){return authorizeCalls},
    setGrant(v){grant=v},setAuthorize(v){authorize=v},
    setGather(v){gatherOverrides=v},setDeposit(v){depositOverrides=v},
    setGatherFactory(v){customGatherFactory=v},
    setDepositFactory(v){customDepositFactory=v}}
}

test('two-item end-to-end gather to chest follows durable journal order',async t=>{
  const x=fixture(t),pipeline=x.factory()
  assert.equal(pipeline.status().phase,'gather')
  const result=await pipeline.runAll()
  assert.equal(result.ok,true)
  assert.equal(result.state.phase,'completed')
  assert.equal(result.state.gatherDone,2)
  assert.equal(result.state.depositsDone,2)
  assert.equal(x.gathers,2)
  assert.equal(x.deposits,2)
  assert.equal(x.authorizeCalls,8)
  assert.equal((await pipeline.runAll()).reason,'already_completed')
  assert.equal(x.deposits,2)
})
test('never deposits before all planned gather receipts exist',async t=>{
  const x=fixture(t),pipeline=x.factory()
  const first=await pipeline.runNext()
  assert.equal(first.ok,true)
  assert.equal(first.state.phase,'gather')
  assert.equal(x.deposits,0)
  await pipeline.runNext()
  assert.equal(pipeline.status().phase,'deposit')
  assert.equal(x.deposits,0)
  await pipeline.runNext()
  assert.equal(x.deposits,1)
})
test('restart after gather can continue deposit without mining a second time',async t=>{
  const x=fixture(t),first=x.factory()
  await first.runNext();await first.runNext()
  assert.equal(first.status().phase,'deposit')
  const restarted=x.factory()
  assert.equal((await restarted.runAll()).ok,true)
  assert.equal(x.gathers,2)
  assert.equal(x.deposits,2)
})
test('reopening a completed task only reports status, not new operations',async t=>{
  const x=fixture(t)
  await x.factory().runAll()
  const again=x.factory()
  assert.equal(again.status().phase,'completed')
  assert.equal((await again.runNext()).reason,'already_completed')
  assert.equal(x.gathers,2)
  assert.equal(x.deposits,2)
})
test('failed gather before touching world pauses; never continues automatically',async t=>{
  const x=fixture(t)
  x.setGather(()=>({ok:false,dig_attempted:false,reason:'out_of_range'}))
  const p=x.factory(),r=await p.runAll()
  assert.equal(r.ok,false)
  assert.equal(p.status().phase,'blocked')
  assert.equal(x.deposits,0)
  assert.equal((await p.runAll()).ok,false)
  assert.equal(x.gathers,1)
})
test('uncertain mining result requires manual review and refuses further dispatch',async t=>{
  const x=fixture(t)
  x.setGather(()=>({ok:false,dig_attempted:true,reason:'dig_failed'}))
  const p=x.factory()
  assert.equal((await p.runAll()).ok,false)
  assert.equal(x.read('mission').phase,'needs_review')
  assert.equal((await p.runNext()).state.phase,'blocked')
  assert.equal(x.gathers,1)
  assert.equal(x.deposits,0)
})
test('uncertain chest transfer requires manual review; never retries the deposit',async t=>{
  const x=fixture(t)
  x.setDeposit(()=>({ok:false,transferAttempted:true,reason:'unknown_transfer'}))
  const p=x.factory(),out=await p.runAll()
  assert.equal(out.ok,false)
  assert.equal(x.read('deposit').phase,'needs_review')
  assert.equal((await p.runAll()).ok,false)
  assert.equal(x.deposits,1)
})
test('a crashed dispatching or transferring journal is blocked, never replayed',t=>{
  for(const kind of ['mission','deposit']){
    const x=fixture(t)
    if(kind==='deposit'){
      const m=x.read('mission');m.phase='completed';m.index=m.targets.length
      m.receipts=m.targets.map((target,i)=>({step:i,item:target.block,inventoryDelta:1,operationId:randomUUID()}))
      x.write('mission',m)
    }
    const state=x.read(kind)
    state.phase=kind==='mission'?'dispatching':'transferring'
    x.write(kind,state)
    const p=x.factory()
    assert.equal(p.status().phase,'blocked')
    assert.equal(p.status().reason,'journal_not_replay_safe')
  }
})
test('authorization false or unavailable denies with no adapter/world operation',async t=>{
  const x=fixture(t),p=x.factory()
  x.setGrant(false)
  const r=await p.runAll()
  assert.equal(r.reason,'authorization_unavailable')
  assert.equal(x.gathers,0)
  assert.equal(x.deposits,0)
  x.setAuthorize(async()=>{throw Error('No witness')})
  assert.equal((await p.runNext()).reason,'authorization_unavailable')
  assert.equal(x.gathers,0)
})
test('forged journal plan, changed target or deposit mismatch is rejected',t=>{
  for(const mutation of [
    x=>{const d=x.read('deposit');d.ownerName='OtherQA';x.write('deposit',d)},
    x=>{const d=x.read('deposit');d.items=[{name:'oak_log',count:2}];x.write('deposit',d)},
    x=>{const m=x.read('mission');m.targets[0].x=99;x.write('mission',m)},
    x=>{const d=x.read('deposit');d.chest.x=99;x.write('deposit',d)},
    x=>{const m=x.read('mission');m.missionId=randomUUID();x.write('mission',m)},
    x=>{const d=x.read('deposit');d.planId=randomUUID();x.write('deposit',d)},
  ]){
    const x=fixture(t)
    mutation(x)
    assert.throws(()=>x.factory(),/QA delivery pipeline/)
  }
})
test('mutation of a pinned journal after construction fails closed',async t=>{
  const x=fixture(t),p=x.factory()
  const d=x.read('deposit');d.chest.x=99;x.write('deposit',d)
  assert.throws(()=>p.status(),/configuration or progress changed/)
  await assert.rejects(p.runNext(),/configuration or progress changed/)
  assert.equal(x.gathers,0)
})
test('invalid receipt state is rejected at integration boundary',t=>{
  const x=fixture(t),m=x.read('mission')
  m.index=1;m.receipts=[{step:0,item:'birch_log',inventoryDelta:1}]
  x.write('mission',m)
  assert.throws(()=>x.factory(),/unverified gather receipt/)
})
test('authorization callback yields while someone changes journal: deny stale dispatch',async t=>{
  const x=fixture(t)
  let release,started
  const begun=new Promise(resolve=>{started=resolve})
  let calls=0
  x.setAuthorize(async()=>{if(++calls===1){started();return new Promise(resolve=>{release=resolve})}return true})
  const p=x.factory(),running=p.runNext()
  await begun
  const m=x.read('mission');m.phase='paused';x.write('mission',m)
  release(true)
  const result=await running
  assert.equal(result.reason,'journal_changed_during_authorization')
  assert.equal(x.gathers,0)
})
test('second concurrent run is rejected without dispatching duplicate action',async t=>{
  const x=fixture(t)
  let release,started
  const begun=new Promise(resolve=>{started=resolve})
  let calls=0
  x.setAuthorize(async()=>{if(++calls===1){started();return new Promise(resolve=>{release=resolve})}return true})
  const p=x.factory(),first=p.runNext()
  await begun
  assert.equal((await p.runNext()).reason,'pipeline_busy')
  release(true)
  assert.equal((await first).ok,true)
  assert.equal(x.gathers,1)
})
test('two of one type plus one of another are supported, but over-budget plans denied',async t=>{
  const x=fixture(t,['oak_log','oak_log','birch_log'])
  assert.equal((await x.factory().runAll()).ok,true)
  const tooMany=fixture(t,['oak_log','oak_log','oak_log','birch_log'])
  assert.throws(()=>tooMany.factory(),/unbounded/)
})
test('no chat, RCON or generic execute endpoint is provided',t=>{
  const p=fixture(t).factory()
  assert.deepEqual(Object.keys(p),['status','runNext','runAll','stop'])
  assert.equal(Object.isFrozen(p),true)
})


test('a hung authorization times out and cannot dispatch after resolving late',async t=>{
  const x=fixture(t)
  let release
  x.setAuthorize(()=>new Promise(resolve=>{release=resolve}))
  const p=x.factory()
  const begun=Date.now()
  const result=await p.runNext()
  assert.equal(result.ok,false)
  assert.equal(result.reason,'authorization_unavailable')
  assert.ok(Date.now()-begun>=AUTH_TIMEOUT_MS)
  assert.equal(x.gathers,0)
  release(true)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(x.gathers,0)
  assert.equal(p.status().phase,'gather')
})

test('external plan is mandatory, even if the two journals agree',t=>{
  const x=fixture(t)
  assert.throws(()=>createQaDeliveryPipeline({
    missionJournal:x.j.mission,depositJournal:x.j.deposit,
    authorizeDispatch:async()=>true,
    createGatherAction:async()=>({}),createDepositAction:async()=>({})
  }),/externally approved plan/)
})


test('revocation after slow action factory denies immediately before dispatch',async t=>{
  const x=fixture(t)
  let allowed=true, factoryStarted, release
  const entered=new Promise(resolve=>{factoryStarted=resolve})
  x.setAuthorize(async()=>allowed)
  x.setGatherFactory(async step=>{
    factoryStarted()
    await new Promise(resolve=>{release=resolve})
    return {sandboxOnly:true,target:step,gatherOne:()=>{
      throw Error('MUST NOT GATHER AFTER REVOCATION')
    }}
  })
  const runner=x.factory(),promise=runner.runNext()
  await entered
  assert.equal(x.authorizeCalls,1)
  allowed=false
  release()
  const out=await promise
  assert.equal(out.reason,'authorization_unavailable')
  assert.equal(x.authorizeCalls,2)
  assert.equal(x.gathers,0)
  assert.equal(x.read('mission').phase,'ready')
})

test('fresh reauthorization after factory rejects stale witness when second check throws',async t=>{
  const x=fixture(t)
  let count=0
  x.setAuthorize(async()=>{
    count++
    if(count===2)throw Error('revocation service closed')
    return true
  })
  const p=x.factory(),r=await p.runNext()
  assert.equal(r.reason,'authorization_unavailable')
  assert.equal(count,2)
  assert.equal(x.gathers,0)
  assert.equal(x.read('mission').phase,'ready')
})

test('cancel while first authorization is pending persists both journal cancellations',async t=>{
  const x=fixture(t)
  let begun,release
  const entered=new Promise(resolve=>{begun=resolve})
  x.setAuthorize(async()=>{begun();return new Promise(resolve=>{release=resolve})})
  const p=x.factory(),running=p.runNext()
  await entered
  const stopped=p.stop()
  assert.equal(stopped.reason,'operator_stopped')
  assert.equal(stopped.state.phase,'blocked')
  assert.equal(x.read('mission').phase,'cancelled')
  assert.equal(x.read('deposit').phase,'cancelled')
  release(true)
  const result=await running
  assert.equal(result.reason,'pipeline_stopped')
  assert.equal(x.gathers,0)
  assert.equal(x.deposits,0)
  assert.equal((await p.runAll()).reason,'pipeline_stopped')
  assert.equal(p.stop().reason,'pipeline_already_stopped')
})

test('cancel during asynchronous adapter creation cannot launch world operation',async t=>{
  const x=fixture(t)
  let signal,release
  const entered=new Promise(resolve=>{signal=resolve})
  x.setGatherFactory(async step=>{
    signal()
    await new Promise(resolve=>{release=resolve})
    return {sandboxOnly:true,target:step,gatherOne:()=>{
      throw Error('DISPATCH AFTER CANCEL')
    }}
  })
  const p=x.factory(),running=p.runNext()
  await entered
  p.stop()
  release()
  const result=await running
  assert.equal(result.reason,'pipeline_stopped')
  assert.equal(x.gathers,0)
  assert.equal(x.read('mission').phase,'cancelled')
  assert.equal(x.read('deposit').phase,'cancelled')
})

test('cancel a completed gathering phase only cancels the pending deposits',async t=>{
  const x=fixture(t),p=x.factory()
  assert.equal((await p.runNext()).ok,true)
  assert.equal((await p.runNext()).ok,true)
  assert.equal(p.status().phase,'deposit')
  p.stop()
  assert.equal(x.read('mission').phase,'completed')
  assert.equal(x.read('deposit').phase,'cancelled')
  assert.equal(x.deposits,0)
  assert.equal((await p.runNext()).reason,'pipeline_stopped')
})

test('second approval timeout prevents durable dispatch after the first approval',async t=>{
  const x=fixture(t)
  let calls=0,release
  x.setAuthorize(()=>{
    calls++
    if(calls===2)return new Promise(resolve=>{release=resolve})
    return true
  })
  const p=x.factory(),started=Date.now(),r=await p.runNext()
  assert.equal(r.reason,'authorization_unavailable')
  assert.equal(calls,2)
  assert.ok(Date.now()-started>=AUTH_TIMEOUT_MS)
  assert.equal(x.gathers,0)
  assert.equal(x.read('mission').phase,'ready')
  release(true)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(x.gathers,0)
})

test('second authorization also denies a transfer after gathering completed',async t=>{
  const x=fixture(t),p=x.factory()
  await p.runNext();await p.runNext()
  assert.equal(p.status().phase,'deposit')
  const initialCalls=x.authorizeCalls
  let check=0
  x.setAuthorize(async()=>++check===1)
  const r=await p.runNext()
  assert.equal(r.reason,'authorization_unavailable')
  assert.equal(x.deposits,0)
  assert.equal(x.authorizeCalls,initialCalls+2)
  assert.equal(x.read('deposit').phase,'ready')
})

test('cancel API requires both journals to implement fail-closed stop',t=>{
  const x=fixture(t)
  const journal={...x.j.mission,stop:undefined}
  assert.throws(()=>createQaDeliveryPipeline({
    missionJournal:journal,depositJournal:x.j.deposit,
    approvedPlan:{},
    authorizeDispatch:async()=>true,createGatherAction:async()=>({}),
    createDepositAction:async()=>({})
  }),/trusted QA journal/)
})

test('stop attempts both journals even when first stop throws, and never reopens dispatch',async t=>{
  const x=fixture(t),p=x.factory()
  const original=x.j.mission.stop
  x.j.mission.stop=()=>{throw Error('mission disk read-only')}
  assert.throws(()=>p.stop(),/cancellation could not be persisted/)
  assert.equal(x.read('deposit').phase,'cancelled')
  assert.deepEqual({ok:p.stop().ok,reason:p.stop().reason},{ok:false,reason:'cancellation_unconfirmed'})
  assert.equal((await p.runNext()).reason,'pipeline_stopped')
  assert.equal(x.gathers,0)
  x.j.mission.stop=original
})
