'use strict'
// Disposable QA external floor authority, kept separate from the witness.
// Does NOT create an anti-rollback hardware/storage guarantee on its own.
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const crypto=require('node:crypto')
const http=require('node:http')
const {publicKey,validateAdvance,createPinnedQaRemoteCheckpointClient}=require('./remote_checkpoint')
const FIELDS=['aud','worldId','operatorFingerprint','witnessFingerprint','sequence','registrySha256']
const HEX=/^[0-9a-f]{64}$/
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const exact=(value,names)=>value!==null&&typeof value==='object'&&
  Object.getPrototypeOf(value)===Object.prototype&&
  Object.keys(value).length===names.length&&names.every(k=>Object.hasOwn(value,k))
const fingerprint=k=>crypto.createHash('sha256')
  .update(k.export({format:'der',type:'spki'})).digest('hex')
function createQaFloorCustodian({directory,worldId,operatorPublicKeyPem,
  witnessPublicKeyPem,anchorPrivateKey,witnessUrl}={}){
  if(process.platform!=='linux'||typeof process.getuid!=='function')
    throw Error('QA floor custodian requires Linux')
  if(typeof worldId!=='string'||!/^qa:[A-Za-z0-9:_-]{1,61}$/.test(worldId)||
     typeof directory!=='string'||!path.isAbsolute(directory)||
     path.dirname(directory)!==os.tmpdir()||
     !/^guiaia-independent-floor-qa-[A-Za-z0-9_-]{6,}$/.test(path.basename(directory)))
    throw Error('Only disposable QA independent floor namespace accepted')
  const wasPresent=fs.existsSync(directory)
  if(!wasPresent)fs.mkdirSync(directory,{mode:0o700})
  const root=fs.lstatSync(directory)
  if(!root.isDirectory()||root.isSymbolicLink()||
     fs.realpathSync(directory)!==directory||
     root.uid!==process.getuid()||(root.mode&0o777)!==0o700)
    throw Error('Untrusted QA floor custodian directory')
  const headPath=path.join(directory,'floor.json')
  if(wasPresent&&!fs.existsSync(headPath))
    throw Error('Prior QA floor state missing: fail closed')
  const operator=publicKey(operatorPublicKeyPem)
  const witness=publicKey(witnessPublicKeyPem)
  if(!anchorPrivateKey||anchorPrivateKey.asymmetricKeyType!=='ed25519')
    throw Error('Independent QA floor requires Ed25519 private key')
  const anchorPublic=crypto.createPublicKey(anchorPrivateKey)
  const op=fingerprint(operator),wit=fingerprint(witness),anc=fingerprint(anchorPublic)
  if(op===wit||op===anc||wit===anc)
    throw Error('Independent QA keys must be separate')
  const remote=createPinnedQaRemoteCheckpointClient({
    url:witnessUrl,worldId,operatorPublicKeyPem,witnessPublicKeyPem})
  const lock=path.join(directory,'floor.lock')
  const lockFd=fs.openSync(lock,'wx',0o600)
  let floor=null,server=null,closed=false,poisoned=false
  const ensure=()=>{if(poisoned||closed)throw Error('QA floor unavailable')}
  const sign=payload=>({payload,signature:crypto.sign(null,
    Buffer.from(JSON.stringify(payload)),anchorPrivateKey).toString('base64url')})
  function readPersisted(){
    if(!fs.existsSync(headPath))return null
    const fd=fs.openSync(headPath,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
    try{
      const st=fs.fstatSync(fd)
      if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid()||
         (st.mode&0o777)!==0o600||st.size<30||st.size>2048)
        throw Error('Untrusted QA independent floor state')
      const b=Buffer.alloc(st.size)
      if(fs.readSync(fd,b,0,b.length,0)!==b.length)
        throw Error('Incomplete QA independent floor state')
      const obj=JSON.parse(b.toString('utf8'))
      if(!exact(obj,['payload','signature'])||
         !exact(obj.payload,FIELDS)||typeof obj.signature!=='string'||
         !/^[A-Za-z0-9_-]{86}$/.test(obj.signature))
        throw Error('Invalid QA floor envelope')
      const p=obj.payload
      if(p.aud!=='guiaia:independent-floor-qa:v1'||
         p.worldId!==worldId||p.operatorFingerprint!==op||
         p.witnessFingerprint!==wit||!Number.isSafeInteger(p.sequence)||
         p.sequence<0||!HEX.test(p.registrySha256||'')||
         !crypto.verify(null,Buffer.from(JSON.stringify(p)),anchorPublic,
           Buffer.from(obj.signature,'base64url')))
        throw Error('Invalid or foreign QA floor signature')
      return obj
    }finally{fs.closeSync(fd)}
  }
  function syncDir(){
    const fd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY)
    try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
  }
  function writeFloor(signed){
    const tmp=path.join(directory,'.floor-'+crypto.randomUUID()+'.tmp')
    let fd=null
    try{
      fd=fs.openSync(tmp,'wx',0o600)
      const data=Buffer.from(JSON.stringify(signed)+'\n')
      if(fs.writeSync(fd,data)!==data.length)throw Error('Short QA floor write')
      fs.fsyncSync(fd);fs.closeSync(fd);fd=null
      if(fs.existsSync(headPath)&&fs.lstatSync(headPath).isSymbolicLink())
        throw Error('QA floor symlink denied')
      fs.renameSync(tmp,headPath)
      syncDir()
    }finally{
      if(fd!==null)fs.closeSync(fd)
      if(fs.existsSync(tmp))fs.unlinkSync(tmp)
    }
  }
  try{floor=readPersisted()}catch(e){
    fs.closeSync(lockFd);fs.unlinkSync(lock);throw e
  }
  function verifyDisk(){
    ensure()
    const actual=readPersisted()
    if((actual===null)!==(floor===null)||
       actual?.payload.sequence!==floor?.payload.sequence||
       actual?.payload.registrySha256!==floor?.payload.registrySha256||
       actual?.signature!==floor?.signature){
      poisoned=true
      throw Error('Independent QA floor disk changed: fail closed')
    }
  }
  function assertCas(p){
    if(floor===null){
      if(p.previousSequence!==-1||p.sequence!==0)
        throw Error('QA floor bootstrap requires signed operator approval')
    }else if(p.previousSequence!==floor.payload.sequence||
       p.previousSha256!==floor.payload.registrySha256||
       p.sequence!==floor.payload.sequence+1){
      throw Error('Independent QA floor CAS denied')
    }
  }
  async function advance(ticket){
    verifyDisk()
    const p=validateAdvance(ticket,operator,worldId,op)
    assertCas(p)
    // Signed witness proof is fetched BY the custodian, not trusted from
    // a caller-provided JSON snapshot or a client-side assertion.
    const observed=await remote.latest()
    verifyDisk()
    assertCas(p) // Mandatory after async read: two concurrent writes race here.
    if(observed.sequence!==p.sequence||observed.registrySha256!==p.registrySha256)
      throw Error('Witness and independent floor advance disagree')
    const next=sign({aud:'guiaia:independent-floor-qa:v1',
      worldId,operatorFingerprint:op,witnessFingerprint:wit,
      sequence:p.sequence,registrySha256:p.registrySha256})
    try{writeFloor(next);floor=next}
    catch(error){poisoned=true;throw error}
    return {accepted:true}
  }
  async function start(){
    ensure()
    if(server)throw Error('QA floor already serving')
    server=http.createServer(async(req,res)=>{
      const deadline=setTimeout(()=>req.socket.destroy(),3500)
      deadline.unref()
      res.once('close',()=>clearTimeout(deadline))
      req.setTimeout(3500,()=>req.destroy())
      const deny=()=>{if(!res.headersSent){res.writeHead(403)}res.end('denied')}
      try{
        if(req.socket.remoteAddress!=='127.0.0.1'||
           req.headers.host?.startsWith('127.0.0.1:')!==true)return deny()
        if(req.method==='GET'){
          const u=new URL(req.url,'http://127.0.0.1')
          const nonce=u.searchParams.get('nonce')
          if(u.pathname!=='/floor'||u.searchParams.size!==1||
             !UUID.test(nonce||''))return deny()
          verifyDisk()
          if(!floor)return deny()
          const now=Date.now()
          const payload={...floor.payload,aud:'guiaia:independent-floor-live-qa:v1',
            nonce,issuedAt:now,expiresAt:now+3000}
          res.setHeader('content-type','application/json')
          return res.end(JSON.stringify(sign(payload)))
        }
        if(req.method!=='POST'||req.url!=='/advance'||
           req.headers['content-type']!=='application/json'||
           !/^[1-9][0-9]{0,3}$/.test(req.headers['content-length']||''))
          return deny()
        let raw=''
        for await(const part of req){
          raw+=part.toString('utf8')
          if(raw.length>1024)return deny()
        }
        const result=await advance(JSON.parse(raw))
        res.setHeader('content-type','application/json')
        return res.end(JSON.stringify(result))
      }catch{deny()}
    })
    try{await new Promise((ok,fail)=>{
      server.once('error',fail);server.listen(0,'127.0.0.1',ok)
    })}catch(error){server=null;throw error}
    return 'http://127.0.0.1:'+server.address().port+'/'
  }
  return Object.freeze({start,close:async()=>{
    if(closed)return
    closed=true
    if(server){
      server.closeAllConnections()
      await new Promise(done=>server.close(done));server=null
    }
    fs.closeSync(lockFd)
    if(fs.existsSync(lock))fs.unlinkSync(lock)
  }})
}
module.exports={createQaFloorCustodian}
