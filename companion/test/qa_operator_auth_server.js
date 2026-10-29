'use strict'
// Real Minecraft QA for signed, strictly scoped OPERATOR capability; offline
// players remain UNAUTHENTICATED. This does not certify secure player identity.
// The keypair is generated in this disposable QA process; no keys are shipped.
const mineflayer=require('mineflayer')
const {Vec3}=require('vec3')
const {generateKeyPairSync,sign,randomUUID}=require('node:crypto')
const fs=require('node:fs')
const path=require('node:path')
const {inventoryCount}=require('../src/gather')
const {openDepositJournal,chestCount}=require('../src/deposit')
const {createOperatorAuthorizedQaDeposit}=require('../src/operator_authorization')
const directory=process.env.GUIAIA_QA_DEPOSIT_DIR
if(!directory || !directory.startsWith('/tmp/guiaia-chest-qa-'))
  throw Error('Operator capability QA only in disposable Minecraft')
const opts=name=>({host:'127.0.0.1',port:25595,version:'1.21.1',
  auth:'offline',hideErrors:true,username:name})
const owner=mineflayer.createBot(opts('OwnerQA'))
const bot=mineflayer.createBot(opts('GuiaIA_QA'))
const chest={x:4,y:64,z:3}
const items=[{name:'oak_log',count:1},{name:'birch_log',count:1}]
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const spawned=b=>b.entity?.position?Promise.resolve():new Promise((resolve,reject)=>{
  b.once('spawn',resolve)
  b.once('error',()=>reject(Error('QA Minecraft client connect error')))
  b.once('end',()=>reject(Error('QA Minecraft client disconnected')))
})
async function main(){
  const watchdog=setTimeout(()=>{
    console.error('Signed capability Minecraft QA timeout')
    process.exitCode=1;owner.end();bot.end()
  },75000)
  let journal
  try{
    await Promise.all([spawned(owner),spawned(bot)])
    let ready=false
    for(let i=0;i<80;i++){
      if(bot.players?.OwnerQA?.entity &&
         bot.blockAt(new Vec3(chest.x,chest.y,chest.z))?.name==='chest' &&
         items.every(x=>inventoryCount(bot,x.name)===1)){
        ready=true;break
      }
      await sleep(150)
    }
    if(!ready)throw Error('QA chest or synthetic inventory not present')
    const {privateKey,publicKey}=generateKeyPairSync('ed25519')
    const authority={worldId:'qa:signed-chest:25595',botName:bot.username,
      sandboxOnly:true,identityMode:'unverified_offline_lab',
      publicKeyPem:publicKey.export({type:'spki',format:'pem'}),
      ledgerDirectory:path.join(directory,'used-operator-grants')}
    const issue=item=>{
      const now=Date.now()
      const payload={version:1,audience:'guiaia:deposit-one:v1',
        worldId:authority.worldId,botName:authority.botName,
        ownerName:'OwnerQA',chest:{...chest},
        item:item.name,count:item.count,nonce:randomUUID(),
        issuedAt:now-1000,expiresAt:now+120000,sandboxOnly:true}
      return {payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),
        privateKey).toString('base64url')}
    }
    const makePlan=item=>({sandboxOnly:true,ownerName:'OwnerQA',
      chest:{...chest},item:item.name,count:item.count})
    let denied=0
    const initial={oak_log:inventoryCount(bot,'oak_log'),
      birch_log:inventoryCount(bot,'birch_log')}
    const first=makePlan(items[0])
    // OFFLINE USERNAME ALONE is never a capability. Denial occurs before
    // interacting with the real chest (no Minecraft packet mutation).
    try{createOperatorAuthorizedQaDeposit(bot,first,null,authority)}
    catch{denied++}
    if(denied!==1)throw Error('Unauthenticated nickname obtained chest permission')
    // A genuine signed grant cannot be redirected to an arbitrary chest.
    try{createOperatorAuthorizedQaDeposit(bot,
      {...first,chest:{x:5,y:64,z:3}},issue(items[0]),authority)}
    catch{denied++}
    if(denied!==2)throw Error('Wrong chest accepted despite signed authorization')
    if(inventoryCount(bot,'oak_log')!==1 ||
       inventoryCount(bot,'birch_log')!==1)throw Error('Denial mutated inventory')
    journal=openDepositJournal(directory,{sandboxOnly:true,ownerName:'OwnerQA',
      chest,items})
    let spent=0
    for(const item of items){
      const grant=issue(item)
      const adapter=createOperatorAuthorizedQaDeposit(bot,makePlan(item),
        grant,authority)
      const result=await journal.runNext(adapter)
      if(!result.ok)throw Error('Signed real chest transfer denied: '+result.reason)
      spent++
      // Same signed nonce is irreversibly spent, even using a fresh adapter.
      try{
        await createOperatorAuthorizedQaDeposit(bot,makePlan(item),grant,authority).depositOne()
        throw Error('CRITICAL: already consumed capability replayed')
      }catch(error){
        if(error.message==='CRITICAL: already consumed capability replayed')throw error
        if(error.code!=='EEXIST')throw error
      }
    }
    const final={oak_log:inventoryCount(bot,'oak_log'),
      birch_log:inventoryCount(bot,'birch_log')}
    const block=bot.blockAt(new Vec3(chest.x,chest.y,chest.z))
    const window=await bot.openContainer(block)
    let inChest
    try{inChest={oak_log:chestCount(window,'oak_log'),
      birch_log:chestCount(window,'birch_log')}}
    finally{window.close()}
    if(final.oak_log!==0||final.birch_log!==0||
       inChest.oak_log!==1||inChest.birch_log!==1||
       journal.view().phase!=='completed'||journal.view().receipts.length!==2){
      throw Error('Signed real chest receipt or inventories do not match')
    }
    const replayRecords=fs.readdirSync(authority.ledgerDirectory)
    if(replayRecords.length!==2)throw Error('Missing durable single-use reservations')
    journal.close();journal=null
    console.log('GUIAIA_SIGNED_CHEST_AUTH_QA_EVIDENCE='+JSON.stringify({
      result:'pass',real_minecraft_server:true,
      offline_username_not_identity:true,
      unsigned_denied:true,wrong_chest_denied:true,
      signed_distinct_operator_grants:spent,nonce_replay_denied:true,
      durable_nonce_reservations:replayRecords.length,
      player_before:initial,player_after:final,chest_after_reopen:inChest,
      deposit_receipts:2,operator_public_key_generated_in_qa:true,
      authenticated_multiplayer_owner:false,production:false
    }))
  }finally{
    clearTimeout(watchdog)
    if(journal)journal.close()
    owner.quit();bot.quit()
  }
}
main().catch(err=>{
  console.error('SIGNED CHEST AUTH QA FAILED: '+String(err?.message).slice(0,370))
  process.exitCode=1;owner.end();bot.end()
})
