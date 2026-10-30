'use strict'
// Dedicated child-process witness for the disposable QA lab, not a deployed
// daemon. Test runner supplies lab-only ephemeral Ed25519 keys through IPC.
const crypto=require('node:crypto')
const {createQaCheckpointWitness}=require('../src/qa_checkpoint_witness')
let witness=null
process.on('message',async command=>{
  try{
    if(command?.type==='start'){
      if(witness)throw Error('Witness child already configured')
      witness=createQaCheckpointWitness({
        directory:command.directory,worldId:command.worldId,
        operatorPublicKeyPem:command.operatorPublicKeyPem,
        witnessPrivateKey:crypto.createPrivateKey(command.witnessPrivateKeyPem)
      })
      const url=await witness.start()
      process.send({type:'ready',url})
    }else if(command?.type==='stop'){
      if(witness)await witness.close()
      process.exit(0)
    }
  }catch(error){
    process.send({type:'failed',error:error.message})
  }
})
