'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {openQaPrincipalRegistry}=require('../src/principal_enrollment')
const {createPrincipalRequest,approvePrincipalRequest,
  completePrincipalHandoff}=require('../src/offline_principal_handoff')
const {createPinnedQaServerBridgeAuthority}=require('../src/fabric_bridge_reader')
const {issueQaBoundPrincipalSession}=require('../src/qa_principal_session_binding')
const {verifySessionBundle}=require('../src/session_identity')
const pair=()=>crypto.generateKeyPairSync('ed25519')
const pem=k=>k.publicKey.export({format:'pem',type:'spki'})
const privatePem=k=>k.privateKey.export({format:'pem',type:'pkcs8'})
const sign=(p,k)=>({payload:p,signature:crypto.sign(null,
  Buffer.from(JSON.stringify(p)),k.privateKey).toString('base64url')})
const worldId='qa:real-fabric:25593',username='OwnerQA',botName='GuiaIA_QA'
const principalId='approved_qa_owner'
function setup(t){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-enrollment-qa-'))
  const bridgeFolder=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-session-qa-'))
  const operator=pair(),principal=pair(),server=pair()
  const dir=path.join(folder,'registry')
  const registry=openQaPrincipalRegistry(dir,{
    worldId,sandboxOnly:true,operatorPublicKeyPem:pem(operator)
  })
  t.after(()=>{registry.close();fs.rmSync(folder,{recursive:true,force:true});
    fs.rmSync(bridgeFolder,{recursive:true,force:true})})
  const request=createPrincipalRequest({worldId,principalId,
    principalPrivateKey:privatePem(principal)})
  const ticket=approvePrincipalRequest({request,operatorPrivateKey:privatePem(operator),
    expectedWorldId:worldId,reviewedPrincipalId:principalId,
    reviewedFingerprint:crypto.createHash('sha256').update(
      principal.publicKey.export({format:'der',type:'spki'})).digest('hex')})
  const handoff=completePrincipalHandoff({ticket,principalPrivateKey:privatePem(principal),
    operatorPublicKeyPem:pem(operator),expectedWorldId:worldId})
  registry.applySignedChange(handoff.ticket,handoff.consent)
  const connectionId=crypto.randomUUID(),challenge=crypto.randomBytes(24).toString('hex')
  const now=Date.now()
  const join={aud:'guiaia:server-connection:v1',worldId,connectionId,
    username,challenge,issuedAt:now-1000,expiresAt:now+44000}
  const eventsFile=path.join(bridgeFolder,'events.jsonl')
  const event=(name,p)=>fs.appendFileSync(eventsFile,
    JSON.stringify({event:name,...sign(p,server)})+'\n',{mode:0o600})
  event('join',join)
  const bridge=createPinnedQaServerBridgeAuthority(eventsFile,pem(server),worldId)
  const live={livePresence:async()=>({worldId,connectionId,connected:true,
    issuedAt:Date.now()})}
  const witness={verifyLocal:async head=>head.sequence===registry.exportCheckpoint().sequence}
  const config={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName,principalId,username,connectionId,
    principalPrivateKey:privatePem(principal),serverBridgePublicKeyPem:pem(server),
    registry,bridge,live,witness}
  return {config,registry,bridge,live,witness,join,server,operator,principal,
    event,connectionId,eventsFile,registryDir:dir}
}
const ready=x=>issueQaBoundPrincipalSession(x.config)
test('real signed Fabric event reader + independently enrolled private key + live proof + witness produce a scoped session, no grant',async t=>{
  const x=setup(t)
  const out=await ready(x)
  assert.equal(out.scope.worldId,worldId)
  assert.equal(out.scope.principalId,principalId)
  assert.equal(out.scope.connectionId,x.connectionId)
  assert.equal(out.scope.worldActionsEnabled,false)
  assert.equal(Object.keys(out.session).length,2)
  assert.equal(out.session.bridge.payload.challenge,x.join.challenge)
  assert.ok(out.scope.expiresAt<=Date.now()+20000)
  const trusted={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName,serverBridgePublicKeyPem:pem(x.server),
    trustedPrincipals:x.registry.trustedPrincipals(),
    isRevoked:id=>x.registry.isRevoked(id),
    activeConnection:id=>x.bridge.activeConnection(id)}
  assert.equal(verifySessionBundle(out.session,trusted).principalId,principalId)
  const revoked={aud:'guiaia:principal-revocation:v1',worldId,principalId,
    nonce:crypto.randomUUID(),issuedAt:Date.now()-1000,expiresAt:Date.now()+50000}
  x.registry.applySignedChange(sign(revoked,x.operator))
  assert.throws(()=>verifySessionBundle(out.session,trusted),/revoked/)
  await assert.rejects(()=>ready(x),/revoked/)
})

