'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const crypto=require('node:crypto')
const {promisify}=require('node:util')
const {execFile}=require('node:child_process')
const exec=promisify(execFile)
const {openQaPrincipalRegistry}=require('../src/principal_enrollment')
const {createQaCheckpointWitness}=require('../src/qa_checkpoint_witness')
const {createPinnedQaRemoteCheckpointClient}=require('../src/remote_checkpoint')
const {submitQaRevocationBundle,createQaLiveRevocationReceiver,
  assertQaNoPendingRevocation}=require('../src/qa_live_revocation')
const worldId='qa:real-fabric:25593',principalId='OwnerQA_Principal'
const pair=()=>crypto.generateKeyPairSync('ed25519')
const pem=k=>k.publicKey.export({format:'pem',type:'spki'})
const sign=(payload,key)=>({payload,signature:crypto.sign(null,
  Buffer.from(JSON.stringify(payload)),key.privateKey).toString('base64url')})
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-enrollment-qa-'))
  const senderRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-operator-qa-'))
  const witnessRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-remote-anchor-qa-'))
  fs.rmdirSync(witnessRoot)
  const operator=pair(),principal=pair(),witnessKey=pair()
  const registryDirectory=path.join(root,'registry')
  const registry=openQaPrincipalRegistry(registryDirectory,{
    sandboxOnly:true,worldId,operatorPublicKeyPem:pem(operator)})
  const before=registry.exportCheckpoint()
  const enrollment={aud:'guiaia:principal-enrollment:v1',
    worldId,principalId,nonce:crypto.randomUUID(),
    issuedAt:Date.now()-1000,expiresAt:Date.now()+60000,
    publicKeyDer:principal.publicKey.export({format:'der',type:'spki'}).toString('base64url')}
  const consent=crypto.sign(null,Buffer.from('guiaia:principal-consent:v1\n'+
    JSON.stringify(enrollment)),principal.privateKey).toString('base64url')
  registry.applySignedChange(sign(enrollment,operator),consent)
  const current=registry.exportCheckpoint()
  const witness=createQaCheckpointWitness({directory:witnessRoot,worldId,
    operatorPublicKeyPem:pem(operator),witnessPrivateKey:witnessKey.privateKey})
  const url=await witness.start()
  const client=createPinnedQaRemoteCheckpointClient({url,worldId,
    operatorPublicKeyPem:pem(operator),witnessPublicKeyPem:pem(witnessKey)})
  const advance=(a,b)=>sign({aud:'guiaia:checkpoint-advance:v1',worldId,
    operatorFingerprint:b.operatorFingerprint,
    previousSequence:a?a.sequence:-1,
    previousSha256:a?a.registrySha256:null,
    sequence:b.sequence,registrySha256:b.registrySha256,
    nonce:crypto.randomUUID(),issuedAt:Date.now()-1000,
    expiresAt:Date.now()+45000},operator)
  await client.publish(advance(null,before))
  await client.publish(advance(before,current))
  assert.equal(await client.verifyLocal(current),true)
  const privateFile=(filename,data)=>{
    const f=path.join(senderRoot,filename)
    fs.writeFileSync(f,data,{flag:'wx',mode:0o600})
    return f
  }
  const privateKeyFile=privateFile('signer-private.pem',
    operator.privateKey.export({format:'pem',type:'pkcs8'}))
  const configFile=privateFile('sender.json',JSON.stringify({version:1,
    sandboxOnly:true,worldId,registryDirectory,principalId,
    operatorPrivateKeyFile:privateKeyFile}))
  let receiver=null
  t.after(async()=>{
    if(receiver)await receiver.close()
    registry.close()
    await witness.close()
    fs.rmSync(root,{force:true,recursive:true})
    fs.rmSync(senderRoot,{force:true,recursive:true})
    fs.rmSync(witnessRoot,{force:true,recursive:true})
  })
  return {operator,principal,root,senderRoot,registryDirectory,registry,
    current,witness,client,configFile,
    newReceiver:extra=>receiver=createQaLiveRevocationReceiver({
      registryDirectory,registry,witness:client,
      operatorPublicKeyPem:pem(operator),worldId,stopRuntime:()=>({ok:true}),...extra
    }),
    submitFromExternal:()=>exec(process.execPath,[
      path.resolve(__dirname,'../qa_revoke.js'),'--qa-submit',configFile],
      {cwd:path.resolve(__dirname,'..'),timeout:6000})
  }
}
test('independent signed revocation is consumed while exclusive registry lock is held; witness CAS advances',async t=>{
  const x=await fixture(t)
  let stops=0
  const receiver=x.newReceiver({stopRuntime:()=>{stops++;return {ok:true}},intervalMs:50})
  receiver.start()
  assert.throws(()=>openQaPrincipalRegistry(x.registryDirectory,{
    sandboxOnly:true,worldId,operatorPublicKeyPem:pem(x.operator)}),/EEXIST/)
  const external=await x.submitFromExternal()
  assert.match(external.stdout,/signed_qa_revocation_queued/)
  const deadline=Date.now()+5000
  while(!receiver.status().processed&&Date.now()<deadline)await wait(35)
  assert.equal(receiver.status().processed,true)
  assert.equal(receiver.status().failed,false)
  assert.equal(receiver.status().stopped,true)
  assert.equal(stops,1)
  assert.equal(x.registry.isRevoked(principalId),true)
  const after=x.registry.exportCheckpoint()
  assert.equal(after.sequence,2)
  assert.equal(await x.client.verifyLocal(after),true)
  assert.equal(fs.existsSync(path.join(x.root,'pending-revocation.json')),false)
  assert.equal(fs.existsSync(path.join(x.root,'processed-revocation.json')),true)
  await assert.rejects(x.submitFromExternal(),/Existing QA revocation|Command failed/)
  assert.equal(stops,1)
  assert.equal(receiver.status().processed,true)
})
test('invalid cross-process signed bundle halts QA and cannot mutate owner registry',async t=>{
  const x=await fixture(t)
  let stops=0
  const receiver=x.newReceiver({stopRuntime:()=>{stops++;return {ok:true}},intervalMs:1000})
  receiver.start()
  submitQaRevocationBundle({registryDirectory:x.registryDirectory,
    bundle:{ticket:{payload:{aud:'guiaia:principal-revocation:v1'},signature:'A'.repeat(86)},
      advance:{payload:{aud:'guiaia:checkpoint-advance:v1'},signature:'A'.repeat(86)}}})
  await assert.rejects(receiver.pollOnce(),/Invalid, expired or wrong-world signed enrollment ticket|Malformed signed enrollment ticket|Untrusted/)
  assert.equal(stops,1)
  assert.equal(receiver.status().failed,true)
  assert.equal(x.registry.isRevoked(principalId),false)
  assert.equal(x.registry.exportCheckpoint().sequence,1)
  assert.equal(await x.client.verifyLocal(x.current),true)
  assert.throws(()=>assertQaNoPendingRevocation(x.registryDirectory),/Pending/)
})
test('unavailable witness after valid signed update blocks operation and retains unacknowledged submission',async t=>{
  const x=await fixture(t)
  let stops=0
  const receiver=x.newReceiver({
    stopRuntime:()=>{stops++;return {ok:true}},intervalMs:1000,
    witness:{publish:async()=>{throw Error('witness_offline')},
      verifyLocal:async()=>false}
  })
  receiver.start()
  await x.submitFromExternal()
  await assert.rejects(receiver.pollOnce(),/witness_offline/)
  assert.equal(receiver.status().failed,true)
  assert.equal(stops,1)
  assert.equal(x.registry.isRevoked(principalId),true)
  assert.equal(x.registry.exportCheckpoint().sequence,2)
  await assert.rejects(x.client.verifyLocal(x.registry.exportCheckpoint()),/disagreement/)
  assert.equal(fs.existsSync(path.join(x.root,'pending-revocation.json')),true)
  assert.equal(fs.existsSync(path.join(x.root,'processed-revocation.json')),false)
  assert.throws(()=>assertQaNoPendingRevocation(x.registryDirectory),/Pending/)
})

test('failed durable cancellation cannot acknowledge or apply a signed live revocation',async t=>{
  const x=await fixture(t)
  let calls=0
  const receiver=x.newReceiver({intervalMs:1000,
    stopRuntime:()=>{calls++;return {ok:false,reason:'cancellation_unconfirmed'}}})
  receiver.start()
  await x.submitFromExternal()
  await assert.rejects(receiver.pollOnce(),/cancellation could not be persisted/)
  assert.equal(calls,1)
  assert.equal(receiver.status().failed,true)
  assert.equal(x.registry.isRevoked(principalId),false)
  assert.equal(x.registry.exportCheckpoint().sequence,1)
  assert.equal(await x.client.verifyLocal(x.current),true)
  assert.equal(fs.existsSync(path.join(x.root,'pending-revocation.json')),true)
  assert.equal(fs.existsSync(path.join(x.root,'processed-revocation.json')),false)
})
