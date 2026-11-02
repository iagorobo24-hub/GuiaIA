'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const crypto=require('node:crypto')
const http=require('node:http')
const {fork}=require('node:child_process')
const {createQaCheckpointWitness}=require('../src/qa_checkpoint_witness')
const {createQaFloorCustodian}=require('../src/qa_floor_custodian')
const {createPinnedQaRemoteCheckpointClient}=require('../src/remote_checkpoint')
const {createPinnedQaFloorClient}=require('../src/qa_floor_client')
const {createPinnedQaHighWaterClient}=require('../src/qa_high_water_client')
const {createQaTripleAuthorityReconciler}=require('../src/qa_triple_authority_reconciler')
const worldId='qa:high-water-lab'
const keys=()=>crypto.generateKeyPairSync('ed25519')
const pem=k=>k.publicKey.export({format:'pem',type:'spki'})
const fp=k=>crypto.createHash('sha256')
  .update(k.publicKey.export({format:'der',type:'spki'})).digest('hex')
let counter=0
function fixture(t){
  const witnessDir=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-remote-anchor-qa-'))
  const floorDir=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-independent-floor-qa-'))
  fs.rmdirSync(witnessDir);fs.rmdirSync(floorDir)
  const operator=keys(),witnessKey=keys(),floorKey=keys(),highKey=keys()
  const op=fp(operator)
  const servers=[],children=[]
  const shared={worldId,operatorPublicKeyPem:pem(operator),
    witnessPublicKeyPem:pem(witnessKey),
    custodianPublicKeyPem:pem(floorKey),highWaterPublicKeyPem:pem(highKey)}
  function witness(){
    const server=createQaCheckpointWitness({directory:witnessDir,
      worldId,operatorPublicKeyPem:pem(operator),
      witnessPrivateKey:witnessKey.privateKey})
    servers.push(server)
    return server
  }
  function floor(url){
    const server=createQaFloorCustodian({directory:floorDir,
      worldId,operatorPublicKeyPem:pem(operator),
      witnessPublicKeyPem:pem(witnessKey),
      anchorPrivateKey:floorKey.privateKey,witnessUrl:url})
    servers.push(server)
    return server
  }
  const head=(sequence,hash)=>({version:1,worldId,
    operatorFingerprint:op,sequence,registrySha256:hash})
  const ticket=(before,after)=>{
    const now=Date.now()
    const payload={aud:'guiaia:checkpoint-advance:v1',worldId,
      operatorFingerprint:op,previousSequence:before?.sequence??-1,
      previousSha256:before?.registrySha256??null,
      sequence:after.sequence,registrySha256:after.registrySha256,
      nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+45000}
    return {payload,signature:crypto.sign(null,
      Buffer.from(JSON.stringify(payload)),operator.privateKey).toString('base64url')}
  }
  async function spawnHigh(witnessUrl,floorUrl,signer=highKey){
    const child=fork(path.join(__dirname,'qa_high_water_memory_child.js'),[],{
      stdio:['ignore','ignore','ignore','ipc']})
    children.push(child)
    const ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('High-water child startup timed out')),5000)
      const onMessage=m=>{
        if(m.type==='ready'){
          clearTimeout(timer);child.off('message',onMessage);resolve(m.url)
        }else if(m.type==='denied'){
          clearTimeout(timer);child.off('message',onMessage);reject(Error(m.reason))
        }
      }
      child.on('message',onMessage)
      child.once('exit',()=>reject(Error('High-water child exited early')))
    })
    child.send({type:'start',qa_only:true,worldId,
      operatorPublicKeyPem:pem(operator),
      witnessPublicKeyPem:pem(witnessKey),
      custodianPublicKeyPem:pem(floorKey),
      highWaterPrivateKeyPem:signer.privateKey.export({format:'pem',type:'pkcs8'}),
      witnessUrl,floorUrl})
    const url=await ready
    async function advance(ticket){
      const requestId=String(++counter)
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{child.off('message',response);reject(Error('QA high-water IPC timeout'))},6500)
        function response(m){
          if(m.requestId!==requestId)return
          clearTimeout(timer);child.off('message',response)
          if(m.type==='advanced')resolve(m.sequence)
          else reject(Error(m.reason||'High-water denied'))
        }
        child.on('message',response)
        child.send({type:'advance',requestId,ticket})
      })
    }
    return {child,url,advance}
  }
  async function launch(){
    const w=witness(),wu=await w.start()
    const f=floor(wu),fu=await f.start()
    const high=await spawnHigh(wu,fu)
    const wc=createPinnedQaRemoteCheckpointClient({
      ...shared,url:wu})
    const fc=createPinnedQaFloorClient({...shared,anchorPublicKeyPem:pem(floorKey),url:fu})
    const options={...shared,witnessUrl:wu,floorUrl:fu,highWaterUrl:high.url}
    return {w,wu,f,fu,high,wc,fc,options,
      inspect:()=>createQaTripleAuthorityReconciler(options).inspect()}
  }
  t.after(async()=>{
    for(const child of children)if(child.exitCode===null&&child.signalCode===null)
      child.kill('SIGTERM')
    for(const server of servers.reverse())try{await server.close()}catch{}
    fs.rmSync(witnessDir,{recursive:true,force:true})
    fs.rmSync(floorDir,{recursive:true,force:true})
  })
  return {witnessDir,floorDir,shared,witness,floor,spawnHigh,launch,head,ticket,highKey,
    floorKey,witnessKey}
}
test('fourth separate key and fresh nonce permit read-only triple authority equality',async t=>{
  const x=fixture(t),s=await x.launch()
  const h0=x.head(0,'a'.repeat(64)),h1=x.head(1,'b'.repeat(64))
  await assert.rejects(s.inspect(),/denied/)
  await s.wc.publish(x.ticket(null,h0))
  await s.fc.publish(x.ticket(null,h0))
  assert.equal(await s.high.advance(x.ticket(null,h0)),0)
  const equal=await s.inspect()
  assert.equal(equal.result,'qa_three_authority_equal_observation')
  assert.equal(equal.requiresManualReview,false)
  assert.equal(equal.world_actions,false)
  assert.equal(equal.production_ready,false)
  assert.equal(equal.external_monotonicity_verified,false)
  assert.equal(equal.atomic_snapshot,false)
  await s.wc.publish(x.ticket(h0,h1))
  await s.fc.publish(x.ticket(h0,h1))
  const pending=await s.inspect()
  assert.equal(pending.result,'qa_three_authority_gap_requires_review')
  assert.equal(pending.externalSequence,0)
  assert.equal(pending.requiresManualReview,true)
  assert.equal(await s.high.advance(x.ticket(h0,h1)),1)
  assert.equal((await s.inspect()).result,'qa_three_authority_equal_observation')
  await assert.rejects(s.high.advance(x.ticket(h0,h1)),/CAS rejected/)
})
test('a separate live high-water process detects rollback of BOTH old signed files',async t=>{
  const x=fixture(t),s=await x.launch()
  const h0=x.head(0,'c'.repeat(64)),h1=x.head(1,'d'.repeat(64))
  await s.wc.publish(x.ticket(null,h0))
  await s.fc.publish(x.ticket(null,h0))
  await s.high.advance(x.ticket(null,h0))
  const oldWitness=fs.readFileSync(path.join(x.witnessDir,'head.json'))
  const oldFloor=fs.readFileSync(path.join(x.floorDir,'floor.json'))
  await s.wc.publish(x.ticket(h0,h1))
  await s.fc.publish(x.ticket(h0,h1))
  await s.high.advance(x.ticket(h0,h1))
  await s.f.close();await s.w.close()
  fs.writeFileSync(path.join(x.witnessDir,'head.json'),oldWitness)
  fs.writeFileSync(path.join(x.floorDir,'floor.json'),oldFloor)
  const w=x.witness(),wu=await w.start()
  const f=x.floor(wu),fu=await f.start()
  // The original high-water child survives; original witness/floor endpoint
  // URLs changed, but the strict read-only gate pins the new two clients.
  const triple=createQaTripleAuthorityReconciler({
    ...x.shared,witnessUrl:wu,floorUrl:fu,highWaterUrl:s.high.url})
  await assert.rejects(triple.inspect(),/below signed external high-water/)
  assert.equal((await createPinnedQaHighWaterClient({
    ...x.shared,url:s.high.url}).latest()).sequence,1)
  await assert.rejects(s.high.advance(x.ticket(null,h0)),/CAS rejected/)
})
test('separate authority refuses advancing before BOTH signed witness and floor match',async t=>{
  const x=fixture(t),s=await x.launch()
  const h0=x.head(0,'e'.repeat(64)),h1=x.head(1,'f'.repeat(64))
  await assert.rejects(s.high.advance(x.ticket(null,h0)),/denied/)
  await s.wc.publish(x.ticket(null,h0))
  await assert.rejects(s.high.advance(x.ticket(null,h0)),/denied/)
  await s.fc.publish(x.ticket(null,h0))
  await s.high.advance(x.ticket(null,h0))
  await s.wc.publish(x.ticket(h0,h1))
  await assert.rejects(s.high.advance(x.ticket(h0,h1)),/Both independent/)
  assert.equal((await createPinnedQaHighWaterClient({
    ...x.shared,url:s.high.url}).latest()).sequence,0)
  assert.equal((await s.inspect()).result,'qa_three_authority_gap_requires_review')
  await s.fc.publish(x.ticket(h0,h1))
  await s.high.advance(x.ticket(h0,h1))
  assert.equal((await s.inspect()).result,'qa_three_authority_equal_observation')
})
test('denies corrupt pinned keys, untrusted endpoints and replayed signed nonce',async t=>{
  const x=fixture(t),s=await x.launch()
  const h0=x.head(0,'9'.repeat(64))
  await s.wc.publish(x.ticket(null,h0));await s.fc.publish(x.ticket(null,h0))
  await s.high.advance(x.ticket(null,h0))
  const wrong=keys()
  assert.throws(()=>createPinnedQaHighWaterClient({
    ...x.shared,url:'http://example.org/'}),/Unsafe/)
  assert.throws(()=>createPinnedQaHighWaterClient({
    ...x.shared,url:s.high.url,highWaterPublicKeyPem:pem(x.floorKey)
  }),/separation/)
  await assert.rejects(createPinnedQaHighWaterClient({
    ...x.shared,url:s.high.url,highWaterPublicKeyPem:pem(wrong)
  }).latest(),/Untrusted/)
  const recordedNonce=crypto.randomUUID()
  const captured=await new Promise((resolve,reject)=>{
    http.get(new URL('/high-water?nonce='+recordedNonce,s.high.url),res=>{
      let data='';res.on('data',v=>{data+=v})
      res.on('end',()=>{try{resolve(JSON.parse(data))}catch(error){reject(error)}})
    }).on('error',reject)
  })
  const fake=http.createServer((_req,res)=>{
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify(captured))
  })
  await new Promise(ok=>fake.listen(0,'127.0.0.1',ok))
  t.after(()=>{fake.closeAllConnections();fake.close()})
  await assert.rejects(createPinnedQaHighWaterClient({...x.shared,
    url:'http://127.0.0.1:'+fake.address().port+'/'}).latest(),
    /Untrusted or stale/)
})
test('unavailable high-water and lost volatile process state never imply approval',async t=>{
  const x=fixture(t),s=await x.launch()
  const h0=x.head(0,'1'.repeat(64))
  await s.wc.publish(x.ticket(null,h0));await s.fc.publish(x.ticket(null,h0))
  await s.high.advance(x.ticket(null,h0))
  s.high.child.kill('SIGKILL')
  await new Promise(ok=>s.high.child.once('exit',ok))
  await assert.rejects(s.inspect(),/unavailable/)
  const newHigh=await x.spawnHigh(s.wu,s.fu,x.highKey)
  // A new child, even with the SAME signing key, has lost its volatile
  // high-water. It must FAIL CLOSED, never silently approve a lower floor.
  await assert.rejects(createQaTripleAuthorityReconciler({
    ...x.shared,witnessUrl:s.wu,floorUrl:s.fu,
    highWaterUrl:newHigh.url}).inspect(),/denied/)
})

