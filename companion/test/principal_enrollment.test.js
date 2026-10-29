'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const crypto=require('node:crypto')
const {openQaPrincipalRegistry}=require('../src/principal_enrollment')

function keys(){return crypto.generateKeyPairSync('ed25519')}
function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-enrollment-qa-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const operator=keys(),principal=keys()
  const worldId='guiaia:lab'
  const directory=path.join(root,'registry')
  const context={worldId,sandboxOnly:true,
    operatorPublicKeyPem:operator.publicKey.export({format:'pem',type:'spki'})}
  const open=()=>openQaPrincipalRegistry(directory,context)
  const publicKeyDer=principal.publicKey.export({format:'der',type:'spki'}).toString('base64url')
  function ticket({kind='enroll',id='friend_one',key=publicKeyDer,world=worldId,
                    expires=Date.now()+40000,nonce=crypto.randomUUID()}={}){
    const p={aud:kind==='enroll'?'guiaia:principal-enrollment:v1':'guiaia:principal-revocation:v1',
      worldId:world,principalId:id,nonce,issuedAt:expires-40000,expiresAt:expires}
    if(kind==='enroll')p.publicKeyDer=key
    const sign=crypto.sign(null,Buffer.from(JSON.stringify(p)),operator.privateKey).toString('base64url')
    return {payload:p,signature:sign}
  }
  function consent(s,signer=principal.privateKey){
    return crypto.sign(null,
      Buffer.from('guiaia:principal-consent:v1\n'+JSON.stringify(s.payload)),
      signer).toString('base64url')
  }
  return {root,directory,worldId,context,open,operator,principal,ticket,consent,publicKeyDer}
}
test('out-of-band operator signature AND principal possession both required; persists only public key',t=>{
  const x=setup(t),j=x.open(),s=x.ticket()
  const receipt=j.applySignedChange(s,x.consent(s))
  assert.equal(receipt.action,'enrolled')
  assert.match(j.trustedPrincipals().friend_one,/BEGIN PUBLIC KEY/)
  assert.deepEqual(Object.keys(j.trustedPrincipals()),['friend_one'])
  assert.equal(fs.statSync(x.directory).mode&0o777,0o700)
  assert.equal(fs.statSync(path.join(x.directory,'principals.json')).mode&0o777,0o600)
  j.close()
  const reopened=x.open()
  assert.equal(reopened.trustedPrincipals().friend_one,
    x.principal.publicKey.export({format:'pem',type:'spki'}))
  assert.equal(JSON.stringify(fs.readFileSync(path.join(x.directory,'principals.json'),'utf8')).includes('PRIVATE KEY'),false)
  reopened.close()
})
test('self-enrollment without an operator ticket cannot change registry',t=>{
  const x=setup(t),j=x.open(),s=x.ticket()
  assert.throws(()=>j.applySignedChange(null,null),/Malformed/)
  assert.throws(()=>j.applySignedChange(s,null),/possession/)
  assert.deepEqual(Object.keys(j.trustedPrincipals()),[])
  j.close()
})
test('wrong principal key, fake operator signature and tampered payload are denied',t=>{
  const x=setup(t),j=x.open(),s=x.ticket()
  assert.throws(()=>j.applySignedChange(s,x.consent(s,keys().privateKey)),/possession/)
  assert.throws(()=>j.applySignedChange({...s,signature:'A'.repeat(86)},x.consent(s)),/signature/)
  assert.throws(()=>j.applySignedChange({...s,payload:{...s.payload,principalId:'other'}},x.consent(s)),/signature/)
  assert.throws(()=>j.applySignedChange({...s,payload:{...s.payload,extra:'forbidden'}},x.consent(s)),/ticket/)
  assert.deepEqual(Object.keys(j.trustedPrincipals()),[])
  j.close()
})
test('expired or cross-world enrollment denied even when signed by operator',t=>{
  const x=setup(t),j=x.open()
  const expired=x.ticket({expires:Date.now()-100})
  assert.throws(()=>j.applySignedChange(expired,x.consent(expired)),/expired/)
  const other=x.ticket({world:'other:lab'})
  assert.throws(()=>j.applySignedChange(other,x.consent(other)),/wrong-world/)
  j.close()
})
test('single-use signed ticket nonce cannot be replayed across a restart',t=>{
  const x=setup(t),j=x.open(),s=x.ticket()
  j.applySignedChange(s,x.consent(s))
  assert.throws(()=>j.applySignedChange(s,x.consent(s)),/Replayed/)
  j.close()
  const reopened=x.open()
  assert.throws(()=>reopened.applySignedChange(s,x.consent(s)),/Replayed/)
  reopened.close()
})
test('revocation is signed, durable, immediate and denies future authentication',t=>{
  const x=setup(t),j=x.open(),s=x.ticket()
  j.applySignedChange(s,x.consent(s))
  const revoke=x.ticket({kind:'revoke'})
  assert.equal(j.applySignedChange(revoke).action,'revoked')
  assert.deepEqual(Object.keys(j.trustedPrincipals()),[])
  j.close()
  const reopened=x.open()
  assert.deepEqual(Object.keys(reopened.trustedPrincipals()),[])
  reopened.close()
})
test('revoked principal cannot be reassigned under same ID; use new approved ID',t=>{
  const x=setup(t),j=x.open(),s=x.ticket()
  j.applySignedChange(s,x.consent(s))
  j.applySignedChange(x.ticket({kind:'revoke'}))
  const attempt=x.ticket()
  assert.throws(()=>j.applySignedChange(attempt,x.consent(attempt)),/reuse/)
  const newId=x.ticket({id:'friend_two'})
  j.applySignedChange(newId,x.consent(newId))
  assert.deepEqual(Object.keys(j.trustedPrincipals()),['friend_two'])
  j.close()
})
test('unknown or repeated revocation is refused, including signed operator actions',t=>{
  const x=setup(t),j=x.open()
  assert.throws(()=>j.applySignedChange(x.ticket({kind:'revoke'})),/Unauthorized/)
  const s=x.ticket()
  j.applySignedChange(s,x.consent(s))
  j.applySignedChange(x.ticket({kind:'revoke'}))
  assert.throws(()=>j.applySignedChange(x.ticket({kind:'revoke'})),/Unauthorized/)
  j.close()
})
test('stale lock rejects automatic recovery; active lock rejects another writer',t=>{
  const x=setup(t),j=x.open()
  assert.throws(()=>x.open(),/EEXIST/)
  j.close()
  fs.writeFileSync(path.join(x.directory,'principals.lock'),'stale after simulated crash')
  assert.throws(()=>x.open(),/EEXIST/)
})
test('signed history tamper or wrong operator pin fails closed without leaving a lock',t=>{
  const x=setup(t),j=x.open(),s=x.ticket()
  j.applySignedChange(s,x.consent(s))
  j.close()
  const f=path.join(x.directory,'principals.json')
  const data=JSON.parse(fs.readFileSync(f,'utf8'))
  data.events[0].ticket.payload.principalId='attacker'
  fs.writeFileSync(f,JSON.stringify(data),{mode:0o600})
  assert.throws(()=>x.open(),/signature/)
  assert.equal(fs.existsSync(path.join(x.directory,'principals.lock')),false)
  const other={...x.context,operatorPublicKeyPem:keys().publicKey.export({format:'pem',type:'spki'})}
  assert.throws(()=>openQaPrincipalRegistry(x.directory,other),/Untrusted/)
})
test('registry refuses symlink on disk and wrong sandbox configuration',t=>{
  const x=setup(t)
  assert.throws(()=>openQaPrincipalRegistry('relative',x.context),/Explicit/)
  assert.throws(()=>openQaPrincipalRegistry(x.directory,{...x.context,sandboxOnly:false}),/Explicit/)
  const file=path.join(x.root,'outside.json')
  fs.writeFileSync(file,'{}')
  fs.mkdirSync(x.directory)
  fs.symlinkSync(file,path.join(x.directory,'principals.json'))
  assert.throws(()=>x.open(),/Symlink/)
})
test('unsupported RSA public key cannot be enrolled as Ed25519',t=>{
  const x=setup(t),j=x.open()
  const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048})
  const signed=x.ticket({key:rsa.publicKey.export({format:'der',type:'spki'}).toString('base64url')})
  assert.throws(()=>j.applySignedChange(signed,x.consent(signed)),/Invalid principal key encoding|Only Ed25519/)
  j.close()
})
test('world and authority-specific registry cannot be reused under different trust roots',t=>{
  const x=setup(t),j=x.open()
  j.close()
  const differentWorld={...x.context,worldId:'other:lab'}
  assert.throws(()=>openQaPrincipalRegistry(x.directory,differentWorld),/Untrusted/)
  const otherOperator={...x.context,operatorPublicKeyPem:keys().publicKey.export({format:'pem',type:'spki'})}
  assert.throws(()=>openQaPrincipalRegistry(x.directory,otherOperator),/Untrusted/)
})

