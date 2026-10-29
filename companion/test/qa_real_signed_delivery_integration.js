'use strict'

// Run ONLY inside the disposable real Fabric signed-connection harness.
// Never accepts Minecraft coordinates, keys or server endpoints from chat.
const path=require('node:path')
const fs=require('node:fs')
const crypto=require('node:crypto')
const {Vec3}=require('vec3')
const {Movements,goals}=require('mineflayer-pathfinder')
const {openMission}=require('../src/mission')
const {openDepositJournal,chestCount}=require('../src/deposit')
const {inventoryCount}=require('../src/gather')
const {issueQaDeliveryPlan}=require('../src/qa_delivery_plan_issuer')
const {createQaSignedMinecraftDelivery}=require('../src/qa_delivery_minecraft')

const target={x:7,y:64,z:2,block:'oak_log'}
const chest={x:1,y:64,z:5}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z)

async function runRealSignedDeliveryQa({bot,session,authority,operatorKey,journalDir}){
  if(!journalDir?.startsWith('/tmp/guiaia-fabric-bridge-qa-')||
     authority?.worldId!=='qa:real-fabric:25593' ||
     authority?.botName!=='GuiaIA_QA' ||
     bot?.username!=='GuiaIA_QA')
    throw Error('Real delivery requires disposable Fabric QA identity')
  if(bot.blockAt(new Vec3(target.x,target.y,target.z))?.name!==target.block ||
     bot.blockAt(new Vec3(chest.x,chest.y,chest.z))?.name!=='chest')
    throw Error('QA delivery block or separate chest not loaded')
  const reviewedSpec={sandboxOnly:true,ownerName:'OwnerQA',
    targets:[target],chest,items:[{name:'oak_log',count:1}]}
  const mission=openMission(path.join(journalDir,'delivery-mission'),{
    sandboxOnly:true,ownerName:reviewedSpec.ownerName,targets:reviewedSpec.targets
  })
  const deposit=openDepositJournal(path.join(journalDir,'delivery-deposit'),{
    sandboxOnly:true,ownerName:reviewedSpec.ownerName,
    chest:reviewedSpec.chest,items:reviewedSpec.items
  })
  const before=inventoryCount(bot,'oak_log')
  const atStart={...bot.entity.position}
  const seenGoals=[]
  const originalGoto=bot.pathfinder.goto.bind(bot.pathfinder)
  bot.pathfinder.goto=async goal=>{
    seenGoals.push({x:goal.x,y:goal.y,z:goal.z})
    return originalGoto(goal)
  }
  try{
    const issued=issueQaDeliveryPlan({
      bot,session,bundle:session,authority,operatorPrivateKey:operatorKey.privateKey,
      reviewedSpec,missionJournal:mission,depositJournal:deposit,
      approvalDirectory:path.join(journalDir,'delivery-approvals'),lifetimeMs:27000
    })
    const now=Date.now()
    const grantPayload={aud:'guiaia:session-deposit:v1',worldId:authority.worldId,
      botName:'GuiaIA_QA',ownerName:'OwnerQA',
      principalId:session.owner.payload.principalId,
      connectionId:session.bridge.payload.connectionId,
      challenge:session.bridge.payload.challenge,
      chest,item:'oak_log',count:1,nonce:crypto.randomUUID(),
      issuedAt:now-1000,expiresAt:Math.min(now+30000,
        session.bridge.payload.expiresAt,session.owner.payload.expiresAt)}
    const grant={payload:grantPayload,signature:crypto.sign(null,
      Buffer.from(JSON.stringify(grantPayload)),operatorKey.privateKey).toString('base64url')}
    const runner=createQaSignedMinecraftDelivery({
      bot,bundle:session,signedPlan:issued.signedPlan,authority,
      missionJournal:mission,depositJournal:deposit,
      depositGrants:{oak_log:grant},
      pickupTimeoutMs:12000,
      navigationClasses:{GoalNear:goals.GoalNear,Movements}
    })
    const gathered=await runner.runNext()
    const afterGather={...bot.entity.position}
    if(!gathered.ok || gathered.state.gatherDone!==1 ||
       gathered.state.phase!=='deposit' ||
       inventoryCount(bot,'oak_log')!==before+1 ||
       bot.blockAt(new Vec3(target.x,target.y,target.z))?.name==='oak_log'){
      const detail={gathered,before,now:inventoryCount(bot,'oak_log'),
        goals:seenGoals,atStart,afterGather,
        remainingBlock:bot.blockAt(new Vec3(target.x,target.y,target.z))?.name,
        botHealth:bot.health,
        ownerVisible:Boolean(bot.players?.OwnerQA?.entity)}
      process.stderr.write('GUIAIA_REAL_GATHER_FAILURE_DIAGNOSTIC='+
        JSON.stringify(detail)+'\n')
      throw Error('Real Fabric delivery gather did not prove world and inventory changes')
    }
    // Deliberate crash injection ONLY in the isolated signed-delivery
    // Fabric QA child. A transfer must be physically confirmed before the
    // process exits; deposit.json remains at the fsynced 'transferring' barrier.
    if(process.env.GUIAIA_QA_CRASH_DURING_SIGNED_DEPOSIT==='1'){
      const originalOpen=bot.openContainer.bind(bot)
      let targetSeen=false
      bot.openContainer=async block=>{
        const window=await originalOpen(block)
        if(block?.position?.x===chest.x &&
           block?.position?.y===chest.y &&
           block?.position?.z===chest.z){
          if(targetSeen)throw Error('Unexpected repeated crash QA chest open')
          targetSeen=true
          const pre=chestCount(window,'oak_log')
          const originalDeposit=window.deposit.bind(window)
          window.deposit=async(...args)=>{
            await originalDeposit(...args)
            let confirmed=false
            for(let i=0;i<20;i++){
              if(chestCount(window,'oak_log')===pre+1 &&
                 inventoryCount(bot,'oak_log')===before){
                confirmed=true;break
              }
              await new Promise(r=>setTimeout(r,100))
            }
            if(!confirmed)throw Error('QA crash requires real two-sided transfer proof')
            fs.writeSync(1,'GUIAIA_REAL_SIGNED_DELIVERY_CRASH_POINT_QA_EVIDENCE='+
              JSON.stringify({result:'pass',production:false,
                real_gather_receipts:mission.view().receipts.length,
                real_deposit_receipts:deposit.view().receipts.length,
                crash_phase:deposit.view().phase,
                transfer_confirmed_by_both_inventories:true,
                exact_crash:'after_world_transfer_before_durable_receipt',
                process_exit:77})+'\n')
            process.exit(77)
          }
        }
        return window
      }
    }
    const stored=await runner.runNext()
    const afterDeposit={...bot.entity.position}
    const container=await bot.openContainer(bot.blockAt(new Vec3(chest.x,chest.y,chest.z)))
    let oakInChest
    try{oakInChest=chestCount(container,'oak_log')}finally{container.close()}
    if(!stored.ok || stored.state.phase!=='completed' ||
       mission.view().receipts.length!==1 ||deposit.view().receipts.length!==1 ||
       inventoryCount(bot,'oak_log')!==before ||oakInChest!==1 ||
       !seenGoals.some(p=>p.x===target.x&&p.z===target.z) ||
       !seenGoals.some(p=>p.x===chest.x&&p.z===chest.z) ||
       distance(atStart,afterGather)<1 || distance(afterGather,afterDeposit)<1)
      throw Error('Real Fabric delivery deposit/return lacked durable evidence: '+
        JSON.stringify({stored,before,oakInChest,seenGoals,
          toResource:distance(atStart,afterGather),
          toChest:distance(afterGather,afterDeposit)}))
    const evidence={result:'pass',production:false,
      real_fabric_server:true,real_mineflayer_bot:true,
      operator_signed_plan:true,live_fabric_presence:true,
      checked_independent_qa_witness:true,
      actual_block_removed:true,actual_inventory_pickup:true,
      actual_chest_transfer:true,
      gather_receipts:1,deposit_receipts:1,
      navigation_goals:seenGoals.length,
      moved_to_resource_blocks:+distance(atStart,afterGather).toFixed(3),
      returned_to_chest_blocks:+distance(afterGather,afterDeposit).toFixed(3),
      owner_connection_verified:true}
    console.log('GUIAIA_REAL_SIGNED_DELIVERY_QA_EVIDENCE='+JSON.stringify(evidence))
    return evidence
  }finally{
    bot.pathfinder.goto=originalGoto
    mission.close()
    deposit.close()
  }
}
module.exports={runRealSignedDeliveryQa}
