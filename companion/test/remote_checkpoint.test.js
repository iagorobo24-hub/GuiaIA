'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const crypto=require('node:crypto')
const {createQaCheckpointWitness}=require('../src/qa_checkpoint_witness')
const {createPinnedQaRemoteCheckpointClient}=require('../src/remote_checkpoint')
const WORLD='qa:separate-witness:1'
const keys=()=>crypto.generateKeyPairSync('ed25519')
const hex=i=>String(i).repeat(64)
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-remote-anchor-qa-'))
  // Reserve a unique, QA-only name without pre-creating a trusted witness.
  fs.rmdirSync(dir)
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const operator=keys(),witnessKey=keys()
  const operatorPem=operator.publicKey.export({type:'spki',format:'pem'})
  const witnessPem=witnessKey.publicKey.export({type:'spki',format:'pem'})
  const fingerprint=crypto.createHash('sha256')
    .update(operator.publicKey.export({type:'spki',format:'der'})).digest('hex')
  const create=()=>createQaCheckpointWitness({
    directory:dir,worldId:WORLD,operatorPublicKeyPem:operatorPem,
    witnessPrivateKey:witnessKey.privateKey})
  const makeClient=url=>createPinnedQaRemoteCheckpointClient({
    url,worldId:WORLD,operatorPublicKeyPem:operatorPem,witnessPublicKeyPem:witnessPem})
  const ticket=(before,after,key=operator.privateKey,extra={})=>{
    const now=Date.now()
    const payload={aud:'guiaia:checkpoint-advance:v1',
      worldId:WORLD,operatorFingerprint:fingerprint,
      previousSequence:before===null?-1:before.sequence,
      previousSha256:before===null?null:before.registrySha256,
      sequence:after.sequence,registrySha256:after.registrySha256,
      nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+45000,...extra}
    return {payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),
      key).toString('base64url')}
  }
  const head=(seq,sha)=>({version:1,worldId:WORLD,
    operatorFingerprint:fingerprint,sequence:seq,registrySha256:sha})
  return {dir,create,makeClient,ticket,head,operator,witnessKey}
}
test('witness separately pins operator-approved bootstrap then monotonic updates',async t=>{
  const x=fixture(t),server=x.create()
  const url=await server.start()
  t.after(()=>server.close())
  const client=x.makeClient(url)
  await assert.rejects(client.latest(),/denied/)
  const first=x.head(0,hex('a')),next=x.head(1,hex('b'))
  await client.publish(x.ticket(null,first))
  assert.deepEqual(await client.latest(),first)
  assert.equal(await client.verifyLocal(first),true)
  await client.publish(x.ticket(first,next))
  assert.equal(await client.verifyLocal(next),true)
  await assert.rejects(client.verifyLocal(first),/disagreement/)
  await assert.rejects(client.publish(x.ticket(first,next)),/denied/)
  assert.equal((await client.latest()).sequence,1)
})
test('witness rejects unauthorized, world-scoped, stale and skipped revisions',async t=>{
  const x=fixture(t),server=x.create(),url=await server.start()
  t.after(()=>server.close())
  const client=x.makeClient(url),initial=x.head(0,hex('1'))
  const wrong=keys()
  await assert.rejects(client.publish(x.ticket(null,initial,wrong.privateKey)),/signature|denied/)
  await assert.rejects(client.publish(x.ticket(null,initial,x.operator.privateKey,
    {worldId:'qa:other'})),/Unsafe|denied/)
  await assert.rejects(client.publish(x.ticket(null,initial,x.operator.privateKey,
    {expiresAt:Date.now()-1})),/Unsafe|denied/)
  await client.publish(x.ticket(null,initial))
  await assert.rejects(client.publish(x.ticket(initial,x.head(2,hex('2')))),/Unsafe/)
  assert.equal((await client.latest()).sequence,0)
})
test('witness restart persists reference outside registry and denies stale changes',async t=>{
  const x=fixture(t)
  const firstServer=x.create()
  let url=await firstServer.start(),client=x.makeClient(url)
  const start=x.head(0,hex('a')),latest=x.head(1,hex('b'))
  await client.publish(x.ticket(null,start))
  await client.publish(x.ticket(start,latest))
  await firstServer.close()
  const restarted=x.create()
  url=await restarted.start()
  t.after(()=>restarted.close())
  client=x.makeClient(url)
  assert.equal(await client.verifyLocal(latest),true)
  await assert.rejects(client.verifyLocal(start),/disagreement/)
  await assert.rejects(client.publish(x.ticket(start,latest)),/denied/)
})
test('unavailable independent witness always denies; local checkpoint alone is insufficient',async t=>{
  const x=fixture(t),server=x.create(),url=await server.start()
  const client=x.makeClient(url)
  const head=x.head(0,hex('a'))
  await client.publish(x.ticket(null,head))
  await server.close()
  await assert.rejects(client.verifyLocal(head),/unavailable/)
})
test('tampered witness disk and missing head after restart fail closed',async t=>{
  const x=fixture(t),server=x.create(),url=await server.start()
  t.after(()=>server.close())
  const client=x.makeClient(url),head=x.head(0,hex('a'))
  await client.publish(x.ticket(null,head))
  const file=path.join(x.dir,'head.json')
  fs.writeFileSync(file,JSON.stringify(x.head(0,hex('c')))+'\n')
  await assert.rejects(client.latest(),/denied/)
  await server.close()
  assert.throws(()=>x.create(),/Corrupt|Unsafe|Untrusted|witness/i)
  // Remove head entirely: even an otherwise valid operator bootstrap must not
  // reinitialize an already-used witness directory.
  fs.rmSync(file)
  assert.throws(()=>x.create(),/missing checkpoint/i)
})
test('concurrent same-parent updates cannot both succeed',async t=>{
  const x=fixture(t),server=x.create(),url=await server.start()
  t.after(()=>server.close())
  const client=x.makeClient(url),base=x.head(0,hex('a'))
  await client.publish(x.ticket(null,base))
  const attempts=await Promise.allSettled([
    client.publish(x.ticket(base,x.head(1,hex('b')))),
    client.publish(x.ticket(base,x.head(1,hex('c'))))
  ])
  assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1)
  assert.equal(attempts.filter(a=>a.status==='rejected').length,1)
  assert.equal((await client.latest()).sequence,1)
})
test('untrusted configured endpoints and wrong signing keys cannot be used',async t=>{
  const x=fixture(t),server=x.create(),url=await server.start()
  t.after(()=>server.close())
  for(const unsafe of ['https://127.0.0.1:3333/','http://localhost:3333/',
    'http://127.0.0.1:3333/x','http://user:pass@127.0.0.1:3333/']){
    assert.throws(()=>x.makeClient(unsafe),/Unsafe/)
  }
  const rogue=keys()
  const pinned=createPinnedQaRemoteCheckpointClient({
    url,worldId:WORLD,
    operatorPublicKeyPem:x.operator.publicKey.export({format:'pem',type:'spki'}),
    witnessPublicKeyPem:rogue.publicKey.export({format:'pem',type:'spki'})
  })
  await x.makeClient(url).publish(x.ticket(null,x.head(0,hex('a'))))
  await assert.rejects(pinned.latest(),/signature/)
  assert.throws(()=>createQaCheckpointWitness({
    directory:path.join(os.tmpdir(),'arbitrary-anchor'),
    worldId:WORLD,operatorPublicKeyPem:'invalid',
    witnessPrivateKey:x.witnessKey.privateKey}),/disposable/)
})