test('misbound principal private key, arbitrary principal or unsigned bridge is denied',async t=>{
  const x=setup(t)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    principalPrivateKey:privatePem(pair())}}),/pre-enrolled/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    principalId:'unapproved_friend'}}),/revoked|registry unavailable/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    worldId:'prod:real'}}),/Explicit QA/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    botName:'bad!'}}),/Explicit QA/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    username:'WrongUser'}}),/signed Fabric connection/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    serverBridgePublicKeyPem:pem(pair())}}),/signature/)
})

test('actual signed disconnect and expired server join cannot be used after acceptance',async t=>{
  const x=setup(t)
  x.event('disconnect',{...x.join,aud:'guiaia:server-disconnect:v1',
    issuedAt:Date.now(),expiresAt:Date.now()+45000})
  await assert.rejects(()=>ready(x),/signed Fabric|connection claim|Connection not live/)
})

test('fresh signed Fabric live challenge is required and must match exact connection ID',async t=>{
  const x=setup(t)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    live:{livePresence:async()=>({worldId,connectionId:x.connectionId,
      connected:false,issuedAt:Date.now()})}}}),/presence unavailable/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    live:{livePresence:async()=>({worldId,connectionId:crypto.randomUUID(),
      connected:true,issuedAt:Date.now()})}}}),/presence unavailable/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    live:{livePresence:async()=>({worldId,connectionId:x.connectionId,
      connected:true,issuedAt:Date.now()-2000})}}}),/presence unavailable/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    live:{livePresence:async()=>{throw Error('JVM unavailable')}}}}),/JVM unavailable/)
})

test('independent checkpoint absent, stale, mismatching or unreachable fails closed',async t=>{
  const x=setup(t)
  await assert.rejects(()=>ready({...x,config:{...x.config,witness:{verifyLocal:async()=>false}}}),
    /witness refused/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    witness:{verifyLocal:async()=>{throw Error('witness offline')}}}}),/witness offline/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    witness:null}}),/Explicit QA/)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    registry:{isRevoked:()=>false,trustedPrincipals:()=>({})}}}),/Explicit QA/)
})

test('revocation racing while remote witness waits prevents any signed session',async t=>{
  const x=setup(t)
  let signal
  const paused=new Promise(resolve=>{signal=resolve})
  const promise=ready({...x,config:{...x.config,
    witness:{verifyLocal:async()=>{await paused;return true}}}})
  await new Promise(resolve=>setImmediate(resolve))
  const revoke={aud:'guiaia:principal-revocation:v1',worldId,principalId,
    nonce:crypto.randomUUID(),issuedAt:Date.now()-1000,expiresAt:Date.now()+50000}
  x.registry.applySignedChange(sign(revoke,x.operator))
  signal()
  await assert.rejects(promise,/revoked/)
})

