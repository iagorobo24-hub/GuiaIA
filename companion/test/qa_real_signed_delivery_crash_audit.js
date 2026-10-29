'use strict'

// Read-only reconciliation of a REAL signed gather+deposit client crash.
// Runs only against the disposable Fabric world after an actual JVM restart.
// Never performs mining, deposit, journal unlock, replay or owner impersonation.
const fs=require('node:fs')
const path=require('node:path')
const mineflayer=require('mineflayer')
const {Vec3}=require('vec3')
const {inventoryCount}=require('../src/gather')
const {chestCount,validateJournal,openDepositJournal}=require('../src/deposit')
const {validateState,openMission}=require('../src/mission')

const root=process.env.GUIAIA_QA_CRASH_AUDIT_ROOT
if(!root?.startsWith('/tmp/guiaia-fabric-bridge-qa-') ||
   root.includes('..') || !path.isAbsolute(root))
  throw Error('Read-only QA audit restricted to disposable Fabric root')
const missionDir=path.join(root,'journal','delivery-mission')
const depositDir=path.join(root,'journal','delivery-deposit')
const mission=JSON.parse(fs.readFileSync(path.join(missionDir,'mission.json'),'utf8'))
const deposit=JSON.parse(fs.readFileSync(path.join(depositDir,'deposit.json'),'utf8'))
validateState(mission)
validateJournal(deposit)
if(mission.phase!=='completed' || mission.index!==1 ||
   mission.receipts.length!==1 ||
   deposit.phase!=='transferring' || deposit.index!==0 ||
   deposit.receipts.length!==0 || !deposit.operationId)
  throw Error('Signed delivery journal did not retain expected crash barrier')
if(!fs.existsSync(path.join(missionDir,'mission.lock')) ||
   !fs.existsSync(path.join(depositDir,'deposit.lock')))
  throw Error('Unexpectedly missing stale crash locks')
const approvalUsed=fs.readdirSync(path.join(root,'journal','delivery-approvals'))
  .filter(file=>file.endsWith('.used')).length
const stepsUsed=fs.readdirSync(path.join(root,'journal','spent'))
  .filter(file=>file.endsWith('.used')).length
if(approvalUsed!==1 || stepsUsed<2)
  throw Error('Expected one-use signed issuance and both step barriers')

// A stale exclusive lock must block journal reopen, BEFORE an adapter can
// perform any new world action or consume another signed nonce.
for(const [open,dir] of [[openMission,missionDir],[openDepositJournal,depositDir]]){
  let refused=false
  try{open(dir)}
  catch(e){refused=e?.code==='EEXIST'}
  if(!refused)throw Error('Stale lock did not block signed delivery replay')
}
const snapshot=JSON.stringify({mission,deposit})
const bot=mineflayer.createBot({host:'127.0.0.1',port:25593,
  username:'GuiaIA_QA',auth:'offline',version:'1.21.1',hideErrors:true})
const chest={x:1,y:64,z:5},target={x:7,y:64,z:2}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))

async function audit(){
  const watchdog=setTimeout(()=>{
    console.error('Real Fabric crash audit timeout')
    process.exitCode=1
    bot.end()
  },50000)
  try{
    if(!bot.entity?.position){
      await new Promise((resolve,reject)=>{
        bot.once('spawn',resolve)
        bot.once('end',()=>reject(Error('QA audit disconnected before spawn')))
        bot.once('error',reject)
      })
    }
    let ready=false
    for(let n=0;n<100;n++){
      if(bot.blockAt(new Vec3(chest.x,chest.y,chest.z))?.name==='chest' &&
         bot.blockAt(new Vec3(target.x,target.y,target.z))?.name!=='oak_log' &&
         Number.isInteger(inventoryCount(bot,'oak_log'))){
        ready=true;break
      }
      await sleep(150)
    }
    if(!ready)throw Error('Real Fabric restart world observations unavailable')
    const mined=bot.blockAt(new Vec3(target.x,target.y,target.z))
    const inventory=inventoryCount(bot,'oak_log')
    const window=await bot.openContainer(bot.blockAt(new Vec3(chest.x,chest.y,chest.z)))
    let oakChest
    try{oakChest=chestCount(window,'oak_log')}
    finally{window.close()}
    if(mined.name==='oak_log'||oakChest!==1||inventory!==1)
      throw Error('Restart reconciliation did not conserve real inventory: '+
        JSON.stringify({block:mined.name,oakChest,inventory}))
    const current=JSON.stringify({
      mission:JSON.parse(fs.readFileSync(path.join(missionDir,'mission.json'),'utf8')),
      deposit:JSON.parse(fs.readFileSync(path.join(depositDir,'deposit.json'),'utf8'))})
    if(current!==snapshot ||
       !fs.existsSync(path.join(missionDir,'mission.lock')) ||
       !fs.existsSync(path.join(depositDir,'deposit.lock')))
      throw Error('Passive reconciliation mutated durable mission or released stale lock')
    console.log('GUIAIA_REAL_SIGNED_DELIVERY_CRASH_RECOVERY_QA_EVIDENCE='+JSON.stringify({
      result:'pass',production:false,real_fabric_server_restarted:true,
      real_mineflayer_inventory_reconnected:true,
      gathered_block_remains_removed:true,oak_log_in_chest:oakChest,
      oak_log_retained_by_bot:inventory,gather_receipts:1,deposit_receipts:0,
      in_flight_deposit_phase:'transferring',stale_locks_preserved:true,
      journals_unchanged_by_read_only_audit:true,
      durable_issued_plan_markers:approvalUsed,
      durable_consumed_step_markers:stepsUsed,
      automatic_replay_permitted:false,requires_operator_reconciliation:true
    }))
  }finally{
    clearTimeout(watchdog)
    bot.end()
  }
}
audit().catch(e=>{console.error('QA CRASH AUDIT ERROR: '+String(e?.stack||e));process.exitCode=1;bot.end()})
