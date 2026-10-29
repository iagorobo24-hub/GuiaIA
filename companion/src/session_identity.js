'use strict'

// Isolated prototype: two independent cryptographic authorities must agree.
// Neither offline nickname nor offline UUID is accepted as player identity.
// A genuine server-side connection attester is REQUIRED outside this QA lab.
const crypto=require('node:crypto')
const {createQaChestDeposit}=require('./deposit')
const {reserveGrantOnce}=require('./operator_authorization')
const {RESOURCE_ITEMS}=require('./gather')

const BRIDGE_FIELDS=['aud','worldId','connectionId','username','challenge','issuedAt','expiresAt']
const OWNER_FIELDS=['aud','worldId','connectionId','principalId','challenge','issuedAt','expiresAt']
const GRANT_FIELDS=['aud','worldId','botName','ownerName','principalId','connectionId',
  'challenge','chest','item','count','nonce','issuedAt','expiresAt']
const EXACT_SESSION = ['bridge','owner']
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const name=/^[A-Za-z0-9_]{3,16}$/
const id=/^[a-zA-Z0-9:_-]{1,64}$/
const challenge=/^[a-f0-9]{32,64}$/
function exact(obj,keys){
  return obj && Object.getPrototypeOf(obj)===Object.prototype &&
    Object.keys(obj).length===keys.length && keys.every(k=>Object.hasOwn(obj,k))
}
function validChest(p){
  return exact(p,['x','y','z']) &&
    ['x','y','z'].every(k=>Number.isInteger(p[k])&&Math.abs(p[k])<30000000)
}
function validWindow(p,now,maximum){
  return Number.isSafeInteger(p.issuedAt) && Number.isSafeInteger(p.expiresAt) &&
    p.issuedAt<=now+5000 && p.expiresAt>=now &&
    p.expiresAt-p.issuedAt>=1000 && p.expiresAt-p.issuedAt<=maximum
}
function verifySigned(token,keyPem){
  if(!exact(token,['payload','signature']) ||
     typeof token.signature!=='string' ||
     !/^[a-zA-Z0-9_-]{86}$/.test(token.signature) ||
     typeof keyPem!=='string')throw Error('Untrusted or malformed signed evidence')
  let key
  try{key=crypto.createPublicKey(keyPem)}catch{throw Error('Untrusted authority public key')}
  if(key.asymmetricKeyType!=='ed25519')throw Error('Unsupported evidence signing key')
  const bytes=Buffer.from(token.signature,'base64url')
  if(bytes.length!==64 ||
     !crypto.verify(null,Buffer.from(JSON.stringify(token.payload)),key,bytes)){
    throw Error('Signed evidence verification failed')
  }
  return token.payload
}
function verifySessionBundle(bundle,authority){
  if(!authority || authority.sandboxOnly!==true ||
     authority.identityMode!=='trusted_server_bridge_lab' ||
     !id.test(authority.worldId||'') || !name.test(authority.botName||'') ||
     !authority.trustedPrincipals || typeof authority.trustedPrincipals!=='object' ||
     !exact(bundle,EXACT_SESSION) ||
     typeof authority.activeConnection!=='function' ||
     typeof authority.isRevoked!=='function') {
    throw Error('No independent trusted session authority')
  }
  const bridge=bundle.bridge?.payload,owner=bundle.owner?.payload
  if(!exact(bridge,BRIDGE_FIELDS) || !exact(owner,OWNER_FIELDS) ||
     bridge.aud!=='guiaia:server-connection:v1' ||
     owner.aud!=='guiaia:principal-proof:v1' ||
     !id.test(bridge.worldId||'') || bridge.worldId!==authority.worldId ||
     owner.worldId!==authority.worldId ||
     !uuid.test(bridge.connectionId||'') || bridge.connectionId!==owner.connectionId ||
     !name.test(bridge.username||'') ||
     !challenge.test(bridge.challenge||'') || bridge.challenge!==owner.challenge ||
     !id.test(owner.principalId||'') ||
     !Object.hasOwn(authority.trustedPrincipals,owner.principalId) ||
     !validWindow(bridge,Date.now(),60000) ||
     !validWindow(owner,Date.now(),60000)) {
    throw Error('Session identity or scope invalid')
  }
  verifySigned(bundle.bridge,authority.serverBridgePublicKeyPem)
  verifySigned(bundle.owner,authority.trustedPrincipals[owner.principalId])
  if(authority.isRevoked(owner.principalId,bridge.connectionId)!==false) {
    throw Error('Principal or session revoked or revocation unavailable')
  }
  // MUST come from a live authenticated SERVER BRIDGE, not bot.players,
  // nickname, user-supplied JSON or a previous snapshot.
  const active=authority.activeConnection(bridge.connectionId)
  if(!active || active.worldId!==authority.worldId ||
     active.connectionId!==bridge.connectionId ||
     active.username!==bridge.username ||
     active.connected!==true){
    throw Error('Server bridge cannot attest live matching connection')
  }
  return {worldId:bridge.worldId,principalId:owner.principalId,
    connectionId:bridge.connectionId,challenge:bridge.challenge,username:bridge.username}
}
function verifySessionDepositGrant(token,session,authority){
  const p=token?.payload
  if(!exact(p,GRANT_FIELDS) || p.aud!=='guiaia:session-deposit:v1' ||
     p.worldId!==session.worldId || p.principalId!==session.principalId ||
     p.connectionId!==session.connectionId || p.challenge!==session.challenge ||
     p.ownerName!==session.username || p.botName!==authority.botName ||
     !validChest(p.chest) || !Object.hasOwn(RESOURCE_ITEMS,p.item) ||
     !Number.isInteger(p.count) || p.count<1 || p.count>2 ||
     !uuid.test(p.nonce||'') || !validWindow(p,Date.now(),120000)) {
    throw Error('Session-scoped deposit capability invalid')
  }
  verifySigned(token,authority.operatorPublicKeyPem)
  return p
}
// Only public entrypoint offered by this security prototype.
// Raw createQaChestDeposit is a historical sandbox test adapter, and must
// NEVER be exported by any future production command/chat API.
function createSessionAuthorizedQaDeposit(bot,bundle,capability,authority){
  const session=verifySessionBundle(bundle,authority)
  // Copy trusted key material/callbacks, not caller-mutable configuration.
  const trust=Object.freeze({...authority,
    trustedPrincipals:Object.freeze({...authority.trustedPrincipals})})
  const p=verifySessionDepositGrant(capability,session,trust)
  if(bot?.username!==trust.botName ||
     typeof trust.ledgerDirectory!=='string') {
    throw Error('Wrong QA bot or missing single-use ledger')
  }
  const scope={sandboxOnly:true,ownerName:p.ownerName,chest:Object.freeze({...p.chest}),
    item:p.item,count:p.count}
  const adapter=createQaChestDeposit(bot,scope)
  const base=adapter.depositOne
  let attempted=false
  adapter.depositOne=async()=>{
    if(attempted)return {ok:false,reason:'session_grant_already_attempted',transferAttempted:false}
    attempted=true
    const current=verifySessionBundle(bundle,trust)
    const grant=verifySessionDepositGrant(capability,current,trust)
    if(bot.username!==trust.botName)throw Error('Target bot changed before dispatch')
    reserveGrantOnce(trust.ledgerDirectory,grant.nonce)
    return base()
  }
  return adapter
}
function createQaSessionActionGateway(bot,authority){
  // A closed command surface: no untrusted chat, mine, arbitrary chest,
  // free-form commands or generic "execute" path.
  return Object.freeze({
    createDeposit: (sessionProof,signedCapability) =>
      createSessionAuthorizedQaDeposit(bot,sessionProof,signedCapability,authority)
  })
}
module.exports={verifySessionBundle,verifySessionDepositGrant,createSessionAuthorizedQaDeposit,
  createQaSessionActionGateway}