test('independent witness process survives restart, denies requests while down and retains monotonic floor',async t=>{
  const {fork}=require('node:child_process')
  const x=fixture(t)
  const children=[]
  t.after(()=>{
    for(const child of children)if(child.exitCode===null)child.kill('SIGTERM')
  })
  const childScript=path.join(__dirname,'qa_checkpoint_witness_process.js')
  const operatorPublicKeyPem=x.operator.publicKey.export({format:'pem',type:'spki'})
  const witnessPrivateKeyPem=x.witnessKey.privateKey.export({format:'pem',type:'pkcs8'})
  async function start(){
    const child=fork(childScript,[],{stdio:['ignore','ignore','ignore','ipc']})
    children.push(child)
    const response=new Promise((resolve,reject)=>{
      child.once('message',message=>{
        if(message.type==='ready')resolve(message.url)
        else reject(Error('Child witness failed: '+message.error))
      })
      child.once('exit',()=>reject(Error('Witness child exited before start')))
    })
    child.send({type:'start',directory:x.dir,worldId:WORLD,
      operatorPublicKeyPem,witnessPrivateKeyPem})
    return {child,url:await response}
  }
  const first=await start()
  const client=x.makeClient(first.url)
  const initial=x.head(0,hex('a')),current=x.head(1,hex('b'))
  await client.publish(x.ticket(null,initial))
  await client.publish(x.ticket(initial,current))
  assert.equal(await client.verifyLocal(current),true)
  first.child.kill('SIGKILL')
  await new Promise(resolve=>first.child.once('exit',resolve))
  await assert.rejects(client.verifyLocal(current),/unavailable/)
  // Only the disposable QA witness lock is stale after SIGKILL. Unlike the
  // registry, this explicit test harness can remove its own former lock.
  // This is NOT general-purpose recovery of untrusted locks.
  const lock=path.join(x.dir,'witness.lock')
  assert.equal(fs.existsSync(lock),true)
  fs.unlinkSync(lock)
  const second=await start()
  const restored=x.makeClient(second.url)
  assert.equal(await restored.verifyLocal(current),true)
  await assert.rejects(restored.verifyLocal(initial),/disagreement/)
  second.child.send({type:'stop'})
  await new Promise(resolve=>second.child.once('exit',resolve))
})


test('an attacker with the witness data directory can restore its own old signed state: not immutable',async t=>{
  const x=fixture(t)
  const server=x.create(),url=await server.start()
  const client=x.makeClient(url),base=x.head(0,hex('a')),next=x.head(1,hex('b'))
  await client.publish(x.ticket(null,base))
  const file=path.join(x.dir,'head.json')
  const old=fs.readFileSync(file)
  await client.publish(x.ticket(base,next))
  await server.close()
  fs.writeFileSync(file,old)
  // A witness run with exactly the same compromised storage and signing key
  // cannot discover a fully coherent restoration by itself.
  const restarted=x.create(),latestUrl=await restarted.start()
  t.after(()=>restarted.close())
  const rolledBack=x.makeClient(latestUrl)
  assert.equal((await rolledBack.latest()).sequence,0)
  assert.equal(await rolledBack.verifyLocal(base),true)
  await assert.rejects(rolledBack.verifyLocal(next),/disagreement/)
})
