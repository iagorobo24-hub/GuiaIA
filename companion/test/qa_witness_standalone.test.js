'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const crypto=require('node:crypto')
const {spawn,spawnSync}=require('node:child_process')
const {createPinnedQaRemoteCheckpointClient}=require('../src/remote_checkpoint')

const worldId='qa:standalone-witness'
const pair=()=>crypto.generateKeyPairSync('ed25519')
const pem=x=>x.publicKey.export({format:'pem',type:'spki'})
function setup(t){
  const configRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-witness-config-qa-'))
  const witnessRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-remote-anchor-qa-'))
  fs.rmdirSync(witnessRoot)
  const operator=pair(),witness=pair()
  const privateFile=(name,data)=>{
    const file=path.join(configRoot,name)
    fs.writeFileSync(file,data,{flag:'wx',mode:0o600})
    return file
  }
  const pub=privateFile('operator-public.pem',pem(operator))
  const key=privateFile('witness-private.pem',
    witness.privateKey.export({format:'pem',type:'pkcs8'}))
  const configFile=privateFile('config.json',JSON.stringify({
    version:1,sandboxOnly:true,worldId,directory:witnessRoot,
    operatorPublicKeyFile:pub,witnessPrivateKeyFile:key
  }))
  const children=[]
  t.after(async()=>{
    for(const child of children){
      if(child.exitCode===null&&child.signalCode===null){
        child.kill('SIGTERM')
        await new Promise(resolve=>{
          if(child.exitCode!==null||child.signalCode!==null)return resolve()
          child.once('close',resolve)
        })
      }
    }
    fs.rmSync(configRoot,{recursive:true,force:true})
    fs.rmSync(witnessRoot,{recursive:true,force:true})
  })
  function start({config=configFile}={}){
    return new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[path.resolve(__dirname,'../qa_witness.js'),
        '--qa-serve',config],{
        cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe']})
      children.push(child)
      let output='',stderr='',settled=false
      const timeout=setTimeout(()=>fail(Error('QA independent witness did not start')),5500)
      const finish=(f,value)=>{
        if(settled)return
        settled=true;clearTimeout(timeout)
        f(value)
      }
      const fail=e=>{child.kill('SIGTERM');finish(reject,e)}
      child.stderr.on('data',part=>{stderr+=part.toString('utf8').slice(0,500)})
      child.once('error',fail)
      child.once('close',code=>fail(Error('Witness exited '+code+': '+stderr)))
      child.stdout.on('data',part=>{
        output+=part.toString('utf8')
        if(output.length>2048)return fail(Error('Unexpected witness stdout'))
        const line=output.split('\n').find(s=>s.includes('qa_witness_ready'))
        if(line){
          try{
            const state=JSON.parse(line)
            assert.equal(state.worldId,worldId)
            assert.equal(state.sandboxOnly,true)
            assert.match(state.url,/^http:\/\/127\.0\.0\.1:\d+\/$/)
            finish(resolve,{child,url:state.url})
          }catch(e){fail(e)}
        }
      })
    })
  }
  function client(url,override){
    return createPinnedQaRemoteCheckpointClient({url,worldId,
      operatorPublicKeyPem:pem(operator),
      witnessPublicKeyPem:override||pem(witness)})
  }
  const fingerprint=crypto.createHash('sha256').update(
    operator.publicKey.export({format:'der',type:'spki'})).digest('hex')
  const head=(sequence,hash)=>({version:1,worldId,
    operatorFingerprint:fingerprint,sequence,registrySha256:hash})
  const ticket=(prev,next,signer=operator.privateKey)=>{
    const issuedAt=Date.now()-1000
    const payload={aud:'guiaia:checkpoint-advance:v1',worldId,
      operatorFingerprint:fingerprint,
      previousSequence:prev===null?-1:prev.sequence,
      previousSha256:prev===null?null:prev.registrySha256,
      sequence:next.sequence,registrySha256:next.registrySha256,
      nonce:crypto.randomUUID(),issuedAt,expiresAt:issuedAt+45000}
    return {payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),
      signer).toString('base64url')}
  }
  const stop=async child=>{
    if(child.exitCode!==null||child.signalCode!==null)return
    child.kill('SIGTERM')
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error('QA witness did not shut down')),3500)
      child.once('close',code=>{clearTimeout(timeout)
        code===0?resolve():reject(Error('Witness exit '+code))})
    })
  }
  return {start,client,operator,witness,head,ticket,stop,configFile,
    privateFile,witnessRoot,configRoot}
}
async function assertNativeWindowsDenied(f){
  const child=spawn(process.execPath,[path.resolve(__dirname,'../qa_witness.js'),
    '--qa-serve',f.configFile],{stdio:['ignore','pipe','pipe']})
  let stderr=''
  child.stderr.on('data',part=>{stderr+=part.toString('utf8')})
  const code=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(Error('Native Windows QA guard hung'))},4500)
    child.once('error',error=>{clearTimeout(timeout);reject(error)})
    child.once('close',exit=>{clearTimeout(timeout);resolve(exit)})
  })
  assert.equal(code,2)
  assert.match(stderr,/Native Windows witness requires verified NTFS ACL isolation/)
  assert.equal(fs.existsSync(f.witnessRoot),false)
}
test('independent executable persists pinned witness, denies invalid signatures and survives restart',async t=>{
  const f=setup(t)
  if(process.platform==='win32')return assertNativeWindowsDenied(f)
  const first=await f.start(),remote=f.client(first.url)
  await assert.rejects(remote.latest(),/denied/)
  const start=f.head(0,'a'.repeat(64)),next=f.head(1,'b'.repeat(64))
  await assert.rejects(remote.publish(f.ticket(null,start,pair().privateKey)),/signature/)
  await remote.publish(f.ticket(null,start))
  await remote.publish(f.ticket(start,next))
  assert.equal(await remote.verifyLocal(next),true)
  await assert.rejects(remote.verifyLocal(start),/disagreement/)
  await f.stop(first.child)
  await assert.rejects(remote.latest(),/unavailable/)
  const second=await f.start()
  const restored=f.client(second.url)
  assert.equal(await restored.verifyLocal(next),true)
  await assert.rejects(restored.publish(f.ticket(start,next)),/denied/)
  await assert.rejects(f.client(second.url,pem(pair())).latest(),/signature/)
  await f.stop(second.child)
  assert.equal(fs.existsSync(path.join(f.witnessRoot,'witness.lock')),false)
})
test('independent executable denies unsafe credentials, unexpected keys and symlinked config',async t=>{
  const f=setup(t)
  if(process.platform==='win32')return assertNativeWindowsDenied(f)
  const config=JSON.parse(fs.readFileSync(f.configFile,'utf8'))
  const command=[path.resolve(__dirname,'../qa_witness.js'),'--qa-serve']
  const spawnDenied=async file=>{
    const child=spawn(process.execPath,[...command,file],{stdio:['ignore','pipe','pipe']})
    let output=''
    child.stderr.on('data',s=>{output+=s.toString('utf8')})
    const code=await new Promise(resolve=>child.once('close',resolve))
    assert.equal(code,2)
    assert.match(output,/QA witness denied/)
  }
  const rogue=path.join(f.configRoot,'rogue.json')
  fs.writeFileSync(rogue,JSON.stringify({...config,extra:'no'}),{mode:0o600})
  await spawnDenied(rogue)
  const lax=path.join(f.configRoot,'lax.json')
  fs.writeFileSync(lax,JSON.stringify(config),{mode:0o644})
  await spawnDenied(lax)
  const symlink=path.join(f.configRoot,'symlink.json')
  fs.symlinkSync(f.configFile,symlink)
  await spawnDenied(symlink)
  const wrong=path.join(f.configRoot,'wrong.json')
  fs.writeFileSync(wrong,JSON.stringify({...config,worldId:'production'}),{mode:0o600})
  await spawnDenied(wrong)
  assert.equal(fs.existsSync(f.witnessRoot),false)
})
test('independent witness keeps an exclusive lock and requires external private state for startup',async t=>{
  const f=setup(t)
  if(process.platform==='win32')return assertNativeWindowsDenied(f)
  const primary=await f.start()
  await assert.rejects(f.start(),/Witness exited|did not start/)
  await f.stop(primary.child)
  // Once initialized, its signed head must exist; missing state fails closed.
  const file=path.join(f.witnessRoot,'head.json')
  // Pre-bootstrapped witness has no signed head. Restart is refused as designed.
  await assert.rejects(f.start(),/Witness exited|did not start/)
  assert.equal(fs.existsSync(file),false)
})

