'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {openMission}=require('../src/mission')
const {openDepositJournal}=require('../src/deposit')
const {verifyQaDeliveryPlan,createQaSignedDeliveryPipeline}=require('../src/qa_signed_delivery')
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))

function fixture(t,blocks=['oak_log','birch_log']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-signed-delivery-v3-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const key=()=>crypto.generateKeyPairSync('ed25519')
  const srv=key(),user=key(),operator=key()
  const pub=k=>k.publicKey.export({format:'pem',type:'spki'})
  const sign=(payload,who)=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),who.privateKey).toString('base64url')})
  const worldId='qa:delivery',botName='GuiaIA_QA',ownerName='OwnerQA',
    connectionId=crypto.randomUUID(),principalId='owner_approved',
    challenge=crypto.randomBytes(24).toString('hex')
  const targets=blocks.map((block,i)=>({x:i+1,y:64,z:2,block}))
  const chest={x:5,y:64,z:3}
  const items=[...new Set(blocks)].map(name=>({name,
    count:blocks.filter(b=>b===name).length}))
  const missionDir=path.join(root,'mission'),depositDir=path.join(root,'deposit')
  const openM=()=>openMission(missionDir,fs.existsSync(path.join(missionDir,'mission.json'))
    ?null:{sandboxOnly:true,ownerName,targets})
  const openD=()=>openDepositJournal(depositDir,fs.existsSync(path.join(depositDir,'deposit.json'))
    ?null:{sandboxOnly:true,ownerName,chest,items})
  const mission=openM(),deposit=openD()
  t.after(()=>{try{mission.close()}catch{};try{deposit.close()}catch{}})
  const now=Date.now()
  const bundle={
    bridge:sign({aud:'guiaia:server-connection:v1',worldId,connectionId,
      username:ownerName,challenge,issuedAt:now-1000,expiresAt:now+45000},srv),
    owner:sign({aud:'guiaia:principal-proof:v1',worldId,connectionId,
      principalId,challenge,issuedAt:now-1000,expiresAt:now+45000},user)
  }
  const planPayload={aud:'guiaia:session-delivery-plan:v1',sandboxOnly:true,
    worldId,botName,ownerName,principalId,connectionId,challenge,
    missionId:mission.view().missionId,planId:deposit.view().planId,
    targets,chest,items,nonce:crypto.randomUUID(),
    issuedAt:now-1000,expiresAt:now+40000}
  const signedPlan=sign(planPayload,operator)
  let revoked=false,online=true,witness=true,attestations=0,attempts=0,
    depositAttempts=0,stalled=false,allow=false
  const authority={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName,operatorPublicKeyPem:pub(operator),
    serverBridgePublicKeyPem:pub(srv),trustedPrincipals:{[principalId]:pub(user)},
    ledgerDirectory:path.join(root,'ledger'),requireLivePresence:true,
    requireRemoteCheckpoint:true,
    activeConnection:id=>online&&id===connectionId
      ?{connected:true,worldId,username:ownerName,connectionId}:null,
    isRevoked:()=>revoked,
    livePresence:async id=>{
      attestations++
      if(stalled)await new Promise(resolve=>{allow=resolve})
      return {connected:true,worldId,connectionId:id,issuedAt:Date.now()}
    },
    currentRegistryCheckpoint:()=>({sequence:1}),
    remoteCheckpointMatch:async()=>witness}
  const bot={username:botName}
  const adapters={
    createGatherAction:async target=>({sandboxOnly:true,ownerName,target,
      block:target.block,cancel(){},
      async gatherOne(){attempts++;return {ok:true,reason:'verified_inventory_drop',
        block:target.block,item:target.block,inventory_delta:1,dig_attempted:true}}}),
    createDepositAction:async step=>({sandboxOnly:true,ownerName,
      chest:step.chest,item:step.name,count:step.count,cancel(){},
      async depositOne(){depositAttempts++;return {ok:true,
        reason:'both_inventory_deltas_verified',name:step.name,count:step.count,
        chest:step.chest,transferAttempted:true,playerBefore:step.count,
        playerAfter:0,chestBefore:0,chestAfter:step.count}}})}
  const pipe=(opts={})=>createQaSignedDeliveryPipeline({bot,bundle,signedPlan,
    authority,missionJournal:mission,depositJournal:deposit,...adapters,...opts})
  return {root,mission,deposit,openM,openD,authority,bot,sign,operator,srv,user,
    bundle,signedPlan,planPayload,adapters,pipe,
    get gathers(){return attempts},get deposits(){return depositAttempts},
    get attests(){return attestations},revoke(){revoked=true},disconnect(){online=false},
    refuseWitness(){witness=false},stall(){stalled=true},unstall(){stalled=false;if(allow)allow()},
    get dirs(){return {missionDir,depositDir}}}
}

