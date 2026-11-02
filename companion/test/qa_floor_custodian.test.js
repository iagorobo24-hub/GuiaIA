'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const crypto=require('node:crypto')
const http=require('node:http')
const {createQaCheckpointWitness}=require('../src/qa_checkpoint_witness')
const {createQaFloorCustodian}=require('../src/qa_floor_custodian')
const {createPinnedQaFloorClient}=require('../src/qa_floor_client')
const {createPinnedQaRemoteCheckpointClient}=require('../src/remote_checkpoint')
const {createQaIndependentRollbackVerifier}=require('../src/qa_independent_rollback_floor')
const worldId='qa:floor-custodian-integration'
const pair=()=>crypto.generateKeyPairSync('ed25519')
const pub=k=>k.publicKey.export({format:'pem',type:'spki'})
const fingerprint=k=>crypto.createHash('sha256')
  .update(k.publicKey.export({format:'der',type:'spki'})).digest('hex')
function setup(t){
  const witnessRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-remote-anchor-qa-'))
  const anchorRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-independent-floor-qa-'))
  fs.rmdirSync(witnessRoot);fs.rmdirSync(anchorRoot)
  const operator=pair(),witness=pair(),anchor=pair()
  const op=fingerprint(operator)
  const file=path.join(anchorRoot,'floor.json')
  const options=(witnessUrl,anchorUrl)=>({worldId,
    operatorPublicKeyPem:pub(operator),
    witnessPublicKeyPem:pub(witness),
    anchorPublicKeyPem:pub(anchor),url:witnessUrl,anchorUrl})
  const witnessServer=()=>createQaCheckpointWitness({
    directory:witnessRoot,worldId,operatorPublicKeyPem:pub(operator),
    witnessPrivateKey:witness.privateKey})
  const floorServer=witnessUrl=>createQaFloorCustodian({
    directory:anchorRoot,worldId,operatorPublicKeyPem:pub(operator),
    witnessPublicKeyPem:pub(witness),anchorPrivateKey:anchor.privateKey,
    witnessUrl})
  const head=(sequence,hash)=>({version:1,worldId,
    operatorFingerprint:op,sequence,registrySha256:hash})
  const ticket=(prev,next)=>{
    const now=Date.now()
    const payload={aud:'guiaia:checkpoint-advance:v1',worldId,
      operatorFingerprint:op,previousSequence:prev?.sequence??-1,
      previousSha256:prev?.registrySha256??null,
      sequence:next.sequence,registrySha256:next.registrySha256,
      nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+45000}
    return {payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),
      operator.privateKey).toString('base64url')}
  }
  t.after(()=>{
    fs.rmSync(witnessRoot,{recursive:true,force:true})
    fs.rmSync(anchorRoot,{recursive:true,force:true})
  })
  return {witnessRoot,anchorRoot,file,operator,witness,anchor,
    options,witnessServer,floorServer,head,ticket}
}
async function launch(t,f){
  const w=f.witnessServer(),wu=await w.start()
  const a=f.floorServer(wu),au=await a.start()
  t.after(async()=>{await a.close();await w.close()})
  const witness=createPinnedQaRemoteCheckpointClient(f.options(wu,au))
  const anchor=createPinnedQaFloorClient({...f.options(wu,au),url:au})
  const verifier=createQaIndependentRollbackVerifier(f.options(wu,au))
  return {w,wu,a,au,witness,anchor,verifier}
}
test('separate custodian signs a fresh floor only after witnessed operator CAS; persists restart',async t=>{
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'a'.repeat(64)),h1=f.head(1,'b'.repeat(64))
  await assert.rejects(s.anchor.latest(),/denied/)
  await assert.rejects(s.anchor.publish(f.ticket(null,h0)),/denied/)
  assert.equal(fs.existsSync(f.file),false)
  await s.witness.publish(f.ticket(null,h0))
  const floor0=await s.anchor.publish(f.ticket(null,h0))
  assert.equal(floor0.sequence,0)
  assert.equal(floor0.registrySha256,h0.registrySha256)
  assert.equal(fs.statSync(f.file).mode&0o777,0o600)
  assert.equal((await s.verifier.verifyLive()).anchoredSequence,0)
  await assert.rejects(s.anchor.publish(f.ticket(null,h0)),/denied/)
  await s.witness.publish(f.ticket(h0,h1))
  assert.equal((await s.verifier.verifyLive()).observedSequence,1)
  assert.equal((await s.verifier.verifyLive()).anchoredSequence,0)
  await s.anchor.publish(f.ticket(h0,h1))
  assert.equal((await s.verifier.verifyLive()).anchoredSequence,1)
  const stored=fs.readFileSync(f.file)
  await s.a.close()
  await assert.rejects(s.verifier.verifyLive(),/unavailable/)
  const revived=f.floorServer(s.wu),newUrl=await revived.start()
  t.after(()=>revived.close())
  const live=createQaIndependentRollbackVerifier(f.options(s.wu,newUrl))
  const result=await live.verifyLive()
  assert.equal(result.anchoredSequence,1)
  assert.deepEqual(fs.readFileSync(f.file),stored)
  await assert.rejects(createPinnedQaFloorClient({
    ...f.options(s.wu,newUrl),url:newUrl
  }).publish(f.ticket(h0,h1)),/denied/)
})
test('restored signed witness seq0 is rejected by independent custodian seq1',async t=>{
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'0'.repeat(64)),h1=f.head(1,'1'.repeat(64))
  await s.witness.publish(f.ticket(null,h0))
  await s.anchor.publish(f.ticket(null,h0))
  const old=fs.readFileSync(path.join(f.witnessRoot,'head.json'))
  await s.witness.publish(f.ticket(h0,h1))
  await s.anchor.publish(f.ticket(h0,h1))
  await s.w.close()
  fs.writeFileSync(path.join(f.witnessRoot,'head.json'),old)
  const restarted=f.witnessServer(),wu2=await restarted.start()
  t.after(()=>restarted.close())
  const v=createQaIndependentRollbackVerifier(f.options(wu2,s.au))
  await assert.rejects(v.verifyLive(),/floor disagreement/)
  const anchor=createPinnedQaFloorClient({...f.options(wu2,s.au),url:s.au})
  assert.equal((await anchor.latest()).sequence,1)
  await assert.rejects(anchor.publish(f.ticket(null,h0)),/denied/)
})
test('custodian rejects unverified forged future, concurrent same-parent, duplicate and wrong world advances',async t=>{
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'a'.repeat(64)),h1=f.head(1,'b'.repeat(64))
  await assert.rejects(s.anchor.publish(f.ticket(null,h0)),/denied/)
  await s.witness.publish(f.ticket(null,h0))
  const initial=f.ticket(null,h0)
  const simultaneous=await Promise.allSettled([
    s.anchor.publish(initial),s.anchor.publish(initial)
  ])
  assert.equal(simultaneous.filter(i=>i.status==='fulfilled').length,1)
  assert.equal(simultaneous.filter(i=>i.status==='rejected').length,1)
  await assert.rejects(s.anchor.publish(f.ticket(h0,h1)),/denied/)
  assert.equal((await s.anchor.latest()).sequence,0)
  await s.witness.publish(f.ticket(h0,h1))
  const invalid=f.ticket(h0,h1)
  invalid.payload.worldId='qa:another-world'
  await assert.rejects(s.anchor.publish(invalid),/signature|Unsafe/i)
  await s.anchor.publish(f.ticket(h0,h1))
  assert.equal((await s.anchor.latest()).sequence,1)
})
test('tampered persisted floor is rejected without resetting or rewriting the record',async t=>{
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'a'.repeat(64))
  await s.witness.publish(f.ticket(null,h0))
  await s.anchor.publish(f.ticket(null,h0))
  const actual=fs.readFileSync(f.file)
  const spoof={payload:{...JSON.parse(actual).payload,sequence:9},
    signature:JSON.parse(actual).signature}
  const corrupted=Buffer.from(JSON.stringify(spoof))
  fs.writeFileSync(f.file,corrupted)
  await assert.rejects(s.anchor.latest(),/denied/)
  await assert.rejects(s.verifier.verifyLive(),/denied/)
  await s.a.close()
  assert.throws(()=>f.floorServer(s.wu),/floor signature|Invalid/i)
  assert.deepEqual(fs.readFileSync(f.file),corrupted)
})
test('stale captured live floor response cannot replay a nonce; wrong anchor key denies',async t=>{
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'a'.repeat(64))
  await s.witness.publish(f.ticket(null,h0))
  await s.anchor.publish(f.ticket(null,h0))
  const forgedAnchor=pair()
  const wrong=createPinnedQaFloorClient({
    ...f.options(s.wu,s.au),url:s.au,anchorPublicKeyPem:pub(forgedAnchor)})
  await assert.rejects(wrong.latest(),/Untrusted/)
  assert.throws(()=>createPinnedQaFloorClient({
    ...f.options(s.wu,s.au),url:'http://example.com/'
  }),/Unsafe/)
  const recordedNonce=crypto.randomUUID()
  const captured=await new Promise((resolve,reject)=>{
    http.get(new URL('/floor?nonce='+recordedNonce,s.au),res=>{
      let b='';res.on('data',c=>{b+=c});res.on('end',()=>{
        try{resolve(JSON.parse(b))}catch(e){reject(e)}
      })
    }).on('error',reject)
  })
  const fake=http.createServer((_req,res)=>{
    res.setHeader('content-type','application/json')
    res.end(JSON.stringify(captured))
  })
  await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve))
  t.after(()=>{fake.closeAllConnections();fake.close()})
  const fakeUrl='http://127.0.0.1:'+fake.address().port+'/'
  const replay=createPinnedQaFloorClient({...f.options(s.wu,s.au),url:fakeUrl})
  await assert.rejects(replay.latest(),/Untrusted or stale/)
  const v=createQaIndependentRollbackVerifier(f.options(s.wu,fakeUrl))
  await assert.rejects(v.verifyLive(),/Untrusted or stale/)
})
test('own signed custodian floor rollback is undetectable without yet another independent anchor',async t=>{
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'a'.repeat(64)),h1=f.head(1,'b'.repeat(64))
  await s.witness.publish(f.ticket(null,h0))
  await s.anchor.publish(f.ticket(null,h0))
  const old=fs.readFileSync(f.file)
  await s.witness.publish(f.ticket(h0,h1))
  await s.anchor.publish(f.ticket(h0,h1))
  await s.a.close()
  fs.writeFileSync(f.file,old)
  const reopened=f.floorServer(s.wu),url=await reopened.start()
  t.after(()=>reopened.close())
  const read=createPinnedQaFloorClient({...f.options(s.wu,url),url})
  assert.equal((await read.latest()).sequence,0)
  const check=createQaIndependentRollbackVerifier(f.options(s.wu,url))
  assert.equal((await check.verifyLive()).observedSequence,1)
  assert.equal((await check.verifyLive()).anchoredSequence,0)
  // This weakness must stay documented; no production durability claim.
})

