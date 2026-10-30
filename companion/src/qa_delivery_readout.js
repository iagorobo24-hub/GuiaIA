'use strict'

// Read-only QA report for an operator. This is NOT an authorization gateway:
// there are no world-action adapters, no journal writes and no active Fabric
// presence check. Only signed, bounded plans can be inspected.
const {verifyQaDeliveryPlan}=require('./qa_signed_delivery')
const {createQaDeliveryPipeline}=require('./qa_delivery_pipeline')

function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function freeze(value){
  if(value && typeof value==='object'){
    for(const item of Object.values(value))freeze(item)
    Object.freeze(value)
  }
  return value
}

function createQaDeliveryReadout({signedPlan,authority,missionJournal,
  depositJournal,now=Date.now()}={}){
  if(!Number.isSafeInteger(now))throw Error('QA readout requires a valid inspection time')
  // Verify historical expired plans without pretending they are still
  // authorized. The signature, scope, duration and coordinates must STILL
  // verify. Only readout is permitted to use the historical verification time.
  const expiry=signedPlan?.payload?.expiresAt
  const verificationNow=Number.isSafeInteger(expiry) && expiry<now?expiry:now
  const verified=verifyQaDeliveryPlan(signedPlan,authority,verificationNow)
  const p=verified.approvedPlan
  const pipeline=createQaDeliveryPipeline({missionJournal,depositJournal,
    approvedPlan:p,
    authorizeDispatch:()=>false,
    createGatherAction:()=>{throw Error('QA readout cannot create gather actions')},
    createDepositAction:()=>{throw Error('QA readout cannot create deposit actions')}})
  const firstMission=missionJournal.view(),firstDeposit=depositJournal.view()
  const progress=pipeline.status()
  const mission=missionJournal.view(),deposit=depositJournal.view()
  // A non-atomic pair of reads can race the live runner. Never report a
  // confidently settled status from inconsistent views.
  if(!same(firstMission,mission)||!same(firstDeposit,deposit) ||
     !same(progress,pipeline.status()))
    throw Error('QA readout saw journals changing during inspection')
  const expiresAt=signedPlan.payload.expiresAt
  const validFrom=signedPlan.payload.issuedAt
  const tokenState=now<validFrom?'not_yet_valid':now>expiresAt?'expired':'within_signed_window'
  const current=progress.phase
  function stepState(i,index,journalPhase,enabled){
    if(i<index)return 'journal_receipt_present'
    if(i>index)return 'not_started'
    if(current==='blocked')return 'blocked_for_manual_review'
    return enabled?'next_step_requires_live_authorization':'waiting_for_prior_steps'
  }
  const steps=[
    ...p.targets.map((target,index)=>({
      sequence:index+1,kind:'gather',block:target.block,
      target:{x:target.x,y:target.y,z:target.z},
      state:stepState(index,mission.index,mission.phase,current==='gather'),
      ...(index<mission.index?{receipt:{
        operationId:mission.receipts[index].operationId,
        inventoryDelta:mission.receipts[index].inventoryDelta
      }}:{})
    })),
    ...p.items.map((item,index)=>({
      sequence:p.targets.length+index+1,kind:'deposit',
      item:item.name,count:item.count,target:{...p.chest},
      state:stepState(index,deposit.index,deposit.phase,current==='deposit'),
      ...(index<deposit.index?{receipt:{
        operationId:deposit.receipts[index].operationId,
        playerBefore:deposit.receipts[index].playerBefore,
        playerAfter:deposit.receipts[index].playerAfter,
        chestBefore:deposit.receipts[index].chestBefore,
        chestAfter:deposit.receipts[index].chestAfter
      }}:{})
    }))
  ]
  const manualReview=current==='blocked'
  let operatorNext
  if(current==='completed')operatorNext='archive_completed_qa_evidence'
  else if(manualReview)operatorNext='inspect_uncertain_journal_and_reconcile_world_manually'
  else if(tokenState!=='within_signed_window')
    operatorNext='operator_review_new_approval_required_no_automatic_reissue'
  else operatorNext='require_new_live_fabric_presence_and_witness_before_any_dispatch'
  return freeze({version:1,sandboxOnly:true,readOnly:true,
    worldId:verified.scope.worldId,principalId:verified.scope.principalId,
    ownerName:p.ownerName,missionId:p.missionId,depositPlanId:p.planId,
    observedAt:now,issuedAt:validFrom,expiresAt,
    signedWindow:tokenState,phase:current,
    reason:progress.reason,
    journalPhases:{gather:mission.phase,deposit:deposit.phase},
    completedSteps:progress.completedSteps,totalSteps:progress.totalSteps,
    requiresManualReview:manualReview,
    canDispatchWithoutFreshAuthorization:false,
    operatorNext,steps,
    evidenceQualification:'journal_receipts_only_not_independently_verified_world_state',
    liveFabricPresenceChecked:false,independentWitnessChecked:false})
}
module.exports={createQaDeliveryReadout}
