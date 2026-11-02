'use strict'
// Read-only QA triple-attestation diagnostic. Cannot authorize world actions,
// prove atomicity, or ensure the separate high-water store is non-rollbackable.
const {createPinnedQaRemoteCheckpointClient}=require('./remote_checkpoint')
const {createPinnedQaFloorClient}=require('./qa_floor_client')
const {createPinnedQaHighWaterClient}=require('./qa_high_water_client')
const same=(a,b)=>a.sequence===b.sequence&&
  a.registrySha256===b.registrySha256
function createQaTripleAuthorityReconciler({witnessUrl,floorUrl,highWaterUrl,
  worldId,operatorPublicKeyPem,witnessPublicKeyPem,
  custodianPublicKeyPem,highWaterPublicKeyPem}={}){
  const shared={worldId,operatorPublicKeyPem,witnessPublicKeyPem}
  const witness=createPinnedQaRemoteCheckpointClient({
    ...shared,url:witnessUrl})
  const floor=createPinnedQaFloorClient({
    ...shared,url:floorUrl,anchorPublicKeyPem:custodianPublicKeyPem})
  const highWater=createPinnedQaHighWaterClient({
    ...shared,url:highWaterUrl,
    custodianPublicKeyPem,highWaterPublicKeyPem})
  return Object.freeze({
    async inspect(){
      // Bracket the other two signed observations with fresh signed
      // high-water responses. This is NOT a distributed atomic read.
      const upperBefore=await highWater.latest()
      const floorBefore=await floor.latest()
      const observed=await witness.latest()
      const floorAfter=await floor.latest()
      const upperAfter=await highWater.latest()
      if(!same(upperBefore,upperAfter))
        throw Error('QA external high-water changed during inspection: fail closed')
      if(!same(floorBefore,floorAfter))
        throw Error('QA signed custodian changed during inspection: fail closed')
      if(observed.sequence<upperAfter.sequence||
         floorAfter.sequence<upperAfter.sequence)
        throw Error('QA state below signed external high-water: fail closed')
      if(floorAfter.sequence>observed.sequence)
        throw Error('QA floor ahead of signed witness: fail closed')
      if(observed.sequence===floorAfter.sequence&&!same(observed,floorAfter))
        throw Error('QA signed witness and floor hash mismatch: fail closed')
      if(observed.sequence===upperAfter.sequence&&!same(observed,upperAfter))
        throw Error('QA witness hash disagrees with external high-water')
      if(floorAfter.sequence===upperAfter.sequence&&!same(floorAfter,upperAfter))
        throw Error('QA custodian hash disagrees with external high-water')
      const equal=same(observed,floorAfter)&&same(floorAfter,upperAfter)
      return Object.freeze({
        result:equal?'qa_three_authority_equal_observation':
          'qa_three_authority_gap_requires_review',
        requiresManualReview:!equal,
        witnessSequence:observed.sequence,
        custodianSequence:floorAfter.sequence,
        externalSequence:upperAfter.sequence,
        read_only:true,world_actions:false,
        production_ready:false,atomic_snapshot:false,
        external_monotonicity_verified:false
      })
    }
  })
}
module.exports={createQaTripleAuthorityReconciler}
