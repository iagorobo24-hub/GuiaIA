'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {EventEmitter}=require('node:events')
const crypto=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {createQaAuthorizedFollow}=require('../src/qa_authorized_follow')
const {verifySessionFollowGrant}=require('../src/session_identity')
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
class GoalFollow{
  constructor(entity,distance){this.entity=entity;this.distance=distance}
}
class Movements{constructor(){this.canDig=true}}
function fixture(t,opts={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-signed-follow-qa-'))
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
  const key=()=>crypto.generateKeyPairSync('ed25519')
  const server=key(),principal=key(),operator=key()
  const pem=pair=>pair.publicKey.export({format:'pem',type:'spki'})
  const worldId='qa:only',connectionId=crypto.randomUUID(),
    challenge=crypto.randomBytes(24).toString('hex'),username='OwnerQA',botName='GuiaIA_QA'
  const now=Date.now()
  const start=opts.start??now-1000
  const end=opts.end??now+8000
  const signed=(payload,actor)=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),actor.privateKey).toString('base64url')})
  const bridge=signed({aud:'guiaia:server-connection:v1',worldId,connectionId,
    username,challenge,issuedAt:now-1000,expiresAt:now+40000},server)
  const owner=signed({aud:'guiaia:principal-proof:v1',worldId,connectionId,
    principalId:'friend_one',challenge,issuedAt:now-1000,expiresAt:now+40000},principal)
  const cap=(overrides={},signer=operator)=>signed({
    aud:'guiaia:session-follow:v1',worldId,botName,
    ownerName:username,principalId:'friend_one',connectionId,challenge,
    nonce:crypto.randomUUID(),issuedAt:start,expiresAt:end,...overrides
  },signer)
  let revoked=false,online=true,witness=true,requests=0
  const bot=new EventEmitter()
  const goals=[]
  Object.assign(bot,{username:botName,health:20,
    entity:{position:{x:0,y:64,z:0}},
    players:{[username]:{entity:{position:{x:4,y:64,z:0}}}},
    pathfinder:{setMovements(m){bot.moves=m},setGoal(goal){goals.push(goal)}},
    clearControlStates(){bot.cleared=true}})
  const authority={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName,serverBridgePublicKeyPem:pem(server),operatorPublicKeyPem:pem(operator),
    trustedPrincipals:{friend_one:pem(principal)},
    ledgerDirectory:path.join(dir,'spent'),
    activeConnection:id=>id===connectionId&&online?{
      connected:true,worldId,connectionId,username}:null,
    isRevoked:()=>revoked,
    requireLivePresence:true,
    requireRemoteCheckpoint:true,
    livePresence:async id=>{requests++;if(!online)throw Error('QA JVM closed')
      return {connected:true,worldId,connectionId:id,issuedAt:Date.now()}},
    currentRegistryCheckpoint:()=>({sequence:1}),
    remoteCheckpointMatch:async()=>witness}
  const session={bridge,owner}
  const create=(capability=cap(),a=authority)=>
    createQaAuthorizedFollow(bot,{GoalFollow,Movements},session,capability,a)
  return {bot,goals,authority,session,cap,create,dir,
    get requests(){return requests},revoke(){revoked=true},disconnect(){online=false},
    witnessDown(){witness=false},server,operator,principal}
}
test('signed, scoped, one-use grant starts bounded follow, never mining',async t=>{
  const x=fixture(t),action=x.create(),result=await action.start()
  t.after(()=>action.stop('test_cleanup'))
  assert.equal(result.mode,'following')
  assert.equal(action.status().mode,'following')
  assert.equal(x.goals.length,1)
  assert.equal(x.goals[0].distance,2)
  for(const key of ['canDig','canOpenDoors','allow1by1towers',
    'allowFreeMotion','allowParkour','allowSprinting'])
    assert.equal(x.bot.moves[key],false,key)
  assert.equal(fs.readdirSync(path.join(x.dir,'spent')).length,1)
  assert.deepEqual(await action.start(),{ok:false,reason:'signed_follow_grant_already_attempted'})
  assert.equal(x.goals.length,1)
})
test('signed movement cannot be changed to another owner, world, bot or key',t=>{
  const x=fixture(t)
  for(const overrides of [
    {ownerName:'OtherQA'},{worldId:'qa:elsewhere'},{botName:'OtherBot'},
    {principalId:'different'},{connectionId:crypto.randomUUID()},
    {challenge:crypto.randomBytes(24).toString('hex')},{expiresAt:Date.now()+90000}
  ])assert.throws(()=>x.create(x.cap(overrides)),/Invalid bounded/)
  const untrusted=crypto.generateKeyPairSync('ed25519')
  assert.throws(()=>x.create(x.cap({},untrusted)),/Signed evidence verification failed/)
  assert.equal(x.goals.length,0)
})
test('absent signed witness or fresh Fabric live authority denies before moving or spending nonce',async t=>{
  const x=fixture(t)
  for(const key of ['requireLivePresence','requireRemoteCheckpoint',
    'livePresence','remoteCheckpointMatch','currentRegistryCheckpoint']){
    const authority={...x.authority}
    delete authority[key]
    assert.throws(()=>x.create(x.cap(),authority),/Movement requires dual/)
  }
  x.witnessDown()
  const a=x.create()
  await assert.rejects(a.start(),/Independent revocation checkpoint mismatch/)
  assert.equal(x.goals.length,1) // stop clears the goal even without movement
  assert.equal(x.goals[0],null)
  assert.equal(fs.existsSync(path.join(x.dir,'spent')),false)
})
test('revocation during active follow stops movement and clears controls',async t=>{
  const x=fixture(t),action=x.create()
  t.after(()=>action.stop('cleanup'))
  assert.equal((await action.start()).ok,true)
  x.revoke()
  await sleep(500)
  assert.equal(action.status().mode,'idle')
  assert.equal(action.status().reason,'movement_identity_or_witness_unavailable')
  assert.equal(x.goals.at(-1),null)
  assert.equal(x.bot.cleared,true)
})
test('witness refusal while moving causes fail-closed stop',async t=>{
  const x=fixture(t),action=x.create()
  t.after(()=>action.stop('cleanup'))
  await action.start()
  x.witnessDown()
  await sleep(500)
  assert.equal(action.status().mode,'idle')
  assert.equal(x.goals.at(-1),null)
})
test('real JVM disconnect evidence becoming unavailable stops follow',async t=>{
  const x=fixture(t),action=x.create()
  t.after(()=>action.stop('cleanup'))
  await action.start()
  x.disconnect()
  await sleep(500)
  assert.equal(action.status().mode,'idle')
  assert.equal(x.goals.at(-1),null)
})
test('operator grant expires while moving; watchdog stops without caller commands',async t=>{
  const now=Date.now()
  const x=fixture(t,{start:now-9400,end:now+600}),action=x.create()
  t.after(()=>action.stop('cleanup'))
  await action.start()
  await sleep(850)
  assert.equal(action.status().mode,'idle')
  assert.equal(x.goals.at(-1),null)
})
test('network attestation stalls after starting; watchdog limits unchecked motion',async t=>{
  const x=fixture(t)
  const original=x.authority.livePresence
  let stall=false
  x.authority.livePresence=id=>{
    if(stall)return new Promise(()=>{})
    return original(id)
  }
  const action=x.create()
  t.after(()=>action.stop('cleanup'))
  await action.start()
  stall=true
  await sleep(2050)
  assert.equal(action.status().mode,'idle')
  assert.equal(action.status().reason,'movement_attestation_expired')
  assert.equal(x.goals.at(-1),null)
})
test('stopping during pending initial attestation cannot start movement afterwards',async t=>{
  const x=fixture(t)
  let release
  x.authority.livePresence=()=>new Promise(resolve=>{release=resolve})
  const action=x.create(),starting=action.start()
  action.stop('operator_stop')
  release({connected:true,worldId:x.authority.worldId,
    connectionId:x.session.bridge.payload.connectionId,issuedAt:Date.now()})
  await assert.rejects(starting,/Movement stopped/)
  assert.equal(action.status().mode,'idle')
  assert.equal(x.goals.at(-1),null)
  assert.equal(fs.existsSync(path.join(x.dir,'spent')),false)
})
test('disconnect event immediately prevents new movement without waiting for poll',async t=>{
  const x=fixture(t),action=x.create()
  t.after(()=>action.stop('cleanup'))
  await action.start()
  x.bot.emit('end')
  assert.equal(action.status().mode,'idle')
  assert.equal(x.goals.at(-1),null)
})
test('once stopped, consumed capability cannot be replayed by new adapter',async t=>{
  const x=fixture(t),token=x.cap()
  const first=x.create(token)
  await first.start()
  first.stop('test_stop')
  const second=x.create(token)
  await assert.rejects(second.start(),/EEXIST/)
  assert.equal(second.status().mode,'idle')
})

test('owner out of range or unsafe health stops an already authorized follow',async t=>{
  for(const fault of ['range','health','absent']){
    const x=fixture(t),action=x.create()
    t.after(()=>action.stop('cleanup'))
    await action.start()
    if(fault==='range')x.bot.players.OwnerQA.entity.position.x=200
    else if(fault==='health')x.bot.health=5
    else x.bot.players={}
    await sleep(380)
    assert.equal(action.status().mode,'idle')
    assert.equal(x.goals.at(-1),null)
  }
})
test('revocation during an awaited witness response stops before granting a lease',async t=>{
  const x=fixture(t)
  let release=null,makePending=false
  x.authority.remoteCheckpointMatch=async()=>{
    if(makePending)return new Promise(resolve=>{release=resolve})
    return true
  }
  const action=x.create()
  t.after(()=>action.stop('cleanup'))
  await action.start()
  makePending=true
  await sleep(350)
  assert.equal(typeof release,'function')
  x.revoke()
  release(true)
  await sleep(350)
  assert.equal(action.status().mode,'idle')
  assert.equal(x.goals.at(-1),null)
})
