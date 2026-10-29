'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {generateKeyPairSync,sign,randomUUID,randomBytes}=require('node:crypto')
const {EventEmitter}=require('node:events')
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const {verifySessionBundle,createQaSessionActionGateway,createSessionAuthorizedQaDeposit}=
  require('../src/session_identity')

const chest={x:4,y:64,z:3}
function environment(t){
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-session-lab-'))
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}))
  const newKey=()=>generateKeyPairSync('ed25519')
  const bridgeKey=newKey(), ownerKey=newKey(), operatorKey=newKey()
  const pem=key=>key.publicKey.export({type:'spki',format:'pem'})
  const worldId='qa:isolated:session'
  const connectionId=randomUUID(),challenge=randomBytes(24).toString('hex')
  let active={connected:true,worldId,connectionId,username:'OwnerQA'}
  const revokedPrincipals=new Set(),revokedConnections=new Set()
  const authority={
    sandboxOnly:true,identityMode:'trusted_server_bridge_lab',worldId,
    botName:'GuiaIA_QA',serverBridgePublicKeyPem:pem(bridgeKey),
    trustedPrincipals:{player_alpha:pem(ownerKey)},
    operatorPublicKeyPem:pem(operatorKey),
    ledgerDirectory:path.join(home,'spent'),
    activeConnection:()=>active,
    isRevoked:(p,c)=>revokedPrincipals.has(p)||revokedConnections.has(c)
  }
  const signed=(payload,key)=>({payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),key.privateKey).toString('base64url')})
  const issue=(overrides={})=>{
    const now=Date.now()
    const bridge={aud:'guiaia:server-connection:v1',worldId,connectionId,
      username:'OwnerQA',challenge,issuedAt:now-1000,expiresAt:now+45000}
    const owner={aud:'guiaia:principal-proof:v1',worldId,connectionId,
      principalId:'player_alpha',challenge,issuedAt:now-1000,expiresAt:now+45000}
    const grant={aud:'guiaia:session-deposit:v1',worldId,
      botName:'GuiaIA_QA',ownerName:'OwnerQA',principalId:'player_alpha',
      connectionId,challenge,chest:{...chest},item:'oak_log',count:1,
      nonce:randomUUID(),issuedAt:now-1000,expiresAt:now+60000}
    return {
      bridge:signed({...bridge,...overrides.bridge},bridgeKey),
      owner:signed({...owner,...overrides.owner},ownerKey),
      grant:signed({...grant,...overrides.grant},operatorKey)
    }
  }
  const bot=new EventEmitter()
  bot.username='GuiaIA_QA'; bot.health=20
  bot.entity={position:{x:2,y:64,z:3}}
  bot.players={OwnerQA:{entity:{position:{x:2,y:64,z:2}}}}
  let player=1,operations=0
  const window={inventoryStart:27,inventoryEnd:63,slots:Array(63).fill(null),
    close(){},async deposit(_id,_meta,count){
      operations++
      player-=count
      this.slots[27]=null
      this.slots[0]={name:'oak_log',count}
    }}
  window.slots[27]={name:'oak_log',count:1}
  bot.inventory={items:()=>player?[{name:'oak_log',count:player}]:[]}
  bot.registry={itemsByName:{oak_log:{id:20}}}
  bot.blockAt=()=>({name:'chest'})
  bot.openContainer=async()=>window
  return {authority,bot,issue,bridgeKey,ownerKey,operatorKey,signed,
    get player(){return player},
    get operations(){return operations},
    get active(){return active},
    set active(value){active=value},
    revokePrincipal:p=>revokedPrincipals.add(p),
    revokeConnection:c=>revokedConnections.add(c)}
}
function prepare(f,tokens){
  return createQaSessionActionGateway(f.bot,f.authority)
    .createDeposit({bridge:tokens.bridge,owner:tokens.owner},tokens.grant)
}
test('independent bridge, principal and operator signatures authorize one exact chest transfer',async t=>{
  const f=environment(t),tok=f.issue()
  assert.equal((await prepare(f,tok).depositOne()).ok,true)
  assert.equal(f.player,0)
  assert.equal(f.operations,1)
  assert.equal(fs.readdirSync(f.authority.ledgerDirectory).length,1)
})
test('offline nick, offline UUID or player entity are never stand-alone identity',t=>{
  const f=environment(t),tok=f.issue()
  const gateway=createQaSessionActionGateway(f.bot,f.authority)
  assert.deepEqual(Object.keys(gateway),['createDeposit'])
  assert.throws(()=>gateway.createDeposit({owner:tok.owner},tok.grant),/trusted session|independent/)
  assert.throws(()=>gateway.createDeposit({bridge:tok.bridge},tok.grant),/trusted session|independent/)
  assert.equal(f.operations,0)
})
test('forged bridge, forged owner and forged operator signatures each denied',t=>{
  const f=environment(t),tok=f.issue()
  for(const forged of [
    {...tok,bridge:{...tok.bridge,payload:{...tok.bridge.payload,username:'ImpostorQA'}}},
    {...tok,owner:{...tok.owner,payload:{...tok.owner.payload,principalId:'player_beta'}}},
    {...tok,grant:{...tok.grant,payload:{...tok.grant.payload,count:2}}},
  ])assert.throws(()=>prepare(f,forged),/invalid|verification failed/)
  assert.equal(f.operations,0)
})
test('same offline username on a different live connection cannot reuse session',t=>{
  const f=environment(t),tok=f.issue()
  f.active={...f.active,connectionId:randomUUID(),username:'OwnerQA'}
  assert.throws(()=>prepare(f,tok),/live matching connection/)
})
test('signed session with a different connection or challenge cannot be spliced',t=>{
  const f=environment(t)
  for(const bad of [
    {owner:{connectionId:randomUUID()}},
    {owner:{challenge:'a'.repeat(48)}},
    {grant:{connectionId:randomUUID()}},
    {grant:{challenge:'b'.repeat(48)}}
  ])assert.throws(()=>prepare(f,f.issue(bad)),/invalid/)
})
test('bridge signature from different unpinned issuer rejected',t=>{
  const f=environment(t),other=environment(t),tok=f.issue()
  f.authority.serverBridgePublicKeyPem=other.authority.serverBridgePublicKeyPem
  assert.throws(()=>prepare(f,tok),/verification failed/)
})
test('enrolled principal public key must match proof, and unknown principal denied',t=>{
  const f=environment(t),other=environment(t),tok=f.issue()
  f.authority.trustedPrincipals.player_alpha=other.authority.trustedPrincipals.player_alpha
  assert.throws(()=>prepare(f,tok),/verification failed/)
  const second=environment(t)
  assert.throws(()=>prepare(second,second.issue({owner:{principalId:'not_enrolled'}})),/invalid/)
})
test('revoked user and revoked connection are denied even while signatures valid',t=>{
  const f=environment(t),tok=f.issue()
  f.revokePrincipal('player_alpha')
  assert.throws(()=>prepare(f,tok),/revoked/)
  const g=environment(t),tokens=g.issue()
  g.revokeConnection(g.active.connectionId)
  assert.throws(()=>prepare(g,tokens),/revoked/)
})
test('session revoked after creation cannot transfer on dispatch',async t=>{
  const f=environment(t),tok=f.issue(),adapter=prepare(f,tok)
  f.revokeConnection(f.active.connectionId)
  await assert.rejects(adapter.depositOne(),/revoked/)
  assert.equal(f.operations,0)
  assert.equal(fs.existsSync(f.authority.ledgerDirectory),false)
})
test('session disconnected or live connection switched after creation denies dispatch',async t=>{
  const f=environment(t),tok=f.issue(),adapter=prepare(f,tok)
  f.active={...f.active,connected:false}
  await assert.rejects(adapter.depositOne(),/live matching connection/)
  assert.equal(f.operations,0)
})
test('expires after authorization creation: reject at dispatch without spending nonce',async t=>{
  const f=environment(t),now=Date.now()
  const tok=f.issue({bridge:{issuedAt:now-1000,expiresAt:now+110},
    owner:{issuedAt:now-1000,expiresAt:now+110},
    grant:{issuedAt:now-1000,expiresAt:now+110}})
  const adapter=prepare(f,tok)
  await new Promise(r=>setTimeout(r,200))
  await assert.rejects(adapter.depositOne(),/invalid/)
  assert.equal(f.operations,0)
  assert.equal(fs.existsSync(f.authority.ledgerDirectory),false)
})
test('unsigned or wrong-world operator grant never reaches world mutation',t=>{
  const f=environment(t),tok=f.issue()
  assert.throws(()=>prepare(f,{...tok,grant:undefined}),/invalid/)
  assert.throws(()=>prepare(f,f.issue({grant:{worldId:'other:world'}})),/invalid/)
  assert.equal(f.operations,0)
})
test('operator grant tied to other chest/material/amount cannot redirect operation',async t=>{
  const f=environment(t)
  for(const bad of [
    {chest:{x:5,y:64,z:3}},
    {item:'diamond'},
    {count:3}
  ]){
    const g=f.issue({grant:bad})
    if(bad.chest){
      const a=prepare(f,g)
      // Same properly signed *different* target is refused by world block
      // check: the lab bot only observes the authorized chest at x=4.
      f.bot.blockAt=p=>({name:p.x===4?'chest':'air'})
      const result=await a.depositOne()
      assert.equal(result.ok,false)
      assert.equal(result.reason,'chest_not_authorized')
    }else assert.throws(()=>prepare(f,g),/invalid/)
  }
  assert.equal(f.operations,0)
})
test('used operator nonce cannot be replayed from another adapter or session',async t=>{
  const f=environment(t),tok=f.issue()
  assert.equal((await prepare(f,tok).depositOne()).ok,true)
  await assert.rejects(prepare(f,tok).depositOne(),/EEXIST/)
  assert.equal(f.operations,1)
})
test('simultaneous use of identical authorization produces at most one transfer',async t=>{
  const f=environment(t),tok=f.issue()
  const a=prepare(f,tok),b=prepare(f,tok)
  const result=await Promise.allSettled([a.depositOne(),b.depositOne()])
  assert.equal(result.filter(x=>x.status==='fulfilled'&&x.value.ok).length,1)
  assert.equal(result.filter(x=>x.status==='rejected'&&x.reason.code==='EEXIST').length,1)
  assert.equal(f.operations,1)
})
test('tampering with payload after creating adapter is caught at dispatch',async t=>{
  const f=environment(t),tok=f.issue(),adapter=prepare(f,tok)
  tok.grant.payload.chest.x=99
  await assert.rejects(adapter.depositOne(),/verification failed/)
  assert.equal(f.operations,0)
})
test('missing trusted live server bridge callback always fails closed',t=>{
  const f=environment(t),tok=f.issue()
  delete f.authority.activeConnection
  assert.throws(()=>prepare(f,tok),/No independent trusted/)
})
test('no revocation service and no owner enrollment always deny',t=>{
  const f=environment(t),tok=f.issue()
  delete f.authority.isRevoked
  assert.throws(()=>prepare(f,tok),/No independent trusted/)
  f.authority.isRevoked=()=>undefined
  assert.throws(()=>prepare(f,tok),/revoked/)
})
test('trusted key pinning and live bridge callback cannot be swapped after gateway setup',async t=>{
  const f=environment(t),tok=f.issue()
  const adapter=prepare(f,tok)
  const attacker=environment(t)
  f.authority.serverBridgePublicKeyPem=attacker.authority.serverBridgePublicKeyPem
  f.authority.operatorPublicKeyPem=attacker.authority.operatorPublicKeyPem
  f.authority.trustedPrincipals.player_alpha=attacker.authority.trustedPrincipals.player_alpha
  f.authority.activeConnection=()=>({connected:true,
    worldId:f.active.worldId,connectionId:f.active.connectionId,username:'OwnerQA'})
  f.active={...f.active,connected:false}
  await assert.rejects(adapter.depositOne(),/live matching connection/)
  assert.equal(f.operations,0)
})
test('no generic command path: gateway cannot expose follow, mining or arbitrary execution',t=>{
  const f=environment(t)
  const gateway=createQaSessionActionGateway(f.bot,f.authority)
  assert.equal(gateway.execute,undefined)
  assert.equal(gateway.mine,undefined)
  assert.equal(gateway.follow,undefined)
  assert.equal(Object.isFrozen(gateway),true)
})

