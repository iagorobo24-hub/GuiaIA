'use strict'

// Independent *QA file* checkpoint: detects single-file rollback and interrupted
// updates. This is NOT an immutable/off-host anchor: an attacker able to replace
// both files with consistent old copies can defeat it.
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const MAX_BYTES=1024
const MAX_REGISTRY=65536
const strict=(v,fields)=>v && Object.getPrototypeOf(v)===Object.prototype &&
  Object.keys(v).length===fields.length && fields.every(k=>Object.hasOwn(v,k))
const digest=value=>crypto.createHash('sha256')
  .update(JSON.stringify(value)+'\n').digest('hex')
function fsyncDirectory(dir){
  if(process.platform==='win32')return
  const fd=fs.openSync(dir,fs.constants.O_RDONLY)
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function readSecure(file,limit){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
  try{
    const s=fs.fstatSync(fd)
    if(!s.isFile()||s.size===0||s.size>limit||(process.platform!=='win32' && (s.mode&0o777)!==0o600))
      throw Error('Unsafe checkpoint or registry file')
    const data=Buffer.alloc(s.size)
    if(fs.readSync(fd,data,0,data.length,0)!==data.length)
      throw Error('Incomplete checkpoint read')
    return data
  }finally{fs.closeSync(fd)}
}
function saveAtomically(directory,file,state){
  const bytes=Buffer.from(JSON.stringify(state)+'\n')
  const tmp=path.join(directory,'.anchor-'+crypto.randomUUID()+'.tmp')
  let fd=null
  try{
    fd=fs.openSync(tmp,'wx',0o600)
    fs.writeSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null
    if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())
      throw Error('Symlink checkpoint rejected')
    fs.renameSync(tmp,file)
    fsyncDirectory(directory)
  }finally{
    if(fd!==null)fs.closeSync(fd)
    if(fs.existsSync(tmp))fs.unlinkSync(tmp)
  }
}
function openQaPrincipalCheckpoint(root,{worldId,operatorFingerprint,registryFile,newRegistry}){
  const directory=path.join(root,'checkpoint')
  const file=path.join(directory,'anchor.json')
  // root was already sandbox-checked and exclusively locked by registry.
  if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())
    throw Error('Symlink anti-rollback anchor refused')
  if(newRegistry){
    if(fs.existsSync(directory))throw Error('Orphan anti-rollback checkpoint')
    fs.mkdirSync(directory,{mode:0o700})
    fsyncDirectory(root)
  }else if(!fs.existsSync(directory)){
    throw Error('Missing independent anti-rollback checkpoint')
  }
  if(!fs.statSync(directory).isDirectory() ||
     (process.platform!=='win32' && (fs.statSync(directory).mode&0o777)!==0o700))
    throw Error('Unsafe anti-rollback checkpoint directory')
  if(!newRegistry && !fs.existsSync(file))
    throw Error('Missing independent anti-rollback checkpoint')
  const build=(state)=>Object.freeze({
    version:1,worldId,operatorFingerprint,
    sequence:state.events.length,registrySha256:digest(state)})
  let head
  function readHead(){
    const parent=fs.lstatSync(directory)
    if(!parent.isDirectory() || parent.isSymbolicLink() ||
       (process.platform!=='win32' && (parent.mode&0o777)!==0o700))
      throw Error('Unsafe anti-rollback checkpoint directory')
    if(fs.lstatSync(file).isSymbolicLink())
      throw Error('Symlink anti-rollback checkpoint')
    const bytes=readSecure(file,MAX_BYTES)
    let candidate
    try{candidate=JSON.parse(bytes.toString('utf8'))}
    catch{throw Error('Corrupt anti-rollback checkpoint')}
    if(!strict(candidate,['version','worldId','operatorFingerprint','sequence','registrySha256']) ||
       candidate.version!==1 || candidate.worldId!==worldId ||
       candidate.operatorFingerprint!==operatorFingerprint ||
       !Number.isSafeInteger(candidate.sequence) || candidate.sequence<0 ||
       !/^[0-9a-f]{64}$/.test(candidate.registrySha256))
      throw Error('Untrusted anti-rollback checkpoint')
    return candidate
  }
  function matches(a,b){
    return a.sequence===b.sequence && a.registrySha256===b.registrySha256 &&
      a.worldId===b.worldId && a.operatorFingerprint===b.operatorFingerprint
  }
  if(newRegistry){
    if(fs.existsSync(file))throw Error('Unexpected anti-rollback checkpoint')
    // Fresh registry is on disk before its checkpoint is first published.
    head=build({events:[]})
    // Caller passes the real registry state via initialize; defer until then.
  }else{
    head=readHead()
  }
  return Object.freeze({
    snapshot(){
      // The caller must store this externally, using a separate trust boundary.
      // The local QA checkpoint alone does NOT resist full-root restoration.
      return Object.freeze({...head})
    },
    verifyPinned(pinned){
      if(!strict(pinned,['version','worldId','operatorFingerprint','sequence','registrySha256']) ||
         pinned.version!==1 || !matches(head,pinned))
        throw Error('Externally pinned principal checkpoint mismatch')
      return true
    },
    initialize(state){
      if(!newRegistry || head.sequence!==0 || fs.existsSync(file))
        throw Error('Checkpoint cannot be initialized twice')
      const next=build(state)
      if(next.sequence!==0)throw Error('Nonempty initial checkpoint')
      head=next
      saveAtomically(directory,file,head)
      this.verify(state)
    },
    verify(state){
      const current=readHead()
      if(!matches(current,head) || !matches(current,build(state)))
        throw Error('Principal rollback or divergent checkpoint detected')
      // Check the actual registry bytes, not just cached in-process state.
      const raw=readSecure(registryFile,MAX_REGISTRY)
      if(crypto.createHash('sha256').update(raw).digest('hex')!==head.registrySha256)
        throw Error('Principal registry rollback or disk tampering detected')
      return true
    },
    advance(state){
      // A new registry file has already been durably renamed. A crash in
      // between leaves a mismatch that must fail closed on the next open.
      const previous=readHead()
      if(!matches(previous,head))throw Error('Anti-rollback checkpoint changed')
      const next=build(state)
      if(next.sequence!==head.sequence+1)
        throw Error('Nonmonotonic anti-rollback checkpoint sequence')
      saveAtomically(directory,file,next)
      head=next
      this.verify(state)
    }
  })
}
module.exports={openQaPrincipalCheckpoint}
