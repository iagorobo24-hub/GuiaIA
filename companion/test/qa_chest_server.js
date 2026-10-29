'use strict'

// Isolated real Minecraft QA: items are GIVEN by the test server, not gathered.
// This proves chest transfers only; it does NOT claim a gather->store workflow.
const mineflayer=require('mineflayer')
const {Vec3}=require('vec3')
const {createQaChestDeposit,openDepositJournal,chestCount}=require('../src/deposit')
const {inventoryCount}=require('../src/gather')
const fs=require('node:fs')

const directory=process.env.GUIAIA_QA_DEPOSIT_DIR
if (!directory || !['/tmp/guiaia-chest-qa-','/tmp/guiaia-restart-qa-'].some(p=>directory.startsWith(p))) {
  throw Error('Disposable QA-only deposit directory required')
}
const qaPort=process.env.GUIAIA_QA_PORT==='25594'?25594:25595
const opts=name=>({host:'127.0.0.1',port:qaPort,version:'1.21.1',
  auth:'offline',hideErrors:true,username:name})
const owner=mineflayer.createBot(opts('OwnerQA'))
const bot=mineflayer.createBot(opts('GuiaIA_QA'))
const chest={x:4,y:64,z:3}
const items=[{name:'oak_log',count:1},{name:'birch_log',count:1}]
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const spawned=b=>b.entity?.position?Promise.resolve():new Promise((resolve,reject)=>{
  b.once('spawn',resolve)
  b.once('error',()=>reject(Error('QA Minecraft login failed')))
  b.once('end',()=>reject(Error('QA Minecraft login disconnected')))
})
async function main(){
  const timeout=setTimeout(()=>{
    console.error('QA chest deposit timed out')
    process.exitCode=1;owner.end();bot.end()
  },75000)
  let journal
  try{
    await Promise.all([spawned(owner),spawned(bot)])
    let ready=false
    for(let k=0;k<80;k++){
      if(bot.players?.OwnerQA?.entity &&
         bot.blockAt(new Vec3(chest.x,chest.y,chest.z))?.name==='chest' &&
         items.every(i=>inventoryCount(bot,i.name)===i.count)){
        ready=true;break
      }
      await sleep(150)
    }
    if(!ready)throw Error('QA player, chest or synthetic inventory not ready')
    journal=openDepositJournal(directory,{sandboxOnly:true,ownerName:'OwnerQA',
      chest,items})
    const initial=Object.fromEntries(items.map(i=>[i.name,inventoryCount(bot,i.name)]))
    for(const [step,item] of items.entries()){
      const action=createQaChestDeposit(bot,{sandboxOnly:true,ownerName:'OwnerQA',
        chest,item:item.name,count:item.count})
      let depositEvidence
      const originalDeposit=action.depositOne
      action.depositOne=async()=>{
        try { depositEvidence=await originalDeposit();return depositEvidence }
        catch(error) {
          console.error('QA deposit exception='+String(error?.message||'unknown').slice(0,160))
          throw error
        }
      }
      const outcome=await journal.runNext(action)
      if(!outcome.ok) {
        console.error('QA deposit step diagnostic='+JSON.stringify(depositEvidence||{}))
      }
      if(!outcome.ok) throw Error('QA deposit failed at step '+step+
        ' reason='+outcome.reason+' phase='+outcome.state?.phase)
    }
    const final=Object.fromEntries(items.map(i=>[i.name,inventoryCount(bot,i.name)]))
    if(items.some(i=>final[i.name]!==0))throw Error('Items remained in bot inventory')
    const block=bot.blockAt(new Vec3(chest.x,chest.y,chest.z))
    const window=await bot.openContainer(block)
    let inChest
    try{
      inChest=Object.fromEntries(items.map(i=>[i.name,chestCount(window,i.name)]))
    }finally{window.close()}
    if(items.some(i=>inChest[i.name]!==1))throw Error('Reopened chest missing expected inventory')
    const before=journal.view()
    if(before.phase!=='completed'||before.receipts.length!==2) {
      throw Error('Deposit journal not durably completed')
    }
    journal.close()
    journal=null
    const restored=openDepositJournal(directory)
    try{
      if(restored.view().phase!=='completed'||restored.view().receipts.length!==2){
        throw Error('Reopened deposit journal missing final receipts')
      }
      const replay=await restored.runNext({})
      if(replay.reason!=='not_ready')throw Error('Completed deposit can replay')
      if((fs.statSync(directory).mode&0o777)!==0o700 ||
         (fs.statSync(directory+'/deposit.json').mode&0o777)!==0o600) {
        throw Error('QA deposit journal file mode not private')
      }
      console.log('GUIAIA_CHEST_DEPOSIT_QA_EVIDENCE='+JSON.stringify({
        result:'pass',real_minecraft_server:true,
        source_items:'test_server_synthetic_give_commands',
        player_before:initial,player_after:final,
        chest_after_reopen:inChest,
        receipts:2,completed_reopen:true,replay_denied:true,
        private_directory:true,private_journal:true,
        actual_chest_transactions:2,
        production:false,sandbox_only:true
      }))
    }finally{restored.close()}
  }finally{
    clearTimeout(timeout)
    if(journal)journal.close()
    try{owner.clearControlStates();bot.clearControlStates()}catch{}
    owner.quit();bot.quit()
  }
}
main().catch(err=>{
  console.error('QA CHEST FAILURE: '+String(err?.message).slice(0,400))
  process.exitCode=1;owner.end();bot.end()
})
