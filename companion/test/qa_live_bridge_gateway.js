'use strict'
// Real Fabric-signed JOIN + operator-approved, durable QA enrollment of keys.
// Both operator and principal keys are EPHEMERAL LAB SIGNERS: not friend identity.
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const mineflayer=require('mineflayer')
const crypto=require('node:crypto')
const {Vec3}=require('vec3')
const {inventoryCount}=require('../src/gather')
const {finiteDistance,OWNER_MAX_DISTANCE}=require('../src/controller')
const {openDepositJournal,chestCount}=require('../src/deposit')
const {verifyBridgeLog,createPinnedQaServerBridgeAuthority}=
  require('../src/fabric_bridge_reader')
const {createQaSessionActionGateway}=require('../src/session_identity')
const {openQaPrincipalRegistry}=require('../src/principal_enrollment')
const [eventsFile,pubFile,journalDir]=process.argv.slice(2)
if(!eventsFile?.startsWith('/tmp/guiaia-fabric-bridge-qa-') ||
   !pubFile?.startsWith('/tmp/guiaia-fabric-bridge-qa-') ||
   !journalDir?.startsWith('/tmp/guiaia-fabric-bridge-qa-')) {
  throw Error('Only isolated real Fabric connection QA paths permitted')
}
const worldId='qa:real-fabric:25593'
const publicKey=fs.readFileSync(pubFile,'utf8')
const source=createPinnedQaServerBridgeAuthority(eventsFile,publicKey,worldId)
const opts=username=>({host:'127.0.0.1',port:25593,
  username,auth:'offline',version:'1.21.1',hideErrors:true})
const owner=mineflayer.createBot(opts('OwnerQA'))
const bot=mineflayer.createBot(opts('GuiaIA_QA'))
const chest={x:4,y:64,z:3}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const spawn=b=>b.entity?.position?Promise.resolve():new Promise((resolve,reject)=>{
  b.once('spawn',resolve)
  b.once('end',()=>reject(Error('Real Fabric QA client disconnected before spawn')))
  b.once('error',()=>reject(Error('Real Fabric QA connection failed')))
})
const signed=(payload,key)=>({payload,signature:crypto.sign(null,
  Buffer.from(JSON.stringify(payload)),key.privateKey).toString('base64url')})
