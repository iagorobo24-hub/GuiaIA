'use strict'
// QA-only read of a separately pinned high-water authority.
// This does not implement durable remote storage or authorize world actions.
const crypto=require('node:crypto')
const http=require('node:http')
const {publicKey}=require('./remote_checkpoint')
const HEX=/^[0-9a-f]{64}$/
const FIELDS=['aud','worldId','operatorFingerprint','witnessFingerprint',
  'custodianFingerprint','sequence','registrySha256','nonce','issuedAt','expiresAt']
const exact=(x,fields)=>x!==null&&typeof x==='object'&&
  Object.getPrototypeOf(x)===Object.prototype&&
  Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k))
const fingerprint=k=>crypto.createHash('sha256')
  .update(k.export({format:'der',type:'spki'})).digest('hex')
function createPinnedQaHighWaterClient({url,worldId,operatorPublicKeyPem,
  witnessPublicKeyPem,custodianPublicKeyPem,highWaterPublicKeyPem}={}){
  if(typeof url!=='string'||!/^qa:[A-Za-z0-9:_-]{1,61}$/.test(worldId||''))
    throw Error('Explicit QA high-water endpoint and world required')
  const endpoint=new URL(url)
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||
     !endpoint.port||endpoint.pathname!=='/'||endpoint.search||
     endpoint.hash||endpoint.username||endpoint.password)
    throw Error('Unsafe QA high-water endpoint')
  const operator=publicKey(operatorPublicKeyPem)
  const witness=publicKey(witnessPublicKeyPem)
  const custodian=publicKey(custodianPublicKeyPem)
  const highWater=publicKey(highWaterPublicKeyPem)
  const op=fingerprint(operator),wit=fingerprint(witness),
    floor=fingerprint(custodian),high=fingerprint(highWater)
  if(new Set([op,wit,floor,high]).size!==4)
    throw Error('Independent QA high-water key separation required')
  function latest(){
    return new Promise((resolve,reject)=>{
      const nonce=crypto.randomUUID()
      const req=http.request({hostname:'127.0.0.1',port:Number(endpoint.port),
        method:'GET',path:'/high-water?nonce='+nonce},res=>{
        let data=''
        res.setEncoding('utf8')
        res.on('data',part=>{
          data+=part
          if(data.length>2048)req.destroy(Error('Oversized QA high-water reply'))
        })
        res.on('end',()=>{
          if(res.statusCode!==200)
            return reject(Error('High-water authority denied request'))
          try{
            const obj=JSON.parse(data)
            if(!exact(obj,['payload','signature'])||
               !exact(obj.payload,FIELDS)||typeof obj.signature!=='string'||
               !/^[A-Za-z0-9_-]{86}$/.test(obj.signature))
              throw Error('Invalid signed QA high-water envelope')
            const p=obj.payload,now=Date.now()
            if(p.aud!=='guiaia:external-high-water-qa:v1'||
               p.worldId!==worldId||p.operatorFingerprint!==op||
               p.witnessFingerprint!==wit||
               p.custodianFingerprint!==floor||p.nonce!==nonce||
               !Number.isSafeInteger(p.sequence)||p.sequence<0||
               !HEX.test(p.registrySha256||'')||
               !Number.isSafeInteger(p.issuedAt)||
               !Number.isSafeInteger(p.expiresAt)||
               p.expiresAt-p.issuedAt!==3000||p.issuedAt>now+1000||
               now-p.issuedAt>1500||p.expiresAt<now||
               !crypto.verify(null,Buffer.from(JSON.stringify(p)),
                 highWater,Buffer.from(obj.signature,'base64url')))
              throw Error('Untrusted or stale QA high-water proof')
            resolve(Object.freeze({sequence:p.sequence,
              registrySha256:p.registrySha256}))
          }catch(error){reject(error)}
        })
      })
      const timer=setTimeout(()=>req.destroy(Error('QA high-water deadline exceeded')),1500)
      timer.unref()
      req.once('close',()=>clearTimeout(timer))
      req.setTimeout(1500,()=>req.destroy(Error('QA high-water timed out')))
      req.on('error',()=>reject(Error('QA high-water unavailable')))
      req.end()
    })
  }
  return Object.freeze({latest})
}
module.exports={createPinnedQaHighWaterClient}
