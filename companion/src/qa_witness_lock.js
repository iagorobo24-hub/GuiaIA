'use strict'
// Linux-only QA crash-lock provenance. No world actions or automatic recovery.
// Fail closed when /proc, boot identity or owner metadata cannot be verified.
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const LOCK_FIELDS=['bootId','pid','startTicks','version']
const BOOT=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function linuxOnly(){
  if(process.platform!=='linux'||typeof process.getuid!=='function')
    throw Error('QA witness crash recovery requires Linux procfs')
}
function bootId(){
  linuxOnly()
  const s=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()
  if(!BOOT.test(s))throw Error('Unverifiable QA host boot identity')
  return s
}
function startTicks(pid){
  linuxOnly()
  if(!Number.isSafeInteger(pid)||pid<1)throw Error('Unsafe QA witness PID')
  // /proc/PID/stat field 2 (comm) may contain spaces and parentheses.
  // After the final ") ", field 3 (state) starts at index 0.
  const s=fs.readFileSync('/proc/'+pid+'/stat','utf8')
  const close=s.lastIndexOf(') ')
  if(close<2||!s.startsWith(pid+' ('))throw Error('Unverifiable QA process identity')
  const parts=s.slice(close+2).trim().split(/\s+/)
  const start=parts[19] // field 22
  if(!/^[1-9][0-9]{0,23}$/.test(start||''))
    throw Error('Invalid QA process start time')
  return start
}
function ownedRecord(){
  return {version:1,pid:process.pid,bootId:bootId(),startTicks:startTicks(process.pid)}
}
function createOwnedQaWitnessLock(file){
  // Windows-native witness CLI is forbidden, but unit tests of the generic
  // checkpoint verifier still run cross-platform. Recovery stays Linux-only.
  if(process.platform!=='linux')return fs.openSync(file,'wx',0o600)
  const fd=fs.openSync(file,'wx',0o600)
  try{
    const b=Buffer.from(JSON.stringify(ownedRecord())+'\n')
    if(fs.writeSync(fd,b)!==b.length)throw Error('Incomplete QA witness lock record')
    fs.fsyncSync(fd)
    fsyncDir(path.dirname(file))
    return fd
  }catch(error){
    fs.closeSync(fd)
    try{fs.unlinkSync(file)}catch{}
    throw error
  }
}
function privateQaRoot(directory){
  linuxOnly()
  if(typeof directory!=='string'||!path.isAbsolute(directory)||
     path.dirname(directory)!==os.tmpdir()||
     !/^guiaia-remote-anchor-qa-[A-Za-z0-9_-]{6,}$/.test(path.basename(directory))||
     fs.realpathSync(directory)!==directory)
    throw Error('Only disposable QA witness directory accepted')
  const s=fs.lstatSync(directory)
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o777)!==0o700||
     s.uid!==process.getuid())
    throw Error('Untrusted QA witness directory')
  return directory
}
function readLock(file){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
  try{
    const st=fs.fstatSync(fd)
    if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid()||
       (st.mode&0o777)!==0o600||st.size<20||st.size>256)
      throw Error('Untrusted or legacy QA witness lock; manual review required')
    const raw=Buffer.alloc(st.size)
    if(fs.readSync(fd,raw,0,raw.length,0)!==raw.length)
      throw Error('Incomplete QA witness lock record')
    const obj=JSON.parse(raw.toString('utf8'))
    if(!obj||Object.keys(obj).sort().join(',')!==LOCK_FIELDS.join(',')||
       obj.version!==1||!Number.isSafeInteger(obj.pid)||obj.pid<1||
       !BOOT.test(obj.bootId||'')||
       !/^[1-9][0-9]{0,23}$/.test(obj.startTicks||''))
      throw Error('Invalid QA witness lock identity')
    return {record:obj,dev:st.dev,ino:st.ino}
  }finally{fs.closeSync(fd)}
}
function proveFormerOwnerExited(record){
  const currentBoot=bootId()
  if(currentBoot!==record.bootId)return true
  try{
    const actual=startTicks(record.pid)
    if(actual===record.startTicks)throw Error('QA witness owner remains alive')
    // PID reuse: original exact process identity is gone.
    return true
  }catch(error){
    if(error?.code==='ENOENT')return true
    throw error // Permission or unparseable procfs state: refuse.
  }
}
function fsyncDir(directory){
  const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY)
  try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
}
function recoverQaWitnessCrashLock({directory,validateSignedHead,acknowledged}={}){
  if(acknowledged!==true)
    throw Error('Explicit QA witness crash recovery acknowledgement required')
  privateQaRoot(directory)
  if(typeof validateSignedHead!=='function')
    throw Error('Signed witness state validation required')
  const lock=path.join(directory,'witness.lock')
  const gate=path.join(directory,'.recovery.lock')
  // Only one recovery attempt may run at a time; no automatic lock breaking.
  const gateFd=fs.openSync(gate,'wx',0o600)
  try{
    const first=readLock(lock)
    if(!proveFormerOwnerExited(first.record))
      throw Error('QA witness owner still active')
    const head=validateSignedHead()
    if(head===null||!Number.isSafeInteger(head.sequence)||head.sequence<0)
      throw Error('Missing signed QA checkpoint: deny recovery')
    const second=readLock(lock)
    if(first.dev!==second.dev||first.ino!==second.ino||
       JSON.stringify(first.record)!==JSON.stringify(second.record))
      throw Error('QA witness lock identity changed during recovery')
    proveFormerOwnerExited(second.record)
    fs.unlinkSync(lock)
    fsyncDir(directory)
    return Object.freeze({result:'qa_crashed_witness_lock_recovered',
      qa_only:true,world_actions:false,sequence:head.sequence})
  }finally{
    fs.closeSync(gateFd)
    if(fs.existsSync(gate))fs.unlinkSync(gate)
  }
}
module.exports={createOwnedQaWitnessLock,recoverQaWitnessCrashLock,readLock,
  privateQaRoot,proveFormerOwnerExited}
