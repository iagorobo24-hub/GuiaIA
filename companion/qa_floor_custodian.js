'use strict'
// Standalone QA custodian process. It holds ONLY its own Ed25519 private key.
// Operator and witness public keys are pinned; no production deployment.
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const crypto=require('node:crypto')
const {readPrivate}=require('./qa_witness')
const {createQaFloorCustodian}=require('./src/qa_floor_custodian')
const {publicKey}=require('./src/remote_checkpoint')
const KEYS=['version','sandboxOnly','worldId','directory',
  'operatorPublicKeyFile','witnessPublicKeyFile','anchorPrivateKeyFile','witnessUrl']
function validateConfig(file){
  if(process.platform!=='linux')throw Error('Linux-only QA custodian')
  if(typeof file!=='string'||!path.isAbsolute(file)||path.normalize(file)!==file)
    throw Error('Absolute isolated QA floor config required')
  const parent=path.dirname(file)
  if(path.dirname(parent)!==os.tmpdir()||
     !/^guiaia-floor-config-qa-[A-Za-z0-9_-]{6,}$/.test(path.basename(parent))||
     fs.realpathSync(parent)!==parent)
    throw Error('Only private disposable QA floor config accepted')
  const config=JSON.parse(readPrivate(file).toString('utf8'))
  if(!config||typeof config!=='object'||Array.isArray(config)||
     Object.keys(config).length!==KEYS.length||
     !KEYS.every(k=>Object.hasOwn(config,k))||
     config.version!==1||config.sandboxOnly!==true||
     !/^qa:[A-Za-z0-9:_-]{1,61}$/.test(config.worldId||''))
    throw Error('Complete sandbox QA floor config required')
  for(const k of ['operatorPublicKeyFile','witnessPublicKeyFile','anchorPrivateKeyFile']){
    if(typeof config[k]!=='string'||path.dirname(config[k])!==parent)
      throw Error('QA floor credentials must stay in isolated config')
  }
  const operatorPublicKeyPem=readPrivate(config.operatorPublicKeyFile).toString('utf8')
  const witnessPublicKeyPem=readPrivate(config.witnessPublicKeyFile).toString('utf8')
  publicKey(operatorPublicKeyPem);publicKey(witnessPublicKeyPem)
  const anchorPrivateKey=crypto.createPrivateKey(
    readPrivate(config.anchorPrivateKeyFile))
  if(anchorPrivateKey.asymmetricKeyType!=='ed25519')
    throw Error('QA floor signer must be Ed25519')
  return {directory:config.directory,worldId:config.worldId,
    operatorPublicKeyPem,witnessPublicKeyPem,anchorPrivateKey,
    witnessUrl:config.witnessUrl}
}
async function main(){
  if(process.argv.length!==4||process.argv[2]!=='--qa-serve')
    throw Error('Use --qa-serve with isolated QA floor config')
  const config=validateConfig(process.argv[3])
  const floor=createQaFloorCustodian(config)
  let stopping=false
  const stop=()=>{
    if(stopping)return
    stopping=true
    void floor.close().then(()=>{process.exitCode=0})
      .catch(()=>{process.exitCode=2})
  }
  try{
    const url=await floor.start()
    process.once('SIGINT',stop)
    process.once('SIGTERM',stop)
    process.stdout.write(JSON.stringify({result:'qa_floor_ready',
      sandboxOnly:true,worldId:config.worldId,url})+'\n')
  }catch(error){
    try{await floor.close()}catch{}
    throw error
  }
}
if(require.main===module)main().catch(error=>{
  const message=String(error?.message||'qa_floor_denied')
  process.stderr.write('QA floor denied: '+
    (/^[A-Za-z0-9 .,:()_-]{1,120}$/.test(message)?message:'qa_floor_denied')+'\n')
  process.exitCode=2
})
module.exports={validateConfig}