test('connection loss racing while independent witness awaits prevents signing',async t=>{
  const x=setup(t)
  let signal
  const paused=new Promise(resolve=>{signal=resolve})
  const promise=ready({...x,config:{...x.config,
    witness:{verifyLocal:async()=>{await paused;return true}}}})
  await new Promise(resolve=>setImmediate(resolve))
  x.event('disconnect',{...x.join,aud:'guiaia:server-disconnect:v1',
    issuedAt:Date.now(),expiresAt:Date.now()+45000})
  signal()
  await assert.rejects(promise,/connection|Fabric/)
})

test('old or malformed signed bridge evidence is denied with no private key exposure',async t=>{
  const x=setup(t)
  await assert.rejects(()=>ready({...x,config:{...x.config,
    connectionId:crypto.randomUUID()}}),/signed Fabric/)
  const before=fs.readFileSync(x.eventsFile,'utf8')
  fs.writeFileSync(x.eventsFile,before.replace('"OwnerQA"','"FakeUser"'),{mode:0o600})
  await assert.rejects(()=>ready(x),/Untrusted bridge event|signed Fabric/)
})

test('rotated signed Fabric connection challenge during witness wait fails closed',async t=>{
  const x=setup(t)
  let release
  const paused=new Promise(resolve=>{release=resolve})
  const issued=ready({...x,config:{...x.config,
    witness:{verifyLocal:async()=>{await paused;return true}}}})
  await new Promise(resolve=>setImmediate(resolve))
  const mutated={...x.join,challenge:crypto.randomBytes(24).toString('hex')}
  fs.writeFileSync(x.eventsFile,
    JSON.stringify({event:'join',...sign(mutated,x.server)})+'\n',{mode:0o600})
  release()
  await assert.rejects(issued,/connection changed/)
})

test('old validly signed but expired server session event cannot mint a new claim',async t=>{
  const x=setup(t),now=Date.now()
  const stale={...x.join,issuedAt:now-80000,expiresAt:now-35000}
  fs.writeFileSync(x.eventsFile,
    JSON.stringify({event:'join',...sign(stale,x.server)})+'\n',{mode:0o600})
  await assert.rejects(()=>ready(x),/signed Fabric/)
})

const {EventEmitter}=require('node:events')
const {Vec3}=require('vec3')
const {openMission}=require('../src/mission')
const {openDepositJournal}=require('../src/deposit')
const {createQaEnrolledOperatorRuntime}=require('../src/qa_operator_bootstrap')

