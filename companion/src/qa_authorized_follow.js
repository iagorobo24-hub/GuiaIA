'use strict'

// Bounded *disposable QA* movement. Only the authenticated session owner,
// operator-signed one-use movement grant, live Fabric nonce challenge and
// independent revocation witness can start or sustain following.
// Never attach this to untrusted CLI/game chat without full real-world QA.
const {createController}=require('./controller')
const {verifySessionBundle,verifySessionFollowGrant}=require('./session_identity')
const {reserveGrantOnce}=require('./operator_authorization')

const CHECK_INTERVAL_MS=250
const MAX_UNATTESTED_MS=1500

function createQaAuthorizedFollow(bot,classes,bundle,capability,authority){
  if(authority?.sandboxOnly!==true ||
     authority.identityMode!=='trusted_server_bridge_lab' ||
     authority.requireLivePresence!==true ||
     authority.requireRemoteCheckpoint!==true ||
     typeof authority.livePresence!=='function' ||
     typeof authority.remoteCheckpointMatch!=='function' ||
     typeof authority.currentRegistryCheckpoint!=='function' ||
     typeof authority.ledgerDirectory!=='string' ||
     typeof authority.isRevoked!=='function' ||
     typeof authority.activeConnection!=='function'){
    throw Error('Movement requires dual QA identity and revocation authorities')
  }
  const trust=Object.freeze({...authority,
    trustedPrincipals:Object.freeze({...authority.trustedPrincipals})})
  const initial=verifySessionBundle(bundle,trust)
  const grant=verifySessionFollowGrant(capability,initial,trust)
  if(bot?.username!==trust.botName)throw Error('Movement target bot identity invalid')
  const controller=createController(bot,classes,{ownerName:initial.username})
  let state='ready',cause='awaiting_signed_authorization',pending=false
  let interval=null,validUntil=0,onDisconnect=null
  function halt(reason){
    if(interval){clearInterval(interval);interval=null}
    if(onDisconnect){
      for(const event of ['end','kicked','death'])bot.off(event,onDisconnect)
      onDisconnect=null
    }
    if(state!=='stopped'){
      controller.stop(reason)
      state='stopped'
      cause=reason
    }
    return Object.freeze({ok:true,mode:'idle',reason:cause})
  }
  async function check(){
    if(state==='stopped')throw Error('Movement stopped')
    const session=verifySessionBundle(bundle,trust)
    verifySessionFollowGrant(capability,session,trust)
    if(bot.username!==trust.botName)throw Error('Movement bot changed')
    const live=await trust.livePresence(session.connectionId)
    if(!live || live.connected!==true || live.worldId!==session.worldId ||
       live.connectionId!==session.connectionId ||
       !Number.isSafeInteger(live.issuedAt) ||
       Date.now()-live.issuedAt>1500 || live.issuedAt>Date.now()+1000)
      throw Error('Fresh signed Fabric presence missing')
    // Do not allow revocation that occurs while the live request is pending.
    verifySessionBundle(bundle,trust)
    verifySessionFollowGrant(capability,session,trust)
    const local=trust.currentRegistryCheckpoint()
    if(await trust.remoteCheckpointMatch(local)!==true)
      throw Error('Independent revocation checkpoint mismatch')
    // Check again after every network await. Pending external calls never
    // extend the movement lease by themselves.
    verifySessionBundle(bundle,trust)
    verifySessionFollowGrant(capability,session,trust)
    if(Date.now()-live.issuedAt>1500)
      throw Error('Fabric live proof expired during witness query')
    if(state==='stopped')throw Error('Movement stopped during attestation')
    return Date.now()
  }
  async function refresh(){
    if(state!=='following')return
    if(Date.now()>=validUntil)return halt('movement_attestation_expired')
    const observed=controller.monitor()
    if(observed.mode!=='following')return halt(observed.reason||'safety_stop')
    if(pending)return
    pending=true
    try{
      const now=await check()
      if(state==='following'){
        validUntil=Math.min(now+MAX_UNATTESTED_MS,grant.expiresAt,
          bundle.bridge.payload.expiresAt,bundle.owner.payload.expiresAt)
      }
    }catch{
      if(state==='following')halt('movement_identity_or_witness_unavailable')
    }finally{pending=false}
  }
  let started=false
  async function start(){
    if(started || state!=='ready')
      return Object.freeze({ok:false,reason:'signed_follow_grant_already_attempted'})
    started=true
    try{
      const attestedAt=await check()
      if(state!=='ready')throw Error('Movement stopped before dispatch')
      // Consume the signed nonce BEFORE taking the first movement action.
      reserveGrantOnce(trust.ledgerDirectory,grant.nonce)
      if(state!=='ready')throw Error('Movement stopped before dispatch')
      verifySessionBundle(bundle,trust)
      verifySessionFollowGrant(capability,initial,trust)
      const result=controller.follow()
      if(result.ok!==true){
        halt(result.reason||'movement_safety_rejected')
        return Object.freeze({ok:false,reason:result.reason||'movement_safety_rejected'})
      }
      state='following'
      cause='signed_follow_active'
      validUntil=Math.min(attestedAt+MAX_UNATTESTED_MS,grant.expiresAt,
        bundle.bridge.payload.expiresAt,bundle.owner.payload.expiresAt)
      interval=setInterval(()=>{void refresh()},CHECK_INTERVAL_MS)
      interval.unref?.()
      return Object.freeze({ok:true,mode:'following',reason:cause})
    }catch(error){
      halt('movement_authorization_denied')
      throw error
    }
  }
  function status(){
    const observed=controller.status()
    return Object.freeze({mode:state==='following'?'following':'idle',
      reason:cause,owner_visible:observed.owner_visible,
      signed_grant_attempted:started})
  }
  // React immediately to lifecycle changes in addition to periodic audits.
  onDisconnect=()=>halt('movement_connection_closed')
  for(const event of ['end','kicked','death'])bot.on(event,onDisconnect)
  return Object.freeze({start,stop:halt,status})
}
module.exports={createQaAuthorizedFollow,CHECK_INTERVAL_MS,MAX_UNATTESTED_MS}