test('signed plan + live identity runs real durable gather and deposit journals',async t=>{
  const x=fixture(t),p=x.pipe()
  assert.equal((await p.runAll()).ok,true)
  assert.equal(p.status().phase,'completed')
  assert.equal(x.gathers,2)
  assert.equal(x.deposits,2)
  assert.equal(x.mission.view().receipts.length,2)
  assert.equal(x.deposit.view().receipts.length,2)
  assert.equal(fs.readdirSync(x.authority.ledgerDirectory).length,4)
  assert.ok(x.attests>=16)
  assert.equal((await p.runAll()).reason,'already_completed')
  assert.equal(x.gathers,2)
})

test('signed plan enforces exact session, world, bot and operator signature',t=>{
  const x=fixture(t)
  for(const change of [
    {worldId:'qa:other'},{botName:'OtherQA'},{ownerName:'OtherQA'},
    {principalId:'other'},{connectionId:crypto.randomUUID()},
    {challenge:crypto.randomBytes(24).toString('hex')},
    {missionId:crypto.randomUUID()},{planId:crypto.randomUUID()},
    {nonce:'not-a-uuid'},{aud:'wrong'},
    {expiresAt:Date.now()+9000000},{sandboxOnly:false}
  ]){
    const tok=x.sign({...x.planPayload,...change},x.operator)
    if(change.missionId||change.planId){
      assert.throws(()=>x.pipe({signedPlan:tok}),/approved plan/)
    }else{
      assert.throws(()=>x.pipe({signedPlan:tok}),/signed delivery|identity/)
    }
  }
  const stranger=crypto.generateKeyPairSync('ed25519')
  assert.throws(()=>x.pipe({signedPlan:x.sign(x.planPayload,stranger)}),/signature/)
  assert.equal(x.gathers,0)
})

test('signed plan rejects changed target, chest, resource count and extra keys',t=>{
  const x=fixture(t)
  for(const change of [
    {targets:[{x:77,y:64,z:2,block:'oak_log'},x.planPayload.targets[1]]},
    {targets:[x.planPayload.targets[0],x.planPayload.targets[0]]},
    {targets:[{...x.planPayload.targets[0],block:'bedrock'},x.planPayload.targets[1]]},
    {items:[{name:'oak_log',count:2},{name:'birch_log',count:1}]},
    {chest:{x:99,y:64,z:3}},
    {items:[{name:'oak_log',count:1}, {name:'oak_log',count:1}]},
    {extra:'injection'}
  ]){
    assert.throws(()=>x.pipe({signedPlan:x.sign({...x.planPayload,...change},x.operator)}),
      /plan|target|material|inventory|approved/)
  }
})

test('mutating signed evidence after gateway construction stops dispatch',async t=>{
  const x=fixture(t),p=x.pipe()
  x.signedPlan.payload.targets[0].x=444
  assert.equal((await p.runNext()).reason,'authorization_unavailable')
  assert.equal(x.gathers,0)
})

test('offline connection is denied even if old signed JOIN remains',async t=>{
  const x=fixture(t),p=x.pipe()
  x.disconnect()
  assert.equal((await p.runNext()).reason,'authorization_unavailable')
  assert.equal(x.gathers,0)
})

test('principal revocation between operations denies further gather',async t=>{
  const x=fixture(t),p=x.pipe()
  assert.equal((await p.runNext()).ok,true)
  x.revoke()
  assert.equal((await p.runNext()).reason,'authorization_unavailable')
  assert.equal(x.gathers,1)
  assert.equal(x.deposits,0)
})