test('post-approval caller mutation cannot change the durable in-memory trust mapping',t=>{
  const x=setup(t),j=x.open(),s=x.ticket()
  j.applySignedChange(s,x.consent(s))
  s.payload.principalId='forged_after_approval'
  s.signature='B'.repeat(86)
  assert.deepEqual(Object.keys(j.trustedPrincipals()),['friend_one'])
  j.close()
  const reopened=x.open()
  assert.deepEqual(Object.keys(reopened.trustedPrincipals()),['friend_one'])
  reopened.close()
})
test('cannot use arbitrary disk path or QA-looking symlink as a registry',t=>{
  const x=setup(t)
  assert.throws(()=>openQaPrincipalRegistry(x.root,x.context),/isolated QA/)
  assert.throws(()=>openQaPrincipalRegistry('/home/iagui/.guiaia',x.context),/isolated QA/)
  const target=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-target-'))
  const link=path.join(os.tmpdir(),'guiaia-enrollment-qa-'+crypto.randomBytes(8).toString('hex'))
  fs.symlinkSync(target,link)
  t.after(()=>{fs.unlinkSync(link);fs.rmSync(target,{recursive:true,force:true})})
  assert.throws(()=>openQaPrincipalRegistry(path.join(link,'registry'),x.context),/isolated QA/)
})
test('enrolled public key interoperates with existing sandbox session verifier; revocation denies it',t=>{
  const {verifySessionBundle}=require('../src/session_identity')
  const x=setup(t),j=x.open(),ticket=x.ticket()
  j.applySignedChange(ticket,x.consent(ticket))
  const server=keys(),connectionId=crypto.randomUUID(),
    challenge=crypto.randomBytes(24).toString('hex'),
    now=Date.now(),username='OwnerQA'
  const bridge={aud:'guiaia:server-connection:v1',worldId:x.worldId,
    connectionId,username,challenge,issuedAt:now,expiresAt:now+45000}
  const owner={aud:'guiaia:principal-proof:v1',worldId:x.worldId,
    connectionId,principalId:'friend_one',challenge,issuedAt:now,expiresAt:now+45000}
  const sign=(payload,key)=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),key).toString('base64url')})
  const bundle={bridge:sign(bridge,server.privateKey),owner:sign(owner,x.principal.privateKey)}
  function authority(){
    return {sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
      worldId:x.worldId,botName:'GuiaIA_QA',
      trustedPrincipals:j.trustedPrincipals(),
      serverBridgePublicKeyPem:server.publicKey.export({format:'pem',type:'spki'}),
      activeConnection:id=>id===connectionId?{
        worldId:x.worldId,connectionId:id,username,connected:true}:null,
      isRevoked:principalId=>j.isRevoked(principalId)}
  }
  const snapshotBeforeRevocation=authority()
  assert.equal(verifySessionBundle(bundle,snapshotBeforeRevocation).principalId,'friend_one')
  j.applySignedChange(x.ticket({kind:'revoke'}))
  assert.throws(()=>verifySessionBundle(bundle,snapshotBeforeRevocation),/revoked/)
  assert.throws(()=>verifySessionBundle(bundle,authority()),/identity or scope/)
  j.close()
})

