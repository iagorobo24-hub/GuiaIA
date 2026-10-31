'use strict'
// Standalone QA signing authority. Invoked from a SEPARATE process, never by
// qa_operator.js. No private signing key is sent through the revocation inbox.
const fs=require('node:fs')
const path=require('node:path')
const crypto=require('node:crypto')
const {submitQaRevocationBundle}=require('./src/qa_live_revocation')
const {verifyTicket,verifyConsent}=require('./src/principal_enrollment')
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
function readPrivate(file,max=8192){
  if(typeof file!=='string'||!path.isAbsolute(file)||path.normalize(file)!==file||
     fs.realpathSync(path.dirname(file))!==path.dirname(file))
    throw Error('Standalone QA signer requires an absolute private path')
  const parent=fs.statSync(path.dirname(file))
  if(!parent.isDirectory()||(process.platform!=='win32'&&(parent.mode&0o077)!==0))
    throw Error('QA signer parent must be private')
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
  try{
    const s=fs.fstatSync(fd)
    if(!s.isFile()||s.nlink!==1||s.size<2||s.size>max||
       (process.platform!=='win32'&&(s.mode&0o077)!==0))
      throw Error('Unsafe QA signer credential')
    const b=Buffer.alloc(s.size)
    if(fs.readSync(fd,b,0,s.size,0)!==s.size)throw Error('Short QA signer read')
    return b
  }finally{fs.closeSync(fd)}
}
function signed(payload,key){
  return {payload,signature:crypto.sign(null,Buffer.from(JSON.stringify(payload)),key)
    .toString('base64url')}
}
function main(){
  const [mode,configFile]=process.argv.slice(2)
  if(process.argv.length!==4||mode!=='--qa-submit')
    throw Error('Use --qa-submit with separate private QA signer config')
  const config=JSON.parse(readPrivate(configFile,4096).toString('utf8'))
  const fields=['version','sandboxOnly','worldId','registryDirectory',
    'principalId','operatorPrivateKeyFile']
  if(!config||Object.keys(config).length!==fields.length||
     !fields.every(k=>Object.hasOwn(config,k))||
     config.version!==1||config.sandboxOnly!==true||
     config.worldId!=='qa:real-fabric:25593'||
     !/^[A-Za-z0-9:_-]{1,64}$/.test(config.principalId||'')||
     typeof config.registryDirectory!=='string')
    throw Error('Incomplete sandbox-only QA external revocation config')
  const root=path.dirname(config.registryDirectory)
  if(config.registryDirectory!==path.join(root,'registry')||
     !/^guiaia-enrollment-qa-[A-Za-z0-9_-]{6,}$/.test(path.basename(root))||
     path.dirname(root)!==require('node:os').tmpdir())
    throw Error('Untrusted QA revocation registry path')
  const key=crypto.createPrivateKey(readPrivate(config.operatorPrivateKeyFile))
  if(key.asymmetricKeyType!=='ed25519')
    throw Error('Only Ed25519 offline QA signer accepted')
  const pub=crypto.createPublicKey(key)
  const fingerprint=crypto.createHash('sha256')
    .update(pub.export({format:'der',type:'spki'})).digest('hex')
  const raw=readPrivate(path.join(config.registryDirectory,'principals.json'),65536)
  const state=JSON.parse(raw.toString('utf8'))
  const head=JSON.parse(readPrivate(path.join(root,'checkpoint','anchor.json'),1024).toString('utf8'))
  if(state.version!==1||state.worldId!==config.worldId||
     state.operatorFingerprint!==fingerprint||
     head.version!==1||head.worldId!==config.worldId||
     head.operatorFingerprint!==fingerprint||
     head.sequence!==state.events.length||
     head.registrySha256!==crypto.createHash('sha256').update(raw).digest('hex'))
    throw Error('QA registry and checkpoint do not match pinned signer')
  // Reject invalid historic signatures even if local files agree.
  let active=false
  for(const event of state.events){
    const p=verifyTicket(event.ticket,pub,config.worldId,Date.now(),{fresh:false})
    if(p.aud==='guiaia:principal-enrollment:v1'){
      verifyConsent(p,event.consent)
      if(p.principalId===config.principalId)active=true
    }else if(p.principalId===config.principalId)active=false
  }
  if(!active)throw Error('QA principal is not currently enrolled')
  const now=Date.now()
  const ticket=signed({aud:'guiaia:principal-revocation:v1',
    worldId:config.worldId,principalId:config.principalId,
    nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+45000},key)
  if(!UUID.test(ticket.payload.nonce))throw Error('Invalid QA nonce')
  const next={...state,events:[...state.events,{ticket,consent:null}]}
  const registrySha256=crypto.createHash('sha256')
    .update(JSON.stringify(next)+'\n').digest('hex')
  const advance=signed({aud:'guiaia:checkpoint-advance:v1',
    worldId:config.worldId,operatorFingerprint:fingerprint,
    previousSequence:head.sequence,previousSha256:head.registrySha256,
    sequence:next.events.length,registrySha256,
    nonce:crypto.randomUUID(),issuedAt:now-1000,expiresAt:now+45000},key)
  submitQaRevocationBundle({registryDirectory:config.registryDirectory,
    bundle:{ticket,advance}})
  process.stdout.write(JSON.stringify({result:'signed_qa_revocation_queued',
    principalId:config.principalId,expectedSequence:next.events.length})+'\n')
}
try{main()}catch(error){
  const reason=String(error?.message||'qa_signer_denied')
  process.stderr.write('Signed QA revoke denied: '+
    (/^[A-Za-z0-9 _.:,-]{1,100}$/.test(reason)?reason:'qa_signer_denied')+'\n')
  process.exitCode=2
}
