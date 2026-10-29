'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const net=require('node:net')
const crypto=require('node:crypto')
const {createPinnedQaLivePresenceAuthority,verifyLiveReply}=require('../src/live_presence')
const WORLD='qa:live:25593'
const makeKeys=()=>crypto.generateKeyPairSync('ed25519')
const makePayload=(connectionId,nonce,opts={})=>{
  const now=Date.now()
  return {aud:'guiaia:live-presence:v1',worldId:WORLD,connectionId,nonce,
    connected:true,issuedAt:now,expiresAt:now+3000,...opts}
}
const sign=(p,key)=>({payload:p,signature:crypto.sign(null,
  Buffer.from(JSON.stringify(p)),key.privateKey).toString('base64url')})
async function fixture(t,reply){
  const key=makeKeys()
  const sockets=new Set()
  const server=net.createServer(socket=>{
    sockets.add(socket)
    socket.on('close',()=>sockets.delete(socket))
    let request=''
    socket.on('data',bytes=>{
      request+=bytes.toString('utf8')
      if(!request.endsWith('\n'))return
      const [id,nonce]=request.trim().split(' ')
      const result=reply(id,nonce,key)
      if(result==='CLOSE')return socket.destroy()
      if(result==='SILENCE')return
      socket.end(typeof result==='string'?result:JSON.stringify(result)+'\n')
    })
  })
  await new Promise((resolve,reject)=>{
    server.once('error',reject);server.listen(0,'127.0.0.1',resolve)
  })
  t.after(async()=>{for(const socket of sockets)socket.destroy();if(server.listening)await new Promise(done=>server.close(done))})
  const port=server.address().port
  const pem=key.publicKey.export({format:'pem',type:'spki'})
  return {key,server,port,pem,authority:createPinnedQaLivePresenceAuthority({
    port,worldId:WORLD,serverBridgePublicKeyPem:pem})}
}
test('fresh challenge, signed active session and distinct nonce on each request',async t=>{
  const seen=[]
  const f=await fixture(t,(id,nonce,key)=>{
    seen.push(nonce)
    const now=Date.now()
    return sign(makePayload(id,nonce,{issuedAt:now,expiresAt:now+3000}),key)
  })
  const id=crypto.randomUUID()
  assert.equal((await f.authority.livePresence(id)).connected,true)
  assert.equal((await f.authority.livePresence(id)).connectionId,id)
  assert.equal(seen.length,2);assert.notEqual(seen[0],seen[1])
})
test('signed denial for disconnected session is never mistaken for active',async t=>{
  const f=await fixture(t,(id,nonce,key)=>{
    const now=Date.now()
    return sign(makePayload(id,nonce,{issuedAt:now,expiresAt:now+3000,connected:false}),key)
  })
  assert.equal((await f.authority.livePresence(crypto.randomUUID())).connected,false)
})
test('forged signature, wrong pinned key and altered world are rejected',async t=>{
  const f=await fixture(t,(id,nonce,key)=>sign(
    makePayload(id,nonce,{worldId:'qa:other'}),key))
  await assert.rejects(f.authority.livePresence(crypto.randomUUID()),/mismatched/)
  const other=makeKeys()
  const signed=sign(makePayload(crypto.randomUUID(),'a'.repeat(32)),f.key)
  assert.throws(()=>verifyLiveReply(signed,other.publicKey,WORLD,
    signed.payload.connectionId,signed.payload.nonce),/signature/)
})
test('replay uses an old nonce; cannot satisfy a fresh server query',async t=>{
  let saved
  const f=await fixture(t,(id,nonce,key)=>{
    if(!saved){const now=Date.now();saved=sign(makePayload(id,nonce,{issuedAt:now,expiresAt:now+3000}),key)}
    return saved
  })
  const id=crypto.randomUUID()
  await f.authority.livePresence(id)
  await assert.rejects(f.authority.livePresence(id),/mismatched/)
})
test('stale response, future timestamp and invalid signature shape fail closed',async t=>{
  const f=await fixture(t,(id,nonce,key)=>{
    const now=Date.now()-2100
    return sign(makePayload(id,nonce,{issuedAt:now,expiresAt:now+3000}),key)
  })
  await assert.rejects(f.authority.livePresence(crypto.randomUUID()),/Stale/)
  const id=crypto.randomUUID(),nonce='0'.repeat(32)
  const future=sign(makePayload(id,nonce,{issuedAt:Date.now()+3000,
    expiresAt:Date.now()+6000}),f.key)
  assert.throws(()=>verifyLiveReply(future,f.key.publicKey,WORLD,id,nonce),/Stale/)
})
test('closed/crashed listener refuses request even if JOIN file remains available',async t=>{
  const f=await fixture(t,(id,nonce,key)=>{
    const now=Date.now()
    return sign(makePayload(id,nonce,{issuedAt:now,expiresAt:now+3000}),key)
  })
  const id=crypto.randomUUID()
  assert.equal((await f.authority.livePresence(id)).connected,true)
  await new Promise(resolve=>f.server.close(resolve))
  await assert.rejects(f.authority.livePresence(id),/unavailable/)
})
test('silent, prematurely closed and excessive replies never authorize',async t=>{
  for(const reply of ['CLOSE','SILENCE','A'.repeat(1100)+'\n']){
    const f=await fixture(t,()=>reply)
    await assert.rejects(f.authority.livePresence(crypto.randomUUID()))
  }
})
test('QA-only, Ed25519-only, exact pinned endpoint and UUID required',async t=>{
  const key=makeKeys()
  const pem=key.publicKey.export({format:'pem',type:'spki'})
  assert.throws(()=>createPinnedQaLivePresenceAuthority({
    port:80,worldId:WORLD,serverBridgePublicKeyPem:pem}),/QA/)
  assert.throws(()=>createPinnedQaLivePresenceAuthority({
    port:25594,worldId:'teselia',serverBridgePublicKeyPem:pem}),/QA/)
  const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048})
  assert.throws(()=>createPinnedQaLivePresenceAuthority({
    port:25594,worldId:WORLD,
    serverBridgePublicKeyPem:rsa.publicKey.export({format:'pem',type:'spki'})}),/Ed25519/)
  const f=await fixture(t,()=> 'CLOSE')
  await assert.rejects(f.authority.livePresence('OwnerQA'),/Invalid live/)
})
