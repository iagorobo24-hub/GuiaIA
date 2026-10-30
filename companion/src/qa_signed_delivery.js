'use strict'

// Disposable, isolated QA only. This is not a chat/CLI/MCP command surface.
// The caller supplies real, previously reviewed Minecraft adapters; they
// MUST NOT mutate the world in their constructors/factories.
const crypto=require('node:crypto')
const {verifySessionBundle}=require('./session_identity')
const {reserveGrantOnce}=require('./operator_authorization')
const {createQaDeliveryPipeline}=require('./qa_delivery_pipeline')

const FIELDS=['aud','sandboxOnly','worldId','botName','ownerName','principalId',
  'connectionId','challenge','missionId','planId','targets','chest','items',
  'nonce','issuedAt','expiresAt']
const RESOURCES=Object.freeze({oak_log:true,birch_log:true})
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const NAME=/^[A-Za-z0-9_]{3,16}$/
const ID=/^[A-Za-z0-9:_-]{1,64}$/
const CHALLENGE=/^[a-f0-9]{32,64}$/
const MAX_DURATION_MS=300000
const FRESH_PROOF_MS=2000
const ATTEST_TIMEOUT_MS=2000
const ACTION_MONITOR_MS=300
const ACTION_MAX_UNATTESTED_MS=2000
const hasExact=(value,fields)=>value && Object.getPrototypeOf(value)===Object.prototype &&
  Object.keys(value).length===fields.length && fields.every(key=>Object.hasOwn(value,key))
const pos=p=>hasExact(p,['x','y','z'])&&['x','y','z'].every(k=>
  Number.isInteger(p[k])&&Math.abs(p[k])<30000000)