test('standalone floor executable survives process restart without witness private key',async t=>{
  const {spawn}=require('node:child_process')
  const f=setup(t)
  const configRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-floor-config-qa-'))
  t.after(()=>fs.rmSync(configRoot,{recursive:true,force:true}))
  const file=(name,data)=>{
    const p=path.join(configRoot,name)
    fs.writeFileSync(p,data,{flag:'wx',mode:0o600})
    return p
  }
  const operatorPublicKeyFile=file('operator.pem',pub(f.operator))
  const witnessPublicKeyFile=file('witness.pem',pub(f.witness))
  const anchorPrivateKeyFile=file('anchor.pem',
    f.anchor.privateKey.export({format:'pem',type:'pkcs8'}))
  const w=f.witnessServer(),wu=await w.start()
  t.after(()=>w.close())
  const configFile=file('config.json',JSON.stringify({version:1,
    sandboxOnly:true,worldId,directory:f.anchorRoot,
    operatorPublicKeyFile,witnessPublicKeyFile,anchorPrivateKeyFile,
    witnessUrl:wu}))
  const executable=path.resolve(__dirname,'../qa_floor_custodian.js')
  const children=[]
  async function start(){
    const child=spawn(process.execPath,[executable,'--qa-serve',configFile],
      {stdio:['ignore','pipe','pipe']})
    children.push(child)
    const url=await new Promise((resolve,reject)=>{
      let output='',err='',done=false
      const timeout=setTimeout(()=>finish(reject,Error('floor startup timed out')),5000)
      function finish(fn,val){
        if(done)return
        done=true;clearTimeout(timeout);fn(val)
      }
      child.stderr.on('data',v=>{err+=v.toString('utf8').slice(0,300)})
      child.once('close',code=>finish(reject,Error('floor exited '+code+': '+err)))
      child.stdout.on('data',part=>{
        output+=part.toString('utf8')
        if(output.length>2000)return finish(reject,Error('Unexpected floor stdout'))
        const line=output.split('\n').find(x=>x.includes('qa_floor_ready'))
        if(line){
          try{
            const ready=JSON.parse(line)
            assert.equal(ready.worldId,worldId)
            assert.equal(ready.sandboxOnly,true)
            finish(resolve,ready.url)
          }catch(error){finish(reject,error)}
        }
      })
    })
    return {child,url}
  }
  async function stop(child){
    if(child.exitCode!==null||child.signalCode!==null)return
    child.kill('SIGTERM')
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('floor shutdown timed out')),5000)
      child.once('close',code=>{
        clearTimeout(timer)
        code===0?resolve():reject(Error('floor exit '+code))
      })
    })
  }
  t.after(async()=>{for(const child of children)await stop(child)})
  const first=await start()
  const witness=createPinnedQaRemoteCheckpointClient(f.options(wu,first.url))
  const h0=f.head(0,'e'.repeat(64)),h1=f.head(1,'f'.repeat(64))
  await witness.publish(f.ticket(null,h0))
  const anchor=createPinnedQaFloorClient({
    ...f.options(wu,first.url),url:first.url})
  await anchor.publish(f.ticket(null,h0))
  await witness.publish(f.ticket(h0,h1))
  await anchor.publish(f.ticket(h0,h1))
  const persisted=fs.readFileSync(f.file)
  await stop(first.child)
  const second=await start()
  const live=createQaIndependentRollbackVerifier(f.options(wu,second.url))
  assert.equal((await live.verifyLive()).anchoredSequence,1)
  assert.deepEqual(fs.readFileSync(f.file),persisted)
  await assert.rejects(createPinnedQaFloorClient({
    ...f.options(wu,second.url),url:second.url
  }).publish(f.ticket(h0,h1)),/denied/)
  await stop(second.child)
  assert.equal(fs.existsSync(path.join(f.anchorRoot,'floor.lock')),false)
})