test('pinned signed bridge plus durable enrollment denies revoked and disconnected actions before world mutation',async t=>{
  const {EventEmitter}=require('node:events')
  const {createPinnedQaServerBridgeAuthority}=require('../src/fabric_bridge_reader')
  const {createQaSessionActionGateway}=require('../src/session_identity')
  const x=setup(t),registry=x.open()
  const bridgeKey=keys(),worldId=x.worldId
  const connectionId=crypto.randomUUID(),challenge=crypto.randomBytes(24).toString('hex')
  const now=Date.now(),chest={x:4,y:64,z:3}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-bridge-fixture-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const eventsFile=path.join(root,'events.jsonl')
  const bridgePub=bridgeKey.publicKey.export({format:'pem',type:'spki'})
  const sign=(payload,privateKey)=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),privateKey).toString('base64url')})
  const br={aud:'guiaia:server-connection:v1',worldId,connectionId,
    username:'OwnerQA',challenge,issuedAt:now,expiresAt:now+45000}
  const append=(event,p)=>fs.appendFileSync(eventsFile,
    JSON.stringify({event,...sign(p,bridgeKey.privateKey)})+'\n',{mode:0o600})
  append('join',br)
  const source=createPinnedQaServerBridgeAuthority(eventsFile,bridgePub,worldId)
  assert.equal(source.joinProof(connectionId).payload.connectionId,connectionId)
  const valid=x.ticket()
  registry.applySignedChange(valid,x.consent(valid))
  let opened=0
  const bot=new EventEmitter()
  Object.assign(bot,{
    username:'GuiaIA_QA',health:20,
    entity:{position:{x:2,y:64,z:3}},
    players:{OwnerQA:{entity:{position:{x:2,y:64,z:3}}}},
    blockAt:()=>({name:'chest'}),
    openContainer:async()=>{opened++;throw Error('Forbidden preauthorization world mutation')},
    inventory:{items:()=>[{name:'birch_log',count:1}]},
    registry:{itemsByName:{birch_log:{id:31}}}
  })
  const authority=()=>({sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName:'GuiaIA_QA',serverBridgePublicKeyPem:bridgePub,
    trustedPrincipals:registry.trustedPrincipals(),
    operatorPublicKeyPem:x.operator.publicKey.export({format:'pem',type:'spki'}),
    ledgerDirectory:path.join(root,'spent'),
    activeConnection:id=>source.activeConnection(id),
    isRevoked:id=>registry.isRevoked(id)})
  const session=(id,key)=>({
    bridge:source.joinProof(connectionId),
    owner:sign({aud:'guiaia:principal-proof:v1',worldId,connectionId,
      principalId:id,challenge,issuedAt:now,expiresAt:now+45000},key)
  })
  const grant=id=>sign({aud:'guiaia:session-deposit:v1',worldId,
    botName:'GuiaIA_QA',ownerName:'OwnerQA',principalId:id,connectionId,
    challenge,chest,item:'birch_log',count:1,nonce:crypto.randomUUID(),
    issuedAt:now,expiresAt:now+45000},x.operator.privateKey)
  const gateway=createQaSessionActionGateway(bot,authority())
  const revokedAction=gateway.createDeposit(
    session('friend_one',x.principal.privateKey),grant('friend_one'))
  assert.equal(opened,0)
  registry.applySignedChange(x.ticket({kind:'revoke'}))
  assert.equal(source.activeConnection(connectionId).connected,true)
  await assert.rejects(revokedAction.depositOne(),/revoked/)
  assert.equal(opened,0)
  const replacement=keys()
  const enrollSecond=x.ticket({id:'friend_two',
    key:replacement.publicKey.export({format:'der',type:'spki'}).toString('base64url')})
  registry.applySignedChange(enrollSecond,x.consent(enrollSecond,replacement.privateKey))
  const refreshed=createQaSessionActionGateway(bot,authority())
  const disconnectAction=refreshed.createDeposit(
    session('friend_two',replacement.privateKey),grant('friend_two'))
  const dc={...br,aud:'guiaia:server-disconnect:v1'}
  append('disconnect',dc)
  assert.equal(source.activeConnection(connectionId),null)
  await assert.rejects(disconnectAction.depositOne(),/live matching connection/)
  assert.equal(opened,0)
  assert.equal(fs.existsSync(path.join(root,'spent')),false)
  registry.close()
})

