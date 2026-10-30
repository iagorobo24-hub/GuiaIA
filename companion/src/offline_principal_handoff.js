'use strict'

// Independent, OFFLINE QA principal handoff. No Minecraft connection, action
// grant, chat/API entry point, account-name proof or automatic approval.
const crypto=require('node:crypto')
const {verifyTicket,verifyConsent}=require('./principal_enrollment')
const AUD='guiaia:principal-enrollment-request:v1'
const ID=/^[A-Za-z0-9:_-]{1,64}$/
const WORLD=/^qa:[A-Za-z0-9:_-]{1,61}$/
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const REQUEST=['aud','worldId','principalId','publicKeyDer','nonce','issuedAt','expiresAt']
const exact=(v,keys)=>v!==null&&typeof v==='object'&&
  Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const signedShape=v=>exact(v,['payload','signature'])&&
  typeof v.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(v.signature)

function edPublic(input){
  let key
  try{key=crypto.createPublicKey(input)}catch{throw Error('Invalid Ed25519 public key')}
  if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 key required')
  return key
}
function edPrivate(input){
  let key
  try{key=crypto.createPrivateKey(input)}catch{throw Error('Invalid Ed25519 private key')}
  if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 key required')
  return key
}
function decodeKey(encoded){
  if(typeof encoded!=='string'||encoded.length>160||
     !/^[A-Za-z0-9_-]+$/.test(encoded))throw Error('Invalid principal public key')
  const raw=Buffer.from(encoded,'base64url')
  if(raw.toString('base64url')!==encoded)throw Error('Noncanonical principal public key')
  const key=edPublic({key:raw,format:'der',type:'spki'})
  if(key.export({format:'der',type:'spki'}).toString('base64url')!==encoded)
    throw Error('Noncanonical Ed25519 SPKI')
  return key
}
const fingerprint=encoded=>crypto.createHash('sha256')
  .update(decodeKey(encoded).export({format:'der',type:'spki'})).digest('hex')
function assertScope(worldId,principalId){
  if(!WORLD.test(worldId||'')||!ID.test(principalId||''))
    throw Error('Explicit QA world and principal ID required')
}
function sign(bytes,privateKey){
  return crypto.sign(null,Buffer.from(bytes),privateKey).toString('base64url')
}
function validateRequest(request,expectedWorldId,now=Date.now()){
  if(!signedShape(request)||!exact(request.payload,REQUEST)||
     !Number.isSafeInteger(now))throw Error('Malformed enrollment request')
  const p=request.payload
  assertScope(p.worldId,p.principalId)
  if(p.aud!==AUD||p.worldId!==expectedWorldId||!UUID.test(p.nonce||'')||
     !Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||
     p.issuedAt>now+5000||p.expiresAt<now||
     p.expiresAt-p.issuedAt<1000||p.expiresAt-p.issuedAt>300000)
    throw Error('Expired or wrong-world principal request')
  const sig=Buffer.from(request.signature,'base64url')
  if(sig.length!==64||!crypto.verify(null,
      Buffer.from(AUD+'\n'+JSON.stringify(p)),decodeKey(p.publicKeyDer),sig))
    throw Error('Principal request key possession proof failed')
  return p
}
function createPrincipalRequest({worldId,principalId,principalPrivateKey,now=Date.now()}={}){
  assertScope(worldId,principalId)
  if(!Number.isSafeInteger(now))throw Error('Invalid request time')
  const key=edPrivate(principalPrivateKey)
  const publicKeyDer=crypto.createPublicKey(key)
    .export({format:'der',type:'spki'}).toString('base64url')
  const payload={aud:AUD,worldId,principalId,publicKeyDer,
    nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+119000}
  return Object.freeze({payload,signature:sign(AUD+'\n'+JSON.stringify(payload),key)})
}
function approvePrincipalRequest({request,operatorPrivateKey,expectedWorldId,
  reviewedPrincipalId,reviewedFingerprint,now=Date.now()}={}){
  const p=validateRequest(request,expectedWorldId,now)
  // The operator must compare BOTH values using an out-of-band trusted channel;
  // request contents alone are not a human identity attestation.
  if(reviewedPrincipalId!==p.principalId||
     reviewedFingerprint!==fingerprint(p.publicKeyDer))
    throw Error('No matching independent operator approval')
  const key=edPrivate(operatorPrivateKey)
  const payload={
    aud:'guiaia:principal-enrollment:v1',
    worldId:p.worldId,principalId:p.principalId,nonce:p.nonce,
    issuedAt:now-1000,expiresAt:Math.min(now+60000,p.expiresAt),
    publicKeyDer:p.publicKeyDer
  }
  if(payload.expiresAt-payload.issuedAt<1000)
    throw Error('Principal request expires before approval')
  return Object.freeze({payload,signature:sign(JSON.stringify(payload),key)})
}
function completePrincipalHandoff({ticket,principalPrivateKey,operatorPublicKeyPem,
  expectedWorldId,now=Date.now()}={}){
  const key=edPrivate(principalPrivateKey)
  const publicKeyDer=crypto.createPublicKey(key)
    .export({format:'der',type:'spki'}).toString('base64url')
  const p=verifyTicket(ticket,edPublic(operatorPublicKeyPem),expectedWorldId,now)
  if(p.aud!=='guiaia:principal-enrollment:v1'||!WORLD.test(p.worldId)||
     p.publicKeyDer!==publicKeyDer)throw Error('Ticket does not belong to the principal')
  const consent=sign('guiaia:principal-consent:v1\n'+JSON.stringify(p),key)
  verifyConsent(p,consent)
  return Object.freeze({ticket,consent})
}
function verifyPrincipalHandoff({handoff,operatorPublicKeyPem,expectedWorldId,
  now=Date.now()}={}){
  if(!exact(handoff,['ticket','consent']))throw Error('Malformed principal handoff')
  const p=verifyTicket(handoff.ticket,edPublic(operatorPublicKeyPem),expectedWorldId,now)
  if(p.aud!=='guiaia:principal-enrollment:v1'||!WORLD.test(p.worldId))
    throw Error('Only QA principal enrollment is supported')
  verifyConsent(p,handoff.consent)
  return Object.freeze({worldId:p.worldId,principalId:p.principalId,
    fingerprint:fingerprint(p.publicKeyDer),nonce:p.nonce})
}
function createPrincipalRevocation({worldId,principalId,operatorPrivateKey,
  reviewedPrincipalId,now=Date.now()}={}){
  assertScope(worldId,principalId)
  if(principalId!==reviewedPrincipalId||!Number.isSafeInteger(now))
    throw Error('Explicit matching operator revocation required')
  const key=edPrivate(operatorPrivateKey)
  const payload={aud:'guiaia:principal-revocation:v1',worldId,principalId,
    nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+59000}
  return Object.freeze({payload,signature:sign(JSON.stringify(payload),key)})
}
function verifyPrincipalRevocation({ticket,operatorPublicKeyPem,expectedWorldId,
  now=Date.now()}={}){
  const p=verifyTicket(ticket,edPublic(operatorPublicKeyPem),expectedWorldId,now)
  if(p.aud!=='guiaia:principal-revocation:v1'||!WORLD.test(p.worldId))
    throw Error('Only QA principal revocation is supported')
  return Object.freeze({worldId:p.worldId,principalId:p.principalId,nonce:p.nonce})
}
module.exports={createPrincipalRequest,validateRequest,approvePrincipalRequest,
  completePrincipalHandoff,verifyPrincipalHandoff,fingerprint,
  createPrincipalRevocation,verifyPrincipalRevocation}
