'use strict'
// Explicit QA-only crash lock cleanup. No user sessions, grants, advances,
// registry edits, journal changes or automatic world-action replay.
const path=require('node:path')
const crypto=require('node:crypto')
const {validateConfig}=require('./qa_witness')
const {readSignedQaHead}=require('./src/qa_checkpoint_witness')
const {recoverQaWitnessCrashLock}=require('./src/qa_witness_lock')
async function main(){
  if(process.platform!=='linux')throw Error('Linux-only QA recovery')
  if(process.argv.length!==5||
     process.argv[2]!=='--qa-recover-crashed-lock'||
     process.argv[4]!=='--acknowledge-operator-stopped')
    throw Error('Explicit QA recovery command and operator acknowledgement required')
  const conf=validateConfig(process.argv[3])
  const operator=crypto.createPublicKey(conf.operatorPublicKeyPem)
  const fp=crypto.createHash('sha256')
    .update(operator.export({format:'der',type:'spki'})).digest('hex')
  const witnessPublic=crypto.createPublicKey(conf.witnessPrivateKey)
  const validateSignedHead=()=>readSignedQaHead(
    path.join(conf.directory,'head.json'),conf.worldId,fp,witnessPublic)
  const result=recoverQaWitnessCrashLock({
    directory:conf.directory,validateSignedHead,acknowledged:true
  })
  process.stdout.write('GUIAIA_QA_WITNESS_CRASH_RECOVERY='+JSON.stringify(result)+'\n')
}
if(require.main===module)main().catch(error=>{
  // Do not log private paths, signatures, PEM data or config content.
  const message=String(error?.message||'unsafe_recovery')
  process.stderr.write('QA witness crash recovery denied: '+
    (/^[A-Za-z0-9 .,:;()_-]{1,120}$/.test(message)?message:'unsafe_recovery')+'\n')
  process.exitCode=2
})
