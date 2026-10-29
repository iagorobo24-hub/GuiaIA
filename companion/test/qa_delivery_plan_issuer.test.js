'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {openMission}=require('../src/mission')
const {openDepositJournal}=require('../src/deposit')
const {issueQaDeliveryPlan}=require('../src/qa_delivery_plan_issuer')
const {verifyQaDeliveryPlan,createQaSignedDeliveryPipeline}=
  require('../src/qa_signed_delivery')

function fixture(t,blocks=['oak_log','birch_log']){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-qa-plan-issuer-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const pair=()=>crypto.generateKeyPairSync('ed25519')
  const operator=pair(),owner=pair(),server=pair()
  const pub=who=>who.publicKey.export({format:'pem',type:'spki'})
  const sign=(payload,who)=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),who.privateKey).toString('base64url')})
  const worldId='qa:delivery',botName='GuiaIA_QA',ownerName='OwnerQA',
    principalId='trusted_qa',connectionId=crypto.randomUUID(),
    challenge=crypto.randomBytes(24).toString('hex')
  const now=Date.now()
  const bundle={bridge:sign({aud:'guiaia:server-connection:v1',
    worldId,connectionId,username:ownerName,challenge,
    issuedAt:now-1000,expiresAt:now+42000},server),
    owner:sign({aud:'guiaia:principal-proof:v1',worldId,connectionId,
      principalId,challenge,issuedAt:now-1000,expiresAt:now+42000},owner)}
  const targets=blocks.map((block,i)=>({x:1+i,y:64,z:2,block}))
  const chest={x:5,y:64,z:3}
  const items=[...new Set(blocks)].map(name=>({name,
    count:blocks.filter(b=>b===name).length}))
  const reviewedSpec={sandboxOnly:true,ownerName,targets,chest,items}
  const mission=openMission(path.join(root,'mission'),{
    sandboxOnly:true,ownerName,targets})
  const deposit=openDepositJournal(path.join(root,'deposit'),{
    sandboxOnly:true,ownerName,chest,items})
  t.after(()=>{try{mission.close()}catch{};try{deposit.close()}catch{}})
  let online=true,revoked=false,witness=true,physicalActions=0
  const bot={username:botName}
  const authority={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName,operatorPublicKeyPem:pub(operator),
    serverBridgePublicKeyPem:pub(server),
    trustedPrincipals:{[principalId]:pub(owner)},
    ledgerDirectory:path.join(root,'action-ledger'),
    requireLivePresence:true,requireRemoteCheckpoint:true,
    livePresence:async id=>({worldId,connectionId:id,connected:online,issuedAt:Date.now()}),
    currentRegistryCheckpoint:()=>({sequence:1}),
    remoteCheckpointMatch:async()=>witness,
    activeConnection:id=>online&&id===connectionId?{
      worldId,connectionId,username:ownerName,connected:true}:null,
    isRevoked:()=>revoked}
  const args={bot,bundle,authority,operatorPrivateKey:operator.privateKey,
    reviewedSpec,missionJournal:mission,depositJournal:deposit,
    approvalDirectory:path.join(root,'issuance-ledger')}
  const issue=overrides=>issueQaDeliveryPlan({...args,...overrides})
  function pipeline(issued){
    return createQaSignedDeliveryPipeline({bot,bundle,authority,
      signedPlan:issued.signedPlan,missionJournal:mission,depositJournal:deposit,
      createGatherAction:async target=>({sandboxOnly:true,ownerName,
        target,block:target.block,cancel(){},async gatherOne(){
          physicalActions++;return {ok:true,reason:'verified_inventory_drop',
            block:target.block,item:target.block,inventory_delta:1,dig_attempted:true}
        }}),
      createDepositAction:async step=>({sandboxOnly:true,ownerName,
        chest:step.chest,item:step.name,count:step.count,cancel(){},
        async depositOne(){physicalActions++;return {ok:true,
          reason:'both_inventory_deltas_verified',name:step.name,
          count:step.count,chest:step.chest,transferAttempted:true,
          playerBefore:step.count,playerAfter:0,chestBefore:0,
          chestAfter:step.count}
        }})})
  }
  return {...args,root,operator,owner,server,sign,issue,pipeline,
    get actions(){return physicalActions},
    disconnect(){online=false},revoke(){revoked=true},witnessDown(){witness=false}}
}