test('standalone custodian refuses lax keys, symlink configs and foreign credential directory',async t=>{
  const {spawnSync}=require('node:child_process')
  const f=setup(t)
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-floor-config-qa-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const write=(name,value,mode=0o600)=>{
    const p=path.join(root,name)
    fs.writeFileSync(p,value,{mode,flag:'wx'})
    return p
  }
  const operatorPublicKeyFile=write('operator.pem',pub(f.operator))
  const witnessPublicKeyFile=write('witness.pem',pub(f.witness))
  const anchorPrivateKeyFile=write('anchor.pem',
    f.anchor.privateKey.export({format:'pem',type:'pkcs8'}))
  const data={version:1,sandboxOnly:true,worldId,directory:f.anchorRoot,
    operatorPublicKeyFile,witnessPublicKeyFile,anchorPrivateKeyFile,
    witnessUrl:'http://127.0.0.1:19876/'}
  const config=write('config.json',JSON.stringify(data))
  const exe=path.resolve(__dirname,'../qa_floor_custodian.js')
  const run=file=>spawnSync(process.execPath,[exe,'--qa-serve',file],{
    encoding:'utf8',timeout:5000})
  const symlink=path.join(root,'symlink.json')
  fs.symlinkSync(config,symlink)
  assert.equal(run(symlink).status,2)
  const extra=write('extra.json',JSON.stringify({...data,production:true}))
  assert.equal(run(extra).status,2)
  const loose=write('loose.json',JSON.stringify(data),0o644)
  assert.equal(run(loose).status,2)
  const outsider=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-untrusted-qa-'))
  t.after(()=>fs.rmSync(outsider,{recursive:true,force:true}))
  const remoteKey=path.join(outsider,'remote.pem')
  fs.writeFileSync(remoteKey,pub(f.operator),{mode:0o600})
  const foreign=write('foreign.json',JSON.stringify({
    ...data,operatorPublicKeyFile:remoteKey}))
  assert.equal(run(foreign).status,2)
  assert.equal(fs.existsSync(f.anchorRoot),false)
})