class QaGoalNear{constructor(x,y,z,range){Object.assign(this,{x,y,z,range})}}
class QaGoalFollow{constructor(entity,distance){Object.assign(this,{entity,distance})}}
class QaMovements{constructor(){this.canDig=false}}
function integratedFixture(t){
  const x=setup(t)
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-operator-qa-'))
  const target={x:7,y:64,z:2},chest={x:4,y:64,z:3}
  const missionJournal=openMission(path.join(directory,'mission'),{
    sandboxOnly:true,ownerName:username,targets:[{...target,block:'oak_log'}]
  })
  const depositJournal=openDepositJournal(path.join(directory,'deposit'),{
    sandboxOnly:true,ownerName:username,chest,items:[{name:'oak_log',count:1}]
  })
  t.after(()=>{
    missionJournal.close()
    depositJournal.close()
    fs.rmSync(directory,{recursive:true,force:true})
  })
  let stock=0,deposited=0,mined=false,digs=0,transfers=0
  const bot=new EventEmitter()
  bot.username=botName
  bot.health=20
  bot.entity={position:new Vec3(2.5,64,2.5)}
  bot.players={[username]:{entity:{position:new Vec3(4,64,2.5)}}}
  bot.registry={itemsByName:{oak_log:{id:101}}}
  bot.inventory={items:()=>stock?[{name:'oak_log',type:101,count:stock}]:[]}
  bot.blockAt=pos=>{
    if(pos.x===7&&pos.y===64&&pos.z===2&&!mined)return {name:'oak_log'}
    if(pos.x===4&&pos.y===64&&pos.z===3)return {name:'chest'}
    return {name:'air'}
  }
  bot.canDigBlock=()=>true
  bot.dig=async()=>{digs++;mined=true;stock++}
  bot.stopDigging=()=>{}
  bot.clearControlStates=()=>{}
  bot.pathfinder={setMovements:()=>{},setGoal:()=>{},
    goto:async goal=>{bot.entity.position=new Vec3(goal.x,goal.y,goal.z)}}
  bot.openContainer=async()=>{
    const slots=new Array(63).fill(null)
    if(stock)slots[27]={name:'oak_log',count:stock}
    if(deposited)slots[0]={name:'oak_log',count:deposited}
    return {slots,inventoryStart:27,inventoryEnd:63,
      deposit:async(type,meta,count)=>{
        assert.equal(type,101)
        transfers++;stock-=count;deposited+=count
        slots[27]=stock?{name:'oak_log',count:stock}:null
        slots[0]={name:'oak_log',count:deposited}
      },close:()=>{}}
  }
  const times=()=>({nonce:crypto.randomUUID(),
    issuedAt:Date.now()-1000,expiresAt:Date.now()+15000})
  const binding={worldId,botName,ownerName:username,principalId,
    connectionId:x.connectionId,challenge:x.join.challenge}
  const grants={
    gather:[sign({aud:'guiaia:session-gather:v1',...binding,
      target,item:'oak_log',count:1,...times()},x.operator)],
    deposit:[sign({aud:'guiaia:session-deposit:v1',...binding,
      chest,item:'oak_log',count:1,...times()},x.operator)]
  }
  const approvedPlan={sandboxOnly:true,ownerName:username,
    missionId:missionJournal.view().missionId,
    planId:depositJournal.view().planId,
    targets:[{...target,block:'oak_log'}],items:[{name:'oak_log',count:1}],chest}
  const operatorFingerprint=crypto.createHash('sha256').update(
    x.operator.publicKey.export({format:'der',type:'spki'})).digest('hex')
  const identity={...x.config,witness:{
    operatorFingerprint,verifyLocal:head=>x.witness.verifyLocal(head)
  }}
  const options={bot,classes:{GoalNear:QaGoalNear,GoalFollow:QaGoalFollow,
    Movements:QaMovements},identity,
    operatorPublicKeyPem:pem(x.operator),
    ledgerDirectory:path.join(directory,'spent'),missionJournal,depositJournal,
    approvedPlan,grants}
  return {x,options,bot,missionJournal,depositJournal,
    observations:()=>({stock,deposited,digs,transfers}),
    nonceFiles:()=>fs.existsSync(options.ledgerDirectory)
      ?fs.readdirSync(options.ledgerDirectory):[]}
}

test('enrolled operator QA bootstrap executes authorized physical mission through the local console',async t=>{
  const f=integratedFixture(t)
  const running=await createQaEnrolledOperatorRuntime(f.options)
  assert.equal(running.scope.worldActionsEnabled,true)
  assert.equal(running.scope.actionScope,'independently_signed_qa_grants_only')
  assert.equal(running.scope.principalId,principalId)
  assert.equal((await running.operator.execute('estado')).ok,true)
  const result=await running.operator.execute('mision')
  assert.equal(result.ok,true,JSON.stringify(result))
  assert.deepEqual(f.observations(),{stock:0,deposited:1,digs:1,transfers:1})
  assert.equal(f.missionJournal.view().receipts.length,1)
  assert.equal(f.depositJournal.view().receipts.length,1)
  assert.equal(f.nonceFiles().length,2)
  assert.equal((await running.operator.execute('mision')).reason,'already_completed')
  assert.equal((await running.operator.execute('para')).ok,true)
})

