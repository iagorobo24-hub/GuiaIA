'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const crypto=require('node:crypto')
const {spawn}=require('node:child_process')
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
