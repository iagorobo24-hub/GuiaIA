'use strict'
// Signed witness for disposable QA ONLY. The witness must be operated
// independently of the registry host in a future, production-quality design.
const crypto=require('node:crypto')
const http=require('node:http')
const https=require('node:https')
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX=/^[0-9a-f]{64}$/
const NAME=/^[A-Za-z0-9:_-]{1,64}$/
const PROOF=['aud','worldId','operatorFingerprint','sequence','registrySha256',
  'nonce','issuedAt','expiresAt']
const TICKET=['aud','worldId','operatorFingerprint','previousSequence',
  'previousSha256','sequence','registrySha256','nonce','issuedAt','expiresAt']
const CHECKPOINT=['version','worldId','operatorFingerprint','sequence','registrySha256']
const exact=(v,fields)=>v!==null&&typeof v==='object'&&
  Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k))
const publicKey=(pem)=>{
  let key
  try{key=crypto.createPublicKey(pem)}
  catch{throw Error('Invalid pinned QA checkpoint authority')}
  if(key.asymmetricKeyType!=='ed25519')throw Error('QA checkpoint requires Ed25519 key')
  return key
}
function validHead(p,worldId,fingerprint){
  return exact(p,CHECKPOINT)&&p.version===1&&p.worldId===worldId&&
    p.operatorFingerprint===fingerprint&&Number.isSafeInteger(p.sequence)&&
    p.sequence>=0&&HEX.test(p.registrySha256||'')
}
function verifySigned(token,key){
  if(!exact(token,['payload','signature'])||
     typeof token.signature!=='string'||
     !/^[A-Za-z0-9_-]{86}$/.test(token.signature))
    throw Error('Invalid signed QA checkpoint envelope')
  const b=Buffer.from(token.signature,'base64url')
  if(b.length!==64||!crypto.verify(null,Buffer.from(JSON.stringify(token.payload)),key,b))
    throw Error('Untrusted QA checkpoint signature')
  return token.payload
}
function validateAdvance(ticket,key,worldId,fingerprint,now=Date.now()){
  const p=verifySigned(ticket,key)
  if(!exact(p,TICKET)||p.aud!=='guiaia:checkpoint-advance:v1'||
     p.worldId!==worldId||p.operatorFingerprint!==fingerprint||
     !Number.isSafeInteger(p.previousSequence)||p.previousSequence < -1||
     !Number.isSafeInteger(p.sequence)||p.sequence!==p.previousSequence+1||
     (p.previousSequence===-1?p.previousSha256!==null:!HEX.test(p.previousSha256||''))||
     !HEX.test(p.registrySha256||'')||!UUID.test(p.nonce||'')||
     !Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||
     p.issuedAt>now+2000||p.expiresAt<now||
     p.expiresAt-p.issuedAt>60000||p.expiresAt-p.issuedAt<1000)
    throw Error('Unsafe signed checkpoint advancement')
  return p
}
function verifyWitnessResponse(token,key,{worldId,operatorFingerprint,nonce},now=Date.now()){
  const p=verifySigned(token,key)
  if(!exact(p,PROOF)||p.aud!=='guiaia:remote-checkpoint:v1'||
     p.worldId!==worldId||p.operatorFingerprint!==operatorFingerprint||
     !UUID.test(p.nonce||'')||p.nonce!==nonce||
     !Number.isSafeInteger(p.sequence)||p.sequence<0||
     !HEX.test(p.registrySha256||'')||
     !Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||
     p.expiresAt-p.issuedAt!==3000||p.issuedAt>now+1000||
     now-p.issuedAt>1500||p.expiresAt<now)
    throw Error('Stale or mismatched independent checkpoint proof')
  return Object.freeze({version:1,worldId,operatorFingerprint,
    sequence:p.sequence,registrySha256:p.registrySha256})
}
function createPinnedQaRemoteCheckpointClient({url,worldId,operatorPublicKeyPem,
  witnessPublicKeyPem}={}){
  if(typeof url!=='string'||!/^qa:[A-Za-z0-9:_-]{1,61}$/.test(worldId||''))
    throw Error('Explicit QA witness endpoint required')
  const endpoint=new URL(url)
  // Only a local test endpoint. No redirects, credentials, arbitrary hosts.
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||
     !endpoint.port||endpoint.pathname!=='/'||endpoint.search||endpoint.hash||
     endpoint.username||endpoint.password)throw Error('Unsafe QA witness URL')
  const operator=publicKey(operatorPublicKeyPem)
  const witness=publicKey(witnessPublicKeyPem)
  const fingerprint=crypto.createHash('sha256')
    .update(operator.export({format:'der',type:'spki'})).digest('hex')
  function request(method,route,body){
    return new Promise((resolve,reject)=>{
      const raw=body===undefined?null:Buffer.from(JSON.stringify(body))
      const req=http.request({hostname:'127.0.0.1',port:Number(endpoint.port),
        method,path:route,headers:raw?{'content-type':'application/json',
          'content-length':raw.length}:{}},res=>{
        let data=''
        res.setEncoding('utf8')
        res.on('data',part=>{
          data+=part
          if(data.length>2048){req.destroy(Error('Oversized witness reply'))}
        })
        res.on('end',()=>{
          if(res.statusCode!==200)return reject(Error('Witness denied request'))
          try{resolve(JSON.parse(data))}
          catch{reject(Error('Malformed witness reply'))}
        })
      })
      req.setTimeout(1500,()=>req.destroy(Error('Remote witness timed out')))
      req.on('error',()=>reject(Error('Remote checkpoint witness unavailable')))
      if(raw)req.write(raw)
      req.end()
    })
  }
  async function read(){
    const nonce=crypto.randomUUID()
    const response=await request('GET','/checkpoint?nonce='+nonce)
    return verifyWitnessResponse(response,witness,{worldId,
      operatorFingerprint:fingerprint,nonce})
  }
  return Object.freeze({
    operatorFingerprint:fingerprint,
    async latest(){return read()},
    async verifyLocal(local){
      const remote=await read()
      if(!validHead(local,worldId,fingerprint)||
         local.sequence!==remote.sequence||
         local.registrySha256!==remote.registrySha256)
        throw Error('Remote checkpoint disagreement: fail closed')
      return true
    },
    async publish(operatorSignedTicket){
      const p=validateAdvance(operatorSignedTicket,operator,worldId,fingerprint)
      const response=await request('POST','/advance',operatorSignedTicket)
      if(response?.accepted!==true)throw Error('Witness advancement denied')
      const current=await read()
      if(current.sequence!==p.sequence||current.registrySha256!==p.registrySha256)
        throw Error('Witness publication not confirmed')
      return current
    }
  })
}
module.exports={createPinnedQaRemoteCheckpointClient,validateAdvance,
  verifyWitnessResponse,validHead,publicKey}
