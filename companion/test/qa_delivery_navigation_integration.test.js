'use strict'
// Portable integration: original durable journals, actual QA gather/deposit
// behavior, genuine Ed25519 scopes. Minecraft client and pathfinding are
// simulated; a real Fabric world remains required before any deployment.
const test=require('node:test')
const assert=require('node:assert/strict')
const {EventEmitter}=require('node:events')
const crypto=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {Vec3}=require('vec3')
const {openMission}=require('../src/mission')
const {openDepositJournal}=require('../src/deposit')
const {createQaSignedMinecraftDelivery}=require('../src/qa_delivery_minecraft')
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
class GoalNear{constructor(x,y,z,radius){Object.assign(this,{x,y,z,radius})}}
class Movements{constructor(){this.canDig=true}}
const keypair=()=>crypto.generateKeyPairSync('ed25519')
const publicPem=k=>k.publicKey.export({format:'pem',type:'spki'})
const sign=(payload,key)=>({payload,signature:crypto.sign(null,
  Buffer.from(JSON.stringify(payload)),key.privateKey).toString('base64url')})
function fixture(t,{initialX=0,stalledPath=false,targetsX=9,lostDrop=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-delivery-path-v5-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const srv=keypair(),principal=keypair(),operator=keypair()
  const worldId='qa:delivery',botName='GuiaIA_QA',ownerName='OwnerQA',
    connectionId=crypto.randomUUID(),principalId='owner_approved',
    challenge=crypto.randomBytes(24).toString('hex')
  const target={x:targetsX,y:64,z:0,block:'oak_log'}
  const chest={x:5,y:64,z:3},items=[{name:'oak_log',count:1}]
  const journalM=openMission(path.join(root,'mission'),{
    sandboxOnly:true,ownerName,targets:[target]})
  const journalD=openDepositJournal(path.join(root,'deposit'),{
    sandboxOnly:true,ownerName,chest,items})
  t.after(()=>{try{journalM.close()}catch{};try{journalD.close()}catch{}})
  const now=Date.now()
  const bundle={
    bridge:sign({aud:'guiaia:server-connection:v1',worldId,connectionId,
      username:ownerName,challenge,issuedAt:now-1000,expiresAt:now+45000},srv),
    owner:sign({aud:'guiaia:principal-proof:v1',worldId,connectionId,
      principalId,challenge,issuedAt:now-1000,expiresAt:now+45000},principal)}
  const signedPlan=sign({aud:'guiaia:session-delivery-plan:v1',sandboxOnly:true,
    worldId,botName,ownerName,principalId,connectionId,challenge,
    missionId:journalM.view().missionId,planId:journalD.view().planId,
    targets:[target],chest,items,nonce:crypto.randomUUID(),
    issuedAt:now-1000,expiresAt:now+40000},operator)
  const depositGrants={oak_log:sign({aud:'guiaia:session-deposit:v1',
    worldId,botName,ownerName,principalId,connectionId,challenge,
    chest,item:'oak_log',count:1,nonce:crypto.randomUUID(),
    issuedAt:now-1000,expiresAt:now+40000},operator)}
  let revoked=false,online=true,dug=0,inventory=0,chestTotal=0,
    pathCommands=0,clears=0,navEnabled=true
  const bot=new EventEmitter()
  Object.assign(bot,{username:botName,health:20,
    entity:{position:new Vec3(initialX,64,0)},
    players:{[ownerName]:{entity:{position:new Vec3(7,64,0)}}},
    registry:{itemsByName:{oak_log:{id:1}}},
    inventory:{items:()=>inventory>0?[{name:'oak_log',count:inventory}]:[]},
    blockAt(p){
      assert.ok(p && typeof p.x==='number')
      if(p.x===chest.x && p.y===chest.y && p.z===chest.z)return {name:'chest'}
      if(p.x===target.x && p.y===target.y && p.z===target.z && dug===0)
        return {name:'oak_log',position:new Vec3(target.x,target.y,target.z)}
      return {name:'air'}
    },
    canDigBlock:()=>true,
    async dig(block){
      assert.equal(block.name,'oak_log')
      assert.ok(block.position instanceof Vec3)
      dug++;if(!lostDrop)inventory++
    },
    stopDigging(){},
    async openContainer(block){
      if(block.name!=='chest')throw Error('Wrong chest')
      const slots=Array(64).fill(null)
      if(chestTotal)slots[0]={name:'oak_log',count:chestTotal}
      if(inventory)slots[27]={name:'oak_log',count:inventory}
      return {inventoryStart:27,inventoryEnd:63,slots,
        async deposit(_id,_meta,count){
          if(count>inventory)throw Error('Fake inventory empty')
          inventory-=count;chestTotal+=count
          slots[0]={name:'oak_log',count:chestTotal}
          slots[27]=inventory?{name:'oak_log',count:inventory}:null
        },close(){}}
    },
    pathfinder:{setMovements(m){bot.pathMovements=m},setGoal(goal){bot.lastGoal=goal},
      goto(goal){
        pathCommands++
        if(stalledPath && navEnabled)return new Promise(()=>{})
        bot.entity.position=new Vec3(goal.x,goal.y,goal.z)
        return Promise.resolve()
      }},
    clearControlStates(){clears++}
  })
  const authority={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName,operatorPublicKeyPem:publicPem(operator),
    serverBridgePublicKeyPem:publicPem(srv),
    trustedPrincipals:{[principalId]:publicPem(principal)},
    ledgerDirectory:path.join(root,'spent'),requireLivePresence:true,
    requireRemoteCheckpoint:true,
    activeConnection:id=>online&&id===connectionId
      ?{connected:true,worldId,username:ownerName,connectionId}:null,
    isRevoked:()=>revoked,
    livePresence:async id=>({connected:true,worldId,connectionId:id,issuedAt:Date.now()}),
    currentRegistryCheckpoint:()=>({sequence:1}),
    remoteCheckpointMatch:async()=>true}
  const create=(options={})=>createQaSignedMinecraftDelivery({bot,bundle,
    signedPlan,authority,missionJournal:journalM,depositJournal:journalD,
    depositGrants, ...options})
  const classes={GoalNear,Movements}
  return {root,bot,journalM,journalD,authority,create,classes,
    get dug(){return dug},get inventory(){return inventory},
    get chest(){return chestTotal},get pathCommands(){return pathCommands},
    get clears(){return clears},
    revoke(){revoked=true},disconnect(){online=false},
    releasePath(){navEnabled=false}}
}
test('signed real journals: navigate, gather real Vec3 block, return and deposit',async t=>{
  const w=fixture(t),pipeline=w.create({navigationClasses:w.classes})
  assert.equal(w.pathCommands,0,'creating a QA pipeline cannot move')
  const result=await pipeline.runAll()
  assert.equal(result.ok,true)
  assert.equal(pipeline.status().phase,'completed')
  assert.equal(w.journalM.view().receipts.length,1)
  assert.equal(w.journalD.view().receipts.length,1)
  assert.equal(w.dug,1)
  // Portable over the lab gateway (simulated receipt) and the real
  // session_identity gateway (verified window inventory deltas).
  assert.equal(w.inventory+w.chest,1)
  assert.equal((w.bot.worldDeposits||0)+w.chest,1)
  assert.ok(w.pathCommands>=2,'both block and chest require pathfinding')
  assert.equal(w.bot.pathMovements.canDig,false)
  assert.equal(w.bot.lastGoal,null)
  assert.equal((await pipeline.runAll()).reason,'already_completed')
  assert.equal(w.dug,1)
})
test('navigation is opt-in: no movement when signed block is outside dig reach',async t=>{
  const w=fixture(t),pipeline=w.create()
  const result=await pipeline.runAll()
  assert.equal(result.ok,false)
  assert.equal(w.pathCommands,0)
  assert.equal(w.dug,0)
  assert.equal(w.journalM.view().phase,'paused')
  assert.equal(w.journalM.view().receipts.length,0)
})
test('unsafe movement to signed block cannot mine or deposit',async t=>{
  const w=fixture(t),pipeline=w.create({navigationClasses:w.classes})
  w.bot.health=6
  const result=await pipeline.runAll()
  assert.equal(result.ok,false)
  assert.equal(w.dug,0)
  assert.equal(w.pathCommands,0)
  assert.equal(w.journalM.view().phase,'paused')
  assert.equal(w.journalD.view().phase,'ready')
})
test('valid mining but unsafe return trip pauses deposit without touching chest',async t=>{
  const w=fixture(t),pipeline=w.create({navigationClasses:w.classes})
  assert.equal((await pipeline.runNext()).ok,true)
  w.bot.health=4
  const result=await pipeline.runNext()
  assert.equal(result.ok,false)
  assert.equal(w.journalM.view().phase,'completed')
  assert.equal(w.journalD.view().phase,'paused')
  assert.equal(w.journalD.view().receipts.length,0)
  assert.equal(w.inventory,1)
})
test('revocation while navigating cannot create a verified gather receipt',async t=>{
  const w=fixture(t,{stalledPath:true}),pipeline=w.create({navigationClasses:w.classes})
  const pending=pipeline.runNext()
  for(let i=0;i<30 && w.pathCommands===0;i++)await sleep(20)
  assert.equal(w.pathCommands,1)
  w.revoke()
  const result=await Promise.race([pending,sleep(2200).then(()=>{throw Error('QA revocation hung')})])
  assert.equal(result.ok,false)
  assert.equal(w.journalM.view().receipts.length,0)
  assert.equal(w.dug,0)
  assert.equal(pipeline.status().phase,'blocked')
  assert.equal(w.bot.lastGoal,null)
})
test('caller stop while navigating persists cancellation in both journals',async t=>{
  const w=fixture(t,{stalledPath:true}),pipeline=w.create({navigationClasses:w.classes})
  const pending=pipeline.runNext()
  for(let i=0;i<30 && w.pathCommands===0;i++)await sleep(20)
  assert.equal(w.pathCommands,1)
  assert.equal(pipeline.stop().ok,true)
  assert.equal((await pending).ok,false)
  assert.equal(w.journalM.view().phase,'needs_review')
  assert.equal(w.journalD.view().phase,'cancelled')
  assert.equal(w.dug,0)
})
test('out-of-radius signed target still cannot trigger exploration or digging',async t=>{
  const w=fixture(t,{targetsX:11}),pipeline=w.create({navigationClasses:w.classes})
  assert.equal((await pipeline.runAll()).ok,false)
  assert.equal(w.pathCommands,0)
  assert.equal(w.dug,0)
  assert.equal(w.journalM.view().receipts.length,0)
})
test('manual journal resume never replays a consumed signed deposit nonce',async t=>{
  const w=fixture(t),pipeline=w.create({navigationClasses:w.classes})
  assert.equal((await pipeline.runNext()).ok,true)
  w.bot.health=4
  assert.equal((await pipeline.runNext()).ok,false)
  assert.equal(w.journalD.view().phase,'paused')
  assert.equal(w.journalD.view().receipts.length,0)
  w.bot.health=20
  assert.equal(w.journalD.resume().ok,true)
  // The signed nonce was already spent before the failed approach. Even an
  // explicit journal resume cannot silently repeat the same signed step.
  assert.equal((await pipeline.runNext()).ok,false)
  assert.equal(w.journalD.view().receipts.length,0)
  assert.equal(w.bot.worldDeposits||0,0)
})


test('real journals: mined block without verified pickup is never retried or deposited',async t=>{
  // Regression for the real Fabric failure observed on Penguin: the block
  // was air, but the oak_log count had not increased after the dig.
  const w=fixture(t,{lostDrop:true})
  const pipeline=w.create({navigationClasses:w.classes,pickupTimeoutMs:350})
  const first=await pipeline.runAll()
  assert.equal(first.ok,false)
  assert.equal(w.dug,1,'the block was actually mined once')
  assert.equal(w.inventory,0,'world mutation is NOT proof of collection')
  assert.equal(w.journalM.view().phase,'needs_review')
  assert.equal(w.journalM.view().receipts.length,0)
  assert.equal(w.journalD.view().phase,'ready')
  assert.equal(w.journalD.view().receipts.length,0)
  const after=await pipeline.runAll()
  assert.equal(after.ok,false)
  assert.equal(after.state.phase,'blocked')
  assert.equal(w.dug,1,'no automatic re-dig after an uncertain pickup')
  assert.equal(w.chest,0,'no deposit without a proven pickup')
})
