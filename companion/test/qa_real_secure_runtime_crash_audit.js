'use strict'

// Only for the disposable Fabric QA world AFTER an actual secure-runtime
// process crash and Minecraft restart. No credentials, mining or deposits.
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const mineflayer=require('mineflayer')
const {Vec3}=require('vec3')
const {inventoryCount}=require('../src/gather')
const {chestCount,openDepositJournal,validateJournal}=require('../src/deposit')
const {openMission,validateState}=require('../src/mission')

const root=process.env.GUIAIA_QA_CRASH_AUDIT_ROOT
if(typeof root!=='string' || !path.isAbsolute(root) ||
   !/^guiaia-fabric-bridge-qa-[\w-]+$/.test(path.basename(root)) ||
   path.dirname(root)!==os.tmpdir() || fs.realpathSync(root)!==root)
  throw Error('Recovery audit only permits an isolated Fabric QA directory')
const missionDir=path.join(root,'journal','secure-runtime-mission')
const depositDir=path.join(root,'journal','secure-runtime-deposit')
const missionFile=path.join(missionDir,'mission.json')
const depositFile=path.join(depositDir,'deposit.json')
const missionBytes=fs.readFileSync(missionFile)
const depositBytes=fs.readFileSync(depositFile)
const mission=JSON.parse(missionBytes)
const deposit=JSON.parse(depositBytes)
validateState(mission)
validateJournal(deposit)
if(mission.phase!=='completed' || mission.index!==1 ||
   mission.receipts.length!==1 ||
   deposit.phase!=='transferring' || deposit.index!==0 ||
   deposit.receipts.length!==0 || !deposit.operationId)
  throw Error('Secure runtime crash journals did not preserve the uncertain transfer')
if(!fs.existsSync(path.join(missionDir,'mission.lock')) ||
   !fs.existsSync(path.join(depositDir,'deposit.lock')))
  throw Error('Secure runtime process crash failed to preserve exclusive locks')
const usedDir=path.join(root,'journal','spent')
const used=fs.readdirSync(usedDir).filter(name=>name.endsWith('.used'))
if(used.length!==3)throw Error('Secure runtime lacked three durable one-use grants')
for(const [open,dir] of [[openMission,missionDir],[openDepositJournal,depositDir]]){
  let code
  try{open(dir)}catch(e){code=e.code}
  if(code!=='EEXIST')throw Error('Crashed runtime journal reopened despite stale exclusive lock')
}

// The operator may INSPECT a copy after a crash, never clear the source lock.
// A copy shows how the journal recovery logic marks an unknown operation as
// needs_review; this cannot authorize a new world action or replay a nonce.
const probe=path.join(root,'isolated-recovery-probe')
const probeMission=path.join(probe,'mission')
const probeDeposit=path.join(probe,'deposit')
fs.mkdirSync(probeMission,{recursive:true,mode:0o700})
fs.mkdirSync(probeDeposit,{recursive:true,mode:0o700})
fs.copyFileSync(missionFile,path.join(probeMission,'mission.json'))
fs.copyFileSync(depositFile,path.join(probeDeposit,'deposit.json'))
const reopenedMission=openMission(probeMission)
const reopenedDeposit=openDepositJournal(probeDeposit)
async function inspectCopy(){
  try{
    if(reopenedMission.view().phase!=='completed' ||
       reopenedDeposit.view().phase!=='needs_review' ||
       reopenedDeposit.view().reason!=='unknown_outcome_after_restart')
      throw Error('Recovery copy did not fail closed on unverified deposit')
    const blocked=await reopenedDeposit.runNext({
      sandboxOnly:true,ownerName:deposit.ownerName,
      chest:deposit.chest,item:deposit.items[0].name,count:deposit.items[0].count,
      depositOne:()=>{throw Error('Never invoke a world adapter during recovery')}
    })
    if(blocked.ok!==false || blocked.reason!=='not_ready' ||
       reopenedDeposit.resume().ok!==false)
      throw Error('Recovered deposit journal permitted replay')
    return blocked
  }finally{reopenedDeposit.close();reopenedMission.close()}
}

const bot=mineflayer.createBot({host:'127.0.0.1',port:25593,
  username:'GuiaIA_QA',auth:'offline',version:'1.21.1',hideErrors:true})
const chest=new Vec3(1,64,5), target=new Vec3(7,64,2)
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function audit(){
  const watchdog=setTimeout(()=>bot.end(),50000)
  try{
    await inspectCopy()
    if(!bot.entity?.position){
      await new Promise((resolve,reject)=>{
        bot.once('spawn',resolve)
        bot.once('end',()=>reject(Error('Fabric disconnected before recovery inspection')))
        bot.once('error',reject)
      })
    }
    let ready=false
    for(let i=0;i<100;i++){
      if(bot.blockAt(chest)?.name==='chest' &&
         bot.blockAt(target)?.name!=='oak_log' &&
         Number.isInteger(inventoryCount(bot,'oak_log'))){ready=true;break}
      await sleep(150)
    }
    if(!ready)throw Error('Post-restart Fabric blocks or inventory unavailable')
    const block=bot.blockAt(target)?.name
    const player=inventoryCount(bot,'oak_log')
    const container=await bot.openContainer(bot.blockAt(chest))
    let stored
    try{stored=chestCount(container,'oak_log')}finally{container.close()}
    if(block==='oak_log'||player!==1||stored!==1)
      throw Error('Fabric restart changed real inventory or block: '+
        JSON.stringify({block,player,stored}))
    if(!fs.readFileSync(missionFile).equals(missionBytes) ||
       !fs.readFileSync(depositFile).equals(depositBytes) ||
       used.length!==fs.readdirSync(usedDir).filter(name=>name.endsWith('.used')).length ||
       !fs.existsSync(path.join(missionDir,'mission.lock')) ||
       !fs.existsSync(path.join(depositDir,'deposit.lock')))
      throw Error('Recovery inspection mutated original journal, markers or locks')
    console.log('GUIAIA_REAL_SECURE_RUNTIME_RECOVERY_QA_EVIDENCE='+JSON.stringify({
      result:'pass',production:false,real_fabric_world_restarted:true,
      real_chest_items:stored,bot_inventory_items:player,
      mined_block_remains_removed:true,
      durable_mission_receipts:1,durable_deposit_receipts:0,
      uncertain_deposit_phase:'transferring',spent_signed_nonces:used.length,
      original_locks_preserved:true,original_journals_unchanged:true,
      isolated_copy_recovery_phase:'needs_review',
      replay_denied:true,automatic_recovery_denied:true
    }))
  }finally{clearTimeout(watchdog);bot.end()}
}
audit().catch(err=>{console.error('SECURE RUNTIME RECOVERY FAILED',err);process.exitCode=1;bot.end()})