test('SIGKILL of custodian leaves exclusive lock and fails closed rather than silently rewriting floor',async t=>{
  const {spawn}=require('node:child_process')
  const f=setup(t)
  const configRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-floor-config-qa-'))
  t.after(()=>fs.rmSync(configRoot,{recursive:true,force:true}))
  const file=(name,data)=>{
    const p=path.join(configRoot,name)
    fs.writeFileSync(p,data,{mode:0o600,flag:'wx'})
    return p
  }
  const w=f.witnessServer(),wu=await w.start()
  t.after(()=>w.close())
  const config=file('config.json',JSON.stringify({version:1,sandboxOnly:true,
    worldId,directory:f.anchorRoot,witnessUrl:wu,
    operatorPublicKeyFile:file('operator.pem',pub(f.operator)),
    witnessPublicKeyFile:file('witness.pem',pub(f.witness)),
    anchorPrivateKeyFile:file('anchor.pem',
      f.anchor.privateKey.export({format:'pem',type:'pkcs8'}))}))
  const exe=path.resolve(__dirname,'../qa_floor_custodian.js')
  const start=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[exe,'--qa-serve',config],
      {stdio:['ignore','pipe','pipe']})
    let buffer=''
    const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('timeout'))},5000)
    const finish=(fn,result)=>{clearTimeout(timer);fn(result)}
    child.once('close',code=>finish(reject,Error('custodian exit '+code)))
    child.stdout.on('data',part=>{
      buffer+=part.toString('utf8')
      const line=buffer.split('\n').find(v=>v.includes('qa_floor_ready'))
      if(line)finish(resolve,{child,url:JSON.parse(line).url})
    })
  })
  const first=await start()
  const witness=createPinnedQaRemoteCheckpointClient(f.options(wu,first.url))
  const h0=f.head(0,'a'.repeat(64))
  await witness.publish(f.ticket(null,h0))
  await createPinnedQaFloorClient({...f.options(wu,first.url),url:first.url})
    .publish(f.ticket(null,h0))
  const floorBytes=fs.readFileSync(f.file)
  first.child.kill('SIGKILL')
  await new Promise(resolve=>first.child.once('close',resolve))
  const lock=path.join(f.anchorRoot,'floor.lock')
  assert.equal(fs.existsSync(lock),true)
  await assert.rejects(createPinnedQaFloorClient({
    ...f.options(wu,first.url),url:first.url}).latest(),/unavailable/)
  const restart=spawn(process.execPath,[exe,'--qa-serve',config],
    {stdio:['ignore','pipe','pipe']})
  const code=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{restart.kill('SIGTERM');reject(Error('timeout'))},5000)
    restart.once('close',status=>{clearTimeout(timer);resolve(status)})
  })
  assert.equal(code,2)
  assert.equal(fs.existsSync(lock),true)
  assert.deepEqual(fs.readFileSync(f.file),floorBytes)
})