test('remote witness disagreement blocks before any world action or nonce',async t=>{
  const x=fixture(t),p=x.pipe()
  x.refuseWitness()
  assert.equal((await p.runAll()).reason,'authorization_unavailable')
  assert.equal(x.gathers,0)
  assert.equal(fs.existsSync(x.authority.ledgerDirectory),false)
})

test('operator expiry before dispatch blocks even on signed live connection',async t=>{
  const x=fixture(t),p=x.pipe()
  x.signedPlan.payload.expiresAt=Date.now()-1000
  assert.equal((await p.runNext()).reason,'authorization_unavailable')
  assert.equal(x.gathers,0)
})

test('signed plan cannot construct without two independent live guard callbacks',t=>{
  const x=fixture(t)
  for(const key of ['requireLivePresence','requireRemoteCheckpoint','livePresence',
    'currentRegistryCheckpoint','remoteCheckpointMatch','ledgerDirectory']){
    const authority={...x.authority}
    delete authority[key]
    assert.throws(()=>x.pipe({authority}),/requires session/)
  }
})

test('adapter outside signed gather scope is rejected before journaling',async t=>{
  const x=fixture(t),p=x.pipe({createGatherAction:async target=>({
    sandboxOnly:true,ownerName:'OtherQA',target,block:target.block,
    gatherOne(){throw Error('must not run')}})})
  assert.equal((await p.runNext()).reason,'action_unavailable')
  assert.equal(x.gathers,0)
  assert.equal(x.mission.view().phase,'ready')
})

test('adapter outside signed chest scope is rejected before transfer',async t=>{
  const x=fixture(t,['oak_log'])
  const p=x.pipe({createDepositAction:async step=>({
    sandboxOnly:true,ownerName:'OwnerQA',chest:{x:100,y:64,z:3},
    item:step.name,count:step.count,
    depositOne(){throw Error('must not run')}})})
  assert.equal((await p.runNext()).ok,true)
  assert.equal((await p.runNext()).reason,'action_unavailable')
  assert.equal(x.deposits,0)
  assert.equal(x.deposit.view().phase,'ready')
})

test('replay ledger denies rolled-back mission with identical signed plan',async t=>{
  const x=fixture(t,['oak_log'])
  const missionFile=path.join(x.dirs.missionDir,'mission.json')
  const depositFile=path.join(x.dirs.depositDir,'deposit.json')
  const originalMission=fs.readFileSync(missionFile)
  const originalDeposit=fs.readFileSync(depositFile)
  const p=x.pipe()
  assert.equal((await p.runAll()).ok,true)
  assert.equal(x.gathers,1)
  assert.equal(x.deposits,1)
  x.mission.close();x.deposit.close()
  // Intentionally simulate a coherent rollback of BOTH local journals.
  fs.writeFileSync(missionFile,originalMission)
  fs.writeFileSync(depositFile,originalDeposit)
  const m=x.openM(),d=x.openD()
  try{
    const replay=x.pipe({missionJournal:m,depositJournal:d})
    assert.equal((await replay.runNext()).ok,false)
    assert.equal(m.view().phase,'paused')
    assert.equal(x.gathers,1)
    assert.equal(x.deposits,1)
  }finally{m.close();d.close()}
})

test('revoked during asynchronous adapter factory: second approval prevents dispatch',async t=>{
  const x=fixture(t)
  let entering,release
  const started=new Promise(resolve=>{entering=resolve})
  const original=x.adapters.createGatherAction
  const p=x.pipe({createGatherAction:async (...args)=>{
    entering()
    await new Promise(resolve=>{release=resolve})
    return original(...args)
  }})
  const pending=p.runNext()
  await started
  x.revoke();release()
  assert.equal((await pending).reason,'authorization_unavailable')
  assert.equal(x.gathers,0)
  assert.equal(fs.existsSync(x.authority.ledgerDirectory),false)
})

