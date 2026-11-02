'use strict'
// Disposable IN-MEMORY QA simulator of a separately running monotonic source.
// NO durable storage, restart recovery, production availability or encryption.
// Private key received exclusively via QA parent IPC, not a deployed service.
const crypto=require('node:crypto')
const http=require('node:http')
const {publicKey,validateAdvance,
  createPinnedQaRemoteCheckpointClient}=require('../src/remote_checkpoint')
const {createPinnedQaFloorClient}=require('../src/qa_floor_client')
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const fp=key=>crypto.createHash('sha256')
  .update(key.export({format:'der',type:'spki'})).digest('hex')
let started=false,head=null,server=null,config=null
const sign=x=>({payload:x,signature:crypto.sign(null,
  Buffer.from(JSON.stringify(x)),config.key).toString('base64url')})
function exact(a,b){return a.sequence===b.sequence&&
  a.registrySha256===b.registrySha256}
async function handleMessage(m){
  if(m?.type==='start'&&!started){
    if(m.qa_only!==true||typeof m.worldId!=='string'||
       !/^qa:[A-Za-z0-9:_-]{1,61}$/.test(m.worldId))
      throw Error('Disposable QA anchor only')
    const op=publicKey(m.operatorPublicKeyPem)
    const wit=publicKey(m.witnessPublicKeyPem)
    const floor=publicKey(m.custodianPublicKeyPem)
    const key=crypto.createPrivateKey(m.highWaterPrivateKeyPem)
    if(key.asymmetricKeyType!=='ed25519')throw Error('Ed25519 only')
    const values=[fp(op),fp(wit),fp(floor),fp(crypto.createPublicKey(key))]
    if(new Set(values).size!==4)throw Error('Independent signer required')
    const witness=createPinnedQaRemoteCheckpointClient({
      url:m.witnessUrl,worldId:m.worldId,
      operatorPublicKeyPem:m.operatorPublicKeyPem,
      witnessPublicKeyPem:m.witnessPublicKeyPem})
    const custodian=createPinnedQaFloorClient({
      url:m.floorUrl,worldId:m.worldId,
      operatorPublicKeyPem:m.operatorPublicKeyPem,
      witnessPublicKeyPem:m.witnessPublicKeyPem,
      anchorPublicKeyPem:m.custodianPublicKeyPem})
    config={worldId:m.worldId,key,operator:op,
      op:values[0],wit:values[1],floor:values[2],witness,custodian}
    server=http.createServer((req,res)=>{
      const deadline=setTimeout(()=>req.socket.destroy(),1500)
      deadline.unref()
      res.once('close',()=>clearTimeout(deadline))
      const deny=()=>{res.writeHead(403);res.end('denied')}
      if(req.socket.remoteAddress!=='127.0.0.1'||
         !req.headers.host?.startsWith('127.0.0.1:')||
         req.method!=='GET')return deny()
      let u
      try{u=new URL(req.url,'http://127.0.0.1')}
      catch{return deny()}
      const nonce=u.searchParams.get('nonce')
      if(u.pathname!=='/high-water'||u.searchParams.size!==1||
         !UUID.test(nonce||'')||!head)return deny()
      const now=Date.now()
      const payload={aud:'guiaia:external-high-water-qa:v1',
        worldId:config.worldId,operatorFingerprint:config.op,
        witnessFingerprint:config.wit,custodianFingerprint:config.floor,
        sequence:head.sequence,registrySha256:head.registrySha256,
        nonce,issuedAt:now,expiresAt:now+3000}
      res.setHeader('content-type','application/json')
      res.end(JSON.stringify(sign(payload)))
    })
    await new Promise((ok,fail)=>{server.once('error',fail);
      server.listen(0,'127.0.0.1',ok)})
    started=true
    process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port+'/'})
  }else if(m?.type==='advance'&&started){
    const p=validateAdvance(m.ticket,config.operator,config.worldId,config.op)
    function cas(){
      if(head===null){
        if(p.previousSequence!==-1||p.sequence!==0)
          throw Error('Initial high-water requires signed QA bootstrap')
      }else if(p.previousSequence!==head.sequence||
               p.previousSha256!==head.registrySha256||
               p.sequence!==head.sequence+1)
        throw Error('High-water CAS rejected')
    }
    cas()
    const a=await config.witness.latest()
    const b=await config.custodian.latest()
    cas()
    if(!exact(a,p)||!exact(b,p))
      throw Error('Both independent QA sources must confirm high-water')
    head={sequence:p.sequence,registrySha256:p.registrySha256}
    process.send({type:'advanced',requestId:m.requestId,
      sequence:head.sequence})
  }else if(m?.type==='stop'){
    if(server)await new Promise(done=>server.close(done))
    process.exit(0)
  }else throw Error('Unknown QA simulator command')
}
process.on('message',m=>{
  void handleMessage(m).catch(e=>{
    if(process.connected)process.send({type:'denied',
      requestId:m?.requestId,reason:String(e.message||'denied').slice(0,100)})
  })
})
