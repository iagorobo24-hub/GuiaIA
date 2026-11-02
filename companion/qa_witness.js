'use strict'
// Standalone checkpoint witness for an isolated QA world. Host must keep its
// private Ed25519 signing key; the operator receives only the public key.
// Binds ONLY 127.0.0.1. A separate host requires a separately authorized
// secure tunnel; direct exposed HTTP is deliberately unsupported.
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const crypto=require('node:crypto')
const {createQaCheckpointWitness}=require('./src/qa_checkpoint_witness')

const CONFIG_ROOT=/^guiaia-witness-config-qa-[A-Za-z0-9_-]{6,}$/
const WITNESS_ROOT=/^guiaia-remote-anchor-qa-[A-Za-z0-9_-]{6,}$/
const allowedKeys=['version','sandboxOnly','worldId','directory',
  'operatorPublicKeyFile','witnessPrivateKeyFile']
function isolatedConfig(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     file!==path.normalize(file))throw Error('Absolute QA witness config required')
  const dir=path.dirname(file)
  if(path.dirname(dir)!==os.tmpdir()||!CONFIG_ROOT.test(path.basename(dir))||
     fs.realpathSync(dir)!==dir)
    throw Error('Only isolated private QA witness config accepted')
  return readPrivate(file)
}
function readPrivate(file,max=8192){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     path.normalize(file)!==file)
    throw Error('Absolute QA credential path required')
  const parent=path.dirname(file)
  if(fs.realpathSync(parent)!==parent)
    throw Error('Symlinked QA witness credential parent refused')
  const dir=fs.lstatSync(parent)
  if(!dir.isDirectory()||dir.isSymbolicLink()||
     (process.platform!=='win32'&&(dir.mode&0o077)!==0))
    throw Error('QA witness private directory must be 0700')
  const fd=fs.openSync(file,fs.constants.O_RDONLY|
    (fs.constants.O_NOFOLLOW||0))
  try{
    const s=fs.fstatSync(fd)
    if(!s.isFile()||s.nlink!==1||s.size<=0||s.size>max||
       (process.platform!=='win32'&&(s.mode&0o077)!==0))
      throw Error('QA witness credential must be 0600')
    const data=Buffer.alloc(s.size)
    if(fs.readSync(fd,data,0,data.length,0)!==data.length)
      throw Error('Incomplete QA witness credential')
    return data
  }finally{fs.closeSync(fd)}
}
function validateConfig(file){
  const conf=JSON.parse(isolatedConfig(file).toString('utf8'))
  if(conf===null||typeof conf!=='object'||Array.isArray(conf)||
     Object.keys(conf).length!==allowedKeys.length||
     !allowedKeys.every(k=>Object.hasOwn(conf,k))||
     conf.version!==1||conf.sandboxOnly!==true||
     !/^qa:[A-Za-z0-9:_-]{1,61}$/.test(conf.worldId||''))
    throw Error('Complete sandbox QA witness config required')
  if(typeof conf.directory!=='string'||!path.isAbsolute(conf.directory)||
     path.normalize(conf.directory)!==conf.directory||
     path.dirname(conf.directory)!==os.tmpdir()||
     !WITNESS_ROOT.test(path.basename(conf.directory)))
    throw Error('Disposable QA witness state root required')
  // No owner or operator private signing key is loaded by the witness.
  const operatorPublicKeyPem=readPrivate(conf.operatorPublicKeyFile).toString('utf8')
  const witnessPrivateKey=crypto.createPrivateKey(readPrivate(conf.witnessPrivateKeyFile))
  if(witnessPrivateKey.asymmetricKeyType!=='ed25519')
    throw Error('Only Ed25519 witness signing key supported')
  return {directory:conf.directory,worldId:conf.worldId,
    operatorPublicKeyPem,witnessPrivateKey}
}
async function main(){
  // POSIX 0700/0600 restrictions are not NTFS ACL checks. A Windows-native
  // temp directory may grant read access to unrelated principals even when
  // fs.stat reports restrictive mode bits. Refuse loading any signing key
  // until a separately reviewed, strict Windows ACL implementation exists.
  // On a Windows computer, this QA witness may instead run in Linux WSL2.
  if(process.platform==='win32')
    throw Error('Native Windows witness requires verified NTFS ACL isolation')
  if(process.argv.length!==4||process.argv[2]!=='--qa-serve')
    throw Error('Use --qa-serve with one private isolated QA witness config')
  const conf=validateConfig(process.argv[3])
  const witness=createQaCheckpointWitness(conf)
  let closing=false
  const shutdown=()=>{
    if(closing)return
    closing=true
    void witness.close().then(()=>{process.exitCode=0}).catch(()=>{
      process.exitCode=2
    })
  }
  try{
    const url=await witness.start()
    process.once('SIGINT',shutdown)
    process.once('SIGTERM',shutdown)
    process.stdout.write(JSON.stringify({result:'qa_witness_ready',
      url,worldId:conf.worldId,sandboxOnly:true})+'\n')
  }catch(error){
    try{await witness.close()}catch{}
    throw error
  }
}
if(require.main===module)main().catch(error=>{
  // Do not reveal private paths or serialized key material in failure logs.
  const message=String(error?.message||'qa_witness_denied')
  const reason=/^[A-Za-z0-9 .,:()_-]{1,120}$/.test(message)
    ?message:'qa_witness_denied'
  process.stderr.write('GuiaIA QA witness denied: '+reason+'\n')
  process.exitCode=2
})

module.exports={validateConfig}
