'use strict'
// Multi-resource Minecraft QA: only pre-planted oak and birch inside an
// ephemeral loopback world. No production server, chat or arbitrary tasks.
const fs=require('node:fs')
const mineflayer=require('mineflayer')
const {Vec3}=require('vec3')
const {pathfinder,Movements,goals}=require('mineflayer-pathfinder')
const {createQaGather,inventoryCount}=require('../src/gather')
const {openMission}=require('../src/mission')
const {createQaChestDeposit,openDepositJournal,chestCount}=require('../src/deposit')

const dir=process.env.GUIAIA_QA_MISSION_DIR
if(!dir || !dir.startsWith('/tmp/guiaia-mission-qa-')) {
  throw new Error('Disposable QA mission directory required')
}
const address={host:'127.0.0.1',port:25596,version:'1.21.1',
  auth:'offline',hideErrors:true}
const owner=mineflayer.createBot({...address,username:'OwnerQA'})
const worker=mineflayer.createBot({...address,username:'GuiaIA_QA'})
worker.loadPlugin(pathfinder)
const targets=[
  {x:3,y:64,z:2,block:'oak_log'},
  {x:9,y:64,z:2,block:'birch_log'}
]
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const spawned=bot=>bot.entity?.position?Promise.resolve():
  new Promise((resolve,reject)=>{
    bot.once('spawn',resolve)
    bot.once('end',()=>reject(Error('QA bot disconnected before spawn')))
    bot.once('error',()=>reject(Error('QA Minecraft connection error')))
  })