test('stop during stalled live check forbids action after stale response',async t=>{
  const x=fixture(t)
  x.stall()
  const p=x.pipe(),pending=p.runNext()
  await sleep(75)
  assert.equal(p.stop().ok,true)
  x.unstall()
  assert.equal((await pending).ok,false)
  assert.equal(x.gathers,0)
  assert.equal(x.mission.view().phase,'cancelled')
  assert.equal(x.deposit.view().phase,'cancelled')
})

test('operator signature is reverified for each step, never reused after tampering',async t=>{
  const x=fixture(t),p=x.pipe()
  assert.equal((await p.runNext()).ok,true)
  x.signedPlan.signature='A'.repeat(86)
  assert.equal((await p.runAll()).reason,'authorization_unavailable')
  assert.equal(x.gathers,1)
  assert.equal(x.deposits,0)
})

test('approval exposes immutable nested plan snapshot independent of source',t=>{
  const x=fixture(t),proof=verifyQaDeliveryPlan(x.signedPlan,x.authority)
  assert.ok(Object.isFrozen(proof.approvedPlan))
  assert.ok(Object.isFrozen(proof.approvedPlan.targets[0]))
  assert.ok(Object.isFrozen(proof.approvedPlan.chest))
  assert.ok(Object.isFrozen(proof.approvedPlan.items[0]))
  assert.throws(()=>{proof.approvedPlan.targets[0].x=999},TypeError)
  x.signedPlan.payload.chest.x=44
  assert.equal(proof.approvedPlan.chest.x,5)
})

test('last live checkpoint refusal inside adapter does not mutate world',async t=>{
  const x=fixture(t)
  let checks=0
  const authority={...x.authority,
    remoteCheckpointMatch:async()=>{checks++;return checks<=2}}
  const p=x.pipe({authority})
  assert.equal((await p.runNext()).ok,false)
  assert.equal(x.gathers,0)
  assert.equal(x.mission.view().phase,'paused')
  assert.equal(fs.existsSync(x.authority.ledgerDirectory),false)
})

test('witness withdrawal after first nonce reservation denies world dispatch',async t=>{
  const x=fixture(t)
  let checks=0
  const authority={...x.authority,
    remoteCheckpointMatch:async()=>{checks++;return checks<=3}}
  const p=x.pipe({authority})
  assert.equal((await p.runNext()).ok,false)
  assert.equal(x.gathers,0)
  assert.equal(x.mission.view().phase,'paused')
  assert.equal(fs.readdirSync(x.authority.ledgerDirectory).length,1)
  // The reserved step is not replayed even if the witness becomes available.
  const retry=x.pipe()
  assert.equal((await retry.runNext()).ok,false)
  assert.equal(x.gathers,0)
})

test('stop while simulated world action is pending requests cancellation and no receipt',async t=>{
  const x=fixture(t,['oak_log'])
  let started,release,cancelled=false
  const entered=new Promise(resolve=>{started=resolve})
  const p=x.pipe({createGatherAction:async target=>({sandboxOnly:true,
    ownerName:'OwnerQA',target,block:target.block,
    cancel(){cancelled=true},
    async gatherOne(){started();await new Promise(resolve=>{release=resolve})
      return {ok:true,reason:'verified_inventory_drop',block:target.block,
        item:target.block,inventory_delta:1,dig_attempted:true}
    }})})
  const pending=p.runNext()
  await entered
  assert.equal(x.mission.view().phase,'dispatching')
  assert.equal(p.stop().ok,true)
  assert.equal(cancelled,true)
  release()
  assert.equal((await pending).ok,false)
  assert.equal(x.mission.view().phase,'needs_review')
  assert.equal(x.mission.view().receipts.length,0)
  assert.equal(x.deposit.view().phase,'cancelled')
})

test('remote attestation never resolves: coordinator times out without world mutation',async t=>{
  const x=fixture(t)
  const authority={...x.authority,
    remoteCheckpointMatch:async()=>new Promise(()=>{})}
  const p=x.pipe({authority})
  assert.equal((await p.runNext()).reason,'authorization_unavailable')
  assert.equal(x.gathers,0)
  assert.equal(fs.existsSync(x.authority.ledgerDirectory),false)
})

