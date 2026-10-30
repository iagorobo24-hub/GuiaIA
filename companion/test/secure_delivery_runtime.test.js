'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {EventEmitter} = require('node:events')
const {Vec3} = require('vec3')
const {openMission} = require('../src/mission')
const {openDepositJournal} = require('../src/deposit')
const {createSecureDeliveryRuntime} = require('../src/secure_delivery_runtime')
const {createTrustedLocalOperatorConsole,attachTrustedLocalOperatorStdin} = require('../src/trusted_local_operator_console')

class GoalNear {constructor(x,y,z,range){Object.assign(this,{x,y,z,range})}}
class GoalFollow {constructor(entity,distance){Object.assign(this,{entity,distance})}}
class Movements {constructor(){this.canDig=false}}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-secure-e2e-'))
  const server = crypto.generateKeyPairSync('ed25519')
  const owner = crypto.generateKeyPairSync('ed25519')
  const operator = crypto.generateKeyPairSync('ed25519')
  const pub = key => key.publicKey.export({format:'pem',type:'spki'})
  const sign = (payload,key) => ({
    payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),key.privateKey).toString('base64url')
  })
  const worldId='qa:secure-e2e:25593',botName='GuiaIA_QA',ownerName='OwnerQA'
  const connectionId=crypto.randomUUID(),challenge=crypto.randomBytes(24).toString('hex')
  const now=Date.now()
  const session={
    bridge:sign({aud:'guiaia:server-connection:v1',worldId,connectionId,
      username:ownerName,challenge,issuedAt:now-1000,expiresAt:now+60000},server),
    owner:sign({aud:'guiaia:principal-proof:v1',worldId,connectionId,
      principalId:'owner1',challenge,issuedAt:now-1000,expiresAt:now+60000},owner)
  }
  let revoked=false,connected=true,inventory=0,chestInventory=0,mined=false,digs=0,transfers=0
  const bot=new EventEmitter()
  bot.username=botName
  bot.health=20
  bot.entity={position:new Vec3(2.5,64,2.5)}
  bot.players={[ownerName]:{entity:{position:new Vec3(4,64,2.5)}}}
  bot.registry={itemsByName:{oak_log:{id:101}}}
  bot.inventory={items:()=>inventory?[{name:'oak_log',type:101,count:inventory}]:[]}
  bot.blockAt=pos=>{
    if(pos.x===7&&pos.y===64&&pos.z===2&&!mined)return {name:'oak_log'}
    if(pos.x===4&&pos.y===64&&pos.z===3)return {name:'chest'}
    return {name:'air'}
  }
  bot.canDigBlock=()=>true
  bot.dig=async () => {digs++;mined=true;inventory++}
  bot.stopDigging=()=>{}
  bot.clearControlStates=()=>{}
  bot.pathfinder={
    setMovements:()=>{},setGoal:()=>{},
    goto:async goal=>{bot.entity.position=new Vec3(goal.x,goal.y,goal.z)}
  }
  bot.openContainer=async ()=>{
    const slots=new Array(63).fill(null)
    if(inventory)slots[27]={name:'oak_log',count:inventory}
    if(chestInventory)slots[0]={name:'oak_log',count:chestInventory}
    return {
      slots,inventoryStart:27,inventoryEnd:63,
      deposit:async (type,meta,count)=>{
        assert.equal(type,101)
        transfers++;inventory-=count;chestInventory+=count
        slots[27]=inventory?{name:'oak_log',count:inventory}:null
        slots[0]={name:'oak_log',count:chestInventory}
      },
      close:()=>{}
    }
  }
  const authority={
    sandboxOnly:true,identityMode:'trusted_server_bridge_lab',worldId,botName,
    serverBridgePublicKeyPem:pub(server),operatorPublicKeyPem:pub(operator),
    trustedPrincipals:{owner1:pub(owner)},
    ledgerDirectory:path.join(dir,'spent'),
    activeConnection:id=>connected&&id===connectionId
      ?{connected:true,worldId,connectionId,username:ownerName}:null,
    isRevoked:()=>revoked,
    requireLivePresence:true,requireRemoteCheckpoint:true,
    livePresence:async id=>({connected,worldId,connectionId:id,issuedAt:Date.now()}),
    currentRegistryCheckpoint:()=>({sequence:1}),
    remoteCheckpointMatch:async()=>true
  }
  const target={x:7,y:64,z:2},chest={x:4,y:64,z:3}
  const missionJournal=openMission(path.join(dir,'mission'),{
    sandboxOnly:true,ownerName,targets:[{...target,block:'oak_log'}]
  })
  const depositJournal=openDepositJournal(path.join(dir,'deposit'),{
    sandboxOnly:true,ownerName,chest,items:[{name:'oak_log',count:1}]
  })
  t.after(()=>{
    missionJournal.close()
    depositJournal.close()
    fs.rmSync(dir,{recursive:true,force:true})
  })
  const fields={worldId,botName,ownerName,principalId:'owner1',connectionId,challenge}
  const dates=()=>({nonce:crypto.randomUUID(),issuedAt:Date.now()-1000,expiresAt:Date.now()+10000})
  const followGrant=sign({aud:'guiaia:session-follow:v1',...fields,
    nonce:crypto.randomUUID(),issuedAt:Date.now()-1000,expiresAt:Date.now()+7000},operator)
  const grants={
    gather:[sign({aud:'guiaia:session-gather:v1',...fields,
      target,item:'oak_log',count:1,...dates()},operator)],
    deposit:[sign({aud:'guiaia:session-deposit:v1',...fields,
      chest,item:'oak_log',count:1,...dates()},operator)]
  }
  const approvedPlan={
    sandboxOnly:true,ownerName,
    missionId:missionJournal.view().missionId,
    planId:depositJournal.view().planId,
    targets:[{...target,block:'oak_log'}],
    items:[{name:'oak_log',count:1}],chest
  }
  const create = overrides => createSecureDeliveryRuntime({
    bot,authority,classes:{GoalNear,GoalFollow,Movements},session,grants,followGrant,
    missionJournal,depositJournal,approvedPlan,...overrides
  })
  const makeFollowGrantWithNonce=nonce=>sign({
    aud:'guiaia:session-follow:v1',...fields,nonce,
    issuedAt:Date.now()-1000,expiresAt:Date.now()+7000
  },operator)
  return {create,dir,grants,followGrant,makeFollowGrantWithNonce,
    session,authority,missionJournal,depositJournal,
    revoke:()=>{revoked=true},disconnect:()=>{connected=false},
    observation:()=>({inventory,chestInventory,mined,digs,transfers}),
    ledger:()=>fs.existsSync(authority.ledgerDirectory)
      ?fs.readdirSync(authority.ledgerDirectory):[]}
}