test('opt-in live-presence gate rejects unavailable or stale server and revocation during query before nonce reservation',async t=>{
  const {EventEmitter}=require('node:events')
  const {createQaSessionActionGateway}=require('../src/session_identity')
  const x=setup(t),registry=x.open(),ticket=x.ticket()
  registry.applySignedChange(ticket,x.consent(ticket))
  const bridge=keys()
  const worldId=x.worldId,connectionId=crypto.randomUUID()
  const challenge=crypto.randomBytes(24).toString('hex')
  const now=Date.now()
  const sign=(payload,key)=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),key).toString('base64url')})
  const b={aud:'guiaia:server-connection:v1',worldId,connectionId,
    username:'OwnerQA',challenge,issuedAt:now-1000,expiresAt:now+44000}
  const o={aud:'guiaia:principal-proof:v1',worldId,connectionId,
    principalId:'friend_one',challenge,issuedAt:now-1000,expiresAt:now+44000}
  const session={bridge:sign(b,bridge.privateKey),owner:sign(o,x.principal.privateKey)}
  const scope=()=>sign({aud:'guiaia:session-deposit:v1',
    worldId,botName:'GuiaIA_QA',ownerName:'OwnerQA',principalId:'friend_one',
    connectionId,challenge,chest:{x:4,y:64,z:3},item:'birch_log',count:1,
    nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+44000},
    x.operator.privateKey)
  let touched=0
  const bot=new EventEmitter()
  Object.assign(bot,{username:'GuiaIA_QA',inventory:{items:()=>[]},
    blockAt:()=>{touched++;throw Error('world access')},
    openContainer:()=>{touched++;throw Error('world access')}})
  const ledgerDirectory=path.join(x.root,'spent')
  const base={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName:'GuiaIA_QA',serverBridgePublicKeyPem:bridge.publicKey.export({format:'pem',type:'spki'}),
    operatorPublicKeyPem:x.operator.publicKey.export({format:'pem',type:'spki'}),
    trustedPrincipals:registry.trustedPrincipals(),
    activeConnection:()=>({worldId,connectionId,username:'OwnerQA',connected:true}),
    isRevoked:id=>registry.isRevoked(id),requireLivePresence:true,ledgerDirectory}
  const adapter=livePresence=>createQaSessionActionGateway(bot,{...base,livePresence})
    .createDeposit(session,scope())
  await assert.rejects(adapter(async()=>{throw Error('Live Fabric query unavailable')}).depositOne(),
    /Live Fabric query unavailable/)
  await assert.rejects(adapter(async()=>({
    worldId,connectionId,connected:true,issuedAt:Date.now()-5000})).depositOne(),
    /Current signed Fabric live presence unavailable/)
  await assert.rejects(adapter(async()=>{
    registry.applySignedChange(x.ticket({kind:'revoke'}))
    return {worldId,connectionId,connected:true,issuedAt:Date.now()}
  }).depositOne(),/revoked/)
  assert.equal(touched,0)
  assert.equal(fs.existsSync(ledgerDirectory),false)
  registry.close()
})

