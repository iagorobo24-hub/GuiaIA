'use strict'

// Disposable QA orchestration only. The two existing journals own durability,
// authorization adapters own Minecraft operations, and this coordinator never
// opens a chat, command, RCON or world-action entrypoint.
const ITEMS=Object.freeze({oak_log:'oak_log',birch_log:'birch_log'})
const OWNER=/^[A-Za-z0-9_]{3,16}$/
const MISSION_PHASES=new Set(['ready','dispatching','paused','needs_review','completed','cancelled'])
const DEPOSIT_PHASES=new Set(['ready','transferring','paused','needs_review','completed','cancelled'])
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const AUTH_TIMEOUT_MS=1500

function validPosition(position){
  return position!==null && typeof position==='object' &&
    ['x','y','z'].every(key=>Number.isInteger(position[key]) && Math.abs(position[key])<=30000000)
}
function fail(message){throw Error('QA delivery pipeline: '+message)}

function createQaDeliveryPipeline({missionJournal,depositJournal,approvedPlan,
  createGatherAction,createDepositAction,authorizeDispatch}={}){
  if(!missionJournal || typeof missionJournal.view!=='function' ||
     typeof missionJournal.runNext!=='function' ||
     !depositJournal || typeof depositJournal.view!=='function' ||
     typeof depositJournal.runNext!=='function' ||
     typeof missionJournal.stop!=='function' ||
     typeof depositJournal.stop!=='function' ||
     typeof createGatherAction!=='function' ||
     typeof createDepositAction!=='function' ||
     typeof authorizeDispatch!=='function')fail('trusted QA journal and action adapters required')

  const initialMission=missionJournal.view()
  const initialDeposit=depositJournal.view()
  if(initialMission?.sandboxOnly!==true || initialDeposit?.sandboxOnly!==true ||
     !OWNER.test(initialMission.ownerName||'') ||
     initialMission.ownerName!==initialDeposit.ownerName ||
     !Array.isArray(initialMission.targets) ||
     initialMission.targets.length<1 || initialMission.targets.length>3 ||
     !Array.isArray(initialDeposit.items) ||
     initialDeposit.items.length<1 || initialDeposit.items.length>2 ||
     !validPosition(initialDeposit.chest))fail('mismatched or unbounded journals')

  const targets=initialMission.targets.map(t=>{
    if(!validPosition(t) || !Object.hasOwn(ITEMS,t.block||'oak_log'))
      fail('unapproved target')
    return Object.freeze({x:t.x,y:t.y,z:t.z,
      block:t.block||'oak_log'})
  })
  if(new Set(targets.map(t=>[t.x,t.y,t.z].join(':'))).size!==targets.length)
    fail('duplicate target')
  const counts=Object.create(null)
  for(const target of targets)counts[ITEMS[target.block]]=(counts[ITEMS[target.block]]||0)+1
  const items=initialDeposit.items.map(item=>{
    if(!item || !Object.hasOwn(ITEMS,item.name) ||
       !Number.isInteger(item.count) || item.count<1 || item.count>2)
      fail('unapproved deposit item')
    return Object.freeze({name:item.name,count:item.count})
  })
  if(new Set(items.map(i=>i.name)).size!==items.length ||
     Object.keys(counts).length!==items.length ||
     items.some(item=>counts[item.name]!==item.count))
    fail('deposit quantities must equal planned gather target counts')

  const chest=Object.freeze({x:initialDeposit.chest.x,
    y:initialDeposit.chest.y,z:initialDeposit.chest.z})
  const ownerName=initialMission.ownerName
  const originalTargets=initialMission.targets.map(t=>({x:t.x,y:t.y,z:t.z,
    ...(t.block===undefined?{}:{block:t.block})}))
  const originalItems=items.map(i=>({...i}))
  // Approval must arrive independently of mutable journal files. Otherwise a
  // forged journal loaded before construction becomes the apparent baseline.
  if(approvedPlan?.sandboxOnly!==true ||
     approvedPlan.ownerName!==ownerName ||
     approvedPlan.missionId!==initialMission.missionId ||
     approvedPlan.planId!==initialDeposit.planId ||
     !same(approvedPlan.targets,originalTargets) ||
     !same(approvedPlan.items,originalItems) ||
     !same(approvedPlan.chest,chest))
    fail('journal does not match externally approved plan')
  const total=targets.length+items.length
  let busy=false,stopped=false,stopFailure=false

  // Only exact journal configurations are accepted after construction. A
  // changed owner/target/chest or a newer plan cannot be silently adopted.
  function inspect(){
    const mission=missionJournal.view(),deposit=depositJournal.view()
    if(!mission || !deposit || mission.sandboxOnly!==true ||
       deposit.sandboxOnly!==true ||
       mission.missionId!==initialMission.missionId ||
       deposit.planId!==initialDeposit.planId ||
       mission.ownerName!==ownerName || deposit.ownerName!==ownerName ||
       !same(mission.targets,originalTargets) ||
       !same(deposit.items,originalItems) ||
       !same(deposit.chest,chest) ||
       !MISSION_PHASES.has(mission.phase) || !DEPOSIT_PHASES.has(deposit.phase) ||
       !Number.isInteger(mission.index) ||
       !Number.isInteger(deposit.index) ||
       mission.index<0 || mission.index>targets.length ||
       deposit.index<0 || deposit.index>items.length ||
       !Array.isArray(mission.receipts) ||
       !Array.isArray(deposit.receipts) ||
       mission.receipts.length!==mission.index ||
       deposit.receipts.length!==deposit.index)
      fail('journal configuration or progress changed unexpectedly')

    if((mission.phase==='completed')!==(mission.index===targets.length) ||
       (deposit.phase==='completed')!==(deposit.index===items.length))
      fail('inconsistent completion state')
    if(deposit.index>0 && mission.phase!=='completed')
      fail('deposit recorded before all gathering completed')

    // Journals have their own receipt validators. Recheck at coordinator
    // boundary so a caller-provided fake journal cannot invent progress.
    mission.receipts.forEach((receipt,i)=>{
      if(receipt?.step!==i || receipt.item!==ITEMS[targets[i].block] ||
         !Number.isInteger(receipt.inventoryDelta) || receipt.inventoryDelta<1)
        fail('unverified gather receipt')
    })
    deposit.receipts.forEach((receipt,i)=>{
      if(receipt?.step!==i || receipt.name!==items[i].name ||
         receipt.count!==items[i].count ||
         !Number.isInteger(receipt.playerBefore) ||
         receipt.playerAfter!==receipt.playerBefore-items[i].count ||
         !Number.isInteger(receipt.chestBefore) ||
         receipt.chestAfter!==receipt.chestBefore+items[i].count)
        fail('unverified deposit receipt')
    })

    let phase='blocked',reason='manual_review_required'
    if(mission.phase==='completed' && deposit.phase==='completed'){
      phase='completed';reason='all_world_receipts_verified'
    }else if(['needs_review','dispatching','paused','cancelled'].includes(mission.phase) ||
             ['needs_review','transferring','paused','cancelled'].includes(deposit.phase)){
      reason='journal_not_replay_safe'
    }else if(mission.phase==='ready' && deposit.phase==='ready'){
      phase='gather';reason='next_approved_gather'
    }else if(mission.phase==='completed' && deposit.phase==='ready'){
      phase='deposit';reason='next_approved_deposit'
    }
    return Object.freeze({phase,reason,ownerName,
      gatherDone:mission.index,gatherTotal:targets.length,
      depositsDone:deposit.index,depositTotal:items.length,
      completedSteps:mission.index+deposit.index,totalSteps:total})
  }

  // Cancellation persists in BOTH journals, not merely process memory.
  // If either journal is already dispatching, its own stop() records an
  // uncertain result and cancels the active adapter. Never auto-retry it.
  function stop(){
    if(stopped)return {ok:!stopFailure,reason:stopFailure?'cancellation_unconfirmed':'pipeline_already_stopped',state:inspect()}
    stopped=true
    // Try both durability barriers even if one journal is unavailable.
    // Never pretend cancellation was durably recorded if either fails.
    let firstError=null
    for(const journal of [missionJournal,depositJournal]){
      try{journal.stop()}catch(error){firstError??=error}
    }
    if(firstError){stopFailure=true;fail('cancellation could not be persisted in both journals')}
    return {ok:true,reason:'operator_stopped',state:inspect()}
  }

  // Two distinct fresh approvals are required: one before creating an
  // adapter, one immediately before the durable dispatch. Async adapter
  // creation may involve an arbitrary delay during which a principal or
  // session can be revoked. Factories are trusted and MUST NOT mutate the
  // world: journal.runNext is the sole dispatch path.
  async function authorizationFresh(summary){
    let timer
    try{
      const granted=await Promise.race([
        Promise.resolve().then(()=>authorizeDispatch(summary)),
        new Promise((_,reject)=>{
          timer=setTimeout(()=>reject(Error('authorization_timeout')),AUTH_TIMEOUT_MS)
        })
      ])
      return granted===true
    }catch{
      return false
    }finally{if(timer)clearTimeout(timer)}
  }

  async function runNext(){
    if(stopped)return {ok:false,reason:'pipeline_stopped',state:inspect()}
    if(busy)return {ok:false,reason:'pipeline_busy',state:inspect()}
    const before=inspect()
    if(before.phase==='completed')return {ok:true,reason:'already_completed',state:before}
    if(before.phase==='blocked')return {ok:false,reason:before.reason,state:before}
    busy=true
    try{
      const index=before.phase==='gather'?before.gatherDone:before.depositsDone
      const step=before.phase==='gather'?targets[index]:items[index]
      const summary=Object.freeze({kind:before.phase,index,
        ownerName,worldMutation:true,
        target:before.phase==='gather'?step:chest,
        item:before.phase==='gather'?step.block:step.name,
        count:before.phase==='gather'?1:step.count})
      // The read-only authority query may be unavailable indefinitely. A
      // bounded wait prevents one broken external witness from wedging the
      // task runner. A late resolution can never trigger an action.
      if(!await authorizationFresh(summary))
        return {ok:false,reason:'authorization_unavailable',state:inspect()}
      if(stopped)return {ok:false,reason:'pipeline_stopped',state:inspect()}
      // Authorizer is async; a cancellation, revocation callback or changed
      // journal while it waited cannot dispatch a stale operation.
      if(!same(before,inspect()))
        return {ok:false,reason:'journal_changed_during_authorization',state:inspect()}
      let action
      try{
        action=before.phase==='gather'
          ?await createGatherAction(Object.freeze({...step}),summary)
          :await createDepositAction(Object.freeze({name:step.name,count:step.count,
            chest}),summary)
      }catch{
        return {ok:false,reason:'action_unavailable',state:inspect()}
      }
      if(stopped)return {ok:false,reason:'pipeline_stopped',state:inspect()}
      if(!same(before,inspect()))
        return {ok:false,reason:'journal_changed_before_dispatch',state:inspect()}
      // Re-check *after* asynchronous factory work, not just before it.
      // The journal is the only component allowed to mutate the world.
      if(!await authorizationFresh(summary))
        return {ok:false,reason:'authorization_unavailable',state:inspect()}
      if(stopped)return {ok:false,reason:'pipeline_stopped',state:inspect()}
      if(!same(before,inspect()))
        return {ok:false,reason:'journal_changed_before_dispatch',state:inspect()}
      // The durable operation journal checks adapter scope, writes an intent
      // barrier and only then invokes the world-changing adapter.
      const result=before.phase==='gather'
        ?await missionJournal.runNext(action)
        :await depositJournal.runNext(action)
      const after=inspect()
      return {ok:result?.ok===true,reason:result?.reason ||
        (result?.ok===true?'receipt_verified':'operation_not_verified'),state:after}
    }finally{busy=false}
  }

  async function runAll(){
    // At most 3 gather operations + 2 deposits. No automatic retry of failed,
    // paused, uncertain, replayed or inaccessible tasks.
    for(let n=0;n<total;n++){
      if(stopped)return {ok:false,reason:'pipeline_stopped',state:inspect()}
      const before=inspect()
      if(before.phase==='completed')return {ok:true,reason:'already_completed',state:before}
      const result=await runNext()
      if(result.ok!==true)return result
    }
    const state=inspect()
    return {ok:state.phase==='completed',reason:state.reason,state}
  }

  inspect() // Fail at creation if pre-existing receipts/progress are invalid.
  return Object.freeze({status:inspect,runNext,runAll,stop})
}
module.exports={createQaDeliveryPipeline,AUTH_TIMEOUT_MS}
