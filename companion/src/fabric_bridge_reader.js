'use strict'
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const MAX_SIZE=131072
const SHAPE=['aud','worldId','connectionId','username','challenge','issuedAt','expiresAt']
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const exact=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype &&
  Object.keys(o).length===keys.length && keys.every(k=>Object.hasOwn(o,k))
function verifyBridgeLog(eventsFile,pinnedKey,worldId,now=Date.now()){
  if(typeof eventsFile!=='string'||!path.isAbsolute(eventsFile)||
     typeof pinnedKey!=='string'||!/^[A-Za-z0-9:_-]{1,64}$/.test(worldId||''))
    throw Error('Untrusted live bridge configuration')
  const folder=path.dirname(eventsFile)
  if(fs.lstatSync(folder).isSymbolicLink() ||
     fs.lstatSync(eventsFile).isSymbolicLink())throw Error('Symlink bridge data denied')
  if((fs.statSync(folder).mode&0o777)!==0o700 ||
     (fs.statSync(eventsFile).mode&0o777)!==0o600)throw Error('Insecure bridge evidence mode')
  const fd=fs.openSync(eventsFile,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
  let bytes
  try{
    const stat=fs.fstatSync(fd)
    if(!stat.isFile() || stat.size>MAX_SIZE || stat.size<0)throw Error('Unsafe bridge audit size')
    bytes=Buffer.alloc(stat.size)
    if(fs.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)throw Error('Partial bridge audit read')
  }finally{fs.closeSync(fd)}
  if(bytes.length===0)return {active:new Map(),joins:new Map(),events:0}
  const data=bytes.toString('utf8')
  if(!data.endsWith('\n'))throw Error('Truncated bridge event record')
  let publicKey
  try{publicKey=crypto.createPublicKey(pinnedKey)}
  catch{throw Error('Untrusted pinned bridge signing key')}
  if(publicKey.asymmetricKeyType!=='ed25519')throw Error('Unsupported signing algorithm')
  const active=new Map(),joins=new Map()
  const lines=data.trimEnd().split('\n')
  if(lines.length>512)throw Error('Excessive signed bridge records')
  let previous=0
  for(const line of lines){
    let entry
    try{entry=JSON.parse(line)}catch{throw Error('Corrupted bridge event')}
    if(!exact(entry,['event','payload','signature'])||
       !['join','disconnect'].includes(entry.event)||
       !exact(entry.payload,SHAPE))throw Error('Unexpected bridge event schema')
    const p=entry.payload
    if(p.worldId!==worldId ||
       p.aud!==(entry.event==='join'?'guiaia:server-connection:v1':'guiaia:server-disconnect:v1') ||
       !UUID.test(p.connectionId||'') ||
       !/^[a-zA-Z0-9_]{3,16}$/.test(p.username||'') ||
       !/^[a-f0-9]{48}$/.test(p.challenge||'') ||
       !Number.isSafeInteger(p.issuedAt) ||
       !Number.isSafeInteger(p.expiresAt) ||
       p.expiresAt-p.issuedAt!==45000 ||
       p.issuedAt>now+5000 || p.issuedAt<previous ||
       !/^[A-Za-z0-9_-]{86}$/.test(entry.signature||'') ||
       !crypto.verify(null,Buffer.from(JSON.stringify(p)),publicKey,
         Buffer.from(entry.signature,'base64url')))throw Error('Untrusted bridge event')
    previous=p.issuedAt
    if(entry.event==='join'){
      if(joins.has(p.connectionId) || [...active.values()].some(x=>x.username===p.username))
        throw Error('Duplicate live identity event')
      joins.set(p.connectionId,{payload:p,signature:entry.signature})
      active.set(p.connectionId,p)
    }else{
      const current=active.get(p.connectionId)
      if(!current || current.challenge!==p.challenge || current.username!==p.username)
        throw Error('Unmatched signed disconnect')
      active.delete(p.connectionId)
    }
  }
  // Expired connections never return as live even if server disconnected
  // unexpectedly and cannot append a final signed disconnect record.
  for(const [id,record] of active)if(record.expiresAt<now)active.delete(id)
  return {active,joins,events:lines.length}
}
function createPinnedQaServerBridgeAuthority(eventsFile,pinnedKey,worldId){
  // Never returns a raw parse result to command sources. Consumers supply an
  // immutable, pinned public key from a separate trusted configuration.
  const key=pinnedKey
  return Object.freeze({
    activeConnection(connectionId){
      if(typeof connectionId!=='string')return null
      const record=verifyBridgeLog(eventsFile,key,worldId).active.get(connectionId)
      return record?{worldId,connectionId:record.connectionId,
        username:record.username,connected:true}:null
    },
    joinProof(connectionId){
      if(typeof connectionId!=='string')return null
      const state=verifyBridgeLog(eventsFile,key,worldId)
      if(!state.active.has(connectionId))return null
      const evidence=state.joins.get(connectionId)
      return evidence?{payload:evidence.payload,signature:evidence.signature}:null
    }
  })
}
module.exports={verifyBridgeLog,createPinnedQaServerBridgeAuthority}