test('revocation cannot disappear by restoring ONLY the old signed registry file, even during active session',t=>{
  const x=setup(t),registry=x.open(),f=path.join(x.directory,'principals.json')
  const ticket=x.ticket()
  registry.applySignedChange(ticket,x.consent(ticket))
  const older=fs.readFileSync(f)
  registry.applySignedChange(x.ticket({kind:'revoke'}))
  assert.equal(registry.isRevoked('friend_one'),true)
  const newer=fs.readFileSync(f)
  fs.writeFileSync(f,older)
  assert.throws(()=>registry.isRevoked('friend_one'),/rollback|checkpoint/i)
  assert.throws(()=>registry.trustedPrincipals(),/poisoned/)
  registry.close()
  assert.throws(()=>x.open(),/rollback|checkpoint/i)
  assert.equal(fs.existsSync(path.join(x.directory,'principals.lock')),false)
  fs.writeFileSync(f,newer)
  const reopened=x.open()
  assert.equal(reopened.isRevoked('friend_one'),true)
  reopened.close()
})

test('checkpoint head rollback and checkpoint removal both fail closed',t=>{
  const x=setup(t),reg=x.open(),a=path.join(x.root,'checkpoint','anchor.json')
  const ticket=x.ticket()
  reg.applySignedChange(ticket,x.consent(ticket))
  const old=fs.readFileSync(a)
  reg.applySignedChange(x.ticket({kind:'revoke'}))
  const latest=fs.readFileSync(a)
  reg.close()
  fs.writeFileSync(a,old)
  assert.throws(()=>x.open(),/rollback|checkpoint/i)
  fs.writeFileSync(a,latest)
  fs.rmSync(a)
  assert.throws(()=>x.open(),/Missing independent anti-rollback checkpoint/)
  assert.equal(fs.existsSync(path.join(x.directory,'principals.lock')),false)
})

test('a missing registry with an old checkpoint cannot silently initialize a fresh whitelist',t=>{
  const x=setup(t),reg=x.open(),s=x.ticket()
  reg.applySignedChange(s,x.consent(s))
  reg.close()
  fs.rmSync(path.join(x.directory,'principals.json'))
  assert.throws(()=>x.open(),/Orphan anti-rollback checkpoint/)
  assert.equal(fs.existsSync(path.join(x.directory,'principals.lock')),false)
})