// A deliberately incomplete POST with frequent body bytes must not hold the
// witness HTTP handler open beyond its absolute request deadline.
test('standalone witness closes slow-trickle POST bodies without applying state',async t=>{
  const f=setup(t)
  if(process.platform==='win32')return assertNativeWindowsDenied(f)
  const {child,url}=await f.start()
  const http=require('node:http')
  const began=Date.now()
  const elapsed=await new Promise((resolve,reject)=>{
    const req=http.request(new URL('/advance',url),{
      method:'POST',headers:{'content-type':'application/json'}
    })
    req.on('error',()=>{})
    req.on('response',res=>res.resume())
    const drip=setInterval(()=>req.write(' '),150)
    const safety=setTimeout(()=>req.end(),3400)
    req.once('close',()=>{
      clearInterval(drip);clearTimeout(safety)
      resolve(Date.now()-began)
    })
    req.write('{')
  })
  assert.ok(elapsed<2700,'dripping HTTP request exceeded QA deadline')
  assert.equal(fs.existsSync(path.join(f.witnessRoot,'head.json')),false)
  await f.stop(child)
})

// A signed durable head can survive SIGKILL, but cleanup of the old process
// lock must prove the old Linux PID+starttime+boot identity is gone.
test('explicit crash-lock recovery survives SIGKILL and retains the signed head without replay',async t=>{
  const f=setup(t)
  if(process.platform!=='linux')return
  const recoverFile=path.resolve(__dirname,'../qa_witness_recover.js')
  const recover=ack=>spawnSync(process.execPath,[recoverFile,
    '--qa-recover-crashed-lock',f.configFile,
    ...(ack?['--acknowledge-operator-stopped']:[])],
    {encoding:'utf8',timeout:5000})
  const first=await f.start()
  const client=f.client(first.url)
  const initial=f.head(0,'c'.repeat(64)),current=f.head(1,'d'.repeat(64))
  await client.publish(f.ticket(null,initial))
  await client.publish(f.ticket(initial,current))
  const lock=path.join(f.witnessRoot,'witness.lock')
  const headPath=path.join(f.witnessRoot,'head.json')
  const headBytes=fs.readFileSync(headPath)
  const oldLockBytes=fs.readFileSync(lock)
  const identity=JSON.parse(oldLockBytes)
  assert.equal(identity.pid,first.child.pid)
  assert.equal(identity.version,1)
  assert.match(identity.bootId,/^[0-9a-f-]{36}$/)
  assert.match(identity.startTicks,/^[0-9]+$/)
  assert.equal(recover(false).status,2,'missing explicit acknowledgment must deny')
  assert.equal(recover(true).status,2,'live owner must not lose lock')
  assert.deepEqual(fs.readFileSync(lock),oldLockBytes)
  first.child.kill('SIGKILL')
  await new Promise(resolve=>first.child.once('close',resolve))
  await assert.rejects(client.latest(),/unavailable/)
  await assert.rejects(f.start(),/Witness exited|did not start/)
  // An altered signed checkpoint forbids lock recovery even if PID is dead.
  fs.writeFileSync(headPath,'{}\n',{mode:0o600})
  const corrupt=recover(true)
  assert.equal(corrupt.status,2)
  assert.equal(fs.existsSync(lock),true)
  fs.writeFileSync(headPath,headBytes)
  const result=recover(true)
  assert.equal(result.status,0,result.stderr)
  const output=JSON.parse(result.stdout.trim().split('=')[1])
  assert.equal(output.result,'qa_crashed_witness_lock_recovered')
  assert.equal(output.sequence,1)
  assert.equal(output.world_actions,false)
  assert.equal(fs.existsSync(lock),false)
  assert.deepEqual(fs.readFileSync(headPath),headBytes)
  const second=await f.start()
  const restarted=f.client(second.url)
  assert.equal(await restarted.verifyLocal(current),true)
  await assert.rejects(restarted.publish(f.ticket(initial,current)),/denied/)
  await f.stop(second.child)
  assert.equal(recover(true).status,2,'clean shutdown left no stale lock')
})

