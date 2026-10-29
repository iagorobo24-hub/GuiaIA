'use strict'

// Pure observation after a real Minecraft server restart. Never /give, dig,
// withdraw, deposit, resume or auto-replay. Both accounts are synthetic QA.
const mineflayer=require('mineflayer')
const fs=require('node:fs')
const {Vec3}=require('vec3')
const {inventoryCount}=require('../src/gather')
const {chestCount}=require('../src/deposit')
const {readDepositJournalPassive,reconcileDepositSnapshot}=require('../src/recovery')

const directory=process.env.GUIAIA_QA_DEPOSIT_DIR
if(!directory || !['/tmp/guiaia-restart-qa-','/tmp/guiaia-inflight-qa-'].some(p=>directory.startsWith(p))) {
  throw Error('Only a disposable restart QA directory is allowed')
}
const port=25594
const config=username=>({host:'127.0.0.1',port,version:'1.21.1',
  auth:'offline',username,hideErrors:true})
const owner=mineflayer.createBot(config('OwnerQA'))
const worker=mineflayer.createBot(config('GuiaIA_QA'))
const chest={x:4,y:64,z:3}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const spawn=bot=>bot.entity?.position?Promise.resolve():new Promise((resolve,reject)=>{
  bot.once('spawn',resolve)
  bot.once('end',()=>reject(Error('QA account disconnected before spawn')))
  bot.once('error',()=>reject(Error('QA account could not connect')))
})
async function main(){
  const timeout=setTimeout(()=>{
    process.exitCode=1;console.error('Restart snapshot watchdog expired')
    owner.end();worker.end()
  },45000)
  try{
    // The audit must NOT recover pending transactions or touch disk.
    const rawJournalBefore=fs.readFileSync(directory+'/deposit.json')
    const state=readDepositJournalPassive(directory)
    if(!fs.readFileSync(directory+'/deposit.json').equals(rawJournalBefore)) {
      throw Error('Passive audit unexpectedly modified the journal')
    }
    if(state.phase==='transferring' && !fs.existsSync(directory+'/deposit.lock')) {
      throw Error('Crash injection stale process lock not preserved')
    }
    const expectedStatus=process.env.GUIAIA_QA_EXPECTED_PHASE||'completed'
    if(state.phase!==expectedStatus) throw Error('Unexpected persisted journal phase')
    await Promise.all([spawn(owner),spawn(worker)])
    let block
    for(let i=0;i<80;i++){
      block=worker.blockAt(new Vec3(chest.x,chest.y,chest.z))
      if(block?.name==='chest' && worker.players?.OwnerQA?.entity)break
      await wait(180)
    }
    if(block?.name!=='chest'||!worker.players?.OwnerQA?.entity)
      throw Error('Chest or owner absent in recovered world')
    // No mutation. Opening a container is observational; it is closed once
    // the actual window slot counts have been sampled.
    const window=await worker.openContainer(block)
    let container
    try{
      container={
        oak_log:chestCount(window,'oak_log'),
        birch_log:chestCount(window,'birch_log')
      }
    }finally{window.close()}
    const player={
      oak_log:inventoryCount(worker,'oak_log'),
      birch_log:inventoryCount(worker,'birch_log')
    }
    const observation={source:'live_minecraft_after_restart',
      ownerName:'OwnerQA',chest,chestBlock:block.name,player,container}
    const proof=reconcileDepositSnapshot(state,observation)
    const expect=process.env.GUIAIA_QA_EXPECTED_STATUS||'completed_inventory_verified'
    if(proof.status!==expect || proof.canAutoReplay!==false) {
      throw Error('Reconciliation gate refused: '+JSON.stringify(proof))
    }
    // When the client dies before its journal receipt, the server might
    // have applied the click or might still hold the original item. Both
    // outcomes require manual review; no automated replays are permitted.
    if(process.env.GUIAIA_QA_REQUIRE_ITEM_CONSERVATION==='true' &&
       (player.oak_log+container.oak_log!==1 ||
        player.birch_log+container.birch_log!==0)) {
      throw Error('Real server player/chest conservation mismatch: '+JSON.stringify({player,container}))
    }
    if(expect==='completed_inventory_verified' &&
       (!proof.ok || player.oak_log!==0||player.birch_log!==0 ||
        container.oak_log!==1||container.birch_log!==1)) {
      throw Error('Persisted player/chest inventory mismatch after restart')
    }
    console.log('GUIAIA_RESTART_SNAPSHOT_QA_EVIDENCE='+JSON.stringify({
      result:'pass',real_minecraft_server:true,phase:state.phase,
      reconciliation:proof.status,player,container,
      journal_read_only:true,automatic_replay:false,
      after_real_server_restart:true,production:false
    }))
  }finally{
    clearTimeout(timeout)
    owner.quit();worker.quit()
  }
}
main().catch(err=>{
  console.error('QA RESTART SNAPSHOT FAILURE: '+String(err?.message).slice(0,400))
  process.exitCode=1;owner.end();worker.end()
})