test('checkpoint path and permissions cannot be redirected to public files',t=>{
  const x=setup(t),reg=x.open()
  reg.close()
  const a=path.join(x.root,'checkpoint','anchor.json')
  const original=fs.readFileSync(a)
  const other=path.join(x.root,'external.json')
  fs.writeFileSync(other,original)
  fs.rmSync(a)
  fs.symlinkSync(other,a)
  assert.throws(()=>x.open(),/Symlink anti-rollback/)
  fs.rmSync(a)
  fs.writeFileSync(a,original,{mode:0o600})
  fs.chmodSync(a,0o644)
  assert.throws(()=>x.open(),/Unsafe checkpoint/)
  fs.chmodSync(a,0o600)
  fs.chmodSync(path.join(x.root,'checkpoint'),0o755)
  assert.throws(()=>x.open(),/checkpoint directory/)
  assert.equal(fs.existsSync(path.join(x.directory,'principals.lock')),false)
})

test('simulated crash between registry save and checkpoint commit poisons writer and refuses restart',t=>{
  const x=setup(t),reg=x.open(),s=x.ticket()
  reg.applySignedChange(s,x.consent(s))
  const originalRename=fs.renameSync
  let injected=false
  fs.renameSync=function(from,to){
    if(String(to).endsWith('/checkpoint/anchor.json') && !injected){
      injected=true;throw Error('QA simulated checkpoint fsync/rename failure')
    }
    return originalRename.apply(this,arguments)
  }
  try{
    assert.throws(()=>reg.applySignedChange(x.ticket({kind:'revoke'})),/simulated checkpoint/)
  }finally{fs.renameSync=originalRename}
  assert.equal(injected,true)
  assert.throws(()=>reg.isRevoked('friend_one'),/poisoned/)
  reg.close()
  assert.throws(()=>x.open(),/rollback|checkpoint/i)
  assert.equal(fs.existsSync(path.join(x.directory,'principals.lock')),false)
})

test('unprivileged local checkpoint is NOT an external immutable anchor: coherent dual rollback remains possible',t=>{
  const x=setup(t),reg=x.open(),s=x.ticket()
  reg.applySignedChange(s,x.consent(s))
  const f=path.join(x.directory,'principals.json')
  const a=path.join(x.root,'checkpoint','anchor.json')
  const oldRegistry=fs.readFileSync(f),oldAnchor=fs.readFileSync(a)
  reg.applySignedChange(x.ticket({kind:'revoke'}))
  reg.close()
  // Explicitly records the security limitation: possession of both files
  // permits rollback. Production requires independent trusted high-water mark.
  fs.writeFileSync(f,oldRegistry)
  fs.writeFileSync(a,oldAnchor)
  const restored=x.open()
  assert.equal(restored.isRevoked('friend_one'),false)
  restored.close()
})

test('externally trusted checkpoint detects a full, coherent dual-file rollback',t=>{
  const x=setup(t),j=x.open(),s=x.ticket()
  j.applySignedChange(s,x.consent(s))
  const f=path.join(x.directory,'principals.json')
  const a=path.join(x.root,'checkpoint','anchor.json')
  const oldRegistry=fs.readFileSync(f),oldAnchor=fs.readFileSync(a)
  j.applySignedChange(x.ticket({kind:'revoke'}))
  // This reference must be kept off-device by a trusted operator. For QA the
  // caller retains it independently in memory, outside files being restored.
  const externalCheckpoint=j.exportCheckpoint()
  const newRegistry=fs.readFileSync(f),newAnchor=fs.readFileSync(a)
  assert.equal(externalCheckpoint.sequence,2)
  assert.equal(Object.isFrozen(externalCheckpoint),true)
  j.close()
  fs.writeFileSync(f,oldRegistry)
  fs.writeFileSync(a,oldAnchor)
  assert.throws(()=>openQaPrincipalRegistry(x.directory,{
    ...x.context,externallyPinnedCheckpoint:externalCheckpoint
  }),/Externally pinned principal checkpoint mismatch/)
  assert.equal(fs.existsSync(path.join(x.directory,'principals.lock')),false)
  fs.writeFileSync(f,newRegistry)
  fs.writeFileSync(a,newAnchor)
  const restored=openQaPrincipalRegistry(x.directory,{
    ...x.context,externallyPinnedCheckpoint:externalCheckpoint
  })
  assert.equal(restored.isRevoked('friend_one'),true)
  restored.close()
})