test('inner live check hangs after durable journal begins: bounded pause, no mutation',async t=>{
  const x=fixture(t)
  let calls=0
  const original=x.authority.livePresence
  const authority={...x.authority,livePresence:id=>{
    calls++
    return calls===3?new Promise(()=>{}):original(id)
  }}
  const p=x.pipe({authority})
  const result=await p.runNext()
  assert.equal(result.ok,false)
  assert.equal(x.mission.view().phase,'paused')
  assert.equal(x.gathers,0)
  assert.equal(fs.existsSync(x.authority.ledgerDirectory),false)
})

test('last guard hangs after nonce barrier: bounded halt, no unverified receipt',async t=>{
  const x=fixture(t)
  let calls=0
  const original=x.authority.livePresence
  const authority={...x.authority,livePresence:id=>{
    calls++
    return calls===4?new Promise(()=>{}):original(id)
  }}
  const p=x.pipe({authority})
  assert.equal((await p.runNext()).ok,false)
  assert.equal(x.mission.view().phase,'paused')
  assert.equal(x.gathers,0)
  assert.equal(fs.readdirSync(x.authority.ledgerDirectory).length,1)
})

test('revocation during a real journal gather cancels adapter and denies success receipt',async t=>{
  const x=fixture(t,['oak_log'])
  let started,release,cancelled=false
  const entered=new Promise(resolve=>{started=resolve})
  const p=x.pipe({createGatherAction:async target=>({sandboxOnly:true,
    ownerName:'OwnerQA',target,block:target.block,
    cancel(){cancelled=true;release?.()},
    async gatherOne(){
      started()
      await new Promise(resolve=>{release=resolve})
      // Even a claimed success is not accepted after revocation.
      return {ok:true,reason:'verified_inventory_drop',block:target.block,
        item:target.block,inventory_delta:1,dig_attempted:true}
    }})})
  const pending=p.runNext()
  await entered
  x.revoke()
  assert.equal((await pending).ok,false)
  assert.equal(cancelled,true)
  assert.equal(x.mission.view().phase,'needs_review')
  assert.equal(x.mission.view().receipts.length,0)
})

test('witness mismatch while chest transfer pending cancels and requires review',async t=>{
  const x=fixture(t,['oak_log'])
  let started,release,cancelled=false
  const entered=new Promise(resolve=>{started=resolve})
  const p=x.pipe({createDepositAction:async step=>({sandboxOnly:true,
    ownerName:'OwnerQA',item:step.name,count:step.count,chest:step.chest,
    cancel(){cancelled=true;release?.()},
    async depositOne(){started();await new Promise(resolve=>{release=resolve})
      return {ok:true,reason:'both_inventory_deltas_verified',
        name:step.name,count:step.count,chest:step.chest,
        playerBefore:1,playerAfter:0,chestBefore:0,chestAfter:1,
        transferAttempted:true}
    }})})
  assert.equal((await p.runNext()).ok,true)
  const pending=p.runNext()
  await entered
  x.refuseWitness()
  assert.equal((await pending).ok,false)
  assert.equal(cancelled,true)
  assert.equal(x.deposit.view().phase,'needs_review')
  assert.equal(x.deposit.view().receipts.length,0)
})

test('stalled network while gathering stops at lease boundary',async t=>{
  const x=fixture(t,['oak_log'])
  let started,release,cancelled=false,freeze=false
  const entered=new Promise(resolve=>{started=resolve})
  const original=x.authority.livePresence
  const authority={...x.authority,livePresence:id=>freeze
    ?new Promise(()=>{}):original(id)}
  const p=x.pipe({authority,createGatherAction:async target=>({sandboxOnly:true,
    ownerName:'OwnerQA',target,block:target.block,
    cancel(){cancelled=true;release?.()},
    async gatherOne(){started();await new Promise(resolve=>{release=resolve})
      return {ok:true,reason:'verified_inventory_drop',block:target.block,
        item:target.block,inventory_delta:1,dig_attempted:true}
    }})})
  const pending=p.runNext()
  await entered
  freeze=true
  assert.equal((await pending).ok,false)
  assert.equal(cancelled,true)
  assert.equal(x.mission.view().phase,'needs_review')
  assert.equal(x.mission.view().receipts.length,0)
})
