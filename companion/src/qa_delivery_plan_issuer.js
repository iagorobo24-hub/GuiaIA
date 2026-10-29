'use strict'

// Trusted, in-process, operator-only QA plan issuance. No CLI, HTTP, chat,
// automatic mining or other world-action entrypoint. A private Ed25519 key is
// supplied by a separate human-approved operator workflow and never persisted.
const crypto = require('node:crypto')
const path = require('node:path')
const {verifySessionBundle} = require('./session_identity')
const {verifyQaDeliveryPlan,MAX_DURATION_MS} = require('./qa_signed_delivery')
const {reserveGrantOnce} = require('./operator_authorization')
const {validateSpec} = require('./mission')
const {validatePlan} = require('./deposit')

const exact=(v,fields)=>v && Object.getPrototypeOf(v)===Object.prototype &&
  Object.keys(v).length===fields.length && fields.every(k=>Object.hasOwn(v,k))
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const clone=v=>JSON.parse(JSON.stringify(v))
const immutable=v=>{
  if(v && typeof v==='object'){
    for(const item of Object.values(v))immutable(item)
    Object.freeze(v)
  }
  return v
}

function issueQaDeliveryPlan({bot,bundle,authority,operatorPrivateKey,
  reviewedSpec,missionJournal,depositJournal,approvalDirectory,
  lifetimeMs=15000}={}){
  if(authority?.sandboxOnly!==true ||
     authority.identityMode!=='trusted_server_bridge_lab' ||
     !exact(reviewedSpec,['sandboxOnly','ownerName','targets','chest','items']) ||
     reviewedSpec.sandboxOnly!==true ||
     !Number.isSafeInteger(lifetimeMs) || lifetimeMs<2000 ||
     lifetimeMs>MAX_DURATION_MS ||
     typeof approvalDirectory!=='string' ||
     !path.isAbsolute(approvalDirectory) ||
     typeof missionJournal?.view!=='function' ||
     typeof depositJournal?.view!=='function')
    throw Error('Trusted operator-reviewed QA plan and existing journals required')
  // The original journal validators are authoritative on safe coordinates,
  // allowed materials and bounded target/count shape.
  validateSpec({sandboxOnly:true,ownerName:reviewedSpec.ownerName,
    targets:reviewedSpec.targets})
  validatePlan({sandboxOnly:true,ownerName:reviewedSpec.ownerName,
    chest:reviewedSpec.chest,items:reviewedSpec.items})
  if(reviewedSpec.targets.some(t=>!exact(t,['x','y','z','block'])) ||
     reviewedSpec.items.some(i=>!exact(i,['name','count'])) ||
     !exact(reviewedSpec.chest,['x','y','z']))
    throw Error('Operator review must specify exact item, block and coordinates')
  const mission=missionJournal.view(),deposit=depositJournal.view()
  if(mission?.sandboxOnly!==true || deposit?.sandboxOnly!==true ||
     mission.phase!=='ready' || deposit.phase!=='ready' ||
     mission.index!==0 || deposit.index!==0 ||
     mission.receipts?.length!==0 || deposit.receipts?.length!==0 ||
     !same(mission.targets,reviewedSpec.targets) ||
     !same(deposit.items,reviewedSpec.items) ||
     !same(deposit.chest,reviewedSpec.chest) ||
     mission.ownerName!==reviewedSpec.ownerName ||
     deposit.ownerName!==reviewedSpec.ownerName)
    throw Error('Existing durable QA journals differ from operator-approved plan')
  const session=verifySessionBundle(bundle,authority)
  if(bot?.username!==authority.botName ||
     session.username!==reviewedSpec.ownerName)
    throw Error('Operator-reviewed plan does not match authenticated session')
  let key
  try{key=operatorPrivateKey?.type==='private' && operatorPrivateKey?.asymmetricKeyType
    ?operatorPrivateKey:crypto.createPrivateKey(operatorPrivateKey)}
  catch{throw Error('QA operator signing private key unavailable')}
  if(key.asymmetricKeyType!=='ed25519' ||
     !crypto.createPublicKey(key).equals(crypto.createPublicKey(authority.operatorPublicKeyPem)))
    throw Error('QA operator private key does not match pinned authority')
  const now=Date.now()
  const expiresAt=Math.min(now+lifetimeMs,
    bundle.bridge.payload.expiresAt,bundle.owner.payload.expiresAt)
  if(!Number.isSafeInteger(expiresAt) || expiresAt-now<1500)
    throw Error('Session too close to expiry to issue QA plan')
  const payload={aud:'guiaia:session-delivery-plan:v1',sandboxOnly:true,
    worldId:session.worldId,botName:authority.botName,
    ownerName:session.username,principalId:session.principalId,
    connectionId:session.connectionId,challenge:session.challenge,
    missionId:mission.missionId,planId:deposit.planId,
    targets:clone(reviewedSpec.targets),chest:clone(reviewedSpec.chest),
    items:clone(reviewedSpec.items),nonce:crypto.randomUUID(),
    issuedAt:now,expiresAt}
  const signedPlan={payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),key).toString('base64url')}
  verifyQaDeliveryPlan(signedPlan,authority)
  // Final live revocation check before spending the one-time issuance marker.
  verifySessionBundle(bundle,authority)
  if(!same(mission,missionJournal.view()) ||
     !same(deposit,depositJournal.view()))
    throw Error('QA journals changed while preparing signed plan')
  // Durable issuance fence is independent of step nonces. An unknown result
  // never licenses reissuing a plan against the same journal pair.
  const issuanceScope=['guiaia:qa-delivery-issuance:v1',session.worldId,
    mission.missionId,deposit.planId].join('\n')
  reserveGrantOnce(approvalDirectory,issuanceScope)
  return immutable({signedPlan,approvedPlan:{sandboxOnly:true,
    ownerName:reviewedSpec.ownerName,missionId:mission.missionId,
    planId:deposit.planId,targets:clone(reviewedSpec.targets),
    chest:clone(reviewedSpec.chest),items:clone(reviewedSpec.items)}})
}
module.exports={issueQaDeliveryPlan}