test('high-water rejects replay, mismatched signed world, invalid operator and competing same-parent updates',async t=>{
  const x=fixture(t),s=await x.launch()
  const h0=x.head(0,'0'.repeat(64)),h1=x.head(1,'1'.repeat(64))
  await s.wc.publish(x.ticket(null,h0));await s.fc.publish(x.ticket(null,h0))
  const bootstrap=x.ticket(null,h0)
  const outcomes=await Promise.allSettled([
    s.high.advance(bootstrap),s.high.advance(bootstrap)
  ])
  assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1)
  assert.equal(outcomes.filter(v=>v.status==='rejected').length,1)
  assert.equal((await createPinnedQaHighWaterClient({
    ...x.shared,url:s.high.url}).latest()).sequence,0)
  await s.wc.publish(x.ticket(h0,h1));await s.fc.publish(x.ticket(h0,h1))
  const wrongWorld=x.ticket(h0,h1)
  wrongWorld.payload.worldId='qa:foreign'
  await assert.rejects(s.high.advance(wrongWorld),/signature|Unsafe/)
  const rogue=keys()
  const signed=x.ticket(h0,h1)
  signed.signature=crypto.sign(null,Buffer.from(JSON.stringify(signed.payload)),
    rogue.privateKey).toString('base64url')
  await assert.rejects(s.high.advance(signed),/signature/)
  assert.equal((await createPinnedQaHighWaterClient({
    ...x.shared,url:s.high.url}).latest()).sequence,0)
  await s.high.advance(x.ticket(h0,h1))
  await assert.rejects(s.high.advance(x.ticket(h0,h1)),/CAS rejected/)
})