test('read-only reconciliation distinguishes equal from witness-ahead state without retry',async t=>{
  const {createQaFloorReconciler}=require('../src/qa_floor_reconciler')
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'a'.repeat(64)),h1=f.head(1,'b'.repeat(64))
  const reconciler=createQaFloorReconciler({
    ...f.options(s.wu,s.au),witnessUrl:s.wu})
  await assert.rejects(reconciler.inspect(),/denied/i)
  await s.witness.publish(f.ticket(null,h0))
  await s.anchor.publish(f.ticket(null,h0))
  const matched=await reconciler.inspect()
  assert.equal(matched.result,'qa_equal_observation')
  assert.equal(matched.requiresManualReview,false)
  assert.equal(matched.world_actions,false)
  assert.equal(matched.production_ready,false)
  assert.equal(matched.atomic_snapshot,false)
  await s.witness.publish(f.ticket(h0,h1))
  const pending=await reconciler.inspect()
  assert.equal(pending.result,'qa_witness_ahead_requires_review')
  assert.equal(pending.requiresManualReview,true)
  assert.equal(pending.floorSequence,0)
  assert.equal(pending.witnessSequence,1)
  assert.equal(pending.world_actions,false)
  assert.equal((await s.anchor.latest()).sequence,0,
    'observation must not advance the floor')
  await s.anchor.publish(f.ticket(h0,h1))
  const restored=await reconciler.inspect()
  assert.equal(restored.result,'qa_equal_observation')
  assert.equal(restored.witnessSequence,1)
  assert.equal(restored.floorSequence,1)
})

