'use strict'

// Secure assembly of already-existing QA components. This module cannot
// provision principals, sign operator grants, or run without live authorities.
const crypto=require('node:crypto')
const {issueQaBoundPrincipalSession}=require('./qa_principal_session_binding')
const {createSecureDeliveryRuntime}=require('./secure_delivery_runtime')
const {createTrustedLocalOperatorConsole}=require('./trusted_local_operator_console')

const fingerprint=pem=>{
  let publicKey
  try{publicKey=crypto.createPublicKey(pem)}
  catch{throw Error('Invalid externally pinned QA operator key')}
  if(publicKey.asymmetricKeyType!=='ed25519')
    throw Error('QA operator must use Ed25519')
  return crypto.createHash('sha256').update(
    publicKey.export({format:'der',type:'spki'})).digest('hex')
}

async function createQaEnrolledOperatorRuntime({
  bot,classes,identity,operatorPublicKeyPem,ledgerDirectory,
  missionJournal,depositJournal,approvedPlan,grants,followGrant
}={}){
  const registry=identity?.registry,bridge=identity?.bridge
  const live=identity?.live,witness=identity?.witness
  if(!identity||identity.sandboxOnly!==true||
     identity.identityMode!=='trusted_server_bridge_lab' ||
     !registry||!bridge||!live||!witness||
     typeof operatorPublicKeyPem!=='string'||
     typeof ledgerDirectory!=='string'||
     bot?.username!==identity.botName||
     typeof missionJournal?.view!=='function'||
     typeof depositJournal?.view!=='function')
    throw Error('Complete independent QA operator runtime configuration required')
  const expected=fingerprint(operatorPublicKeyPem)
  const head=registry.exportCheckpoint()
  if(head.worldId!==identity.worldId||head.operatorFingerprint!==expected||
     witness.operatorFingerprint!==expected)
    throw Error('Operator signing key does not match enrolled registry and witness')
  const bound=await issueQaBoundPrincipalSession(identity)
  // No optional fallback when the independent test witness or live JVM fails.
  // The action controller repeats both checks immediately before dispatch.
  const authority=Object.freeze({
    sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId:identity.worldId,botName:identity.botName,
    serverBridgePublicKeyPem:identity.serverBridgePublicKeyPem,
    operatorPublicKeyPem,
    trustedPrincipals:registry.trustedPrincipals(),
    ledgerDirectory,
    isRevoked:id=>registry.isRevoked(id),
    activeConnection:id=>bridge.activeConnection(id),
    requireLivePresence:true,requireRemoteCheckpoint:true,
    livePresence:id=>live.livePresence(id),
    currentRegistryCheckpoint:()=>registry.exportCheckpoint(),
    remoteCheckpointMatch:head=>witness.verifyLocal(head)
  })
  const runtime=createSecureDeliveryRuntime({
    bot,classes,authority,session:bound.session,grants,followGrant,
    missionJournal,depositJournal,approvedPlan
  })
  const operator=createTrustedLocalOperatorConsole(runtime)
  return Object.freeze({
    operator,runtime,
    scope:Object.freeze({...bound.scope,worldActionsEnabled:true,
      actionScope:'independently_signed_qa_grants_only'}),
    stop:()=>runtime.stop()
  })
}
module.exports={createQaEnrolledOperatorRuntime}