test('operator-issued signed plan executes two real durable journals end-to-end',async t=>{
  const x=fixture(t),issued=x.issue()
  const verified=verifyQaDeliveryPlan(issued.signedPlan,x.authority)
  assert.deepEqual(verified.approvedPlan,issued.approvedPlan)
  assert.equal(issued.signedPlan.payload.missionId,x.missionJournal.view().missionId)
  assert.equal(issued.signedPlan.payload.planId,x.depositJournal.view().planId)
  assert.equal(issued.signedPlan.payload.connectionId,x.bundle.bridge.payload.connectionId)
  const pipe=x.pipeline(issued)
  assert.equal((await pipe.runAll()).ok,true)
  assert.equal(x.actions,4)
  assert.equal(x.missionJournal.view().receipts.length,2)
  assert.equal(x.depositJournal.view().receipts.length,2)
  assert.equal(pipe.status().phase,'completed')
  assert.equal(fs.readdirSync(x.approvalDirectory).length,1)
  assert.equal(fs.readdirSync(x.authority.ledgerDirectory).length,4)
})

test('operator cannot issue another signed plan for the same durable journal pair',t=>{
  const x=fixture(t)
  const first=x.issue(),firstSig=first.signedPlan.signature
  assert.throws(()=>x.issue(),e=>e.code==='EEXIST')
  assert.equal(fs.readdirSync(x.approvalDirectory).length,1)
  assert.equal(first.signedPlan.signature,firstSig)
})

test('plan and signed token snapshots cannot be mutated by caller',t=>{
  const x=fixture(t),result=x.issue()
  assert.ok(Object.isFrozen(result.signedPlan))
  assert.ok(Object.isFrozen(result.signedPlan.payload.targets[0]))
  assert.ok(Object.isFrozen(result.approvedPlan.chest))
  assert.throws(()=>{result.signedPlan.payload.targets[0].x=100},TypeError)
  assert.throws(()=>{result.approvedPlan.items[0].count=7},TypeError)
})

test('rejected scope changes do not create a signed plan or consume issuance nonce',t=>{
  const x=fixture(t)
  for(const bad of [
    {...x.reviewedSpec,targets:[{...x.reviewedSpec.targets[0],x:50},x.reviewedSpec.targets[1]]},
    {...x.reviewedSpec,chest:{x:14,y:64,z:3}},
    {...x.reviewedSpec,ownerName:'Stranger'},
    {...x.reviewedSpec,items:[{name:'oak_log',count:2},{name:'birch_log',count:1}]},
    {...x.reviewedSpec,extra:'not-allowed'},
    {...x.reviewedSpec,targets:[{...x.reviewedSpec.targets[0],block:'stone'},x.reviewedSpec.targets[1]]},
    {...x.reviewedSpec,targets:[{x:1,y:64,z:2},x.reviewedSpec.targets[1]]}
  ])assert.throws(()=>x.issue({reviewedSpec:bad}))
  assert.equal(fs.existsSync(x.approvalDirectory),false)
  assert.equal(x.actions,0)
  assert.ok(x.issue().signedPlan.signature)
})

test('operator key mismatch and RSA key are rejected before issuance',t=>{
  const x=fixture(t)
  const stranger=crypto.generateKeyPairSync('ed25519')
  assert.throws(()=>x.issue({operatorPrivateKey:stranger.privateKey}),/operator private key/)
  const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048})
  assert.throws(()=>x.issue({operatorPrivateKey:rsa.privateKey}),/operator private key/)
  assert.equal(fs.existsSync(x.approvalDirectory),false)
})

