'use strict'
// Independent, pinned Ed25519 operator capability for one disposable QA chest
// operation. This authenticates the OPERATOR's permission, not an offline
// Minecraft nickname, UUID, or client connection. No chat command interface.
const crypto=require('node:crypto')
const fs=require('node:fs')
const path=require('node:path')
const {createQaChestDeposit}=require('./deposit')
const {RESOURCE_ITEMS}=require('./gather')
const MAX_LIFETIME_MS=300000
const REQUIRED=['version','audience','worldId','botName','ownerName',
  'chest','item','count','nonce','issuedAt','expiresAt','sandboxOnly']
function hasExactKeys(x,keys){
  return x && Object.getPrototypeOf(x)===Object.prototype &&
    Object.keys(x).length===keys.length &&
    keys.every(k=>Object.hasOwn(x,k))
}
function validPosition(p){
  return hasExactKeys(p,['x','y','z']) &&
    ['x','y','z'].every(k=>Number.isInteger(p[k]) && Math.abs(p[k])<30000000)
}
function verifyGrant(grant,context){
  if(!context || context.sandboxOnly!==true ||
     context.identityMode!=='unverified_offline_lab' ||
     typeof context.publicKeyPem!=='string' ||
     typeof context.worldId!=='string' ||
     typeof context.botName!=='string' ||
     !/^[a-zA-Z0-9:_-]{1,64}$/.test(context.worldId) ||
     !/^[A-Za-z0-9_]{3,16}$/.test(context.botName) ||
     !hasExactKeys(grant,['payload','signature'])) {
    throw Error('Missing trusted out-of-band QA operator authority')
  }
  const payload=grant.payload
  if(!hasExactKeys(payload,REQUIRED) || !validPosition(payload.chest) ||
     payload.version!==1 || payload.audience!=='guiaia:deposit-one:v1' ||
     payload.sandboxOnly!==true || payload.worldId!==context.worldId ||
     payload.botName!==context.botName ||
     !/^[A-Za-z0-9_]{3,16}$/.test(payload.ownerName||'') ||
     !Object.hasOwn(RESOURCE_ITEMS,payload.item) ||
     !Number.isInteger(payload.count) || payload.count<1 || payload.count>2 ||
     typeof payload.nonce!=='string' ||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(payload.nonce) ||
     !Number.isSafeInteger(payload.issuedAt) ||
     !Number.isSafeInteger(payload.expiresAt) ||
     typeof grant.signature!=='string' ||
     !/^[a-zA-Z0-9_-]{86}$/.test(grant.signature)) {
    throw Error('Unsafe or wrong-scoped QA capability')
  }
  const now=Date.now()
  if(payload.issuedAt>now+5000 || payload.expiresAt<now ||
     payload.expiresAt-payload.issuedAt<1000 ||
     payload.expiresAt-payload.issuedAt>MAX_LIFETIME_MS) {
    throw Error('Expired or excessively long-lived QA capability')
  }
  let key
  try{key=crypto.createPublicKey(context.publicKeyPem)}catch{throw Error('Invalid pinned operator public key')}
  if(key.asymmetricKeyType!=='ed25519')throw Error('Only Ed25519 grants are supported')
  const signature=Buffer.from(grant.signature,'base64url')
  if(signature.length!==64 ||
     !crypto.verify(null,Buffer.from(JSON.stringify(payload)),key,signature)){
    throw Error('QA operator signature invalid')
  }
  return payload
}
function sameChest(a,b){
  return a && b && ['x','y','z'].every(k=>a[k]===b[k])
}
function reserveGrantOnce(directory,nonce) {
  if(typeof directory!=='string' || !path.isAbsolute(directory) ||
     (fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())) {
    throw Error('Unsafe operator capability ledger directory')
  }
  fs.mkdirSync(directory,{recursive:true,mode:0o700})
  if(!fs.statSync(directory).isDirectory())throw Error('Unsafe capability ledger')
  fs.chmodSync(directory,0o700)
  const digest=crypto.createHash('sha256').update(nonce).digest('hex')
  const file=path.join(directory,digest+'.used')
  // O_EXCL is a single, atomic reservation. If the process dies immediately
  // afterwards, the grant remains spent; never retry uncertain operations.
  const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600)
  try{
    fs.writeSync(fd,Buffer.from('spent\n'))
    fs.fsyncSync(fd)
  }finally{fs.closeSync(fd)}
  const d=fs.openSync(directory,fs.constants.O_RDONLY)
  try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
  return file
}
function createOperatorAuthorizedQaDeposit(bot,plan,grant,authority){
  if(!authority || !authority.ledgerDirectory)throw Error('Missing operator replay ledger')
  const claim=verifyGrant(grant,authority)
  if(plan?.sandboxOnly!==true || plan.ownerName!==claim.ownerName ||
     plan.item!==claim.item || plan.count!==claim.count ||
     !sameChest(plan.chest,claim.chest) ||
     bot?.username!==authority.botName){
    throw Error('QA deposit request differs from signed operator scope')
  }
  // Take a private, frozen snapshot of signed coordinates. The caller may
  // mutate its plan object after validation, but never the authorized target.
  const sealedPlan={sandboxOnly:true,ownerName:claim.ownerName,
    chest:Object.freeze({...claim.chest}),item:claim.item,count:claim.count}
  const sealedAuthority=Object.freeze({...authority})
  const operation=createQaChestDeposit(bot,sealedPlan)
  const original=operation.depositOne
  let attempted=false
  operation.depositOne=async()=>{
    if(attempted)return {ok:false,reason:'signed_grant_already_used',transferAttempted:false}
    attempted=true
    // Revalidate the signature and expiry at actual dispatch time as well.
    // A valid grant that expires while queued must NEVER reach the world.
    verifyGrant(grant,sealedAuthority)
    if(bot.username!==sealedAuthority.botName)throw Error('Operator target bot changed')
    // No world mutation before the durable consumption barrier.
    reserveGrantOnce(sealedAuthority.ledgerDirectory,claim.nonce)
    return original()
  }
  return operation
}
module.exports={verifyGrant,reserveGrantOnce,createOperatorAuthorizedQaDeposit}
