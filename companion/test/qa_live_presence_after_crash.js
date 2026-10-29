'use strict'
// The actual Fabric server has already been SIGKILLed by the disposable QA
// harness. No DISCONNECT is emitted: stale signed JOIN remains on disk.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const {EventEmitter}=require('node:events')
const {createPinnedQaServerBridgeAuthority}=require('../src/fabric_bridge_reader')
const {createPinnedQaLivePresenceAuthority}=require('../src/live_presence')
const {createQaSessionActionGateway}=require('../src/session_identity')
const [eventsFile,pubFile,connectionId,journalDirectory]=process.argv.slice(2)
if(![eventsFile,pubFile,journalDirectory].every(p=>p?.startsWith('/tmp/guiaia-fabric-bridge-qa-')) ||
   !/^[0-9a-f-]{36}$/.test(connectionId||''))throw Error('Disposable server evidence required')
const worldId='qa:real-fabric:25593'
const key=fs.readFileSync(pubFile,'utf8')
const source=createPinnedQaServerBridgeAuthority(eventsFile,key,worldId)
const live=createPinnedQaLivePresenceAuthority({
  port:25594,worldId,serverBridgePublicKeyPem:key})
const sign=(payload,privateKey)=>({payload,signature:crypto.sign(null,
  Buffer.from(JSON.stringify(payload)),privateKey).toString('base64url')})
async function run(){
  const stale=source.activeConnection(connectionId)
  assert.equal(stale?.connected,true,'stale signed JOIN required to exercise threat')
  const proof=source.joinProof(connectionId)
  const principal=crypto.generateKeyPairSync('ed25519')
  const operator=crypto.generateKeyPairSync('ed25519')
  const now=Date.now()
  const principalId='qa_crash_principal'
  const session={bridge:proof,owner:sign({
    aud:'guiaia:principal-proof:v1',worldId,connectionId,
    principalId,challenge:proof.payload.challenge,
    issuedAt:now-1000,expiresAt:now+20000},principal.privateKey)}
  const grant=sign({aud:'guiaia:session-deposit:v1',worldId,
    botName:'GuiaIA_QA',ownerName:'OwnerQA',principalId,connectionId,
    challenge:proof.payload.challenge,
    chest:{x:4,y:64,z:3},item:'birch_log',count:1,
    nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+20000},
    operator.privateKey)
  const bot=new EventEmitter()
  let worldTouches=0
  Object.assign(bot,{username:'GuiaIA_QA',health:20,
    entity:{position:{x:2,y:64,z:3}},
    players:{OwnerQA:{entity:{position:{x:2,y:64,z:3}}}},
    inventory:{items:()=>[]},
    blockAt:()=>{worldTouches++;throw Error('Unsafe block read after crash')},
    openContainer:()=>{worldTouches++;throw Error('Unsafe chest open after crash')}
  })
  const authority={sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
    worldId,botName:'GuiaIA_QA',
    serverBridgePublicKeyPem:key,
    operatorPublicKeyPem:operator.publicKey.export({format:'pem',type:'spki'}),
    trustedPrincipals:{[principalId]:principal.publicKey.export({format:'pem',type:'spki'})},
    isRevoked:()=>false,activeConnection:id=>source.activeConnection(id),
    requireLivePresence:true,livePresence:live.livePresence,
    ledgerDirectory:path.join(journalDirectory,'spent-after-crash')}
  const gateway=createQaSessionActionGateway(bot,authority)
  const adapter=gateway.createDeposit(session,grant)
  let refused=false
  try{await adapter.depositOne()}
  catch(e){
    refused=/Live Fabric query unavailable|Live Fabric server timeout/.test(e.message)
  }
  assert.equal(refused,true,'stale JOIN must not bypass live challenge')
  assert.equal(worldTouches,0)
  assert.equal(fs.existsSync(authority.ledgerDirectory),false)
  console.log('GUIAIA_REAL_LIVE_PRESENCE_CRASH_QA_EVIDENCE='+JSON.stringify({
    result:'pass',real_fabric_process_killed:true,old_signed_join_still_active:true,
    fresh_challenge_failed_closed:true,stale_join_replay_denied:true,
    world_operations:worldTouches,nonce_spent:false,production:false}))
}
run().catch(e=>{console.error('Live crash verifier: '+e.message);process.exitCode=1})
