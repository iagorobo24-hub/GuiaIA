'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {generateKeyPairSync,sign,randomUUID}=require('node:crypto')
const {EventEmitter}=require('node:events')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {verifyGrant,reserveGrantOnce,createOperatorAuthorizedQaDeposit}=require('../src/operator_authorization')
const chest={x:4,y:64,z:3}
function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-capability-test-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const {privateKey,publicKey}=generateKeyPairSync('ed25519')
  const authority={worldId:'qa:world:1',botName:'GuiaIA_QA',
    sandboxOnly:true,identityMode:'unverified_offline_lab',
    publicKeyPem:publicKey.export({type:'spki',format:'pem'}),
    ledgerDirectory:path.join(root,'operator-grant-ledger')}
  const plan={sandboxOnly:true,ownerName:'OwnerQA',chest:{...chest},
    item:'oak_log',count:1}
  const issue=override=>{
    const now=Date.now()
    const payload={version:1,audience:'guiaia:deposit-one:v1',
      worldId:authority.worldId,botName:authority.botName,
      ownerName:'OwnerQA',chest:{...chest},item:'oak_log',count:1,
      nonce:randomUUID(),issuedAt:now-1500,expiresAt:now+120000,
      sandboxOnly:true,...override}
    return {payload,signature:sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString('base64url')}
  }
  const bot=new EventEmitter()
  bot.username='GuiaIA_QA'
  bot.players={OwnerQA:{entity:{position:{x:2,y:64,z:2}}}}
  bot.entity={position:{x:2,y:64,z:2}}
  bot.health=20
  let inventory=1,mutations=0
  const window={inventoryStart:27,inventoryEnd:63,slots:Array(63).fill(null),
    close(){},
    async deposit(_type,_meta,count){
      mutations++
      inventory-=count
      this.slots[27]=inventory>0?{name:'oak_log',count:inventory}:null
      this.slots[0]={name:'oak_log',count}
    }}
  window.slots[27]={name:'oak_log',count:1}
  bot.inventory={items:()=>inventory?[{name:'oak_log',count:inventory}]:[]}
  bot.registry={itemsByName:{oak_log:{id:20}}}
  bot.blockAt=()=>({name:'chest'})
  bot.openContainer=async()=>window
  return {authority,plan,issue,bot,get mutations(){return mutations},get inventory(){return inventory}}
}
test('valid signed one-chest operator capability permits exactly one real adapter call',async t=>{
  const f=setup(t),grant=f.issue()
  const adapter=createOperatorAuthorizedQaDeposit(f.bot,f.plan,grant,f.authority)
  assert.equal((await adapter.depositOne()).ok,true)
  assert.equal(f.mutations,1)
  assert.equal(f.inventory,0)
  assert.equal((await adapter.depositOne()).reason,'signed_grant_already_used')
  assert.equal(f.mutations,1)
  const records=fs.readdirSync(f.authority.ledgerDirectory)
  assert.equal(records.length,1)
  assert.equal(fs.statSync(f.authority.ledgerDirectory).mode&0o777,0o700)
  assert.equal(fs.statSync(path.join(f.authority.ledgerDirectory,records[0])).mode&0o777,0o600)
})
test('nickname-only command has no capability and never opens a chest',t=>{
  const f=setup(t)
  let opened=false;f.bot.openContainer=async()=>{opened=true}
  assert.throws(()=>createOperatorAuthorizedQaDeposit(f.bot,f.plan,null,f.authority),/Missing trusted|Unsafe/)
  assert.equal(opened,false)
  assert.equal(fs.existsSync(f.authority.ledgerDirectory),false)
})
test('modified or forged capability signature is rejected',t=>{
  const f=setup(t),signed=f.issue()
  for(const forged of [
    {...signed,payload:{...signed.payload,item:'birch_log'}},
    {...signed,payload:{...signed.payload,chest:{x:5,y:64,z:3}}},
    {...signed,payload:{...signed.payload,ownerName:'Another'}},
    {...signed,signature:'A'.repeat(86)},
    {...signed,payload:{...signed.payload,nonce:randomUUID()}},
  ]) assert.throws(()=>verifyGrant(forged,f.authority),/signature invalid|Unsafe/)
})
test('wrong public key, wrong world and wrong runtime identity all fail closed',t=>{
  const f=setup(t),g=f.issue()
  const other=setup(t)
  assert.throws(()=>verifyGrant(g,{...f.authority,publicKeyPem:other.authority.publicKeyPem}),/signature invalid/)
  assert.throws(()=>verifyGrant(g,{...f.authority,worldId:'wrong-world'}),/Unsafe/)
  assert.throws(()=>verifyGrant(g,{...f.authority,botName:'WrongBot'}),/Unsafe/)
  assert.throws(()=>verifyGrant(g,{...f.authority,identityMode:'server_verified'}),/Missing trusted/)
})
test('expired and too-long signed grants fail even with valid cryptographic signature',t=>{
  const f=setup(t)
  const now=Date.now()
  const expired=f.issue({issuedAt:now-50000,expiresAt:now-1000})
  const long=f.issue({issuedAt:now-1000,expiresAt:now+3600000})
  const future=f.issue({issuedAt:now+100000,expiresAt:now+160000})
  for(const grant of [expired,long,future])assert.throws(()=>verifyGrant(grant,f.authority),/Expired/)
})
test('wrong chest, wrong item, wrong quantity or wrong bot rejected before transfer',t=>{
  const f=setup(t),g=f.issue()
  for(const [plan,bot] of [
    [{...f.plan,chest:{x:6,y:64,z:3}},f.bot],
    [{...f.plan,item:'birch_log'},f.bot],
    [{...f.plan,count:2},f.bot],
    [f.plan,{...f.bot,username:'AnotherBot'}]
  ])assert.throws(()=>createOperatorAuthorizedQaDeposit(bot,plan,g,f.authority),/differs/)
  assert.equal(f.mutations,0)
})
test('nonce reservation survives simulated crash and blocks fresh adapter',async t=>{
  const f=setup(t),g=f.issue()
  reserveGrantOnce(f.authority.ledgerDirectory,g.payload.nonce)
  const adapter=createOperatorAuthorizedQaDeposit(f.bot,f.plan,g,f.authority)
  await assert.rejects(adapter.depositOne(),/EEXIST/)
  assert.equal(f.mutations,0)
})
test('two concurrent attempts with the same signed grant cannot both commit',async t=>{
  const f=setup(t),g=f.issue()
  const a=createOperatorAuthorizedQaDeposit(f.bot,f.plan,g,f.authority)
  const b=createOperatorAuthorizedQaDeposit(f.bot,f.plan,g,f.authority)
  const results=await Promise.allSettled([a.depositOne(),b.depositOne()])
  assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.ok).length,1)
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='EEXIST').length,1)
  assert.equal(f.mutations,1)
})
test('stale signed nonce fails even if fresh window, bot and authority supplied',async t=>{
  const f=setup(t),g=f.issue()
  assert.equal((await createOperatorAuthorizedQaDeposit(f.bot,f.plan,g,f.authority).depositOne()).ok,true)
  await assert.rejects(createOperatorAuthorizedQaDeposit(f.bot,f.plan,g,f.authority).depositOne(),/EEXIST/)
  assert.equal(f.mutations,1)
})
test('unsafe payload types and extra fields cannot be signed into authority',t=>{
  const f=setup(t)
  for(const bad of [
    {count:0},{count:99},{item:'diamond'},
    {sandboxOnly:false},{nonce:'../../etc/passwd'},
    {chest:{x:Infinity,y:64,z:3}},
    {additionalCommand:'/op OwnerQA'},{audience:'admin'}
  ])assert.throws(()=>verifyGrant(f.issue(bad),f.authority),/Unsafe/)
})
test('operator authority rejects symlink replay ledger without following it',t=>{
  const f=setup(t)
  const target=path.join(path.dirname(f.authority.ledgerDirectory),'target')
  fs.mkdirSync(target)
  fs.symlinkSync(target,f.authority.ledgerDirectory)
  assert.throws(()=>reserveGrantOnce(f.authority.ledgerDirectory,randomUUID()),/Unsafe/)
  assert.equal(fs.readdirSync(target).length,0)
})
test('mutating plan coordinates after authorization cannot redirect a chest transfer',async t=>{
  const f=setup(t),signed=f.issue()
  const originalPosition={...f.plan.chest}
  f.bot.blockAt=p=>{
    assert.deepEqual({x:p.x,y:p.y,z:p.z},originalPosition)
    return {name:'chest'}
  }
  const adapter=createOperatorAuthorizedQaDeposit(f.bot,f.plan,signed,f.authority)
  f.plan.chest.x=999
  f.plan.item='birch_log'
  f.plan.count=2
  assert.equal((await adapter.depositOne()).ok,true)
  assert.equal(f.mutations,1)
})
test('grant that expires after construction but before dispatch never touches Minecraft',async t=>{
  const f=setup(t),now=Date.now()
  const g=f.issue({issuedAt:now-1300,expiresAt:now+100})
  const adapter=createOperatorAuthorizedQaDeposit(f.bot,f.plan,g,f.authority)
  await new Promise(resolve=>setTimeout(resolve,180))
  await assert.rejects(adapter.depositOne(),/Expired/)
  assert.equal(f.mutations,0)
  assert.equal(fs.existsSync(f.authority.ledgerDirectory),false)
})
test('unknown signature key type (RSA) cannot grant access',t=>{
  const f=setup(t),g=f.issue()
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048})
  const other={...f.authority,publicKeyPem:publicKey.export({type:'spki',format:'pem'})}
  assert.throws(()=>verifyGrant(g,other),/Ed25519/)
})