test('stale or tampered externally trusted checkpoint cannot silently lower revocation floor',t=>{
  const x=setup(t),j=x.open(),s=x.ticket()
  j.applySignedChange(s,x.consent(s))
  const stale=j.exportCheckpoint()
  j.applySignedChange(x.ticket({kind:'revoke'}))
  j.close()
  assert.throws(()=>openQaPrincipalRegistry(x.directory,{
    ...x.context,externallyPinnedCheckpoint:stale}),/Externally pinned/)
  assert.throws(()=>openQaPrincipalRegistry(x.directory,{
    ...x.context,externallyPinnedCheckpoint:{...stale,sequence:2,registrySha256:'0'.repeat(64)}
  }),/Externally pinned/)
  assert.equal(fs.existsSync(path.join(x.directory,'principals.lock')),false)
})

test('independent signed witness catches coherent local rollback before a granted chest action',async t=>{
  const {EventEmitter}=require('node:events')
  const {createQaCheckpointWitness}=require('../src/qa_checkpoint_witness')
  const {createPinnedQaRemoteCheckpointClient}=require('../src/remote_checkpoint')
  const {createQaSessionActionGateway}=require('../src/session_identity')
  const x=setup(t)
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-remote-anchor-qa-'))
  fs.rmdirSync(root)
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const witnessKeys=keys()
  const witness=createQaCheckpointWitness({
    directory:root,worldId:'qa:registry-witness',
    operatorPublicKeyPem:x.context.operatorPublicKeyPem,
    witnessPrivateKey:witnessKeys.privateKey
  })
  const url=await witness.start()
  t.after(()=>witness.close())
  // Separate QA world for operator checkpoint tickets.
  const worldId='qa:registry-witness'
  const registryContext={...x.context,worldId}
  const registry=openQaPrincipalRegistry(x.directory,registryContext)
  const client=createPinnedQaRemoteCheckpointClient({
    url,worldId,operatorPublicKeyPem:x.context.operatorPublicKeyPem,
    witnessPublicKeyPem:witnessKeys.publicKey.export({format:'pem',type:'spki'})
  })
  const operatorFingerprint=client.operatorFingerprint
  const advance=(before,after)=>{
    const now=Date.now()
    const payload={aud:'guiaia:checkpoint-advance:v1',worldId,operatorFingerprint,
      previousSequence:before?before.sequence:-1,
      previousSha256:before?before.registrySha256:null,
      sequence:after.sequence,registrySha256:after.registrySha256,
      nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+30000}
    return {payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),
      x.operator.privateKey).toString('base64url')}
  }
  const initial=registry.exportCheckpoint()
  await client.publish(advance(null,initial))
  const enroll=(()=>{
    const now=Date.now()
    const payload={aud:'guiaia:principal-enrollment:v1',worldId,
      principalId:'friend_one',nonce:crypto.randomUUID(),issuedAt:now-1000,
      expiresAt:now+30000,publicKeyDer:x.publicKeyDer}
    return {payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),
      x.operator.privateKey).toString('base64url')}
  })()
  registry.applySignedChange(enroll,x.consent(enroll))
  const enrolled=registry.exportCheckpoint()
  await client.publish(advance(initial,enrolled))
  const f=path.join(x.directory,'principals.json')
  const anchor=path.join(x.root,'checkpoint','anchor.json')
  const oldFiles=[fs.readFileSync(f),fs.readFileSync(anchor)]
  const revocation=(()=>{
    const now=Date.now()
    const payload={aud:'guiaia:principal-revocation:v1',worldId,
      principalId:'friend_one',nonce:crypto.randomUUID(),
      issuedAt:now-1000,expiresAt:now+30000}
    return {payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),
      x.operator.privateKey).toString('base64url')}
  })()
  registry.applySignedChange(revocation)
  const revoked=registry.exportCheckpoint()
  await client.publish(advance(enrolled,revoked))
  registry.close()
  fs.writeFileSync(f,oldFiles[0])
  fs.writeFileSync(anchor,oldFiles[1])
  // A naive no-pin reopening considers the revoked principal alive again.
  const compromised=openQaPrincipalRegistry(x.directory,registryContext)
  assert.equal(compromised.isRevoked('friend_one'),false)
  const server=keys(),conn=crypto.randomUUID(),
    challenge=crypto.randomBytes(24).toString('hex')
  const now=Date.now()
  const sign=(payload,key)=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),key).toString('base64url')})
  const proof={bridge:sign({aud:'guiaia:server-connection:v1',worldId,
    connectionId:conn,username:'OwnerQA',challenge,issuedAt:now-1000,
    expiresAt:now+44000},server.privateKey),
    owner:sign({aud:'guiaia:principal-proof:v1',worldId,connectionId:conn,
      principalId:'friend_one',challenge,issuedAt:now-1000,
      expiresAt:now+44000},x.principal.privateKey)}
  const permit=sign({aud:'guiaia:session-deposit:v1',worldId,
    botName:'GuiaIA_QA',ownerName:'OwnerQA',principalId:'friend_one',
    connectionId:conn,challenge,chest:{x:4,y:64,z:3},
    item:'birch_log',count:1,nonce:crypto.randomUUID(),
    issuedAt:now-1000,expiresAt:now+44000},x.operator.privateKey)
  let touches=0
  const bot=new EventEmitter()
  Object.assign(bot,{username:'GuiaIA_QA',
    inventory:{items:()=>[]},
    blockAt:()=>{touches++;throw Error('Unauthorized world access')},
    openContainer:()=>{touches++;throw Error('Unauthorized chest opening')},
  })
  const ledgerDirectory=path.join(x.root,'spent')
  const authority={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName:'GuiaIA_QA',
    serverBridgePublicKeyPem:server.publicKey.export({type:'spki',format:'pem'}),
    operatorPublicKeyPem:x.context.operatorPublicKeyPem,
    trustedPrincipals:compromised.trustedPrincipals(),
    isRevoked:id=>compromised.isRevoked(id),
    activeConnection:()=>({worldId,connectionId:conn,connected:true,username:'OwnerQA'}),
    ledgerDirectory,requireRemoteCheckpoint:true,
    currentRegistryCheckpoint:()=>compromised.exportCheckpoint(),
    remoteCheckpointMatch:head=>client.verifyLocal(head)
  }
  const gateway=createQaSessionActionGateway(bot,authority)
  await assert.rejects(gateway.createDeposit(proof,permit).depositOne(),
    /Remote checkpoint disagreement/)
  assert.equal(touches,0)
  assert.equal(fs.existsSync(ledgerDirectory),false)
  compromised.close()
})

