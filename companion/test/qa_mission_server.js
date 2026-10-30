'use strict'
// End-to-end proof: EXACTLY two operator-planted oak logs in disposable
// localhost Minecraft 1.21.1; persist receipts, restart journal, no replay.
const fs = require('node:fs')
const mineflayer = require('mineflayer')
const {Vec3} = require('vec3')
const {pathfinder, Movements, goals} = require('mineflayer-pathfinder')
const {createQaGather,inventoryCount} = require('../src/gather')
const {openMission} = require('../src/mission')

const dir = process.env.GUIAIA_QA_MISSION_DIR
if (!dir || !dir.startsWith('/tmp/guiaia-mission-qa-')) {
  throw new Error('A disposable mission directory is required')
}
const server = (username) => ({host:'127.0.0.1',port:25596,
  version:'1.21.1',username,auth:'offline',hideErrors:true})
const owner=mineflayer.createBot(server('OwnerQA'))
const worker=mineflayer.createBot(server('GuiaIA_QA'))
worker.loadPlugin(pathfinder)
const targets=[{x:3,y:64,z:2},{x:5,y:64,z:2}]
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const spawn=bot=>bot.entity?.position ? Promise.resolve() :
  new Promise((resolve,reject)=>{
    bot.once('spawn',resolve)
    bot.once('end',()=>reject(new Error('QA account ended before spawn')))
    bot.once('error',()=>reject(new Error('QA account connection error')))
  })
async function main() {
  const watchdog=setTimeout(()=>{ console.error('QA mission watchdog expired')
    process.exitCode=1;owner.end();worker.end()},79000)
  let ledger=null
  try {
    await Promise.all([spawn(owner),spawn(worker)])
    for(let i=0;i<70;i++){
      if(worker.players?.OwnerQA?.entity &&
         targets.every(p=>worker.blockAt(new Vec3(p.x,p.y,p.z))?.name==='oak_log')) break
      await sleep(250)
    }
    if(!worker.players?.OwnerQA?.entity ||
       !targets.every(p=>worker.blockAt(new Vec3(p.x,p.y,p.z))?.name==='oak_log')) {
      throw new Error('QA planted resources or owner absent')
    }
    await owner.lookAt(new Vec3(owner.entity.position.x,
             owner.entity.position.y+1.6,owner.entity.position.z+7),true)
    owner.setControlState('forward',true)
    let distance=0
    for(let i=0;i<18;i++){
      await sleep(140)
      distance=Math.hypot(owner.entity.position.x-3.5,owner.entity.position.z-2.5)
      if(distance>=3.3) break
    }
    owner.setControlState('forward',false)
    if(distance<3.0 || distance>12) throw new Error('Owner interfering in resource pickup')
    const moves=new Movements(worker)
    moves.canDig=false
    moves.canOpenDoors=false
    moves.allowParkour=false
    moves.allow1by1towers=false
    moves.allowFreeMotion=false
    worker.pathfinder.setMovements(moves)
    ledger=openMission(dir,{sandboxOnly:true,ownerName:'OwnerQA',targets})
    const starting=inventoryCount(worker,'oak_log')
    if(starting!==0) throw new Error('QA inventory was not initially empty')
    for(let step=0;step<targets.length;step++){
      const target=targets[step]
      const adapter=createQaGather(worker,{
        ownerName:'OwnerQA',sandboxOnly:true,target:new Vec3(target.x,target.y,target.z),
        pickupTimeoutMs:17500,
        pickupApproach:async p=>{
          worker.pathfinder.setGoal(new goals.GoalBlock(p.x,p.y,p.z))
        }
      })
      const action={ownerName:'OwnerQA',sandboxOnly:true,target,
                    gatherOne:()=>adapter.gatherOne(),cancel:()=>adapter.cancel()}
      const receipt=await ledger.runNext(action)
      if(!receipt.ok) {
        throw new Error('QA mission step '+step+' rejected: '+
                        receipt.reason+'; state='+receipt.state?.phase)
      }
      if(worker.blockAt(new Vec3(target.x,target.y,target.z))?.name==='oak_log') {
        throw new Error('Step receipt says complete but block remains')
      }
    }
    const beforeRestart=ledger.view()
    const finalCount=inventoryCount(worker,'oak_log')
    if(finalCount<2 || beforeRestart.receipts.length!==2 ||
       beforeRestart.phase!=='completed') throw new Error('Unverified mission completion')
    ledger.close()
    ledger=null
    const recovered=openMission(dir)
    try {
      if(recovered.view().phase!=='completed' ||
         recovered.view().receipts.length!==2) throw new Error('Durability proof failed')
      const shouldDeny=await recovered.runNext({
        sandboxOnly:true,ownerName:'OwnerQA',target:targets[1],gatherOne:async()=>{throw Error('REPLAY')}
      })
      if(shouldDeny.reason!=='mission_not_ready') throw Error('Duplicate execution possible')
      const mode=fs.statSync(dir).mode&0o777
      const fileMode=fs.statSync(dir+'/mission.json').mode&0o777
      if(process.platform!=='win32' && (mode!==0o700 || fileMode!==0o600)) throw Error('QA mission receipt permissions unsafe')
      console.log('GUIAIA_MISSION_QA_EVIDENCE='+JSON.stringify({
        result:'pass',real_minecraft_login:true,steps:2,
        receipts:recovered.view().receipts.length,
        inventory_before:starting,inventory_after:finalCount,
        items_verified:finalCount-starting,restored_after_reopen:true,
        completed_replay_denied:true,owner_outside_pickup_range:true,
        journal_directory_private:true,journal_file_private:true,
        production:false,world:'disposable_fabric_qa'
      }))
    } finally {recovered.close()}
  }finally{
    clearTimeout(watchdog)
    if(ledger) ledger.close()
    try{owner.clearControlStates();worker.clearControlStates()}catch{}
    owner.quit();worker.quit()
  }
}
main().catch(err=>{
  console.error('QA MISSION FAILURE: '+String(err?.message).slice(0,350))
  process.exitCode=1;owner.end();worker.end()
})
