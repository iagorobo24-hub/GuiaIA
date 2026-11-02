'use strict'
// QA-only observation across two independently pinned live authorities.
// This is an advisory diagnostic, NOT an authorization or repair API.
// It cannot establish a linearizable joint checkpoint nor prevent an
// adversary from restoring BOTH signed authorities to old disks.
const {createPinnedQaRemoteCheckpointClient}=require('./remote_checkpoint')
const {createPinnedQaFloorClient}=require('./qa_floor_client')
function createQaFloorReconciler({witnessUrl,anchorUrl,worldId,
  operatorPublicKeyPem,witnessPublicKeyPem,anchorPublicKeyPem}={}){
  const shared={worldId,operatorPublicKeyPem,witnessPublicKeyPem}
  const witness=createPinnedQaRemoteCheckpointClient({
    ...shared,url:witnessUrl})
  const floor=createPinnedQaFloorClient({
    ...shared,url:anchorUrl,anchorPublicKeyPem})
  const compare=(a,b)=>a.sequence===b.sequence&&
    a.registrySha256===b.registrySha256
  return Object.freeze({
    async inspect(){
      // Bracket the witness read with two independent nonce-bound floor
      // reads. A concurrent floor change is review-only, never approved.
      const before=await floor.latest()
      const observed=await witness.latest()
      const after=await floor.latest()
      if(!compare(before,after))
        throw Error('Independent QA floor changed during reconciliation: fail closed')
      if(observed.sequence<after.sequence)
        throw Error('QA witness behind signed independent floor: fail closed')
      if(observed.sequence===after.sequence&&
         observed.registrySha256!==after.registrySha256)
        throw Error('QA authorities disagree on checkpoint hash: fail closed')
      return Object.freeze({
        result:compare(observed,after)?
          'qa_equal_observation':'qa_witness_ahead_requires_review',
        witnessSequence:observed.sequence,
        floorSequence:after.sequence,
        requiresManualReview:!compare(observed,after),
        read_only:true,world_actions:false,
        production_ready:false,atomic_snapshot:false
      })
    }
  })
}
module.exports={createQaFloorReconciler}
