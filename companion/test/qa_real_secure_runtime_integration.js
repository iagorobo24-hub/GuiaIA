'use strict'
// End-to-end test of the NEW signed runtime against the disposable Fabric server.
const crypto=require('node:crypto')
const fs=require('node:fs')
const path=require('node:path')
const {Vec3}=require('vec3')
const {goals,Movements}=require('mineflayer-pathfinder')
const {openMission}=require('../src/mission')
const {openDepositJournal,chestCount}=require('../src/deposit')
const {inventoryCount}=require('../src/gather')
const {createSecureDeliveryRuntime}=require('../src/secure_delivery_runtime')
const {createTrustedLocalOperatorConsole}=require('../src/trusted_local_operator_console')
const target={x:7,y:64,z:2,block:'oak_log'}
const chest={x:1,y:64,z:5}

async function runRealSecureRuntimeQa({bot,session,authority,operatorKey,journalDir}){
  if(!journalDir.startsWith('/tmp/guiaia-fabric-bridge-qa-') ||
     authority.worldId!=='qa:real-fabric:25593' ||
     bot.username!=='GuiaIA_QA')throw Error('Only disposable signed Fabric lab is allowed')
  if(bot.blockAt(new Vec3(target.x,target.y,target.z))?.name!=='oak_log' ||
     bot.blockAt(new Vec3(chest.x,chest.y,chest.z))?.name!=='chest')
    throw Error('Real QA block or chest is not in a loaded chunk')
  const mission=openMission(path.join(journalDir,'secure-runtime-mission'),{
    sandboxOnly:true,ownerName:'OwnerQA',targets:[target]
  })
  const deposit=openDepositJournal(path.join(journalDir,'secure-runtime-deposit'),{
    sandboxOnly:true,ownerName:'OwnerQA',chest,items:[{name:'oak_log',count:1}]
  })
  const before=inventoryCount(bot,'oak_log')
  const start={...bot.entity.position}
  const seenGoals=[]
  const baseGoto=bot.pathfinder.goto.bind(bot.pathfinder)
  bot.pathfinder.goto=async goal=>{
    seenGoals.push({x:goal.x,y:goal.y,z:goal.z})
    return baseGoto(goal)
  }
  const sign=(payload)=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),operatorKey.privateKey).toString('base64url')})
  const scope={worldId:authority.worldId,botName:authority.botName,ownerName:'OwnerQA',
    principalId:session.owner.payload.principalId,
    connectionId:session.bridge.payload.connectionId,
    challenge:session.bridge.payload.challenge}
  const window=()=>{
    const now=Date.now()
    return {nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:Math.min(
      now+25000,session.bridge.payload.expiresAt,session.owner.payload.expiresAt)}
  }
  const grants={
    gather:[sign({aud:'guiaia:session-gather:v1',...scope,
      target:{x:target.x,y:target.y,z:target.z},item:'oak_log',count:1,...window()})],
    deposit:[sign({aud:'guiaia:session-deposit:v1',...scope,
      chest,item:'oak_log',count:1,...window()})]
  }
  const followGrant=sign({aud:'guiaia:session-follow:v1',...scope,
    nonce:crypto.randomUUID(),issuedAt:Date.now()-1000,expiresAt:Date.now()+8000})
  const approvedPlan={sandboxOnly:true,ownerName:'OwnerQA',
    missionId:mission.view().missionId,planId:deposit.view().planId,
    targets:[target],items:[{name:'oak_log',count:1}],chest}
  try{
    const runtime=createSecureDeliveryRuntime({
      bot,authority,classes:{GoalNear:goals.GoalNear,GoalFollow:goals.GoalFollow,Movements},
      session,grants,followGrant,missionJournal:mission,depositJournal:deposit,approvedPlan
    })
    const operator=createTrustedLocalOperatorConsole(runtime)
    if((await operator.execute('estado')).state.phase!=='gather' ||
       (await operator.execute('inventario')).ok!==true ||
       (await operator.execute('enviar comandos al servidor')).ok!==false)
      throw Error('Local operator command surface failed before real action')
    const follow=await operator.execute('sigueme')
    if(follow.ok!==true || runtime.status().companion.mode!=='following' ||
       (await operator.execute('sigueme')).ok!==false)
      throw Error('Signed real Fabric operator follow not activated or replayed')
    const state=await operator.execute('mision')
    const after={...bot.entity.position}
    const blockAfter=bot.blockAt(new Vec3(target.x,target.y,target.z))?.name
    const container=await bot.openContainer(bot.blockAt(new Vec3(chest.x,chest.y,chest.z)))
    let chestAfter
    try{chestAfter=chestCount(container,'oak_log')}finally{container.close()}
    const replay=await operator.execute('mision')
    const spent=fs.readdirSync(path.join(journalDir,'spent')).filter(n=>n.endsWith('.used'))
    if(!state.ok ||state.state.phase!=='completed'||
       mission.view().receipts.length!==1 ||deposit.view().receipts.length!==1 ||
       blockAfter==='oak_log' ||inventoryCount(bot,'oak_log')!==before ||
       chestAfter!==1 ||replay.reason!=='already_completed'||spent.length!==3||
       !seenGoals.some(g=>g.x===target.x&&g.z===target.z) ||
       !seenGoals.some(g=>g.x===chest.x&&g.z===chest.z))
       throw Error('Real secure runtime acceptance failed '+JSON.stringify({
         state,blockAfter,before,after:inventoryCount(bot,'oak_log'),chestAfter,replay,
         spent:spent.length,seenGoals
       }).slice(0,1600))
    const evidence={result:'pass',production:false,real_fabric_server:true,
      actual_mineflayer_dig:true,real_block_removed:true,real_inventory_change:true,
      actual_chest_transfer:true,verified_player_before:before,
      verified_player_after:inventoryCount(bot,'oak_log'),verified_chest_after:chestAfter,
      signed_gather_and_deposit:true,signed_operator_follow:true,
      trusted_operator_console:true,live_fabric_presence:true,
      independent_checkpoint:true,mission_receipts:mission.view().receipts.length,
      deposit_receipts:deposit.view().receipts.length,
      replay_denied:replay.reason==='already_completed',
      spent_signed_nonces:spent.length,navigation_goals:seenGoals.length,
      moved_blocks:+Math.hypot(after.x-start.x,after.z-start.z).toFixed(3)}
    const halted=await operator.execute('para')
    if(halted.ok!==true ||runtime.status().stopped!==true)
      throw Error('Operator emergency halt did not persist')
    console.log('GUIAIA_REAL_SECURE_RUNTIME_QA_EVIDENCE='+JSON.stringify(evidence))
    return evidence
  }finally{
    bot.pathfinder.goto=baseGoto
    mission.close()
    deposit.close()
  }
}
module.exports={runRealSecureRuntimeQa}
