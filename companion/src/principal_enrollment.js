'use strict'

// Isolated QA trust enrollment. This is an OPERATOR-APPROVED out-of-band
// principal key registry, NOT authentication by Minecraft username or UUID.
// Never accept enrollment tickets originating solely from in-game messages.
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const crypto=require('node:crypto')
const {openQaPrincipalCheckpoint}=require('./principal_checkpoint')
const MAX_BYTES=65536
const MAX_EVENTS=48
const MAX_AGE_MS=300000
const ID=/^[A-Za-z0-9:_-]{1,64}$/
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const COMMON=['aud','worldId','principalId','nonce','issuedAt','expiresAt']
const ENROLL=[...COMMON,'publicKeyDer']
const REVOKE=COMMON
const strict=(o,keys)=>o && Object.getPrototypeOf(o)===Object.prototype &&
  Object.keys(o).length===keys.length && keys.every(k=>Object.hasOwn(o,k))
const signatureValid=s=>typeof s==='string' && /^[A-Za-z0-9_-]{86}$/.test(s)

function ed25519Key(key){
  let parsed
  try{parsed=crypto.createPublicKey(key)}
  catch{throw Error('Malformed pinned public key')}
  if(parsed.asymmetricKeyType!=='ed25519')throw Error('Only Ed25519 keys accepted')
  return parsed
}
function decodePrincipalKey(encoded){
  if(typeof encoded!=='string' || encoded.length<36 || encoded.length>160 ||
     !/^[A-Za-z0-9_-]+$/.test(encoded))throw Error('Invalid principal key encoding')
  const raw=Buffer.from(encoded,'base64url')
  if(raw.toString('base64url')!==encoded)throw Error('Noncanonical principal key')
  const key=ed25519Key({key:raw,format:'der',type:'spki'})
  if(key.export({format:'der',type:'spki'}).toString('base64url')!==encoded)
    throw Error('Noncanonical principal SPKI key')
  return key
}
function verifyTicket(ticket,operatorKey,worldId,now,{fresh=true}={}){
  if(!strict(ticket,['payload','signature']) || !signatureValid(ticket.signature))
    throw Error('Malformed signed enrollment ticket')
  const p=ticket.payload
  const enroll=p?.aud==='guiaia:principal-enrollment:v1'
  const revoke=p?.aud==='guiaia:principal-revocation:v1'
  if(!(enroll||revoke) || !strict(p,enroll?ENROLL:REVOKE) ||
     p.worldId!==worldId || !ID.test(p.principalId||'') ||
     !UUID.test(p.nonce||'') ||
     !Number.isSafeInteger(p.issuedAt) || !Number.isSafeInteger(p.expiresAt) ||
     p.expiresAt-p.issuedAt<1000 || p.expiresAt-p.issuedAt>MAX_AGE_MS ||
     (fresh && (p.issuedAt>now+5000 || p.expiresAt<now)))
    throw Error('Invalid, expired or wrong-world signed enrollment ticket')
  if(enroll)decodePrincipalKey(p.publicKeyDer)
  const signature=Buffer.from(ticket.signature,'base64url')
  if(signature.length!==64 ||
     !crypto.verify(null,Buffer.from(JSON.stringify(p)),operatorKey,signature))
    throw Error('Untrusted enrollment operator signature')
  return p
}
function verifyConsent(payload,consent){
  if(!signatureValid(consent))throw Error('Missing principal key possession proof')
  const signature=Buffer.from(consent,'base64url')
  const proof=Buffer.from('guiaia:principal-consent:v1\n'+JSON.stringify(payload))
  if(signature.length!==64 ||
     !crypto.verify(null,proof,decodePrincipalKey(payload.publicKeyDer),signature))
    throw Error('Invalid independent principal key possession proof')
}
function derive(events,operatorKey,worldId,now,{freshLast=false}={}){
  if(!Array.isArray(events) || events.length>MAX_EVENTS)
    throw Error('Unsafe principal enrollment history')
  const principals=Object.create(null),nonces=new Set()
  for(const [index,event] of events.entries()){
    if(!strict(event,['ticket','consent']))throw Error('Malformed enrollment event')
    const p=verifyTicket(event.ticket,operatorKey,worldId,now,
      {fresh:freshLast && index===events.length-1})
    if(nonces.has(p.nonce))throw Error('Replayed enrollment ticket')
    nonces.add(p.nonce)
    if(p.aud==='guiaia:principal-enrollment:v1'){
      verifyConsent(p,event.consent)
      // A revoked principal ID cannot be silently reassigned to another key.
      // Key rotation requires a fresh, independently approved principal ID.
      if(Object.hasOwn(principals,p.principalId))
        throw Error('Principal identity reuse forbidden')
      principals[p.principalId]={key:p.publicKeyDer,revoked:false}
    }else{
      if(event.consent!==null || !Object.hasOwn(principals,p.principalId) ||
         principals[p.principalId].revoked)throw Error('Unauthorized revocation')
      principals[p.principalId].revoked=true
    }
  }
  return principals
}
function openQaPrincipalRegistry(directory,{
  worldId,operatorPublicKeyPem,sandboxOnly,externallyPinnedCheckpoint
}={}){
  if(sandboxOnly!==true || !ID.test(worldId||'') ||
     typeof directory!=='string' || !path.isAbsolute(directory))
    throw Error('Explicit trusted QA principal registry required')
  // Refuse arbitrary directories, including production paths. The parent
  // must be an actual temporary QA root, not a symlink to another location.
  const relative=path.relative(os.tmpdir(),directory).split(path.sep)
  if(relative.length!==2 || !/^guiaia-enrollment-qa-[A-Za-z0-9_-]{6,}$/.test(relative[0]) ||
     relative[1]!=='registry' ||
     fs.lstatSync(path.join(os.tmpdir(),relative[0])).isSymbolicLink())
    throw Error('Enrollment permitted only in an isolated QA root')
  const operatorKey=ed25519Key(operatorPublicKeyPem)
  if(fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink())
    throw Error('Symlink principal registry directory denied')
  fs.mkdirSync(directory,{recursive:true,mode:0o700})
  if(!fs.statSync(directory).isDirectory())throw Error('Invalid principal registry directory')
  fs.chmodSync(directory,0o700)
  const file=path.join(directory,'principals.json')
  const lock=path.join(directory,'principals.lock')
  if(fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw Error('Symlink principal registry denied')
  const fdLock=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600)
  let closed=false,poisoned=false,checkpoint
  const fingerprint=crypto.createHash('sha256')
    .update(operatorKey.export({format:'der',type:'spki'})).digest('hex')
  let state
  function ensureOpen(){
    if(closed)throw Error('Principal registry closed')
    if(poisoned)throw Error('Principal registry poisoned: manual recovery required')
  }
  function assertConsistent(){
    ensureOpen()
    try{checkpoint.verify(state)}
    catch(error){poisoned=true;throw error}
  }
  function save(){
    const buffer=Buffer.from(JSON.stringify(state)+'\n')
    if(buffer.length>MAX_BYTES)throw Error('Enrollment history exceeds size budget')
    const tmp=path.join(directory,'.principals-'+crypto.randomUUID()+'.tmp')
    let fd=null
    try{
      fd=fs.openSync(tmp,'wx',0o600)
      fs.writeSync(fd,buffer);fs.fsyncSync(fd);fs.closeSync(fd);fd=null
      fs.renameSync(tmp,file)
      const d=fs.openSync(directory,fs.constants.O_RDONLY)
      try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
    }finally{
      if(fd!==null)fs.closeSync(fd)
      if(fs.existsSync(tmp))fs.unlinkSync(tmp)
    }
  }
  try{
    const hadRegistry=fs.existsSync(file)
    if(hadRegistry){
      const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
      let buf
      try{
        const s=fs.fstatSync(fd)
        if(!s.isFile() || s.size>MAX_BYTES || s.size===0 ||
           (s.mode&0o777)!==0o600)throw Error('Unsafe principal registry file')
        buf=Buffer.alloc(s.size)
        if(fs.readSync(fd,buf,0,buf.length,0)!==buf.length)
          throw Error('Partial principal registry read')
      }finally{fs.closeSync(fd)}
      state=JSON.parse(buf.toString('utf8'))
      if(!strict(state,['version','worldId','operatorFingerprint','events']) ||
         state.version!==1 || state.worldId!==worldId ||
         state.operatorFingerprint!==fingerprint)
        throw Error('Untrusted principal registry state')
      derive(state.events,operatorKey,worldId,Date.now())
    }else{
      state={version:1,worldId,operatorFingerprint:fingerprint,events:[]}
      save()
    }
    checkpoint=openQaPrincipalCheckpoint(path.dirname(directory),{
      worldId,operatorFingerprint:fingerprint,registryFile:file,
      newRegistry:!hadRegistry})
    if(!hadRegistry)checkpoint.initialize(state)
    checkpoint.verify(state)
    // Only a checkpoint delivered by a separately trusted channel can detect
    // a coherent rollback of BOTH files inside the disposable QA root.
    if(externallyPinnedCheckpoint!==undefined)
      checkpoint.verifyPinned(externallyPinnedCheckpoint)
  }catch(err){
    fs.closeSync(fdLock);fs.unlinkSync(lock);throw err
  }
  return Object.freeze({
    exportCheckpoint(){
      assertConsistent()
      return checkpoint.snapshot()
    },
    // A fresh denial check is mandatory at dispatch. Cached trust maps must
    // never override a revocation that happened after session creation.
    isRevoked(principalId){
      assertConsistent()
      const principals=derive(state.events,operatorKey,worldId,Date.now())
      return typeof principalId!=='string' ||
        !Object.hasOwn(principals,principalId) || principals[principalId].revoked
    },
    trustedPrincipals(){
      assertConsistent()
      const result=Object.create(null)
      const active=derive(state.events,operatorKey,worldId,Date.now())
      for(const [id,entry] of Object.entries(active)){
        if(!entry.revoked)
          result[id]=decodePrincipalKey(entry.key).export({format:'pem',type:'spki'})
      }
      return Object.freeze(result)
    },
    applySignedChange(ticket,consent=null){
      assertConsistent()
      const p=verifyTicket(ticket,operatorKey,worldId,Date.now())
      if(p.aud==='guiaia:principal-enrollment:v1')verifyConsent(p,consent)
      else if(consent!==null)throw Error('Revocations cannot contain consent data')
      // Persist a detached verified copy: a caller must not be able to
      // change the live trust registry by mutating its token after approval.
      const sealedTicket=JSON.parse(JSON.stringify(ticket))
      const events=[...state.events,{ticket:sealedTicket,consent}]
      derive(events,operatorKey,worldId,Date.now(),{freshLast:true})
      state={...state,events}
      // Any failure after the mutation is ambiguous: do NOT restore an old
      // in-memory snapshot while disk may already have a new revision.
      try{save();checkpoint.advance(state)}
      catch(error){poisoned=true;throw error}
      return Object.freeze({principalId:p.principalId,
        action:p.aud==='guiaia:principal-enrollment:v1'?'enrolled':'revoked',
        totalEvents:events.length})
    },
    close(){
      if(closed)return
      closed=true
      fs.closeSync(fdLock)
      fs.unlinkSync(lock)
    }
  })
}
module.exports={openQaPrincipalRegistry,verifyTicket,verifyConsent}
