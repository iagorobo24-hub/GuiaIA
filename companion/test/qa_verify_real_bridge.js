'use strict'
const fs=require('node:fs')
const crypto=require('node:crypto')
const assert=require('node:assert/strict')
const {verifyBridgeLog,createPinnedQaServerBridgeAuthority}=require('../src/fabric_bridge_reader')
const [file,keyFile]=process.argv.slice(2)
if(!file||!keyFile)throw Error('Explicit disposable QA evidence and pinned public key required')
const key=crypto.createPublicKey(fs.readFileSync(keyFile,'utf8'))
assert.equal(key.asymmetricKeyType,'ed25519')
if(process.platform!=='win32'){
  assert.equal(fs.statSync(file).mode&0o777,0o600)
  assert.equal(fs.statSync(require('node:path').dirname(file)).mode&0o777,0o700)
}
const bytes=fs.readFileSync(file)
if(bytes.length<2 || bytes.length>131072)throw Error('Bridge evidence out of bounds')
const lines=bytes.toString('utf8').trim().split('\n')
function checked(line){
  const evidence=typeof line==='string'?JSON.parse(line):line
  assert.deepEqual(Object.keys(evidence),['event','payload','signature'])
  assert.ok(['join','disconnect'].includes(evidence.event))
  const p=evidence.payload
  assert.deepEqual(Object.keys(p),['aud','worldId','connectionId','username',
    'challenge','issuedAt','expiresAt'])
  assert.equal(p.aud,evidence.event==='join'?'guiaia:server-connection:v1':'guiaia:server-disconnect:v1')
  assert.equal(p.worldId,'qa:real-fabric:25593')
  assert.match(p.connectionId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.match(p.challenge,/^[0-9a-f]{48}$/)
  assert.equal(p.username,'OwnerQA')
  assert.ok(Number.isSafeInteger(p.issuedAt))
  assert.equal(p.expiresAt-p.issuedAt,45000)
  assert.match(evidence.signature,/^[a-zA-Z0-9_-]{86}$/)
  assert.equal(crypto.verify(null,Buffer.from(JSON.stringify(p)),key,
    Buffer.from(evidence.signature,'base64url')),true)
  return evidence
}
const all=lines.map(checked)
assert.deepEqual(all.map(x=>x.event),['join','disconnect','join','disconnect'])
assert.equal(all[0].payload.connectionId,all[1].payload.connectionId)
assert.equal(all[2].payload.connectionId,all[3].payload.connectionId)
assert.equal(all[0].payload.challenge,all[1].payload.challenge)
assert.equal(all[2].payload.challenge,all[3].payload.challenge)
assert.notEqual(all[0].payload.connectionId,all[2].payload.connectionId)
assert.notEqual(all[0].payload.challenge,all[2].payload.challenge)
assert.equal(all[0].payload.username,all[2].payload.username)
const manipulated=structuredClone(all[0])
manipulated.payload.username='ImpostorQA'
assert.throws(()=>checked(manipulated))
const forged=structuredClone(all[0])
forged.signature='A'.repeat(86)
assert.throws(()=>checked(forged))
const active=new Map()
for(const e of all){
  if(e.event==='join')active.set(e.payload.connectionId,e.payload)
  else active.delete(e.payload.connectionId)
}
assert.equal(active.size,0)
const pinned=createPinnedQaServerBridgeAuthority(file,fs.readFileSync(keyFile,'utf8'),'qa:real-fabric:25593')
const state=verifyBridgeLog(file,fs.readFileSync(keyFile,'utf8'),'qa:real-fabric:25593')
assert.equal(state.events,4)
assert.equal(state.active.size,0)
for(const entry of all.filter(x=>x.event==='join')){
  assert.equal(pinned.activeConnection(entry.payload.connectionId),null)
  assert.equal(pinned.joinProof(entry.payload.connectionId),null)
}
const started=fs.readFileSync(file)
const result={
  result:'pass',real_fabric_server_events:true,
  join_count:2,disconnect_count:2,
  server_signed_ed25519:true,
  two_distinct_real_connections_same_offline_username:true,
  distinct_random_connection_ids:true,
  distinct_challenges:true,
  forged_payload_rejected:true,forged_signature_rejected:true,
  all_sessions_inactive_after_disconnect:true,
  private_file_modes:true,
  production:false,
  player_identity_authenticated:false
}
assert.equal(fs.readFileSync(file).equals(started),true)
console.log('GUIAIA_REAL_FABRIC_BRIDGE_QA_EVIDENCE='+JSON.stringify(result))