test('lost HTTP acknowledgment after committed floor write is reconciled without replay',async t=>{
  const {createQaFloorReconciler}=require('../src/qa_floor_reconciler')
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'1'.repeat(64)),h1=f.head(1,'2'.repeat(64))
  await s.witness.publish(f.ticket(null,h0))
  await s.anchor.publish(f.ticket(null,h0))
  await s.witness.publish(f.ticket(h0,h1))
  let dropped=0
  const target=new URL(s.au)
  const proxy=http.createServer((req,res)=>{
    const upstream=http.request({
      hostname:'127.0.0.1',port:Number(target.port),
      path:req.url,method:req.method,headers:req.headers
    },answer=>{
      const chunks=[]
      answer.on('data',c=>chunks.push(c))
      answer.on('end',()=>{
        if(req.method==='POST'&&answer.statusCode===200){
          dropped++
          res.socket?.destroy()
        }else{
          res.writeHead(answer.statusCode,answer.headers)
          res.end(Buffer.concat(chunks))
        }
      })
    })
    upstream.on('error',()=>res.destroy())
    req.pipe(upstream)
  })
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve))
  t.after(()=>{proxy.closeAllConnections();proxy.close()})
  const proxyUrl='http://127.0.0.1:'+proxy.address().port+'/'
  const interrupted=createPinnedQaFloorClient({
    ...f.options(s.wu,proxyUrl),url:proxyUrl})
  await assert.rejects(interrupted.publish(f.ticket(h0,h1)),/unavailable|deadline/i)
  assert.equal(dropped,1,'proxy must drop ACK only after committed 200')
  const current=await s.anchor.latest()
  assert.equal(current.sequence,1,'signed write must survive lost ACK')
  const recovered=await createQaFloorReconciler({
    ...f.options(s.wu,s.au),witnessUrl:s.wu}).inspect()
  assert.equal(recovered.result,'qa_equal_observation')
  assert.equal(recovered.world_actions,false)
  await assert.rejects(s.anchor.publish(f.ticket(h0,h1)),/denied/)
  assert.equal((await s.anchor.latest()).sequence,1)
})

test('custodian outage after witness advance remains fail closed until explicit floor update',async t=>{
  const {createQaFloorReconciler}=require('../src/qa_floor_reconciler')
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'3'.repeat(64)),h1=f.head(1,'4'.repeat(64))
  await s.witness.publish(f.ticket(null,h0))
  await s.anchor.publish(f.ticket(null,h0))
  await s.witness.publish(f.ticket(h0,h1))
  await s.a.close()
  await assert.rejects(createQaFloorReconciler({
    ...f.options(s.wu,s.au),witnessUrl:s.wu}).inspect(),/unavailable/i)
  const reopened=f.floorServer(s.wu),newUrl=await reopened.start()
  t.after(()=>reopened.close())
  const current=createQaFloorReconciler({
    ...f.options(s.wu,newUrl),witnessUrl:s.wu})
  const pending=await current.inspect()
  assert.equal(pending.result,'qa_witness_ahead_requires_review')
  assert.equal(pending.requiresManualReview,true)
  const manual=createPinnedQaFloorClient({
    ...f.options(s.wu,newUrl),url:newUrl})
  await manual.publish(f.ticket(h0,h1))
  assert.equal((await current.inspect()).result,'qa_equal_observation')
})

