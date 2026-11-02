'use strict'
// QA-only, read-only comparison against an externally retained signed floor.
// This module cannot provide a durable floor by itself and must not be used
// to authorize world actions or to retry any checkpoint CAS operation.
const crypto=require('node:crypto')
const {publicKey,validHead,createPinnedQaRemoteCheckpointClient}=require('./remote_checkpoint')
const HEX=/^[0-9a-f]{64}$/
const FIELDS=['aud','worldId','operatorFingerprint','witnessFingerprint',
  'sequence','registrySha256']
function fingerprint(key){
  return crypto.createHash('sha256')
    .update(key.export({format:'der',type:'spki'})).digest('hex')
}
function exact(v,keys){
  return v!==null&&typeof v==='object'&&!Array.isArray(v)&&
    Object.getPrototypeOf(v)===Object.prototype&&
    Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
}
function createQaIndependentRollbackVerifier({worldId,operatorPublicKeyPem,
  witnessPublicKeyPem,anchorPublicKeyPem,url}={}){
  if(typeof worldId!=='string'||!/^qa:[A-Za-z0-9:_-]{1,61}$/.test(worldId))
    throw Error('Explicit QA world required')
  const operator=publicKey(operatorPublicKeyPem)
  const witness=publicKey(witnessPublicKeyPem)
  const anchor=publicKey(anchorPublicKeyPem)
  const op=fingerprint(operator),wit=fingerprint(witness),anc=fingerprint(anchor)
  if(anc===wit||anc===op||wit===op)
    throw Error('Independent QA rollback authority must use separate keys')
  // Instantiate and pin the remote verifier internally. Never accept an
  // arbitrary object whose latest() could return an unsigned fake snapshot.
  const client=createPinnedQaRemoteCheckpointClient({url,worldId,
    operatorPublicKeyPem,witnessPublicKeyPem})
  function validateFloor(token){
    if(!exact(token,['payload','signature'])||
       !exact(token.payload,FIELDS)||
       typeof token.signature!=='string'||
       !/^[A-Za-z0-9_-]{86}$/.test(token.signature))
      throw Error('Invalid external QA floor envelope')
    const f=token.payload
    if(f.aud!=='guiaia:independent-floor-qa:v1'||
       f.worldId!==worldId||f.operatorFingerprint!==op||
       f.witnessFingerprint!==wit||
       !Number.isSafeInteger(f.sequence)||f.sequence<0||
       !HEX.test(f.registrySha256||'')||
       !crypto.verify(null,Buffer.from(JSON.stringify(f)),anchor,
         Buffer.from(token.signature,'base64url')))
      throw Error('Untrusted independent QA floor')
    return f
  }
  function verifySnapshot(snapshot,floor){
    // Enforce verified floor before reading/comparing the witness snapshot.
    // snapshot MUST already be authenticated via pinned client.latest().
    if(!validHead(snapshot,worldId,op))
      throw Error('Invalid QA checkpoint snapshot')
    if(snapshot.sequence<floor.sequence||
       (snapshot.sequence===floor.sequence&&
        snapshot.registrySha256!==floor.registrySha256))
      throw Error('Independent QA checkpoint floor disagreement: fail closed')
    return Object.freeze({result:'qa_floor_consistent',read_only:true,
      world_actions:false,production_ready:false,
      observedSequence:snapshot.sequence,anchoredSequence:floor.sequence})
  }
  async function verifyRemote(token){
    const floor=validateFloor(token)
    const snapshot=await client.latest() // Witness Ed25519, nonce and age checked.
    return verifySnapshot(snapshot,floor)
  }
  return Object.freeze({verifyRemote})
}
module.exports={createQaIndependentRollbackVerifier}