test('high-water changes between signed reads: triple diagnostic fails closed',async t=>{
  const x=fixture(t),s=await x.launch()
  const h0=x.head(0,'2'.repeat(64)),h1=x.head(1,'3'.repeat(64))
  await s.wc.publish(x.ticket(null,h0));await s.fc.publish(x.ticket(null,h0))
  await s.high.advance(x.ticket(null,h0))
  await s.wc.publish(x.ticket(h0,h1));await s.fc.publish(x.ticket(h0,h1))
  const target=new URL(s.wu)
  let changed=false
  const proxy=http.createServer(async(req,res)=>{
    try{
      if(!changed&&req.method==='GET'&&req.url.startsWith('/checkpoint?')){
        changed=true
        await s.high.advance(x.ticket(h0,h1))
      }
      const upstream=http.request({hostname:'127.0.0.1',
        port:Number(target.port),path:req.url,method:req.method,
        headers:req.headers},response=>{
        res.writeHead(response.statusCode,response.headers)
        response.pipe(res)
      })
      upstream.on('error',()=>res.destroy())
      req.pipe(upstream)
    }catch{res.destroy()}
  })
  await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok))
  t.after(()=>{proxy.closeAllConnections();proxy.close()})
  const proxyUrl='http://127.0.0.1:'+proxy.address().port+'/'
  const check=createQaTripleAuthorityReconciler({
    ...s.options,witnessUrl:proxyUrl})
  await assert.rejects(check.inspect(),/high-water changed during inspection/)
  assert.equal(changed,true)
  assert.equal((await check.inspect()).result,'qa_three_authority_equal_observation')
})
