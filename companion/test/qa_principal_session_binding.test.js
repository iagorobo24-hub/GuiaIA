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
    event,connectionId,eventsFile}
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