test('private key PEM input is supported but never included in emitted plan',t=>{
  const x=fixture(t)
  const pem=x.operator.privateKey.export({format:'pem',type:'pkcs8'})
  const result=x.issue({operatorPrivateKey:pem})
  assert.equal(result.signedPlan.signature.length,86)
  assert.equal(JSON.stringify(result).includes('PRIVATE KEY'),false)
})

test('offline connection and revoked principal cannot issue an authorization',t=>{
  for(const failure of ['disconnect','revoke']){
    const x=fixture(t)
    x[failure]()
    assert.throws(()=>x.issue(),/matching connection|revoked/)
    assert.equal(fs.existsSync(x.approvalDirectory),false)
  }
})

test('changed owner or bot identity prevents operator issuance',t=>{
  const x=fixture(t)
  assert.throws(()=>x.issue({bot:{username:'WrongBot'}}),/authenticated session/)
  assert.throws(()=>x.issue({reviewedSpec:{...x.reviewedSpec,ownerName:'OtherQA'}}))
  assert.equal(fs.existsSync(x.approvalDirectory),false)
})

test('session must have at least 1500 ms left before signing',t=>{
  const x=fixture(t)
  x.bundle.bridge.payload.expiresAt=Date.now()+800
  assert.throws(()=>x.issue(),/scope invalid|evidence verification/)
  assert.equal(fs.existsSync(x.approvalDirectory),false)
})

test('invalid issuance duration and relative storage path are denied',t=>{
  const x=fixture(t)
  for(const lifetimeMs of [0,1,1500,300001,NaN,'10000'])
    assert.throws(()=>x.issue({lifetimeMs}),/operator-reviewed/)
  assert.throws(()=>x.issue({approvalDirectory:'relative/ledger'}),/operator-reviewed/)
  assert.equal(fs.existsSync(x.approvalDirectory),false)
})

test('journal already advanced cannot receive a new signed plan',async t=>{
  const x=fixture(t,['oak_log'])
  await x.missionJournal.runNext({sandboxOnly:true,ownerName:'OwnerQA',
    target:{x:1,y:64,z:2,block:'oak_log'},block:'oak_log',
    async gatherOne(){return {ok:true,reason:'verified_inventory_drop',
      block:'oak_log',item:'oak_log',inventory_delta:1,dig_attempted:true}}
  })
  assert.throws(()=>x.issue(),/journals differ/)
  assert.equal(fs.existsSync(x.approvalDirectory),false)
})

test('journal configuration race fails closed before reserving issuance',t=>{
  const x=fixture(t)
  let reads=0
  const original=x.missionJournal.view
  const changing={view:()=>{
    reads++
    const state=original()
    if(reads>=2)state.targets[0].x=888
    return state
  }}
  assert.throws(()=>x.issue({missionJournal:changing}),/changed while preparing/)
  assert.equal(fs.existsSync(x.approvalDirectory),false)
})

test('issuance ledger persists one-use marker before reporting success',t=>{
  const x=fixture(t),issued=x.issue()
  const [entry]=fs.readdirSync(x.approvalDirectory)
  assert.match(entry,/^[a-f0-9]{64}\.used$/)
  assert.equal(fs.statSync(x.approvalDirectory).mode&0o777,0o700)
  assert.equal(fs.statSync(path.join(x.approvalDirectory,entry)).mode&0o777,0o600)
  assert.equal(issued.signedPlan.payload.expiresAt<=x.bundle.bridge.payload.expiresAt,true)
  assert.equal(issued.signedPlan.payload.expiresAt<=x.bundle.owner.payload.expiresAt,true)
})

test('issue operation does not touch either Minecraft journal world adapter',t=>{
  const x=fixture(t)
  x.issue()
  assert.equal(x.actions,0)
  assert.equal(x.missionJournal.view().phase,'ready')
  assert.equal(x.depositJournal.view().phase,'ready')
  assert.equal(fs.existsSync(x.authority.ledgerDirectory),false)
})
