'use strict'
// Read-only assessment of a *candidate* for future durable WSL2 key/state
// custody. This never opens a key, creates a directory or certifies backups.
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const EXT4=0xef53
function report(conditions,fsType=null){
  return Object.freeze({result:conditions.length?'fail_closed':'candidate_pass',
    candidate_only:true,read_only:true,production_ready:false,
    wsl_reboot_tested:false,backup_tested:false,external_rollback_anchor:false,
    linux_ext4:fsType===EXT4,
    conditions:Object.freeze([...new Set(conditions)])})
}
function inspectQaStorage(candidate,{home=os.userInfo().homedir,statfs=fs.statfsSync}={}){
  if(process.platform!=='linux'||typeof process.getuid!=='function')
    throw Error('Linux-only QA storage assessment')
  if(typeof home!=='string'||typeof candidate!=='string'||
    !path.isAbsolute(home)||!path.isAbsolute(candidate)||
    path.normalize(home)!==home||path.normalize(candidate)!==candidate)
    throw Error('Absolute canonical QA storage paths required')
  const expected=path.join(home,'.local','state')
  const prefix='guiaia-witness-qa-'
  if(path.dirname(candidate)!==expected||
     !new RegExp('^'+prefix+'[A-Za-z0-9_-]{6,}$').test(path.basename(candidate)))
    throw Error('QA candidate must be in the user home state directory')
  // Reject symlink traversal and wrong owner at every relevant directory.
  const entries=[home,path.join(home,'.local'),expected,candidate]
  const conditions=[]
  for(const [i,p] of entries.entries()){
    let st
    try{st=fs.lstatSync(p)}catch(error){
      if(error?.code==='ENOENT'){
        conditions.push('missing_candidate_or_parent')
        return report(conditions)
      }
      throw error
    }
    if(!st.isDirectory()||st.isSymbolicLink()||
       fs.realpathSync(p)!==p||st.uid!==process.getuid())
      conditions.push('unsafe_directory_or_owner')
    if(i>=2&&(st.mode&0o777)!==0o700)
      conditions.push('private_state_directory_must_be_0700')
  }
  let fsType=null
  if(!conditions.includes('unsafe_directory_or_owner')){
    const info=statfs(candidate)
    if(!info||!Number.isInteger(info.type))
      throw Error('Unverifiable candidate filesystem type')
    fsType=info.type>>>0
    if(fsType!==EXT4)conditions.push('filesystem_not_ext4')
  }
  return report(conditions,fsType)
}
function main(){
  if(process.argv.length!==4||process.argv[2]!=='--qa-readonly-storage-candidate')
    throw Error('Explicit read-only QA storage audit flag required')
  // Use the OS account database, never a caller-supplied HOME override.
  const accountHome=os.userInfo().homedir
  if(path.dirname(accountHome)!=='/home')
    throw Error('Expected native Linux user home under /home')
  const report=inspectQaStorage(process.argv[3],{home:accountHome})
  process.stdout.write('GUIAIA_QA_WSL_STORAGE_CANDIDATE='+JSON.stringify(report)+'\n')
  if(report.result!=='candidate_pass')process.exitCode=2
}
if(require.main===module){
  try{main()}catch(error){
    // No paths, passwords, key material or parent directory names in output.
    const e=String(error?.message||'unsafe_candidate')
    process.stderr.write('QA storage audit refused: '+
      (/^[A-Za-z0-9 .,_-]{1,110}$/.test(e)?e:'unsafe_candidate')+'\n')
    process.exitCode=2
  }
}
module.exports={inspectQaStorage}