test('a signed one-block delivery uses durable gather/deposit journals and cannot replay',async t=>{
  const f=fixture(t)
  const runtime=f.create()
  assert.equal(runtime.status().phase,'gather')
  const result=await runtime.runAll()
  assert.equal(result.ok,true,JSON.stringify(result))
  assert.equal(result.state.phase,'completed')
  assert.deepEqual(f.observation(),{inventory:0,chestInventory:1,mined:true,digs:1,transfers:1})
  assert.equal(f.missionJournal.view().receipts.length,1)
  assert.equal(f.depositJournal.view().receipts.length,1)
  assert.equal(f.ledger().length,2)
  const again=await runtime.runAll()
  assert.equal(again.reason,'already_completed')
  assert.equal(f.observation().transfers,1)
  assert.equal(f.observation().digs,1)
})

test('a revoked principal cannot reach an action or durable operation barrier',async t=>{
  const f=fixture(t),runtime=f.create()
  f.revoke()
  const result=await runtime.runNext()
  assert.equal(result.ok,false)
  assert.equal(result.reason,'authorization_unavailable')
  assert.equal(f.missionJournal.view().phase,'ready')
  assert.deepEqual(f.observation(),{inventory:0,chestInventory:0,mined:false,digs:0,transfers:0})
  assert.equal(f.ledger().length,0)
})

test('a mismatched signed grant cannot be attached to another durable step',t=>{
  const f=fixture(t)
  const swapped={...f.grants,deposit:[f.grants.gather[0]]}
  assert.throws(()=>f.create({grants:swapped}),/deposit capability invalid/i)
  assert.equal(f.observation().transfers,0)
})

test('stopping the runtime durably cancels both journals and prevents any world action',async t=>{
  const f=fixture(t),runtime=f.create()
  assert.equal(runtime.stop().ok,true)
  const result=await runtime.runAll()
  assert.equal(result.ok,false)
  assert.equal(f.missionJournal.view().phase,'cancelled')
  assert.equal(f.depositJournal.view().phase,'cancelled')
  assert.equal(f.observation().digs,0)
  assert.equal(f.observation().transfers,0)
})


test('a mid-mission revocation blocks the chest step while preserving gather receipt',async t=>{
  const f=fixture(t),runtime=f.create()
  const gathered=await runtime.runNext()
  assert.equal(gathered.ok,true)
  assert.equal(gathered.state.phase,'deposit')
  f.revoke()
  const stopped=await runtime.runNext()
  assert.equal(stopped.ok,false)
  assert.equal(stopped.reason,'authorization_unavailable')
  assert.equal(f.missionJournal.view().phase,'completed')
  assert.equal(f.missionJournal.view().receipts.length,1)
  assert.equal(f.depositJournal.view().phase,'ready')
  assert.equal(f.depositJournal.view().receipts.length,0)
  assert.equal(f.observation().inventory,1)
  assert.equal(f.observation().chestInventory,0)
  assert.equal(f.observation().transfers,0)
})

