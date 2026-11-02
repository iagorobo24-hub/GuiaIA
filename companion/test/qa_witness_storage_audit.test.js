'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {spawnSync}=require('node:child_process')
const {inspectQaStorage}=require('../qa_witness_storage_audit')
function fixture(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-storage-audit-qa-'))
  const local=path.join(home,'.local')
  const state=path.join(local,'state')
  const candidate=path.join(state,'guiaia-witness-qa-example01')
  fs.mkdirSync(local,{mode:0o700})
  fs.mkdirSync(state,{mode:0o700})
  fs.mkdirSync(candidate,{mode:0o700})
  const marker=path.join(candidate,'read-only-marker')
  fs.writeFileSync(marker,'unchanged',{mode:0o600})
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
  const inspect=(opts={})=>inspectQaStorage(candidate,{home,
    statfs:()=>({type:0xef53}),...opts})
  return {home,local,state,candidate,marker,inspect}
}
test('private Linux ext4 candidate passes only a read-only preliminary audit',t=>{
  if(process.platform!=='linux')return
  const f=fixture(t)
  const before=fs.readFileSync(f.marker)
  const result=f.inspect()
  assert.equal(result.result,'candidate_pass')
  assert.equal(result.linux_ext4,true)
  assert.equal(result.read_only,true)
  assert.equal(result.production_ready,false)
  assert.equal(result.wsl_reboot_tested,false)
  assert.equal(result.backup_tested,false)
  assert.equal(result.external_rollback_anchor,false)
  assert.deepEqual(result.conditions,[])
  assert.deepEqual(fs.readFileSync(f.marker),before)
})
test('Windows-mounted drive or unknown filesystem is not a safe persistent candidate',t=>{
  if(process.platform!=='linux')return
  const f=fixture(t)
  for(const type of [0x53464846,0xff534d42,0x01021994,0x794c7630]){
    const result=f.inspect({statfs:()=>({type})})
    assert.equal(result.result,'fail_closed')
    assert.deepEqual(result.conditions,['filesystem_not_ext4'])
    assert.equal(result.production_ready,false)
  }
  assert.throws(()=>f.inspect({statfs:()=>({type:null})}),/Unverifiable/)
})
test('world-writable, missing and symlinked storage paths fail closed',t=>{
  if(process.platform!=='linux')return
  const f=fixture(t)
  fs.chmodSync(f.candidate,0o755)
  assert.match(f.inspect().conditions.join(' '),/0700/)
  fs.chmodSync(f.candidate,0o700)
  fs.rmSync(f.candidate,{recursive:true})
  assert.equal(f.inspect().result,'fail_closed')
  fs.symlinkSync(f.state,f.candidate)
  assert.equal(f.inspect().result,'fail_closed')
  assert.match(f.inspect().conditions.join(' '),/unsafe_directory/)
})
test('audit refuses paths outside exact user-home QA state namespace',t=>{
  if(process.platform!=='linux')return
  const f=fixture(t)
  for(const candidate of ['/mnt/c/Users/user/secret',
    path.join(f.home,'other'),path.join(f.state,'real-production'),
    path.join(f.state,'guiaia-witness-qa-xx'),
    path.join(f.state,'guiaia-witness-qa-example01','..')])
    assert.throws(()=>inspectQaStorage(candidate,{home:f.home}),/QA|canonical/)
  assert.deepEqual(fs.readFileSync(f.marker,'utf8'),'unchanged')
})

test('CLI rejects spoofed HOME and never creates storage',t=>{
  if(process.platform!=='linux')return
  const f=fixture(t)
  const script=path.resolve(__dirname,'../qa_witness_storage_audit.js')
  const before=fs.readFileSync(f.marker)
  const spoofed=spawnSync(process.execPath,[script,
    '--qa-readonly-storage-candidate',f.candidate],{
    encoding:'utf8',timeout:5000,env:{...process.env,HOME:f.home}})
  assert.equal(spoofed.status,2)
  assert.equal(spoofed.stdout,'')
  assert.deepEqual(fs.readFileSync(f.marker),before)
  const accountHome=os.userInfo().homedir
  if(path.dirname(accountHome)!=='/home')return
  const missing=path.join(accountHome,'.local','state',
    'guiaia-witness-qa-missing-integration2026')
  assert.equal(fs.existsSync(missing),false)
  const denied=spawnSync(process.execPath,[script,
    '--qa-readonly-storage-candidate',missing],{
    encoding:'utf8',timeout:5000})
  assert.equal(denied.status,2)
  assert.equal(fs.existsSync(missing),false)
  const rejected=JSON.parse(denied.stdout.trim().split('=')[1])
  assert.deepEqual(rejected.conditions,['missing_candidate_or_parent'])
  assert.equal(rejected.production_ready,false)
  assert.equal(rejected.wsl_reboot_tested,false)
})
