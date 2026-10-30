'use strict'

// Real disposable Minecraft fault injection: stop *this synthetic bot process*
// AFTER both actual inventory deltas are verified but BEFORE runNext() can
// acknowledge and fsync the result. It does not kill a production server.
const fs=require('node:fs')
const mineflayer=require('mineflayer')
const {Vec3}=require('vec3')
const {inventoryCount}=require('../src/gather')
const {createQaChestDeposit,openDepositJournal}=require('../src/deposit')

const dir=process.env.GUIAIA_QA_DEPOSIT_DIR
if(!dir?.startsWith('/tmp/guiaia-inflight-qa-'))throw Error('Disposable QA dir required')
const options=name=>({host:'127.0.0.1',port:25594,version:'1.21.1',
  auth:'offline',hideErrors:true,username:name})
const owner=mineflayer.createBot(options('OwnerQA'))
const bot=mineflayer.createBot(options('GuiaIA_QA'))
const chest={x:4,y:64,z:3}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
async function main(){
  const timeout=setTimeout(()=>{
    console.error('QA fault injection watchdog expired')
    process.exitCode=1;owner.end();bot.end()
  },60000)
  try{
    await Promise.all([owner,bot].map(b=>b.entity?.position?Promise.resolve():
      new Promise((resolve,reject)=>{
        b.once('spawn',resolve)
        b.once('end',()=>reject(Error('QA player disconnected')))
      })))
    let ready=false
    for(let i=0;i<80;i++){
      if(bot.players?.OwnerQA?.entity &&
         bot.blockAt(new Vec3(chest.x,chest.y,chest.z))?.name==='chest' &&
         inventoryCount(bot,'oak_log')===1){ready=true;break}
      await sleep(150)
    }
    if(!ready)throw Error('Initial real chest or item missing')
    const journal=openDepositJournal(dir,{
      sandboxOnly:true,ownerName:'OwnerQA',chest,
      items:[{name:'oak_log',count:1}]
    })
    const action=createQaChestDeposit(bot,{sandboxOnly:true,
      ownerName:'OwnerQA',chest,item:'oak_log',count:1})
    const original=action.depositOne
    action.depositOne=async()=>{
      const result=await original()
      if(!result.ok || result.reason!=='both_inventory_deltas_verified' ||
         result.chestAfter!==1 || result.playerAfter!==0){
        throw Error('Fault injection requires verified real transfer: '+result.reason)
      }
      // Intentionally leave the lock and write-ahead journal in their
      // original in-flight state, exactly as an abrupt client crash would.
      fs.writeSync(1,'GUIAIA_INFLIGHT_FAULT_QA_EVIDENCE='+JSON.stringify({
        result:'pass',deposit_accepted:true,playerAfter:result.playerAfter,
        chestAfter:result.chestAfter,receipt_durable:false,
        crash_point:'after_world_transfer_before_journal_receipt',
        process_exit:77,production:false
      })+'\n')
      process.exit(77)
    }
    await journal.runNext(action)
    throw Error('Unexpected return after simulated bot crash')
  }finally{
    clearTimeout(timeout)
    owner.quit();bot.quit()
  }
}
main().catch(err=>{
  console.error('QA INFLIGHT INJECTION FAILED: '+String(err?.message).slice(0,300))
  process.exitCode=1;owner.end();bot.end()
})