test('legacy, malformed and symlinked QA locks cannot be reclaimed',async t=>{
  const f=setup(t)
  if(process.platform!=='linux')return
  const first=await f.start()
  const client=f.client(first.url),initial=f.head(0,'a'.repeat(64))
  await client.publish(f.ticket(null,initial))
  await f.stop(first.child)
  const lock=path.join(f.witnessRoot,'witness.lock')
  const recoverFile=path.resolve(__dirname,'../qa_witness_recover.js')
  const recover=()=>spawnSync(process.execPath,[recoverFile,
    '--qa-recover-crashed-lock',f.configFile,'--acknowledge-operator-stopped'],
    {encoding:'utf8',timeout:5000})
  fs.writeFileSync(lock,'',{mode:0o600})
  assert.equal(recover().status,2)
  assert.equal(fs.statSync(lock).size,0)
  fs.writeFileSync(lock,'{}\n')
  assert.equal(recover().status,2)
  assert.equal(fs.existsSync(lock),true)
  fs.unlinkSync(lock)
  fs.symlinkSync(path.join(f.witnessRoot,'head.json'),lock)
  assert.equal(recover().status,2)
  assert.equal(fs.lstatSync(lock).isSymbolicLink(),true)
  fs.unlinkSync(lock)
  const second=await f.start()
  await f.stop(second.child)
})

