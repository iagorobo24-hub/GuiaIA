'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {verifyBridgeLog,createPinnedQaServerBridgeAuthority}=
  require('../src/fabric_bridge_reader')
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-realbridge-reader-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const dir=path.join(root,'protected')
  fs.mkdirSync(dir,{mode:0o700})
  const file=path.join(dir,'events.jsonl')
  fs.writeFileSync(file,'',{mode:0o600})
  const keys=crypto.generateKeyPairSync('ed25519')
  const publicKey=keys.publicKey.export({format:'pem',type:'spki'})
  const connectionId=crypto.randomUUID(),challenge=crypto.randomBytes(24).toString('hex')
  const payload=(event,overrides={})=>{
    const now=Date.now()
    return {aud:event==='join'?'guiaia:server-connection:v1':'guiaia:server-disconnect:v1',
      worldId:'qa:real-fabric:25593',connectionId,username:'OwnerQA',challenge,
      issuedAt:now-1000,expiresAt:now+44000,...overrides}
  }
  const record=(event,overrides={})=>{
    const p=payload(event,overrides)
    return {event,payload:p,signature:crypto.sign(null,Buffer.from(JSON.stringify(p)),
      keys.privateKey).toString('base64url')}
  }
  const append=e=>fs.appendFileSync(file,JSON.stringify(e)+'\n')
  return {file,dir,keys,publicKey,connectionId,record,append}
}
test('signed live JOIN is usable only with separately pinned Ed25519 key',t=>{
  const f=fixture(t)
  f.append(f.record('join'))
  const bridge=createPinnedQaServerBridgeAuthority(f.file,f.publicKey,'qa:real-fabric:25593')
  const live=bridge.activeConnection(f.connectionId)
  assert.equal(live.connected,true)
  assert.equal(live.username,'OwnerQA')
  assert.equal(bridge.joinProof(f.connectionId).payload.connectionId,f.connectionId)
  assert.equal(bridge.activeConnection(crypto.randomUUID()),null)
  assert.equal(verifyBridgeLog(f.file,f.publicKey,'qa:real-fabric:25593').events,1)
})
test('real disconnect invalidates current signed live proof',t=>{
  const f=fixture(t)
  f.append(f.record('join'))
  f.append(f.record('disconnect'))
  const bridge=createPinnedQaServerBridgeAuthority(f.file,f.publicKey,'qa:real-fabric:25593')
  assert.equal(bridge.activeConnection(f.connectionId),null)
  assert.equal(bridge.joinProof(f.connectionId),null)
})
test('offline reconnect with same name must have distinct active connection ID',t=>{
  const f=fixture(t)
  f.append(f.record('join'))
  f.append(f.record('disconnect'))
  const next=crypto.randomUUID()
  f.append(f.record('join',{connectionId:next,challenge:crypto.randomBytes(24).toString('hex')}))
  const bridge=createPinnedQaServerBridgeAuthority(f.file,f.publicKey,'qa:real-fabric:25593')
  assert.equal(bridge.activeConnection(f.connectionId),null)
  assert.equal(bridge.activeConnection(next).connectionId,next)
})
test('forged join fields and forged signature fail closed',t=>{
  const f=fixture(t)
  const forged=f.record('join');forged.payload.username='ImpostorQA'
  f.append(forged)
  assert.throws(()=>verifyBridgeLog(f.file,f.publicKey,'qa:real-fabric:25593'),/Untrusted/)
  fs.writeFileSync(f.file,'')
  const forgedSig=f.record('join');forgedSig.signature='A'.repeat(86)
  f.append(forgedSig)
  assert.throws(()=>verifyBridgeLog(f.file,f.publicKey,'qa:real-fabric:25593'),/Untrusted/)
})
test('different signing key and different world are never trusted',t=>{
  const f=fixture(t)
  f.append(f.record('join'))
  const outsider=crypto.generateKeyPairSync('ed25519')
  assert.throws(()=>verifyBridgeLog(f.file,outsider.publicKey.export({format:'pem',type:'spki'}),'qa:real-fabric:25593'),/Untrusted/)
  assert.throws(()=>verifyBridgeLog(f.file,f.publicKey,'qa:another-world'),/Untrusted/)
})
test('corrupt, reordered, duplicate, unmatched and truncated events fail closed',t=>{
  const f=fixture(t)
  for(const records of [
    [f.record('disconnect')],
    [f.record('join'),f.record('join')],
    [f.record('join'),f.record('disconnect',{challenge:'b'.repeat(48)})],
    [f.record('join'),f.record('disconnect'),f.record('disconnect')],
  ]){
    fs.writeFileSync(f.file,records.map(x=>JSON.stringify(x)).join('\n')+'\n')
    assert.throws(()=>verifyBridgeLog(f.file,f.publicKey,'qa:real-fabric:25593'))
  }
  fs.writeFileSync(f.file,JSON.stringify(f.record('join')))
  assert.throws(()=>verifyBridgeLog(f.file,f.publicKey,'qa:real-fabric:25593'),/Truncated/)
})
test('expired join, stale event file cleared on restart, and absent session all fail closed',t=>{
  const f=fixture(t)
  const previous=Date.now()-90000
  f.append(f.record('join',{issuedAt:previous,expiresAt:previous+45000}))
  assert.equal(verifyBridgeLog(f.file,f.publicKey,'qa:real-fabric:25593').active.size,0)
  fs.writeFileSync(f.file,'')
  assert.equal(verifyBridgeLog(f.file,f.publicKey,'qa:real-fabric:25593').events,0)
})
test('symlink and public filesystem permissions cause immediate refusal',t=>{
  const f=fixture(t)
  f.append(f.record('join'))
  if(process.platform!=='win32'){fs.chmodSync(f.file,0o644)
  assert.throws(()=>verifyBridgeLog(f.file,f.publicKey,'qa:real-fabric:25593'),/Insecure/)}
  fs.chmodSync(f.file,0o600)
  const alias=path.join(f.dir,'alias')
  fs.symlinkSync(f.file,alias)
  assert.throws(()=>verifyBridgeLog(alias,f.publicKey,'qa:real-fabric:25593'),/Symlink/)
  if(process.platform!=='win32'){fs.chmodSync(f.dir,0o755)
  assert.throws(()=>verifyBridgeLog(f.file,f.publicKey,'qa:real-fabric:25593'),/Insecure/)}
})