test('integrated operator refuses unrelated grant issuer, witness and session principal before any world action',async t=>{
  const f=integratedFixture(t)
  await assert.rejects(
    createQaEnrolledOperatorRuntime({...f.options,
      operatorPublicKeyPem:pem(pair())}),/Operator signing key/)
  await assert.rejects(
    createQaEnrolledOperatorRuntime({...f.options,
      identity:{...f.options.identity,witness:{
        operatorFingerprint:'a'.repeat(64),verifyLocal:async()=>true}}}),
    /Operator signing key/)
  await assert.rejects(
    createQaEnrolledOperatorRuntime({...f.options,
      grants:{...f.options.grants,deposit:f.options.grants.gather}}),
    /deposit capability invalid/)
  await assert.rejects(
    createQaEnrolledOperatorRuntime({...f.options,
      identity:{...f.options.identity,principalPrivateKey:privatePem(pair())}}),
    /pre-enrolled/)
  assert.deepEqual(f.observations(),{stock:0,deposited:0,digs:0,transfers:0})
  assert.equal(f.nonceFiles().length,0)
})

test('integrated operator denies stale independent witness before opening runtime',async t=>{
  const f=integratedFixture(t)
  await assert.rejects(
    createQaEnrolledOperatorRuntime({...f.options,
      identity:{...f.options.identity,witness:{
        operatorFingerprint:f.options.identity.witness.operatorFingerprint,
        verifyLocal:async()=>false}}}),/witness refused/)
  assert.deepEqual(f.observations(),{stock:0,deposited:0,digs:0,transfers:0})
  assert.equal(f.missionJournal.view().phase,'ready')
})