async function main(){
  const watchdog=setTimeout(()=>{
    process.exitCode=1
    console.error('Real server bridge-to-companion QA timeout')
    owner.end();bot.end()
  },70000)
  let journal,registry,registryRoot
  try {
    await Promise.all([spawn(owner),spawn(bot)])
    let realProof,connectionId,ready=false
    for(let k=0;k<100;k++){
      try {
        const current=verifyBridgeLog(eventsFile,publicKey,worldId)
        const ownerLine=[...current.active.values()].find(p=>p.username==='OwnerQA')
        if(ownerLine){
          connectionId=ownerLine.connectionId
          realProof=source.joinProof(connectionId)
        }
        if(realProof && source.activeConnection(connectionId)?.connected &&
           bot.players?.OwnerQA?.entity &&
           finiteDistance(bot.entity?.position,bot.players.OwnerQA.entity.position)<=OWNER_MAX_DISTANCE &&
           bot.blockAt(new Vec3(chest.x,chest.y,chest.z))?.name==='chest' &&
           inventoryCount(bot,'oak_log')===1 &&
           inventoryCount(bot,'birch_log')===1) {
          ready=true;break
        }
      }catch{}
      await sleep(140)
    }
    if(!ready)throw Error('Real signed JOIN or Minecraft inventories unavailable')
    const ownerKey=crypto.generateKeyPairSync('ed25519')
    const operatorKey=crypto.generateKeyPairSync('ed25519')
    registryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-enrollment-qa-'))
    const registryDir=path.join(registryRoot,'registry')
    const enrollmentTrust={worldId,sandboxOnly:true,
      operatorPublicKeyPem:operatorKey.publicKey.export({format:'pem',type:'spki'})}
    registry=openQaPrincipalRegistry(registryDir,enrollmentTrust)
    const enroll=(principalId,key)=>{
      const now=Date.now()
      const payload={aud:'guiaia:principal-enrollment:v1',
        worldId,principalId,nonce:crypto.randomUUID(),
        issuedAt:now-1000,expiresAt:now+60000,
        publicKeyDer:key.publicKey.export({format:'der',type:'spki'}).toString('base64url')}
      const consent=crypto.sign(null,Buffer.from(
        'guiaia:principal-consent:v1\n'+JSON.stringify(payload)),
        key.privateKey).toString('base64url')
      return registry.applySignedChange(signed(payload,operatorKey),consent)
    }
    const revoke=principalId=>{
      const now=Date.now()
      return registry.applySignedChange(signed({
        aud:'guiaia:principal-revocation:v1',worldId,principalId,
        nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+60000
      },operatorKey))
    }
    if(enroll('qa_pre_enrolled_user',ownerKey).action!=='enrolled')
      throw Error('Out-of-band operator enrollment denied')
    const authority={
      sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
      worldId,botName:'GuiaIA_QA',
      serverBridgePublicKeyPem:publicKey,
      trustedPrincipals:registry.trustedPrincipals(),
      operatorPublicKeyPem:operatorKey.publicKey.export({format:'pem',type:'spki'}),
      ledgerDirectory:path.join(journalDir,'spent'),
      activeConnection:id=>source.activeConnection(id),
      isRevoked:principalId=>registry.isRevoked(principalId)
    }
    const ownerSession=(principalId='qa_pre_enrolled_user',key=ownerKey)=>{
      const now=Date.now()
      const claim={aud:'guiaia:principal-proof:v1',worldId,connectionId,
        principalId,challenge:realProof.payload.challenge,
        issuedAt:now-1000,expiresAt:now+30000}
      return {bridge:realProof,owner:signed(claim,key)}
    }
    const scope=(item,principalId='qa_pre_enrolled_user')=>{
      const now=Date.now()
      return signed({aud:'guiaia:session-deposit:v1',worldId,
        botName:'GuiaIA_QA',ownerName:'OwnerQA',
        principalId,connectionId,
        challenge:realProof.payload.challenge,
        chest:{...chest},item,count:1,
        nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+30000},
        operatorKey)
    }
    const gateway=createQaSessionActionGateway(bot,authority)
    const session=ownerSession()
    const first=scope('oak_log')
    journal=openDepositJournal(journalDir,{
      sandboxOnly:true,ownerName:'OwnerQA',chest,
      items:[{name:'oak_log',count:1}]
    })
    const adapter=gateway.createDeposit(session,first)
    const actualDeposit=adapter.depositOne
    let depositProof
    adapter.depositOne=async()=>{depositProof=await actualDeposit();return depositProof}
    const result=await journal.runNext(adapter)
    if(!result.ok)throw Error('Real Fabric session deposit failed: '+result.reason+'; operation='+String(depositProof?.reason||'unobserved'))
    // Replay must be denied by persisted operator nonce barrier.
    await (async()=>{
      try {
        await gateway.createDeposit(session,first).depositOne()
        throw Error('Critical: signed real-Fabric grant replayed')
      }catch(error){
        if(error.code!=='EEXIST')throw error
      }
    })()
    // Create authorization while this actual signed Fabric connection is LIVE,
    // then revoke enrollment BEFORE any world mutation: dispatch must re-check.
    const revokedAction=gateway.createDeposit(session,scope('birch_log'))
    if(revoke('qa_pre_enrolled_user').action!=='revoked')
      throw Error('Signed operator revocation failed')
    let revokedBeforeWorldMutation=false
    try { await revokedAction.depositOne() }
    catch(error) {
      if(/revoked/.test(error.message))revokedBeforeWorldMutation=true
    }
    if(!revokedBeforeWorldMutation || inventoryCount(bot,'birch_log')!==1)
      throw Error('Revoked enrolled principal could still deposit into the chest')
    // A separate QA principal is independently approved to keep the existing
    // DISCONNECT denial test unmasked by the earlier revocation.
    const replacementKey=crypto.generateKeyPairSync('ed25519')
    if(enroll('qa_replacement_user',replacementKey).action!=='enrolled')
      throw Error('Replacement QA principal enrollment failed')
    const refreshedGateway=createQaSessionActionGateway(bot,{
      ...authority,trustedPrincipals:registry.trustedPrincipals()})
    const replacementSession=ownerSession('qa_replacement_user',replacementKey)
    const disconnectAction=refreshedGateway.createDeposit(
      replacementSession,scope('birch_log','qa_replacement_user'))
    owner.quit()
    let disconnected=false
    for(let k=0;k<75;k++){
      try{
        if(!source.activeConnection(connectionId)){disconnected=true;break}
      }catch{}
      await sleep(130)
    }
    if(!disconnected)throw Error('Real Fabric DISCONNECT not recorded')
    let revoked=false
    try{await disconnectAction.depositOne()}catch(error){
      if(/live matching connection/.test(error.message))revoked=true
    }
    if(!revoked)throw Error('Old session still permitted actions after disconnect')
    const player={oak_log:inventoryCount(bot,'oak_log'),
      birch_log:inventoryCount(bot,'birch_log')}
    const window=await bot.openContainer(bot.blockAt(new Vec3(chest.x,chest.y,chest.z)))
    let stored
    try{stored={oak_log:chestCount(window,'oak_log'),
      birch_log:chestCount(window,'birch_log')}}
    finally{window.close()}
    if(player.oak_log!==0 || player.birch_log!==1 ||
       stored.oak_log!==1 || stored.birch_log!==0 ||
       journal.view().receipts.length!==1){
      throw Error('Live-connection revocation altered unexpected inventory')
    }
    registry.close();registry=null
    const restored=openQaPrincipalRegistry(registryDir,enrollmentTrust)
    let enrollmentReopened=false
    try{
      enrollmentReopened=restored.isRevoked('qa_pre_enrolled_user') &&
        !restored.isRevoked('qa_replacement_user') &&
        Object.keys(restored.trustedPrincipals()).length===1
    }finally{restored.close()}
    if(!enrollmentReopened)throw Error('Signed enrollment/revocation was not durable')
    console.log('GUIAIA_REAL_SERVER_SESSION_GATE_QA_EVIDENCE='+JSON.stringify({
      result:'pass',real_fabric_server_signs_join:true,
      real_fabric_server_signs_disconnect:true,
      no_simulated_server_proof:true,
      synthetic_pre_enrolled_user_proof:true,
      synthetic_operator_grant:true,
      operator_approved_enrollment_persisted:true,
      independent_principal_possession_proof:true,
      signed_revocation_denied_during_live_connection:revokedBeforeWorldMutation,
      enrolled_registry_reopened_and_revocation_verified:enrollmentReopened,
      exact_server_connection_id_bound:true,
      joined_session_can_authorize:true,
      signed_nonce_replay_denied:true,
      disconnected_session_denied_before_world_change:true,
      player_after:player,chest_after:stored,
      durable_receipts:1,production:false,
      real_friend_enrollment_implemented:false
    }))
  }finally{
    clearTimeout(watchdog)
    if(journal)journal.close()
    if(registry)registry.close()
    if(registryRoot)fs.rmSync(registryRoot,{recursive:true,force:true})
    owner.quit();bot.quit()
  }
}
main().catch(err=>{
  console.error('Real Fabric session gateway failed: '+String(err?.message).slice(0,250))
  process.exitCode=1;owner.end();bot.end()
})