async function main(){
  const watchdog=setTimeout(()=>{
    console.error('QA multi-resource watchdog')
    process.exitCode=1;owner.end();worker.end()
  },85000)
  let journal=null
  try{
    await Promise.all([spawned(owner),spawned(worker)])
    for(let i=0;i<65;i++){
      if(worker.players?.OwnerQA?.entity &&
         targets.every(p=>worker.blockAt(new Vec3(p.x,p.y,p.z))?.name===p.block))break
      await sleep(250)
    }
    if(!worker.players?.OwnerQA?.entity ||
       !targets.every(p=>worker.blockAt(new Vec3(p.x,p.y,p.z))?.name===p.block)){
      throw Error('QA owner or planted resources missing')
    }
    await owner.lookAt(new Vec3(owner.entity.position.x,
      owner.entity.position.y+1.6,owner.entity.position.z+7),true)
    owner.setControlState('forward',true)
    let ownerDistance=0
    for(let i=0;i<20;i++){
      await sleep(140)
      ownerDistance=Math.hypot(owner.entity.position.x-3.5,
        owner.entity.position.z-2.5)
      if(ownerDistance>=3.5)break
    }
    owner.setControlState('forward',false)
    if(ownerDistance<3.0 || ownerDistance>13) throw Error('Owner could collect QA drop')
    const moves=new Movements(worker)
    moves.canDig=false
    moves.canOpenDoors=false
    moves.allowParkour=false
    moves.allow1by1towers=false
    moves.allowFreeMotion=false
    moves.allowSprinting=false
    worker.pathfinder.setMovements(moves)
    journal=openMission(dir,{sandboxOnly:true,ownerName:'OwnerQA',targets})
    const original={
      oak_log:inventoryCount(worker,'oak_log'),
      birch_log:inventoryCount(worker,'birch_log')
    }
    if(original.oak_log!==0 || original.birch_log!==0) {
      throw Error('QA inventories must start empty')
    }
    let preDigNavigationCount=0
    let navDistance=0
    for(const [i,target] of targets.entries()){
      const beforePosition={...worker.entity.position}
      const resource=new Vec3(target.x,target.y,target.z)
      const gather=createQaGather(worker,{
        sandboxOnly:true,ownerName:'OwnerQA',target:resource,
        resource:target.block,pickupTimeoutMs:19500,
        preDigApproach:async p=>{
          // Bounded to the exact QA block. Digging and building are disabled
          // in the pathfinder, and owner-distance checks run in gather().
          const goal=new goals.GoalNear(p.x,p.y,p.z,2)
          await Promise.race([
            worker.pathfinder.goto(goal),
            new Promise((_,reject)=>setTimeout(
              ()=>reject(Error('navigation_time_budget_exceeded')),11000))
          ])
        },
        pickupApproach:async p=>{
          worker.pathfinder.setGoal(new goals.GoalBlock(p.x,p.y,p.z))
        }
      })
      const action={ownerName:'OwnerQA',sandboxOnly:true,target,
        block:target.block,gatherOne:()=>gather.gatherOne(),
        cancel:()=>gather.cancel()}
      let underlying
      action.gatherOne=async()=>{
        underlying=await gather.gatherOne()
        return underlying
      }
      const result=await journal.runNext(action)
      if(!result.ok || !underlying) {
        throw Error('QA multi-resource step '+i+' denied: '+
          result.reason+' phase='+result.state?.phase)
      }
      if(underlying.block!==target.block || underlying.item!==target.block ||
         underlying.inventory_delta<1 || !underlying.dig_attempted) {
        throw Error('Wrong resource or missing real inventory receipt')
      }
      if(worker.blockAt(resource)?.name===target.block)throw Error('Target block remains')
      if(target.block==='birch_log'){
        if(!underlying.navigation_used)throw Error('Birch navigation did not run')
        preDigNavigationCount++
        navDistance=Math.hypot(
          worker.entity.position.x-beforePosition.x,
          worker.entity.position.z-beforePosition.z)
        if(navDistance<2)throw Error('Unverified player path movement')
      }
    }
    const inventory={
      oak_log:inventoryCount(worker,'oak_log'),
      birch_log:inventoryCount(worker,'birch_log')
    }
    if(inventory.oak_log<1 || inventory.birch_log<1 ||
       journal.view().receipts.length!==2 ||
       journal.view().phase!=='completed') {
      throw Error('Mixed resources not verified')
    }
    journal.close()
    journal=null
    const restored=openMission(dir)
    try{
      const state=restored.view()
      if(state.phase!=='completed' ||
         state.receipts[0].item!=='oak_log' ||
         state.receipts[1].item!=='birch_log'){
        throw Error('Durable typed resource receipts were not restored')
      }
      const duplicate=await restored.runNext({
        ownerName:'OwnerQA',sandboxOnly:true,target:targets[1],
        block:'birch_log',gatherOne:async()=>{throw Error('FORBIDDEN_REPLAY')}
      })
      if(duplicate.reason!=='mission_not_ready')throw Error('Replay was allowed')
      if(process.platform!=='win32' && ((fs.statSync(dir).mode&0o777)!==0o700 ||
         (fs.statSync(dir+'/mission.json').mode&0o777)!==0o600)) {
        throw Error('Typed journal permissions unsafe')
      }
      console.log('GUIAIA_MULTI_RESOURCE_QA_EVIDENCE='+JSON.stringify({
        result:'pass',real_minecraft_server:true,authorized_targets:2,
        types:['oak_log','birch_log'],receipts:2,
        inventory_before:original,inventory_after:inventory,
        birch_navigation_used:preDigNavigationCount===1,
        birch_displacement_blocks:Number(navDistance.toFixed(3)),
        replay_denied:true,persisted_reopen:true,
        world_mutations:2,production:false,sandbox_only:true
      }))
    }finally{restored.close()}
    // END-TO-END LAB: these are exactly the real items harvested above.
    // No /give or artificial inventory injection in this server.
    const chestPos={x:7,y:64,z:3}
    const chestBlock=worker.blockAt(new Vec3(chestPos.x,chestPos.y,chestPos.z))
    if(chestBlock?.name!=='chest')throw Error('Approved QA chest missing after harvest')
    const depositDir=dir+'/deposit-ledger'
    const storage=openDepositJournal(depositDir,{
      sandboxOnly:true,ownerName:'OwnerQA',chest:chestPos,
      items:[{name:'oak_log',count:1},{name:'birch_log',count:1}]
    })
    try{
      for(const name of ['oak_log','birch_log']){
        const adapter=createQaChestDeposit(worker,{
          sandboxOnly:true,ownerName:'OwnerQA',chest:chestPos,item:name,count:1
        })
        let proof
        const actual=adapter.depositOne
        adapter.depositOne=async()=>{proof=await actual();return proof}
        const receipt=await storage.runNext(adapter)
        if(!receipt.ok)throw Error('Harvest-to-chest transfer failed: '+
          receipt.reason+'; '+JSON.stringify(proof||{}).slice(0,280))
      }
      if(inventoryCount(worker,'oak_log')!==0 ||
         inventoryCount(worker,'birch_log')!==0)throw Error('Harvested inventory not emptied')
      const window=await worker.openContainer(chestBlock)
      let oak, birch
      try{
        oak=chestCount(window,'oak_log')
        birch=chestCount(window,'birch_log')
      }finally{window.close()}
      if(oak!==1||birch!==1)throw Error('Real chest does not contain both mined items')
      storage.close()
      const reopened=openDepositJournal(depositDir)
      try{
        if(reopened.view().phase!=='completed' || reopened.view().receipts.length!==2 ||
           (await reopened.runNext({})).reason!=='not_ready') {
          throw Error('Harvest-to-chest replay or durable receipts invalid')
        }
      }finally{reopened.close()}
      console.log('GUIAIA_GATHER_TO_CHEST_QA_EVIDENCE='+JSON.stringify({
        result:'pass',real_minecraft_server:true,gathered:{oak_log:1,birch_log:1},
        bot_after_deposit:{oak_log:0,birch_log:0},
        chest_after_reopen:{oak_log:oak,birch_log:birch},
        mining_receipts:2,deposit_receipts:2,
        durable_deposit_reopen:true,replay_denied:true,
        no_synthetic_item_injection:true,production:false
      }))
    }finally{storage.close()}
  }finally{
    clearTimeout(watchdog)
    if(journal)journal.close()
    try{owner.clearControlStates();worker.clearControlStates()}catch{}
    owner.quit();worker.quit()
  }
}
main().catch(err=>{
  console.error('QA MULTI-RESOURCE FAILURE: '+String(err?.message).slice(0,320))
  process.exitCode=1;owner.end();worker.end()
})