const net=require('node:net')
const {execFile}=require('node:child_process')
const {createQaCheckpointWitness}=require('../src/qa_checkpoint_witness')
const {createPinnedQaRemoteCheckpointClient}=require('../src/remote_checkpoint')
function runQaCli(mode,file){
  return new Promise(resolve=>execFile(process.execPath,
    [path.resolve(__dirname,'../qa_operator.js'),mode,file],
    {timeout:7000,maxBuffer:32768},(error,stdout,stderr)=>
      resolve({exit:error?.code??0,stdout,stderr})))
}
test('standalone QA preflight verifies real separately signed TCP presence, HTTP witness, and durable registry with no bot',async t=>{
  const x=setup(t)
  const qaRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-operator-qa-'))
  const fabricRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-fabric-bridge-qa-'))
  const eventFile=path.join(fabricRoot,'events.jsonl')
  fs.copyFileSync(x.eventsFile,eventFile)
  fs.chmodSync(eventFile,0o600)
  const witnessKeys=pair()
  const witnessRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-remote-anchor-qa-'))
  fs.rmdirSync(witnessRoot)
  const witnessServer=createQaCheckpointWitness({
    directory:witnessRoot,worldId,
    operatorPublicKeyPem:pem(x.operator),
    witnessPrivateKey:witnessKeys.privateKey})
  const witnessUrl=await witnessServer.start()
  let connected=true
  const liveServer=net.createServer(socket=>{
    let request=''
    socket.on('data',b=>{
      request+=b.toString('utf8')
      if(!request.endsWith('\n'))return
      const [id,nonce]=request.trim().split(' ')
      const now=Date.now()
      const payload={aud:'guiaia:live-presence:v1',worldId,
        connectionId:id,nonce,connected,
        issuedAt:now,expiresAt:now+3000}
      socket.end(JSON.stringify(sign(payload,x.server))+'\n')
    })
  })
  await new Promise((resolve,reject)=>liveServer.listen(0,'127.0.0.1',
    error=>error?reject(error):resolve()))
  t.after(async()=>{
    await witnessServer.close()
    await new Promise(resolve=>liveServer.close(resolve))
    fs.rmSync(qaRoot,{force:true,recursive:true})
    fs.rmSync(fabricRoot,{force:true,recursive:true})
    fs.rmSync(witnessRoot,{force:true,recursive:true})
  })
  const checkpoint=x.registry.exportCheckpoint()
  assert.equal(checkpoint.sequence,1)
  const client=createPinnedQaRemoteCheckpointClient({
    url:witnessUrl,worldId,operatorPublicKeyPem:pem(x.operator),
    witnessPublicKeyPem:pem(witnessKeys)})
  async function advance(prev,after){
    const now=Date.now()
    const p={aud:'guiaia:checkpoint-advance:v1',worldId,
      operatorFingerprint:checkpoint.operatorFingerprint,
      previousSequence:prev?.sequence??-1,
      previousSha256:prev?.registrySha256??null,
      sequence:after.sequence,registrySha256:after.registrySha256,
      nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+30000}
    await client.publish(sign(p,x.operator))
  }
  const first={sequence:0,registrySha256:'0'.repeat(64)}
  await advance(null,first)
  await advance(first,checkpoint)
  const write=(file,value)=>fs.writeFileSync(path.join(qaRoot,file),
    value,{mode:0o600})
  write('owner.pem',privatePem(x.principal))
  write('operator.pem',pem(x.operator))
  write('server.pem',pem(x.server))
  write('witness.pem',pem(witnessKeys))
  const config={version:1,sandboxOnly:true,worldId,botName,
    username,principalId,connectionId:x.connectionId,
    eventsFile:eventFile,registryDirectory:x.registryDir,
    principalPrivateKeyFile:path.join(qaRoot,'owner.pem'),
    operatorPublicKeyFile:path.join(qaRoot,'operator.pem'),
    serverBridgePublicKeyFile:path.join(qaRoot,'server.pem'),
    witnessPublicKeyFile:path.join(qaRoot,'witness.pem'),
    witnessUrl,livePort:liveServer.address().port}
  const configFile=path.join(qaRoot,'config.json')
  fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600})
  // Both stores cannot be held by separate processes simultaneously.
  x.registry.close()
  const pass=await runQaCli('--qa-preflight',configFile)
  assert.equal(pass.exit,0,pass.stderr)
  assert.equal(pass.stderr,'')
  const output=JSON.parse(pass.stdout)
  assert.equal(output.result,'qa_session_preflight_passed')
  assert.equal(output.worldActionsEnabled,false)
  assert.equal(output.principalId,principalId)
  assert.equal(output.connectionId,x.connectionId)
  connected=false
  const disconnected=await runQaCli('--qa-preflight',configFile)
  assert.notEqual(disconnected.exit,0)
  assert.equal(disconnected.stdout,'')
  assert.match(disconnected.stderr,/denied/)
  connected=true
  // A different operator public key cannot unlock this registry.
  write('wrong-operator.pem',pem(pair()))
  fs.writeFileSync(configFile,JSON.stringify({...config,
    operatorPublicKeyFile:path.join(qaRoot,'wrong-operator.pem')}),{mode:0o600})
  const wrong=await runQaCli('--qa-preflight',configFile)
  assert.notEqual(wrong.exit,0)
  assert.equal(wrong.stdout,'')
  assert.doesNotMatch(wrong.stderr,/BEGIN PRIVATE KEY|owner\.pem/)
  fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600})
  // The action launcher never accepts piped commands as operator authority.
  const operConfig={...config,missionDirectory:path.join(qaRoot,'mission'),
    depositDirectory:path.join(qaRoot,'deposit'),
    spentDirectory:path.join(qaRoot,'spent'),
    approvedPlanFile:path.join(qaRoot,'plan.json'),
    grantsFile:path.join(qaRoot,'grants.json')}
  write('plan.json','{}')
  write('grants.json','{}')
  fs.writeFileSync(configFile,JSON.stringify(operConfig),{mode:0o600})
  const denied=await runQaCli('--qa-operate',configFile)
  assert.notEqual(denied.exit,0)
  assert.equal(denied.stdout,'')
  assert.match(denied.stderr,/local interactive TTY/)
})
