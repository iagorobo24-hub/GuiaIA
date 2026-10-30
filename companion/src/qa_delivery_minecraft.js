'use strict'

// Opt-in, disposable world integration only. No stdin, chat, LLM, RCON or MCP
// command entrypoint. Every gather/deposit still passes through the signed
// session-delivery pipeline's durable intent and one-use step barriers.
const {createQaGather}=require('./gather')
const {createQaStrictSessionActionGateway}=require('./session_identity')
const {createQaSignedDeliveryPipeline}=require('./qa_signed_delivery')
const {createQaBoundedNavigation}=require('./qa_bounded_navigation')
const {Vec3}=require('vec3')
const RESOURCE=Object.freeze({oak_log:true,birch_log:true})

function createQaSignedMinecraftDelivery({bot,bundle,signedPlan,authority,
  missionJournal,depositJournal,depositGrants,pickupTimeoutMs=12000,
  navigationClasses=null}={}){
  if(authority?.sandboxOnly!==true ||
     authority.identityMode!=='trusted_server_bridge_lab' ||
     bot?.username!==authority.botName ||
     !depositGrants || Object.getPrototypeOf(depositGrants)!==Object.prototype ||
     Object.keys(depositGrants).length<1 ||
     Object.keys(depositGrants).length>2 ||
     Object.keys(depositGrants).some(item=>!Object.hasOwn(RESOURCE,item)) ||
     !Number.isInteger(pickupTimeoutMs) || pickupTimeoutMs<1 ||
     pickupTimeoutMs>30000)
    throw Error('Only bounded, operator-scoped Minecraft delivery QA supported')
  // The deposit gateway (unlike the historical raw chest adapter) enforces
  // real Fabric live nonce evidence and a separate pinned revocation witness.
  const gateway=createQaStrictSessionActionGateway(bot,authority)
  if(!gateway || typeof gateway.createDeposit!=='function')
    throw Error('Strict signed session deposit gateway unavailable')
  const grants=Object.freeze({...depositGrants})
  const ownerName=signedPlan?.payload?.ownerName
  // Navigation is OPT-IN and exclusively part of the signed journal action.
  // Constructing the pipeline never moves the Minecraft bot.
  const navigation=navigationClasses===null?null:createQaBoundedNavigation({
    bot,ownerName,sandboxOnly:true,
    GoalNear:navigationClasses?.GoalNear,Movements:navigationClasses?.Movements
  })
  return createQaSignedDeliveryPipeline({bot,bundle,signedPlan,authority,
    missionJournal,depositJournal,
    async createGatherAction(target){
      // No autonomous exploration or pathfinder shortcuts: only a nearby
      // exact block in the operator-signed, bounded QA plan.
      // Mineflayer blockAt expects Vec3, not a plain signed-plan JSON point.
      const point=new Vec3(target.x,target.y,target.z)
      const operation=createQaGather(bot,{
        sandboxOnly:true,ownerName,target:point,resource:target.block,
        pickupTimeoutMs,
        ...(navigation?{
          preDigApproach:point=>navigation.approach(point,{desiredDistance:3.2}),
          pickupApproach:point=>navigation.approach(point,{desiredDistance:0})
        }:{})})
      return {sandboxOnly:true,ownerName,target:point,block:target.block,
        gatherOne:()=>operation.gatherOne(),cancel(){
          operation.cancel();navigation?.cancel()
        }}
    },
    async createDepositAction(step){
      if(!Object.hasOwn(grants,step.name))
        throw Error('Signed per-resource chest capability unavailable')
      // createDeposit checks scope at construction and again at actual
      // dispatch; signed delivery additionally guards the composite plan.
      const action=gateway.createDeposit(bundle,grants[step.name])
      if(!navigation)return action
      return Object.freeze({sandboxOnly:true,ownerName,
        item:action.item,count:action.count,chest:action.chest,
        cancel(){action.cancel?.();navigation.cancel()},
        async depositOne(){
          // This occurs INSIDE the signed adapter's revocation watchdog and
          // AFTER the deposit journal's durable intent barrier.
          try{await navigation.approach(step.chest,{desiredDistance:3.2})}
          catch{return {ok:false,transferAttempted:false,
            reason:'qa_chest_navigation_failed'}}
          return action.depositOne()
        }})
    }})
}
module.exports={createQaSignedMinecraftDelivery}
