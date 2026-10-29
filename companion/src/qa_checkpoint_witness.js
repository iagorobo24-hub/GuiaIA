'use strict'
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const crypto=require('node:crypto')
const http=require('node:http')
const {validateAdvance,publicKey}=require('./remote_checkpoint')
const MAX_FILE=1024
function createQaCheckpointWitness({directory,worldId,operatorPublicKeyPem,
  witnessPrivateKey}={}){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||
     !/^qa:[A-Za-z0-9:_-]{1,61}$/.test(worldId||''))
    throw Error('Explicit QA-only witness directory and world required')
  const parts=path.relative(os.tmpdir(),directory).split(path.sep)
  if(parts.length!==1||!/^guiaia-remote-anchor-qa-[a-zA-Z0-9_-]{6,}$/.test(parts[0]))
    throw Error('Remote checkpoint witness restricted to disposable QA root')
  const hadDirectory=fs.existsSync(directory)
  if(hadDirectory&&fs.lstatSync(directory).isSymbolicLink())
    throw Error('Witness directory symlink denied')
  if(!hadDirectory)fs.mkdirSync(directory,{mode:0o700})
  if(hadDirectory&&!fs.existsSync(path.join(directory,'head.json')))
    throw Error('Previously initialized witness missing checkpoint: fail closed')
  if((fs.statSync(directory).mode&0o777)!==0o700)
    throw Error('Untrusted witness filesystem permissions')
  const operator=publicKey(operatorPublicKeyPem)
  if(!witnessPrivateKey||witnessPrivateKey.asymmetricKeyType!=='ed25519')
    throw Error('Witness signing key must be isolated Ed25519')
  const fingerprint=crypto.createHash('sha256')
    .update(operator.export({format:'der',type:'spki'})).digest('hex')
  const file=path.join(directory,'head.json'),lock=path.join(directory,'witness.lock')
  const lockFd=fs.openSync(lock,'wx',0o600)
  let head=null,server=null,poisoned=false,closed=false
  function ensure(){if(poisoned)throw Error('Checkpoint witness poisoned')}
  function read(){
    if(!fs.existsSync(file))return null
    const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
    try{
      const stat=fs.fstatSync(fd)
      if(!stat.isFile()||stat.size<2||stat.size>MAX_FILE||
         (stat.mode&0o777)!==0o600)
        throw Error('Unsafe persisted witness')
      const b=Buffer.alloc(stat.size)
      if(fs.readSync(fd,b,0,b.length,0)!==b.length)throw Error('Short witness read')
      const encoded=JSON.parse(b.toString('utf8'))
      if(!encoded||Object.keys(encoded).sort().join(',')!=='head,signature'||
         typeof encoded.signature!=='string'||
         !/^[A-Za-z0-9_-]{86}$/.test(encoded.signature))
        throw Error('Corrupt witness checkpoint envelope')
      const v=encoded.head
      if(!v||Object.keys(v).sort().join(',')!=='operatorFingerprint,registrySha256,sequence,version,worldId'||
         v.version!==1||v.worldId!==worldId||v.operatorFingerprint!==fingerprint||
         !Number.isSafeInteger(v.sequence)||v.sequence<0||
         !/^[0-9a-f]{64}$/.test(v.registrySha256||'')||
         !crypto.verify(null,Buffer.from(JSON.stringify(v)),
           crypto.createPublicKey(witnessPrivateKey),
           Buffer.from(encoded.signature,'base64url')))
        throw Error('Corrupt or unsigned witness checkpoint')
      return v
    }finally{fs.closeSync(fd)}
  }
  function write(v){
    const signed={head:v,signature:crypto.sign(null,
      Buffer.from(JSON.stringify(v)),witnessPrivateKey).toString('base64url')}
    const tmp=path.join(directory,'.head-'+crypto.randomUUID()+'.tmp')
    let fd
    try{
      fd=fs.openSync(tmp,'wx',0o600)
      fs.writeSync(fd,JSON.stringify(signed)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=null
      if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())
        throw Error('Witness symlink denied')
      fs.renameSync(tmp,file)
      const d=fs.openSync(directory,fs.constants.O_RDONLY)
      try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
    }finally{
      if(fd!==undefined&&fd!==null)fs.closeSync(fd)
      if(fs.existsSync(tmp))fs.unlinkSync(tmp)
    }
  }
  try{head=read()}catch(e){fs.closeSync(lockFd);fs.unlinkSync(lock);throw e}
  function verifyDisk(){
    ensure()
    const current=read()
    if((current===null)!==(head===null)||current?.sequence!==head?.sequence||
       current?.registrySha256!==head?.registrySha256)
      throw Error('Witness checkpoint disk changed: fail closed')
  }
  function sign(payload){
    return {payload,signature:crypto.sign(null,
      Buffer.from(JSON.stringify(payload)),witnessPrivateKey).toString('base64url')}
  }
  function advance(ticket){
    verifyDisk()
    const p=validateAdvance(ticket,operator,worldId,fingerprint)
    if(head===null){
      if(p.previousSequence!==-1||p.sequence!==0)throw Error('Witness bootstrap requires operator approval')
    }else if(p.previousSequence!==head.sequence||
      p.previousSha256!==head.registrySha256||p.sequence!==head.sequence+1){
      throw Error('Witness checkpoint CAS rejected')
    }
    const next={version:1,worldId,operatorFingerprint:fingerprint,
      sequence:p.sequence,registrySha256:p.registrySha256}
    try{write(next);head=next}
    catch(e){poisoned=true;throw e}
    return true
  }
  async function start(){
    if(closed||server)throw Error('Witness not available or already running')
    server=http.createServer(async(req,res)=>{
      req.setTimeout(1500,()=>req.destroy())
      const deny=()=>{res.writeHead(403);res.end('denied')}
      try{
        if(req.socket.remoteAddress!=='127.0.0.1'||
           req.headers.host?.startsWith('127.0.0.1:')!==true)
          return deny()
        if(req.method==='GET'){
          const u=new URL(req.url,'http://127.0.0.1')
          const nonce=u.searchParams.get('nonce')
          if(u.pathname!=='/checkpoint'||u.searchParams.size!==1||
             !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce||''))
            return deny()
          verifyDisk()
          if(head===null)return deny()
          const now=Date.now()
          const token=sign({aud:'guiaia:remote-checkpoint:v1',
            worldId,operatorFingerprint:fingerprint,sequence:head.sequence,
            registrySha256:head.registrySha256,nonce,
            issuedAt:now,expiresAt:now+3000})
          res.setHeader('content-type','application/json')
          return res.end(JSON.stringify(token))
        }
        if(req.method!=='POST'||req.url!=='/advance'||
           req.headers['content-type']!=='application/json'||
           Number(req.headers['content-length'])>1024)return deny()
        let raw=''
        for await(const chunk of req){
          raw+=chunk.toString('utf8')
          if(raw.length>1024)return deny()
        }
        advance(JSON.parse(raw))
        res.setHeader('content-type','application/json')
        return res.end('{"accepted":true}')
      }catch(error){
        if(process.env.GUIAIA_QA_WITNESS_DEBUG==='1')
          process.stderr.write('QA witness denied: '+error.message+'\n')
        deny()
      }
    })
    try{
      await new Promise((ok,fail)=>{
        server.once('error',fail)
        server.listen(0,'127.0.0.1',ok)
      })
    }catch(error){server=null;throw error}
    return 'http://127.0.0.1:'+server.address().port+'/'
  }
  return Object.freeze({
    start,
    close:async()=>{
      if(closed)return
      closed=true
      if(server){
        server.closeAllConnections()
        await new Promise(done=>server.close(done))
        server=null
      }
      fs.closeSync(lockFd)
      if(fs.existsSync(lock))fs.unlinkSync(lock)
    }
  })
}
module.exports={createQaCheckpointWitness}
