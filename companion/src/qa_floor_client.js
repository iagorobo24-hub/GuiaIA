'use strict'
// Pinned, loopback-only QA floor custodian client with fresh signed reads.
const crypto=require('node:crypto')
const http=require('node:http')
const {publicKey,validateAdvance}=require('./remote_checkpoint')
const HEX=/^[0-9a-f]{64}$/
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const FIELDS=['aud','worldId','operatorFingerprint','witnessFingerprint',
  'sequence','registrySha256','nonce','issuedAt','expiresAt']
const exact=(v,names)=>v!==null&&typeof v==='object'&&
  Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k))
const fingerprint=key=>crypto.createHash('sha256')
  .update(key.export({format:'der',type:'spki'})).digest('hex')
function createPinnedQaFloorClient({url,worldId,operatorPublicKeyPem,
  witnessPublicKeyPem,anchorPublicKeyPem}={}){
  if(typeof url!=='string'||!/^qa:[A-Za-z0-9:_-]{1,61}$/.test(worldId||''))
    throw Error('Explicit QA floor endpoint required')
  const endpoint=new URL(url)
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||
     !endpoint.port||endpoint.pathname!=='/'||endpoint.search||
     endpoint.hash||endpoint.username||endpoint.password)
    throw Error('Unsafe QA floor URL')
  const operator=publicKey(operatorPublicKeyPem)
  const witness=publicKey(witnessPublicKeyPem)
  const anchor=publicKey(anchorPublicKeyPem)
  const op=fingerprint(operator),wit=fingerprint(witness),anc=fingerprint(anchor)
  if(op===wit||op===anc||wit===anc)
    throw Error('QA floor keys must be separate')
  function request(method,route,body){
    return new Promise((resolve,reject)=>{
      const raw=body===undefined?null:Buffer.from(JSON.stringify(body))
      const req=http.request({hostname:'127.0.0.1',port:Number(endpoint.port),
        method,path:route,headers:raw?{'content-type':'application/json',
          'content-length':raw.length}:{}},res=>{
        let data=''
        res.setEncoding('utf8')
        res.on('data',chunk=>{
          data+=chunk
          if(data.length>2048)req.destroy(Error('Oversized QA floor response'))
        })
        res.on('end',()=>{
          if(res.statusCode!==200)return reject(Error('QA floor denied request'))
          try{resolve(JSON.parse(data))}
          catch{reject(Error('Malformed QA floor response'))}
        })
      })
      // Floor writes can wait for a second server's 1.5 s signed preflight;
      // reads remain 1.5 s and cannot be substituted for mission gates.
      const limit=method==='GET'?1500:3500
      const deadline=setTimeout(()=>req.destroy(Error('QA floor deadline exceeded')),limit)
      deadline.unref()
      req.once('close',()=>clearTimeout(deadline))
      req.setTimeout(limit,()=>req.destroy(Error('QA floor timed out')))
      req.on('error',()=>reject(Error('QA floor unavailable')))
      if(raw)req.write(raw)
      req.end()
    })
  }
  async function latest(){
    const nonce=crypto.randomUUID()
    const result=await request('GET','/floor?nonce='+nonce)
    if(!exact(result,['payload','signature'])||
       !exact(result.payload,FIELDS)||typeof result.signature!=='string'||
       !/^[A-Za-z0-9_-]{86}$/.test(result.signature))
      throw Error('Invalid QA floor live response')
    const p=result.payload,now=Date.now()
    if(p.aud!=='guiaia:independent-floor-live-qa:v1'||
       p.worldId!==worldId||p.operatorFingerprint!==op||
       p.witnessFingerprint!==wit||p.nonce!==nonce||
       !Number.isSafeInteger(p.sequence)||p.sequence<0||
       !HEX.test(p.registrySha256||'')||
       !Number.isSafeInteger(p.issuedAt)||!Number.isSafeInteger(p.expiresAt)||
       p.expiresAt-p.issuedAt!==3000||p.issuedAt>now+1000||
       now-p.issuedAt>1500||p.expiresAt<now||
       !crypto.verify(null,Buffer.from(JSON.stringify(p)),anchor,
         Buffer.from(result.signature,'base64url')))
      throw Error('Untrusted or stale QA floor response')
    return Object.freeze({aud:'guiaia:independent-floor-qa:v1',
      worldId,operatorFingerprint:op,witnessFingerprint:wit,
      sequence:p.sequence,registrySha256:p.registrySha256})
  }
  return Object.freeze({
    latest,
    async publish(operatorSignedTicket){
      const p=validateAdvance(operatorSignedTicket,operator,worldId,op)
      const result=await request('POST','/advance',operatorSignedTicket)
      if(result?.accepted!==true)
        throw Error('QA floor advance denied')
      const current=await latest()
      if(current.sequence!==p.sequence||current.registrySha256!==p.registrySha256)
        throw Error('QA floor advance not confirmed')
      return current
    }
  })
}
module.exports={createPinnedQaFloorClient}
