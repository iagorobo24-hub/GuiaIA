'use strict'

// QA-only bridge between independently enrolled principal credentials and a
// signed, currently present Fabric connection. Not Microsoft authentication.
// This module cannot issue world-action grants, join games or open a bot.
const crypto=require('node:crypto')
const {verifySessionBundle}=require('./session_identity')
const WORLD=/^qa:[A-Za-z0-9:_-]{1,61}$/
const PRINCIPAL=/^[A-Za-z0-9:_-]{1,64}$/
const BOT=/^[A-Za-z0-9_]{3,16}$/
const USER=/^[A-Za-z0-9_]{3,16}$/
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CHALLENGE=/^[a-f0-9]{48}$/
const FIELDS=['aud','worldId','connectionId','username','challenge','issuedAt','expiresAt']
const exact=(v,fields)=>v!==null&&typeof v==='object'&&
  Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k))
function publicKey(input){
  let key
  try{key=crypto.createPublicKey(input)}catch{throw Error('Invalid pinned QA signing key')}
  if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 authority required')
  return key
}
function privateKey(input){
  let key
  try{key=crypto.createPrivateKey(input)}catch{throw Error('Invalid QA principal private key')}
  if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 principal key required')
  return key
}
function verifiedBridge(proof,serverKey,worldId,username,now){
  const p=proof?.payload
  if(!exact(proof,['payload','signature'])||!exact(p,FIELDS)||
     p.aud!=='guiaia:server-connection:v1'||p.worldId!==worldId||
     p.username!==username||!USER.test(p.username)||!UUID.test(p.connectionId||'')||
     !CHALLENGE.test(p.challenge||'')||
     !Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||
     ![45000,120000].includes(p.expiresAt-p.issuedAt)||
     p.issuedAt>now+5000||p.expiresAt<now||
     typeof proof.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(proof.signature))
    throw Error('Untrusted signed Fabric connection claim')
  const signature=Buffer.from(proof.signature,'base64url')
  if(signature.length!==64||!crypto.verify(null,
     Buffer.from(JSON.stringify(p)),serverKey,signature))
    throw Error('Invalid Fabric connection Ed25519 signature')
  return p
}
function boundConnected(source,p){
  const active=source.activeConnection(p.connectionId)
  if(!active||active.connected!==true||active.worldId!==p.worldId||
     active.connectionId!==p.connectionId||active.username!==p.username)
    throw Error('Connection not live in signed Fabric event source')
}
function freshPresence(presence,p,now){
  if(!presence||presence.connected!==true||
     presence.worldId!==p.worldId||presence.connectionId!==p.connectionId||
     !Number.isSafeInteger(presence.issuedAt)||
     presence.issuedAt>now+1000||now-presence.issuedAt>1500)
    throw Error('Current signed Fabric presence unavailable')
}
function principalAllowed(registry,principalId,principalPublic){
  if(registry.isRevoked(principalId)!==false)
    throw Error('Principal revoked or registry unavailable')
  const pinned=registry.trustedPrincipals()
  if(!pinned||!Object.hasOwn(pinned,principalId)||
     !crypto.timingSafeEqual(
       publicKey(pinned[principalId]).export({format:'der',type:'spki'}),
       principalPublic.export({format:'der',type:'spki'})))
    throw Error('Principal private key is not pre-enrolled')
  return pinned
}
function isReadyContext(config){
  return config?.sandboxOnly===true &&
    config?.identityMode==='trusted_server_bridge_lab' &&
    WORLD.test(config.worldId||'')&&BOT.test(config.botName||'')&&
    PRINCIPAL.test(config.principalId||'')&&USER.test(config.username||'')&&
    typeof config?.bridge?.joinProof==='function'&&
    typeof config.bridge.activeConnection==='function'&&
    typeof config?.live?.livePresence==='function'&&
    typeof config?.registry?.isRevoked==='function'&&
    typeof config.registry.trustedPrincipals==='function'&&
    typeof config.registry.exportCheckpoint==='function'&&
    typeof config?.witness?.verifyLocal==='function'&&
    typeof config.serverBridgePublicKeyPem==='string'
}
async function issueQaBoundPrincipalSession(config={}){
  if(!isReadyContext(config))
    throw Error('Explicit QA session binding requires live bridge and independent witness')
  const {worldId,botName,principalId,username,registry,bridge,live,witness}=config
  const ownerPrivate=privateKey(config.principalPrivateKey)
  const ownerPublic=crypto.createPublicKey(ownerPrivate)
  const serverKey=publicKey(config.serverBridgePublicKeyPem)
  principalAllowed(registry,principalId,ownerPublic)
  const connectionId=config.connectionId
  if(!UUID.test(connectionId||''))throw Error('Explicit live connection ID required')
  const evidence=bridge.joinProof(connectionId)
  const p=verifiedBridge(evidence,serverKey,worldId,username,Date.now())
  if(p.connectionId!==connectionId)throw Error('Signed connection ID mismatch')
  boundConnected(bridge,p)
  // A source event on disk is NOT current JVM presence; verify a live
  // server challenge and a separately signed high-watermark before signing.
  const presence=await live.livePresence(connectionId)
  freshPresence(presence,p,Date.now())
  if(await witness.verifyLocal(registry.exportCheckpoint())!==true)
    throw Error('Independent principal revocation witness refused')
  // Async calls may race with disconnect, expiry, revocation and key
  // rotation. Recheck every authority after awaits, not just the cache.
  principalAllowed(registry,principalId,ownerPublic)
  const current=verifiedBridge(bridge.joinProof(connectionId),serverKey,
    worldId,username,Date.now())
  if(current.challenge!==p.challenge||current.issuedAt!==p.issuedAt||
     current.expiresAt!==p.expiresAt)
    throw Error('Fabric connection changed during independent attestation')
  boundConnected(bridge,p)
  freshPresence(presence,p,Date.now())
  const now=Date.now()
  if(p.expiresAt<=now+1000)throw Error('Signed Fabric connection expiring')
  const claim={aud:'guiaia:principal-proof:v1',worldId,connectionId,
    principalId,challenge:p.challenge,
    issuedAt:now-1000,expiresAt:Math.min(now+20000,p.expiresAt)}
  const proof={payload:claim,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(claim)),ownerPrivate).toString('base64url')}
  const authority={
    sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName,serverBridgePublicKeyPem:config.serverBridgePublicKeyPem,
    trustedPrincipals:registry.trustedPrincipals(),
    isRevoked:id=>registry.isRevoked(id),
    activeConnection:id=>bridge.activeConnection(id)
  }
  const session={bridge:evidence,owner:proof}
  const verified=verifySessionBundle(session,authority)
  if(verified.principalId!==principalId||verified.connectionId!==connectionId)
    throw Error('Cross-identity session validation failure')
  return Object.freeze({session:structuredClone(session),
    scope:Object.freeze({worldId,principalId,connectionId,username,
      expiresAt:claim.expiresAt,worldActionsEnabled:false})})
}
module.exports={issueQaBoundPrincipalSession,verifiedBridge}