test('remote witness unavailability denies dispatch, not only session creation',async t=>{
  const {EventEmitter}=require('node:events')
  const {createQaSessionActionGateway}=require('../src/session_identity')
  const x=setup(t),registry=x.open()
  const s=x.ticket();registry.applySignedChange(s,x.consent(s))
  const bridge=keys(),connectionId=crypto.randomUUID()
  const challenge=crypto.randomBytes(24).toString('hex'),now=Date.now()
  const sign=(payload,key)=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),key).toString('base64url')})
  const session={bridge:sign({aud:'guiaia:server-connection:v1',
    worldId:x.worldId,connectionId,username:'OwnerQA',challenge,
    issuedAt:now-1000,expiresAt:now+44000},bridge.privateKey),
    owner:sign({aud:'guiaia:principal-proof:v1',
      worldId:x.worldId,connectionId,principalId:'friend_one',challenge,
      issuedAt:now-1000,expiresAt:now+44000},x.principal.privateKey)}
  const grant=sign({aud:'guiaia:session-deposit:v1',
    worldId:x.worldId,botName:'GuiaIA_QA',ownerName:'OwnerQA',
    principalId:'friend_one',connectionId,challenge,
    chest:{x:4,y:64,z:3},item:'birch_log',count:1,
    nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+44000},
    x.operator.privateKey)
  let touches=0
  const bot=new EventEmitter()
  Object.assign(bot,{username:'GuiaIA_QA',inventory:{items:()=>[]},
    blockAt:()=>{touches++;throw Error('Unauthorised block read')},
    openContainer:()=>{touches++;throw Error('Unauthorised chest open')}})
  const directory=path.join(x.root,'spent')
  const authority={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId:x.worldId,botName:'GuiaIA_QA',
    serverBridgePublicKeyPem:bridge.publicKey.export({format:'pem',type:'spki'}),
    trustedPrincipals:registry.trustedPrincipals(),
    operatorPublicKeyPem:x.context.operatorPublicKeyPem,
    isRevoked:id=>registry.isRevoked(id),
    activeConnection:()=>({worldId:x.worldId,connectionId,username:'OwnerQA',connected:true}),
    ledgerDirectory:directory,requireRemoteCheckpoint:true,
    currentRegistryCheckpoint:()=>registry.exportCheckpoint(),
    remoteCheckpointMatch:async()=>{throw Error('Remote checkpoint witness unavailable')}
  }
  const action=createQaSessionActionGateway(bot,authority).createDeposit(session,grant)
  await assert.rejects(action.depositOne(),/Remote checkpoint witness unavailable/)
  assert.equal(touches,0)
  assert.equal(fs.existsSync(directory),false)
  registry.close()
})