const clone=o=>JSON.parse(JSON.stringify(o))
const deepFreeze=value=>{
  if(value && typeof value==='object'){
    for(const nested of Object.values(value))deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)

function verifyQaDeliveryPlan(token,authority,now=Date.now()){
  if(authority?.sandboxOnly!==true ||
     authority.identityMode!=='trusted_server_bridge_lab' ||
     !ID.test(authority.worldId||'') || !NAME.test(authority.botName||'') ||
     typeof authority.operatorPublicKeyPem!=='string' ||
     !hasExact(token,['payload','signature']))
    throw Error('QA signed delivery requires pinned operator authority')
  const p=token.payload
  if(!hasExact(p,FIELDS) || p.aud!=='guiaia:session-delivery-plan:v1' ||
     p.sandboxOnly!==true || p.worldId!==authority.worldId ||
     p.botName!==authority.botName || !NAME.test(p.ownerName||'') ||
     !ID.test(p.principalId||'') || !UUID.test(p.connectionId||'') ||
     !CHALLENGE.test(p.challenge||'') || !UUID.test(p.missionId||'') ||
     !UUID.test(p.planId||'') || !UUID.test(p.nonce||'') ||
     !Number.isSafeInteger(now) || !Number.isSafeInteger(p.issuedAt) ||
     !Number.isSafeInteger(p.expiresAt) || p.issuedAt>now+5000 ||
     p.expiresAt<now || p.expiresAt-p.issuedAt<1000 ||
     p.expiresAt-p.issuedAt>MAX_DURATION_MS || !pos(p.chest) ||
     !Array.isArray(p.targets) || p.targets.length<1 || p.targets.length>3 ||
     !Array.isArray(p.items) || p.items.length<1 || p.items.length>2 ||
     typeof token.signature!=='string' || !/^[A-Za-z0-9_-]{86}$/.test(token.signature))
    throw Error('QA signed delivery plan scope, form or lifetime invalid')
  const counts=Object.create(null),targets=new Set()
  for(const target of p.targets){
    if(!hasExact(target,['x','y','z','block']) ||
       !pos({x:target.x,y:target.y,z:target.z}) ||
       !Object.hasOwn(RESOURCES,target.block))
      throw Error('QA signed delivery target not allowlisted')
    const key=[target.x,target.y,target.z].join(':')
    if(targets.has(key))throw Error('QA signed delivery target repeated')
    targets.add(key)
    counts[target.block]=(counts[target.block]||0)+1
  }
  const materials=new Set()
  for(const item of p.items){
    if(!hasExact(item,['name','count']) ||
       !Object.hasOwn(RESOURCES,item.name) ||
       !Number.isInteger(item.count) || item.count<1 || item.count>2 ||
       materials.has(item.name) || counts[item.name]!==item.count)
      throw Error('QA signed delivery deposit inventory mismatch')
    materials.add(item.name)
  }
  if(materials.size!==Object.keys(counts).length)
    throw Error('QA signed delivery material count mismatch')
  let key
  try{key=crypto.createPublicKey(authority.operatorPublicKeyPem)}
  catch{throw Error('Invalid QA operator public key')}
  if(key.asymmetricKeyType!=='ed25519')throw Error('QA operator must sign with Ed25519')
  const signature=Buffer.from(token.signature,'base64url')
  if(signature.length!==64 ||
     !crypto.verify(null,Buffer.from(JSON.stringify(p)),key,signature))
    throw Error('QA delivery operator signature invalid')
  // The returned plan is a private deep snapshot: a caller can never swap
  // targets or inventories after signature verification.
  const approvedPlan={sandboxOnly:true,ownerName:p.ownerName,
    missionId:p.missionId,planId:p.planId,targets:clone(p.targets),
    chest:clone(p.chest),items:clone(p.items)}
  return Object.freeze({approvedPlan:deepFreeze(approvedPlan),
    scope:Object.freeze({worldId:p.worldId,botName:p.botName,
      ownerName:p.ownerName,principalId:p.principalId,
      connectionId:p.connectionId,challenge:p.challenge,
      nonce:p.nonce,expiresAt:p.expiresAt})})
}

function createQaSignedDeliveryPipeline({bot,bundle,signedPlan,authority,
  missionJournal,depositJournal,createGatherAction,createDepositAction}={}){
  if(authority?.sandboxOnly!==true ||
     authority.identityMode!=='trusted_server_bridge_lab' ||
     authority.requireLivePresence!==true ||
     authority.requireRemoteCheckpoint!==true ||
     typeof authority.livePresence!=='function' ||
     typeof authority.currentRegistryCheckpoint!=='function' ||
     typeof authority.remoteCheckpointMatch!=='function' ||
     typeof authority.ledgerDirectory!=='string' ||
     typeof authority.activeConnection!=='function' ||
     typeof authority.isRevoked!=='function' ||
     !authority.trustedPrincipals ||
     typeof createGatherAction!=='function' ||
     typeof createDepositAction!=='function')
    throw Error('QA delivery requires session, live presence, checkpoint and adapters')
  // Copy keys and callback references, excluding later caller mutation.
  const trust=Object.freeze({...authority,
    trustedPrincipals:Object.freeze({...authority.trustedPrincipals})})
  const approval=verifyQaDeliveryPlan(signedPlan,trust)
  const {approvedPlan,scope}=approval
  function checkSession(){
    const s=verifySessionBundle(bundle,trust)
    verifyQaDeliveryPlan(signedPlan,trust)
    if(s.worldId!==scope.worldId || s.principalId!==scope.principalId ||
       s.connectionId!==scope.connectionId || s.challenge!==scope.challenge ||
       s.username!==scope.ownerName || bot?.username!==scope.botName)
      throw Error('QA signed delivery identity or server session changed')
    return s
  }
  checkSession()

  function attest(){
    let timer
    const check=async()=>{
      try{
        const session=checkSession()
        const proof=await trust.livePresence(session.connectionId)
        if(!proof || proof.connected!==true ||
           proof.connectionId!==session.connectionId ||
           proof.worldId!==session.worldId ||
           !Number.isSafeInteger(proof.issuedAt) ||
           Date.now()-proof.issuedAt>FRESH_PROOF_MS ||
           proof.issuedAt>Date.now()+1000)return false
        checkSession()
        const checkpoint=trust.currentRegistryCheckpoint()
        if(await trust.remoteCheckpointMatch(checkpoint)!==true)return false
        checkSession()
        // Never allow a previously fresh proof to authorize after a slow
        // remote response: all data must remain fresh at the dispatch edge.
        return Date.now()-proof.issuedAt<=FRESH_PROOF_MS
      }catch{return false}
    }
    // In addition to the coordinator's preflight timeout, the *inner*
    // authorization invoked by a journal adapter must also be bounded.
    // A late proof can never trigger a world operation.
    return Promise.race([check(),new Promise(resolve=>{
      timer=setTimeout(()=>resolve(false),ATTEST_TIMEOUT_MS)
    })]).finally(()=>clearTimeout(timer))
  }
  const stepNonce=(kind,index)=>crypto.createHash('sha256').update(
    'guiaia:delivery-step:v1\n'+scope.worldId+'\n'+scope.nonce+'\n'+kind+'\n'+index
  ).digest('hex')

  async function monitorWorldAction(adapter,operation,isCancelled,uncertain){
    let revoked=false,finished=false,pending=false
    let validUntil=Math.min(Date.now()+ACTION_MAX_UNATTESTED_MS,
      scope.expiresAt,bundle.bridge.payload.expiresAt,
      bundle.owner.payload.expiresAt)
    function revoke(){
      if(revoked||finished)return
      revoked=true
      try{adapter.cancel?.()}catch{}
    }
    const poll=setInterval(()=>{
      if(finished||revoked)return
      if(isCancelled()||(!pending && Date.now()>=validUntil)){revoke();return}
      if(pending){if(Date.now()>=validUntil+ATTEST_TIMEOUT_MS)revoke();return}
      pending=true
      void attest().then(ok=>{
        if(finished||revoked)return
        if(isCancelled()||!ok)revoke()
        else validUntil=Math.min(Date.now()+ACTION_MAX_UNATTESTED_MS,
          scope.expiresAt,bundle.bridge.payload.expiresAt,bundle.owner.payload.expiresAt)
      }).catch(revoke).finally(()=>{pending=false})
    },ACTION_MONITOR_MS)
    try{
      const result=await operation()
      // The journal must NOT issue a success receipt if a cancellation or
      // remote revocation happened mid-step, even if the bot returned success.
      if(revoked||isCancelled()||Date.now()>=validUntil)return uncertain()
      // The Minecraft operation can finish between periodic polls. An
      // additional attestation at receipt time closes that final gap.
      if(result?.ok===true && !await attest())return uncertain()
      if(revoked||isCancelled()||Date.now()>=validUntil)return uncertain()
      return result
    }finally{
      finished=true
      clearInterval(poll)
    }
  }
  const normalPosition=p=>p&&{x:p.x,y:p.y,z:p.z}
  function guardedGather(target,summary,adapter){
    if(!adapter || typeof adapter.gatherOne!=='function' ||
       adapter.sandboxOnly!==true || adapter.ownerName!==scope.ownerName ||
       adapter.block!==target.block || !same(normalPosition(adapter.target),
         normalPosition(target)))
      throw Error('QA gather adapter escaped signed plan')
    let cancelled=false,attempted=false
    return {sandboxOnly:true,ownerName:scope.ownerName,
      target:clone(target),block:target.block,
      cancel(){cancelled=true;adapter.cancel?.()},
      async gatherOne(){
        const reject=reason=>({ok:false,dig_attempted:false,reason})
        if(cancelled||attempted)return reject('delivery_step_cancelled_or_replayed')
        attempted=true
        if(!await attest() || cancelled)return reject('delivery_session_not_attested')
        try{reserveGrantOnce(trust.ledgerDirectory,stepNonce('gather',summary.index))}
        catch{return reject('delivery_step_nonce_replay_denied')}
        if(cancelled||!await attest())return reject('delivery_authorization_expired_after_reservation')
        return monitorWorldAction(adapter,()=>adapter.gatherOne(),
          ()=>cancelled,()=>({ok:false,dig_attempted:true,
            reason:'delivery_authority_lost_during_gather'}))
      }}
  }
  function guardedDeposit(step,summary,adapter){
    if(!adapter || typeof adapter.depositOne!=='function' ||
       adapter.sandboxOnly!==true || adapter.ownerName!==scope.ownerName ||
       adapter.item!==step.name || adapter.count!==step.count ||
       !same(normalPosition(adapter.chest),normalPosition(step.chest)))
      throw Error('QA deposit adapter escaped signed plan')
    let cancelled=false,attempted=false
    return {sandboxOnly:true,ownerName:scope.ownerName,
      chest:clone(step.chest),item:step.name,count:step.count,
      cancel(){cancelled=true;adapter.cancel?.()},
      async depositOne(){
        const reject=reason=>({ok:false,transferAttempted:false,reason})
        if(cancelled||attempted)return reject('delivery_step_cancelled_or_replayed')
        attempted=true
        if(!await attest() || cancelled)return reject('delivery_session_not_attested')
        try{reserveGrantOnce(trust.ledgerDirectory,stepNonce('deposit',summary.index))}
        catch{return reject('delivery_step_nonce_replay_denied')}
        if(cancelled||!await attest())return reject('delivery_authorization_expired_after_reservation')
        return monitorWorldAction(adapter,()=>adapter.depositOne(),
          ()=>cancelled,()=>({ok:false,transferAttempted:true,
            reason:'delivery_authority_lost_during_deposit'}))
      }}
  }
  return createQaDeliveryPipeline({missionJournal,depositJournal,approvedPlan,
    authorizeDispatch:attest,
    createGatherAction:async(target,summary)=>
      guardedGather(target,summary,await createGatherAction(target,summary)),
    createDepositAction:async(step,summary)=>
      guardedDeposit(step,summary,await createDepositAction(step,summary))})
}

module.exports={verifyQaDeliveryPlan,createQaSignedDeliveryPipeline,
  MAX_DURATION_MS,FRESH_PROOF_MS,ATTEST_TIMEOUT_MS,
  ACTION_MONITOR_MS,ACTION_MAX_UNATTESTED_MS}
