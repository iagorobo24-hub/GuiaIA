'use strict'
// QA-only challenge/response to the RUNNING Fabric JVM on loopback.
// The historical signed JOIN log is NOT proof that a server remains alive.
const net=require('node:net')
const crypto=require('node:crypto')
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const exact=(x,fields)=>x && Object.getPrototypeOf(x)===Object.prototype &&
  Object.keys(x).length===fields.length && fields.every(k=>Object.hasOwn(x,k))
const FIELDS=['aud','worldId','connectionId','nonce','connected','issuedAt','expiresAt']
function verifyLiveReply(reply,key,worldId,connectionId,nonce,now=Date.now()){
  const p=reply?.payload
  if(!exact(reply,['payload','signature']) || !exact(p,FIELDS) ||
     p.aud!=='guiaia:live-presence:v1' || p.worldId!==worldId ||
     p.connectionId!==connectionId || p.nonce!==nonce ||
     typeof p.connected!=='boolean' ||
     !Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt) ||
     p.expiresAt-p.issuedAt!==3000 || p.issuedAt>now+1000 ||
     now-p.issuedAt>1500 || now>p.expiresAt ||
     typeof reply.signature!=='string' || !/^[A-Za-z0-9_-]{86}$/.test(reply.signature))
    throw Error('Stale or mismatched live server evidence')
  const signature=Buffer.from(reply.signature,'base64url')
  if(signature.length!==64 ||
     !crypto.verify(null,Buffer.from(JSON.stringify(p)),key,signature))
    throw Error('Invalid live server Ed25519 signature')
  return Object.freeze({worldId,connectionId,connected:p.connected,
    issuedAt:p.issuedAt})
}
function createPinnedQaLivePresenceAuthority({port,worldId,serverBridgePublicKeyPem}={}){
  if(!Number.isInteger(port) || port<1024 || port>65535 ||
     typeof worldId!=='string' || !/^qa:[A-Za-z0-9:_-]{1,61}$/.test(worldId) ||
     typeof serverBridgePublicKeyPem!=='string')
    throw Error('Explicit QA loopback live presence configuration required')
  let key
  try {key=crypto.createPublicKey(serverBridgePublicKeyPem)}
  catch {throw Error('Untrusted live server public key')}
  if(key.asymmetricKeyType!=='ed25519')
    throw Error('Only Ed25519 live attestations are trusted')
  return Object.freeze({
    async livePresence(connectionId){
      if(typeof connectionId!=='string' || !UUID.test(connectionId))
        throw Error('Invalid live connection ID')
      const nonce=crypto.randomBytes(16).toString('hex')
      return new Promise((resolve,reject)=>{
        const socket=net.connect({host:'127.0.0.1',port})
        let completed=false,buffer=''
        const finish=(error,result)=>{
          if(completed)return
          completed=true
          socket.destroy()
          if(error)reject(error)
          else resolve(result)
        }
        socket.setTimeout(1500,()=>finish(Error('Live Fabric server timeout')))
        socket.on('error',()=>finish(Error('Live Fabric query unavailable')))
        socket.on('connect',()=>socket.write(connectionId+' '+nonce+'\n'))
        socket.on('data',chunk=>{
          buffer+=chunk.toString('utf8')
          if(buffer.length>1024)return finish(Error('Oversized Fabric live reply'))
          const nl=buffer.indexOf('\n')
          if(nl<0)return
          if(nl!==buffer.length-1)return finish(Error('Unexpected live response suffix'))
          try {
            const reply=JSON.parse(buffer.slice(0,-1))
            finish(null,verifyLiveReply(reply,key,worldId,connectionId,nonce))
          }catch(e){finish(e)}
        })
        socket.on('end',()=>finish(Error('Truncated live Fabric response')))
      })
    }
  })
}
module.exports={verifyLiveReply,createPinnedQaLivePresenceAuthority}