test('a pre-bootstrap SIGKILL cannot be turned into implicit identity enrollment',async t=>{
  const f=setup(t)
  if(process.platform!=='linux')return
  const first=await f.start()
  const lock=path.join(f.witnessRoot,'witness.lock')
  first.child.kill('SIGKILL')
  await new Promise(resolve=>first.child.once('close',resolve))
  assert.equal(fs.existsSync(path.join(f.witnessRoot,'head.json')),false)
  const result=spawnSync(process.execPath,[
    path.resolve(__dirname,'../qa_witness_recover.js'),
    '--qa-recover-crashed-lock',f.configFile,'--acknowledge-operator-stopped'],
    {encoding:'utf8',timeout:5000})
  assert.equal(result.status,2)
  assert.equal(result.stdout,'')
  assert.equal(fs.existsSync(lock),true)
})

test('two recovery operators cannot remove the same QA lock concurrently',async t=>{
  const f=setup(t)
  if(process.platform!=='linux')return
  const first=await f.start()
  const client=f.client(first.url),initial=f.head(0,'e'.repeat(64))
  await client.publish(f.ticket(null,initial))
  const lock=path.join(f.witnessRoot,'witness.lock')
  first.child.kill('SIGKILL')
  await new Promise(resolve=>first.child.once('close',resolve))
  const gate=path.join(f.witnessRoot,'.recovery.lock')
  fs.writeFileSync(gate,'occupied',{mode:0o600,flag:'wx'})
  const args=[path.resolve(__dirname,'../qa_witness_recover.js'),
    '--qa-recover-crashed-lock',f.configFile,'--acknowledge-operator-stopped']
  const denied=spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000})
  assert.equal(denied.status,2)
  assert.equal(fs.existsSync(lock),true)
  fs.unlinkSync(gate)
  const approved=spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000})
  assert.equal(approved.status,0,approved.stderr)
  assert.equal(fs.existsSync(lock),false)
  assert.equal(spawnSync(process.execPath,args,{encoding:'utf8',timeout:5000}).status,2)
})