test('restoring both old signed states still defeats a same-disk floor: never claim durable anti-rollback',async t=>{
  const {createQaFloorReconciler}=require('../src/qa_floor_reconciler')
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'5'.repeat(64)),h1=f.head(1,'6'.repeat(64))
  await s.witness.publish(f.ticket(null,h0))
  await s.anchor.publish(f.ticket(null,h0))
  const oldWitness=fs.readFileSync(path.join(f.witnessRoot,'head.json'))
  const oldFloor=fs.readFileSync(f.file)
  await s.witness.publish(f.ticket(h0,h1))
  await s.anchor.publish(f.ticket(h0,h1))
  await s.a.close()
  await s.w.close()
  fs.writeFileSync(path.join(f.witnessRoot,'head.json'),oldWitness)
  fs.writeFileSync(f.file,oldFloor)
  const revivedWitness=f.witnessServer(),wu=await revivedWitness.start()
  t.after(()=>revivedWitness.close())
  const revivedFloor=f.floorServer(wu),au=await revivedFloor.start()
  t.after(()=>revivedFloor.close())
  const outcome=await createQaFloorReconciler({
    ...f.options(wu,au),witnessUrl:wu}).inspect()
  assert.equal(outcome.result,'qa_equal_observation')
  assert.equal(outcome.witnessSequence,0)
  assert.equal(outcome.floorSequence,0)
  assert.equal(outcome.production_ready,false)
  assert.equal(outcome.atomic_snapshot,false)
  assert.equal(outcome.world_actions,false)
})

test('reconciliation rejects same-sequence hash divergence between the two authorities',async t=>{
  const {createQaFloorReconciler}=require('../src/qa_floor_reconciler')
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'7'.repeat(64)),h1=f.head(1,'8'.repeat(64))
  await s.witness.publish(f.ticket(null,h0))
  await s.anchor.publish(f.ticket(null,h0))
  await s.witness.publish(f.ticket(h0,h1))
  await s.anchor.publish(f.ticket(h0,h1))
  await s.w.close()
  const altered=fs.readFileSync(path.join(f.witnessRoot,'head.json'))
  const obj=JSON.parse(altered)
  obj.head.registrySha256='9'.repeat(64)
  obj.signature=crypto.sign(null,Buffer.from(JSON.stringify(obj.head)),
    f.witness.privateKey).toString('base64url')
  fs.writeFileSync(path.join(f.witnessRoot,'head.json'),
    JSON.stringify(obj)+'\n')
  const revived=f.witnessServer(),wu=await revived.start()
  t.after(()=>revived.close())
  const reconciler=createQaFloorReconciler({
    ...f.options(wu,s.au),witnessUrl:wu})
  await assert.rejects(reconciler.inspect(),/disagree on checkpoint hash/)
})

test('floor moving between two signed snapshots forces reconciliation to fail closed',async t=>{
  const {createQaFloorReconciler}=require('../src/qa_floor_reconciler')
  const f=setup(t),s=await launch(t,f)
  const h0=f.head(0,'a'.repeat(64)),h1=f.head(1,'b'.repeat(64))
  await s.witness.publish(f.ticket(null,h0))
  await s.anchor.publish(f.ticket(null,h0))
  await s.witness.publish(f.ticket(h0,h1))
  const source=new URL(s.wu)
  let advanced=false
  const proxy=http.createServer(async(req,res)=>{
    try{
      if(!advanced&&req.method==='GET'&&req.url.startsWith('/checkpoint?')){
        advanced=true
        await s.anchor.publish(f.ticket(h0,h1))
      }
      const upstream=http.request({
        hostname:'127.0.0.1',port:Number(source.port),
        method:req.method,path:req.url,headers:req.headers
      },response=>{
        res.writeHead(response.statusCode,response.headers)
        response.pipe(res)
      })
      upstream.on('error',()=>res.destroy())
      req.pipe(upstream)
    }catch{res.destroy()}
  })
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve))
  t.after(()=>{proxy.closeAllConnections();proxy.close()})
  const proxyUrl='http://127.0.0.1:'+proxy.address().port+'/'
  const recon=createQaFloorReconciler({
    ...f.options(proxyUrl,s.au),witnessUrl:proxyUrl})
  await assert.rejects(recon.inspect(),/floor changed during reconciliation/)
  assert.equal(advanced,true)
  assert.equal((await s.anchor.latest()).sequence,1)
  assert.equal((await recon.inspect()).result,'qa_equal_observation')
})