test('strict QA gateway refuses every missing live session or independent witness control',t=>{
  const {createQaStrictSessionActionGateway}=require('../src/session_identity')
  const f=environment(t)
  const full={...f.authority,
    requireLivePresence:true,requireRemoteCheckpoint:true,
    livePresence:async()=>({connected:true,worldId:f.authority.worldId,
      connectionId:f.issue().bridge.payload.connectionId,issuedAt:Date.now()}),
    currentRegistryCheckpoint:()=>({sequence:1}),
    remoteCheckpointMatch:async()=>true}
  for(const missing of ['requireLivePresence','requireRemoteCheckpoint',
    'livePresence','currentRegistryCheckpoint','remoteCheckpointMatch',
    'isRevoked','activeConnection','serverBridgePublicKeyPem','operatorPublicKeyPem',
    'ledgerDirectory']){
    const broken={...full}
    delete broken[missing]
    assert.throws(()=>createQaStrictSessionActionGateway(f.bot,broken),
      /Mandatory signed Fabric presence/)
  }
  assert.deepEqual(Object.keys(createQaStrictSessionActionGateway(f.bot,full)),
    ['createDeposit'])
})
test('strict QA gateway demands both live server and witness before any chest transfer',async t=>{
  const {createQaStrictSessionActionGateway}=require('../src/session_identity')
  const f=environment(t),tokens=f.issue()
  const events=[]
  const authority={...f.authority,requireLivePresence:true,requireRemoteCheckpoint:true,
    livePresence:async id=>{
      events.push('live')
      return {worldId:f.authority.worldId,connectionId:id,
        connected:true,issuedAt:Date.now()}
    },
    currentRegistryCheckpoint:()=>{
      events.push('checkpoint')
      return Object.freeze({sequence:2})
    },
    remoteCheckpointMatch:async local=>{
      events.push('remote')
      assert.equal(local.sequence,2)
      return true
    }
  }
  const gateway=createQaStrictSessionActionGateway(f.bot,authority)
  // Mutation of the caller's control flags must not downgrade the gate.
  authority.requireLivePresence=false
  authority.requireRemoteCheckpoint=false
  const result=await gateway.createDeposit({
    bridge:tokens.bridge,owner:tokens.owner},tokens.grant).depositOne()
  assert.equal(result.ok,true)
  assert.deepEqual(events,['live','checkpoint','remote'])
  assert.equal(f.operations,1)
})
test('strict QA gate denies remote mismatch with no inventory or nonce mutation',async t=>{
  const {createQaStrictSessionActionGateway}=require('../src/session_identity')
  const f=environment(t),tokens=f.issue()
  const authority={...f.authority,requireLivePresence:true,requireRemoteCheckpoint:true,
    livePresence:async id=>({worldId:f.authority.worldId,connectionId:id,
      connected:true,issuedAt:Date.now()}),
    currentRegistryCheckpoint:()=>({sequence:1}),
    remoteCheckpointMatch:async()=>false}
  await assert.rejects(createQaStrictSessionActionGateway(f.bot,authority)
    .createDeposit({bridge:tokens.bridge,owner:tokens.owner},tokens.grant)
    .depositOne(),/Independent checkpoint verification unavailable/)
  assert.equal(f.operations,0)
  assert.equal(f.player,1)
  assert.equal(fs.existsSync(f.authority.ledgerDirectory),false)
})
