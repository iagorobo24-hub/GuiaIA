'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const crypto=require('node:crypto')
const {createQaCheckpointWitness}=require('../src/qa_checkpoint_witness')
const {createPinnedQaRemoteCheckpointClient}=require('../src/remote_checkpoint')
const {createQaIndependentRollbackVerifier}=require('../src/qa_independent_rollback_floor')
const world='qa:external-floor-test'
const keys=()=>crypto.generateKeyPairSync('ed25519')
function sha(key){
  return crypto.createHash('sha256')
    .update(key.publicKey.export({format:'der',type:'spki'})).digest('hex')
}
const pub=key=>key.publicKey.export({format:'pem',type:'spki'})
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-remote-anchor-qa-'))
  fs.rmdirSync(dir)
  const operator=keys(),witness=keys(),anchor=keys()
  const op=sha(operator),wit=sha(witness)
  const options=url=>({url,worldId:world,
    operatorPublicKeyPem:pub(operator),
    witnessPublicKeyPem:pub(witness),
    anchorPublicKeyPem:pub(anchor)})
  const server=()=>createQaCheckpointWitness({directory:dir,worldId:world,
    operatorPublicKeyPem:pub(operator),witnessPrivateKey:witness.privateKey})
  const head=(sequence,registrySha256)=>({version:1,worldId:world,
    operatorFingerprint:op,sequence,registrySha256})
  const ticket=(previous,next)=>{
    const now=Date.now()
    const payload={aud:'guiaia:checkpoint-advance:v1',worldId:world,
      operatorFingerprint:op,previousSequence:previous?.sequence??-1,
      previousSha256:previous?.registrySha256??null,
      sequence:next.sequence,registrySha256:next.registrySha256,
      nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+45000}
    return {payload,signature:crypto.sign(null,
      Buffer.from(JSON.stringify(payload)),operator.privateKey).toString('base64url')}
  }
  const floor=(h,signer=anchor.privateKey,changes={})=>{
    const payload={aud:'guiaia:independent-floor-qa:v1',worldId:world,
      operatorFingerprint:op,witnessFingerprint:wit,
      sequence:h.sequence,registrySha256:h.registrySha256,...changes}
    return {payload,signature:crypto.sign(null,
      Buffer.from(JSON.stringify(payload)),signer).toString('base64url')}
  }
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  return {dir,operator,witness,anchor,options,server,head,ticket,floor}
}
test('independent signed floor recognizes valid fresh witness checkpoint without authorizing actions',async t=>{
  const f=fixture(t),w=f.server(),url=await w.start()
  t.after(()=>w.close())
  const client=createPinnedQaRemoteCheckpointClient(f.options(url))
  const verify=createQaIndependentRollbackVerifier(f.options(url))
  const a=f.head(0,'a'.repeat(64)),b=f.head(1,'b'.repeat(64)),
    c=f.head(2,'c'.repeat(64))
  await assert.rejects(verify.verifyRemote(f.floor(a)),/denied/i)
  await client.publish(f.ticket(null,a))
  const matching=await verify.verifyRemote(f.floor(a))
  assert.equal(matching.result,'qa_floor_consistent')
  assert.equal(matching.world_actions,false)
  assert.equal(matching.production_ready,false)
  assert.equal(matching.read_only,true)
  await client.publish(f.ticket(a,b))
  const forward=await verify.verifyRemote(f.floor(a))
  assert.equal(forward.observedSequence,1)
  assert.equal(forward.anchoredSequence,0)
  await client.publish(f.ticket(b,c))
  assert.equal((await verify.verifyRemote(f.floor(b))).observedSequence,2)
  await assert.rejects(verify.verifyRemote(f.floor(f.head(2,'f'.repeat(64)))),
    /floor disagreement/)
})
test('real signed on-disk witness rollback is denied when independent floor remains newer',async t=>{
  const f=fixture(t),w=f.server(),url=await w.start()
  const client=createPinnedQaRemoteCheckpointClient(f.options(url))
  const first=f.head(0,'a'.repeat(64)),next=f.head(1,'b'.repeat(64))
  await client.publish(f.ticket(null,first))
  const file=path.join(f.dir,'head.json')
  const oldSigned=fs.readFileSync(file)
  await client.publish(f.ticket(first,next))
  const independentFloor=f.floor(next)
  assert.equal((await createQaIndependentRollbackVerifier(f.options(url))
    .verifyRemote(independentFloor)).observedSequence,1)
  await w.close()
  // Restore an authentic old file, simulating backup rollback. Key unchanged.
  fs.writeFileSync(file,oldSigned)
  const restarted=f.server(),newUrl=await restarted.start()
  t.after(()=>restarted.close())
  const revived=createPinnedQaRemoteCheckpointClient(f.options(newUrl))
  assert.equal((await revived.latest()).sequence,0)
  await assert.rejects(createQaIndependentRollbackVerifier(f.options(newUrl))
    .verifyRemote(independentFloor),/floor disagreement/)
  // A stale floor is NOT a sufficient antirrollback anchor; the external
  // storage must make signed floor replacements detectable.
  const oldFloor=f.floor(first)
  assert.equal((await createQaIndependentRollbackVerifier(f.options(newUrl))
    .verifyRemote(oldFloor)).observedSequence,0)
})
test('forged, mis-scoped, changed-key and malformed independent floors are rejected',async t=>{
  const f=fixture(t),w=f.server(),url=await w.start()
  t.after(()=>w.close())
  const client=createPinnedQaRemoteCheckpointClient(f.options(url))
  const first=f.head(0,'d'.repeat(64))
  await client.publish(f.ticket(null,first))
  const verifier=createQaIndependentRollbackVerifier(f.options(url))
  const floor=f.floor(first)
  assert.equal((await verifier.verifyRemote(floor)).observedSequence,0)
  for(const token of [
    null,{}, {...floor,extra:true},
    {payload:{...floor.payload,extra:true},signature:floor.signature},
    {...floor,signature:'a'.repeat(86)},
    f.floor(first,keys().privateKey),
    f.floor(first,undefined,{worldId:'qa:other'}),
    f.floor(first,undefined,{sequence:-1}),
    f.floor(first,undefined,{registrySha256:'1'}),
    f.floor(first,undefined,{witnessFingerprint:'0'.repeat(64)}),
    f.floor(first,undefined,{operatorFingerprint:'0'.repeat(64)}),
    f.floor(first,undefined,{aud:'guiaia:remote-checkpoint:v1'})
  ])await assert.rejects(verifier.verifyRemote(token),
    /floor|envelope|independent/i)
  assert.throws(()=>createQaIndependentRollbackVerifier({
    ...f.options(url),anchorPublicKeyPem:pub(f.witness)
  }),/separate keys/)
  assert.throws(()=>createQaIndependentRollbackVerifier({
    ...f.options(url),anchorPublicKeyPem:pub(f.operator)
  }),/separate keys/)
  assert.throws(()=>createQaIndependentRollbackVerifier({
    ...f.options(url),url:'http://example.com/'
  }),/Unsafe QA witness URL/)
})
test('wrong witness key is rejected even when the independent floor signature is valid',async t=>{
  const f=fixture(t),w=f.server(),url=await w.start()
  t.after(()=>w.close())
  const client=createPinnedQaRemoteCheckpointClient(f.options(url))
  const first=f.head(0,'a'.repeat(64))
  await client.publish(f.ticket(null,first))
  const wrong=keys()
  const bad=createQaIndependentRollbackVerifier({
    ...f.options(url),witnessPublicKeyPem:pub(wrong)})
  await assert.rejects(bad.verifyRemote(f.floor(first)),/independent QA floor/i)
  const mismatched=f.floor(first,undefined,{witnessFingerprint:sha(wrong)})
  await assert.rejects(bad.verifyRemote(mismatched),/signature/)
})
