'use strict'

// Real Fabric QA only: two independently signed resource types, each with
// exactly one gathered block and a separately signed chest transfer.
// No chat, CLI, RCON or production execution entrypoint.
const path=require('node:path')
const crypto=require('node:crypto')
const {Vec3}=require('vec3')
const {Movements,goals}=require('mineflayer-pathfinder')
const {inventoryCount}=require('../src/gather')
const {chestCount,openDepositJournal}=require('../src/deposit')
const {openMission}=require('../src/mission')
const {issueQaDeliveryPlan}=require('../src/qa_delivery_plan_issuer')
const {createQaSignedMinecraftDelivery}=require('../src/qa_delivery_minecraft')

const targets=Object.freeze([
  Object.freeze({x:7,y:64,z:2,block:'oak_log'}),
  Object.freeze({x:7,y:64,z:3,block:'birch_log'})
])
const items=Object.freeze([
  Object.freeze({name:'oak_log',count:1}),
  Object.freeze({name:'birch_log',count:1})
])
const chest=Object.freeze({x:1,y:64,z:5})
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const exactBlock=(bot,position,name)=>
  bot.blockAt(new Vec3(position.x,position.y,position.z))?.name===name

async function runRealSignedMultiDeliveryQa({bot,session,authority,operatorKey,journalDir}){
  if(typeof journalDir!=='string' ||
     !(/^\/tmp\/guiaia-fabric-bridge-qa-[a-z0-9_-]+\/journal$/.test(journalDir)||/^guiaia-fabric-bridge-qa-[a-zA-Z0-9_-]+[\\\/]journal$/.test(path.relative(require('node:os').tmpdir(),journalDir))) ||
     authority?.sandboxOnly!==true ||
     authority?.identityMode!=='trusted_server_bridge_lab' ||
     authority?.worldId!=='qa:real-fabric:25593' ||
     authority?.botName!=='GuiaIA_QA' ||
     bot?.username!=='GuiaIA_QA' || operatorKey?.privateKey?.asymmetricKeyType!=='ed25519' ||
     !Array.isArray(bot.inventory?.items?.()))
    throw Error('Multi-resource QA must have trusted disposable Fabric identity')
  for(const target of targets)
    if(!exactBlock(bot,target,target.block))
      throw Error('Expected reviewed QA source block is unavailable: '+target.block)
  if(!exactBlock(bot,chest,'chest'))
    throw Error('Expected reviewed QA chest is unavailable')
  const baseline=Object.fromEntries(items.map(item=>[item.name,inventoryCount(bot,item.name)]))
  if(!items.every(i=>baseline[i.name]===1))
    throw Error('Multi-resource QA requires exactly one pre-existing item per type')
  const spec={sandboxOnly:true,ownerName:'OwnerQA',targets:targets.map(t=>({...t})),
    chest:{...chest},items:items.map(i=>({...i}))}
  const mission=openMission(path.join(journalDir,'multi-resource-mission'),{
    sandboxOnly:true,ownerName:'OwnerQA',targets:spec.targets
  })
  const deposit=openDepositJournal(path.join(journalDir,'multi-resource-deposit'),{
    sandboxOnly:true,ownerName:'OwnerQA',chest:spec.chest,items:spec.items
  })
  // Diagnostic-only pass-through. The journal remains the sole action
  // dispatcher; no retry, receipt fabrication or error masking is possible.
  const journalRunNext=mission.runNext.bind(mission)
  mission.runNext=action=>journalRunNext({...action,
    async gatherOne(){
      const posBefore=bot.entity?.position?{...bot.entity.position}:null
      const invBefore=inventoryCount(bot,action.block)
      const proof=await action.gatherOne()
      const posAfter=bot.entity?.position?{...bot.entity.position}:null
      const invAfter=inventoryCount(bot,action.block)
      const blockAfter=bot.blockAt(new Vec3(action.target.x,action.target.y,action.target.z))?.name
      const nearbyItems=Object.values(bot.entities||{})
        .filter(e=>e.name==='item')
        .map(e=>({pos:e.position}))
      console.error('GUIAIA_MULTI_GATHER_ACTION_QA_DIAGNOSTIC='+JSON.stringify({
        block:action.block,ok:proof?.ok,reason:proof?.reason,
        dig_attempted:proof?.dig_attempted,
        inventory_delta:proof?.inventory_delta,
        navigation_used:proof?.navigation_used,
        posBefore,posAfter,invBefore,invAfter,blockAfter,nearbyItems
      }))
      return proof
    }
  })
  const journalDepositNext=deposit.runNext.bind(deposit)
  deposit.runNext=action=>journalDepositNext({...action,
    async depositOne(){
      const proof=await action.depositOne()
      console.error('GUIAIA_MULTI_DEPOSIT_ACTION_QA_DIAGNOSTIC='+JSON.stringify({
        item:action.item,ok:proof?.ok,reason:proof?.reason,
        transferAttempted:proof?.transferAttempted,
        playerBefore:proof?.playerBefore,playerAfter:proof?.playerAfter,
        chestBefore:proof?.chestBefore,chestAfter:proof?.chestAfter
      }))
      return proof
    }
  })
  const observedGoals=[]
  const originalGoto=bot.pathfinder.goto.bind(bot.pathfinder)
  bot.pathfinder.goto=async goal=>{
    observedGoals.push({x:goal.x,y:goal.y,z:goal.z})
    return originalGoto(goal)
  }
  try{
    const issued=issueQaDeliveryPlan({bot,bundle:session,authority,
      operatorPrivateKey:operatorKey.privateKey,reviewedSpec:spec,
      missionJournal:mission,depositJournal:deposit,
      approvalDirectory:path.join(journalDir,'multi-resource-approvals'),
      lifetimeMs:100000})
    const grants={}
    for(const item of items){
      const now=Date.now()
      const payload={aud:'guiaia:session-deposit:v1',worldId:authority.worldId,
        botName:'GuiaIA_QA',ownerName:'OwnerQA',
        principalId:session.owner.payload.principalId,
        connectionId:session.bridge.payload.connectionId,
        challenge:session.bridge.payload.challenge,
        chest:{...chest},item:item.name,count:item.count,
        nonce:crypto.randomUUID(),issuedAt:now-1000,
        expiresAt:Math.min(now+100000,session.owner.payload.expiresAt,
          session.bridge.payload.expiresAt)}
      grants[item.name]={payload,signature:crypto.sign(null,
        Buffer.from(JSON.stringify(payload)),operatorKey.privateKey)
        .toString('base64url')}
    }
    const run=createQaSignedMinecraftDelivery({
      bot,bundle:session,signedPlan:issued.signedPlan,authority,
      missionJournal:mission,depositJournal:deposit,
      depositGrants:grants,pickupTimeoutMs:12000,
      navigationClasses:{GoalNear:goals.GoalNear,Movements}
    })

    const proof=[]
    for(let i=0;i<targets.length;i++){
      if(i>0)await sleep(900) // Pace independent signed steps, never reuse proof.
      const result=await run.runNext()
      proof.push({kind:'gather',index:i,result})
      if(!result.ok || result.state.gatherDone!==i+1 ||
         result.state.depositsDone!==0 ||
         !exactBlock(bot,chest,'chest') ||
         exactBlock(bot,targets[i],targets[i].block) ||
         inventoryCount(bot,targets[i].block)!==baseline[targets[i].block]+1 ||
         deposit.view().receipts.length!==0){
        throw Error('Real multi-resource gather did not conserve per-item receipt: '+
          JSON.stringify({index:i,proof:result,mission:mission.view(),
            deposit:deposit.view(),inventory:inventoryCount(bot,targets[i].block)}))
      }
      if(i===0 && result.state.phase!=='gather')
        throw Error('Early deposit permitted before all gathering completed')
      if(i===1 && (result.state.phase!=='deposit' ||
                    mission.view().receipts.length!==2 ||
                    mission.view().phase!=='completed'))
        throw Error('All gathering did not finish before deposit phase')
    }
    const afterGather={...bot.entity.position}
    for(let i=0;i<items.length;i++){
      await sleep(900) // Leave a quiescent boundary before each chest action.
      const item=items[i]
      const result=await run.runNext()
      proof.push({kind:'deposit',index:i,result})
      if(!result.ok || result.state.depositsDone!==i+1 ||
         result.state.gatherDone!==2 ||
         inventoryCount(bot,item.name)!==baseline[item.name] ||
         deposit.view().receipts.length!==i+1)
        throw Error('Real multi-resource deposit missing exact durable receipt: '+
          JSON.stringify({index:i,proof:result,deposit:deposit.view(),
            inventory:inventoryCount(bot,item.name)}))
      const container=await bot.openContainer(bot.blockAt(
        new Vec3(chest.x,chest.y,chest.z)))
      let inChest
      try{inChest=chestCount(container,item.name)}
      finally{container.close()}
      if(inChest!==1)
        throw Error('Physical chest count differs from signed deposit receipt: '+item.name)
      if(i===0 && (result.state.phase!=='deposit' ||
                    inventoryCount(bot,'birch_log')!==baseline.birch_log+1))
        throw Error('First deposit skipped or altered second material')
      if(i===1 && result.state.phase!=='completed')
        throw Error('All deposit steps did not durably finish')
    }
    const container=await bot.openContainer(bot.blockAt(
      new Vec3(chest.x,chest.y,chest.z)))
    let finalChest
    try{finalChest=Object.fromEntries(items.map(item=>
      [item.name,chestCount(container,item.name)]))}
    finally{container.close()}
    const finalInventory=Object.fromEntries(items.map(item=>
      [item.name,inventoryCount(bot,item.name)]))
    if(!same(finalChest,{oak_log:1,birch_log:1}) ||
       !same(finalInventory,baseline) ||
       mission.view().receipts.length!==2 ||
       deposit.view().receipts.length!==2 ||
       run.status().phase!=='completed' ||
       !observedGoals.some(g=>g.x===chest.x&&g.z===chest.z) ||
       Math.hypot(afterGather.x-bot.entity.position.x,
         afterGather.z-bot.entity.position.z)<1)
      throw Error('Real multi-resource final consistency or return movement failed')
    const evidence={result:'pass',production:false,
      real_fabric_server:true,real_mineflayer_bot:true,
      signed_plan:true,live_owner_session:true,
      resources:['oak_log','birch_log'],gather_receipts:2,
      deposit_receipts:2,ordered_operations:proof.map(p=>p.kind),
      physical_chest:finalChest,
      player_inventory_baseline:baseline,
      player_inventory_after:finalInventory,
      chest_return_navigation_verified:true,
      two_resource_blocks_removed:true,
      independent_deposit_grants:2,
      no_deposit_before_all_gather:true,
      next_step_after_completion:await run.runNext()}
    if(evidence.next_step_after_completion?.reason!=='already_completed')
      throw Error('Completed multi-resource plan did not reject further execution')
    console.log('GUIAIA_REAL_SIGNED_MULTI_DELIVERY_QA_EVIDENCE='+JSON.stringify(evidence))
    return evidence
  }finally{
    bot.pathfinder.goto=originalGoto
    mission.close()
    deposit.close()
  }
}
module.exports={runRealSignedMultiDeliveryQa}
