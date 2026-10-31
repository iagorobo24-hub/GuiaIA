'use strict'
// Owner-locked QA registry accepts externally signed revocations through an
// immutable, single-slot local inbox. The sender never opens principals.lock.
// NO private operator signing key is needed by the running QA operator.
// This is lab-only interprocess transport, not a network or production API.
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const crypto=require('node:crypto')
const {validateAdvance,publicKey}=require('./remote_checkpoint')

const MAX_BYTES=4096
const SLOT='pending-revocation.json'
const ACK='processed-revocation.json'
const strict=(v,keys)=>v!==null&&typeof v==='object'&&
  Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const match=(a,b)=>a?.sequence===b?.sequence&&
  a?.registrySha256===b?.registrySha256&&
  a?.worldId===b?.worldId&&a?.operatorFingerprint===b?.operatorFingerprint
function rootFor(registryDirectory){
  if(typeof registryDirectory!=='string'||!path.isAbsolute(registryDirectory)||
     path.normalize(registryDirectory)!==registryDirectory)
    throw Error('Explicit QA registry path required for revocation inbox')
  const root=path.dirname(registryDirectory)
  const name=path.basename(root)
  if(path.dirname(root)!==os.tmpdir()||
     !/^guiaia-enrollment-qa-[A-Za-z0-9_-]{6,}$/.test(name)||
     registryDirectory!==path.join(root,'registry')||
     fs.realpathSync(root)!==root)
    throw Error('Live revocation inbox restricted to isolated QA enrollment root')
  const stat=fs.lstatSync(root)
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (process.platform!=='win32'&&(stat.mode&0o777)!==0o700))
    throw Error('Unsafe live revocation inbox directory')
  return root
}
function syncDir(root){
  if(process.platform==='win32')return
  const fd=fs.openSync(root,fs.constants.O_RDONLY)
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function secureRead(file){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
  try{
    const s=fs.fstatSync(fd)
    if(!s.isFile()||s.nlink!==1||s.size<10||s.size>MAX_BYTES||
       (process.platform!=='win32'&&(s.mode&0o777)!==0o600))
      throw Error('Unsafe pending QA revocation')
    const raw=Buffer.alloc(s.size)
    if(fs.readSync(fd,raw,0,s.size,0)!==s.size)
      throw Error('Incomplete pending QA revocation')
    let bundle
    try{bundle=JSON.parse(raw.toString('utf8'))}
    catch{throw Error('Malformed pending QA revocation')}
    if(!strict(bundle,['ticket','advance']))
      throw Error('Malformed signed QA revocation bundle')
    return bundle
  }finally{fs.closeSync(fd)}
}
function submitQaRevocationBundle({registryDirectory,bundle}={}){
  const root=rootFor(registryDirectory),dest=path.join(root,SLOT)
  if(!strict(bundle,['ticket','advance']))
    throw Error('Externally signed QA revocation bundle required')
  const bytes=Buffer.from(JSON.stringify(bundle)+'\n')
  if(bytes.length>MAX_BYTES)throw Error('Signed QA revocation bundle too large')
  // A previous successful or uncertain submission cannot be silently replaced.
  if(fs.existsSync(dest)||fs.existsSync(path.join(root,ACK)))
    throw Error('Existing QA revocation needs operator review')
  const tmp=path.join(root,'.revocation-'+crypto.randomUUID()+'.tmp')
  let fd=null
  try{
    fd=fs.openSync(tmp,'wx',0o600)
    fs.writeSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null
    // A competing producer must not overwrite a pending queue entry.
    fs.linkSync(tmp,dest)
    fs.unlinkSync(tmp)
    syncDir(root)
  }finally{
    if(fd!==null)fs.closeSync(fd)
    if(fs.existsSync(tmp))fs.unlinkSync(tmp)
  }
  return Object.freeze({queued:true})
}
function assertQaNoPendingRevocation(registryDirectory){
  const root=rootFor(registryDirectory)
  if(fs.existsSync(path.join(root,SLOT)))
    throw Error('Pending QA revocation requires operator processing before startup')
}
function createQaLiveRevocationReceiver({registryDirectory,registry,witness,
  operatorPublicKeyPem,worldId,stopRuntime,onProcessed,intervalMs=100}={}){
  const root=rootFor(registryDirectory)
  if(typeof registry?.exportCheckpoint!=='function'||
     typeof registry?.previewSignedRevocation!=='function'||
     typeof registry?.applySignedChange!=='function'||
     typeof witness?.publish!=='function'||
     typeof witness?.verifyLocal!=='function'||
     typeof stopRuntime!=='function'||
     typeof worldId!=='string'||
     !Number.isSafeInteger(intervalMs)||intervalMs<50||intervalMs>1000)
    throw Error('Complete signed live QA revocation receiver required')
  const operator=publicKey(operatorPublicKeyPem)
  const fingerprint=crypto.createHash('sha256')
    .update(operator.export({format:'der',type:'spki'})).digest('hex')
  const pending=path.join(root,SLOT),ack=path.join(root,ACK)
  let timer=null,task=null,closed=false,failed=false,processed=false,stopped=false
  let failure=null
  const halt=()=>{
    if(stopped)return
    stopped=true
    const result=stopRuntime()
    if(result?.ok!==true)
      throw Error('Live QA cancellation could not be persisted')
  }
  const reject=error=>{
    failed=true
    failure='signed_live_revocation_failed_closed'
    if(timer){clearInterval(timer);timer=null}
    try{halt()}catch{}
    return error
  }
  async function pollOnce(){
    if(closed||failed||processed)return Object.freeze({processed:false,closed:true})
    if(task)return task
    if(!fs.existsSync(pending))return Object.freeze({processed:false})
    task=(async()=>{
      // Untrusted queue contents cannot be authoritative without operator
      // signature, exact expected checkpoint digest and signed CAS advance.
      try{
        const {ticket,advance}=secureRead(pending)
        const before=registry.exportCheckpoint()
        if(before.worldId!==worldId||before.operatorFingerprint!==fingerprint)
          throw Error('Wrong live registry trust anchor')
        const expected=registry.previewSignedRevocation(ticket)
        const signed=validateAdvance(advance,operator,worldId,fingerprint)
        if(!match(expected,signed)||
           signed.previousSequence!==before.sequence||
           signed.previousSha256!==before.registrySha256)
          throw Error('Signed QA revocation checkpoint mismatch')
        // Stop live operations before writing the durable revocation.
        // Any uncertain journal state is then blocked from automatic replay.
        halt()
        registry.applySignedChange(ticket)
        const committed=registry.exportCheckpoint()
        if(!match(committed,expected))
          throw Error('Committed QA registry differs from signed expectation')
        await witness.publish(advance)
        await witness.verifyLocal(committed)
        // Retain a private audit receipt, not an executable replay slot.
        if(fs.existsSync(ack))throw Error('Existing QA revocation receipt')
        fs.renameSync(pending,ack)
        syncDir(root)
        processed=true
        if(typeof onProcessed==='function')onProcessed({sequence:committed.sequence})
        return Object.freeze({processed:true,sequence:committed.sequence})
      }catch(error){throw reject(error)}
    })()
    try{return await task}finally{task=null}
  }
  function start(){
    if(closed||timer||failed||processed)throw Error('QA receiver cannot start')
    // An abandoned pending/ack file after crash requires manual review.
    if(fs.existsSync(pending)||fs.existsSync(ack)){
      reject(Error('Stale live revocation queue requires manual review'))
      throw Error('Stale live revocation queue requires manual review')
    }
    timer=setInterval(()=>{void pollOnce().catch(()=>{})},intervalMs)
    return true
  }
  async function close(){
    closed=true
    if(timer){clearInterval(timer);timer=null}
    if(task)try{await task}catch{}
  }
  return Object.freeze({start,pollOnce,close,
    status:()=>Object.freeze({processed,failed,failure,stopped})})
}
module.exports={submitQaRevocationBundle,createQaLiveRevocationReceiver,
  assertQaNoPendingRevocation}