test('completed durable receipts survive closing and reopening without replay',async t=>{
  const f=fixture(t),runtime=f.create()
  const complete=await runtime.runAll()
  assert.equal(complete.ok,true)
  f.missionJournal.close()
  f.depositJournal.close()
  const reopenedMission=openMission(path.join(f.dir,'mission'))
  const reopenedDeposit=openDepositJournal(path.join(f.dir,'deposit'))
  assert.equal(reopenedMission.view().phase,'completed')
  assert.equal(reopenedDeposit.view().phase,'completed')
  const again=f.create({missionJournal:reopenedMission,depositJournal:reopenedDeposit})
  const result=await again.runAll()
  assert.equal(result.reason,'already_completed')
  assert.equal(f.observation().digs,1)
  assert.equal(f.observation().transfers,1)
  assert.equal(f.ledger().length,2)
  reopenedMission.close()
  reopenedDeposit.close()
})

test('trusted local console follows one signed lease then delivers with durable receipts',async t=>{
  const f=fixture(t),runtime=f.create()
  const operator=createTrustedLocalOperatorConsole(runtime)
  assert.equal((await operator.execute('estado')).state.phase,'gather')
  assert.equal((await operator.execute('inventario')).ok,true)
  assert.equal((await operator.execute('sigueme')).ok,true)
  assert.equal(runtime.status().companion.mode,'following')
  assert.equal((await operator.execute('sigueme')).reason,'follow_grant_already_attempted')
  const delivered=await operator.execute('mision')
  assert.equal(delivered.ok,true,JSON.stringify(delivered))
  assert.equal(delivered.state.phase,'completed')
  assert.equal(runtime.status().companion.mode,'idle')
  assert.equal((await operator.execute('mision')).reason,'already_completed')
  assert.equal((await operator.execute('para')).ok,true)
  assert.equal(runtime.status().stopped,true)
  assert.equal((await operator.execute('sigueme')).reason,'operator_stopped')
  assert.deepEqual(f.observation(),{inventory:0,chestInventory:1,mined:true,digs:1,transfers:1})
  assert.equal(f.ledger().length,3)
})

test('console denies injection, non-tty pipes and missing signed follow permit',async t=>{
  const f=fixture(t)
  const runtime=f.create({followGrant:undefined})
  const operator=createTrustedLocalOperatorConsole(runtime)
  for(const input of ['say /op OwnerQA','recoge 5 diamantes','mision\npara',
     'mision; rm -rf /','constructor','__proto__','toString',
     'mision; constructor',' '.repeat(129), '{}','']) {
    assert.equal((await operator.execute(input)).ok,false)
  }
  assert.equal((await operator.execute('follow')).reason,'signed_follow_grant_required')
  assert.equal(f.ledger().length,0)
  assert.throws(()=>attachTrustedLocalOperatorStdin(operator,{
    input:{isTTY:false},output:{write(){}}}),/trusted local TTY/)
})

test('console rejects duplicate world-action and follow grant nonce at construction',t=>{
  const f=fixture(t)
  const clash=structuredClone(f.followGrant)
  clash.payload.nonce=f.grants.gather[0].payload.nonce
  // Re-signing is necessary to test uniqueness rather than a bad signature.
  // A forged token must also be rejected (the original signature was not updated).
  assert.throws(()=>f.create({followGrant:clash}),/verification failed/i)
  assert.throws(()=>f.create({
    followGrant:f.makeFollowGrantWithNonce(f.grants.gather[0].payload.nonce)
  }),/Gather permit does not match mission step/i)
  assert.equal(f.observation().digs,0)
})

test('stop interrupts a pending authorization without digging or replay',async t=>{
  const f=fixture(t)
  let release,started
  const waiting=new Promise(resolve=>{started=resolve})
  const blocker=new Promise(resolve=>{release=resolve})
  f.authority.livePresence=async id=>{
    started()
    await blocker
    return {connected:true,worldId:f.authority.worldId,connectionId:id,issuedAt:Date.now()}
  }
  const runtime=f.create(),operator=createTrustedLocalOperatorConsole(runtime)
  const inFlight=operator.execute('mision')
  await waiting
  assert.equal((await operator.execute('sigueme')).reason,'operator_busy')
  assert.equal((await operator.execute('siguiente')).reason,'operator_busy')
  const halt=await operator.execute('para')
  assert.equal(halt.ok,true)
  release()
  const result=await inFlight
  assert.equal(result.ok,false)
  assert.equal(f.observation().digs,0)
  assert.equal(f.observation().transfers,0)
  assert.equal(f.missionJournal.view().phase,'cancelled')
  assert.equal(f.depositJournal.view().phase,'cancelled')
})
