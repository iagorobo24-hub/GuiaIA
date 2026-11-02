'use strict'
// Explicit two-machine QA fixture. No witness private key is accepted here.
// A separate lab controller toggles only a tailnet HTTPS proxy on Durán.
const crypto=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
function createPhysicalQaWitnessFixture(directory){
  if(typeof directory!=='string'||!path.isAbsolute(directory)||
     path.dirname(directory)!==os.tmpdir()||
     !/^guiaia-crosshost-fabric-qa-[A-Za-z0-9_-]{6,}$/.test(path.basename(directory))||
     path.normalize(directory)!==directory||
     fs.realpathSync(directory)!==directory)
    throw Error('Only isolated two-host Fabric QA fixture allowed')
  const stat=fs.lstatSync(directory)
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)
    throw Error('Physical QA fixture must be private')
  function readPrivate(name){
    const full=path.join(directory,name)
    const fd=fs.openSync(full,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
    try{
      const info=fs.fstatSync(fd)
      if(!info.isFile()||info.nlink!==1||info.size<1||info.size>8192||
         (info.mode&0o077)!==0)
        throw Error('Unsafe physical QA credential')
      const result=Buffer.alloc(info.size)
      if(fs.readSync(fd,result,0,info.size,0)!==info.size)
        throw Error('Incomplete physical QA credential')
      return result
    }finally{fs.closeSync(fd)}
  }
  const privateKey=crypto.createPrivateKey(readPrivate('operator-private.pem'))
  const witnessPublicKeyPem=readPrivate('witness-public.pem').toString('utf8')
  if(privateKey.asymmetricKeyType!=='ed25519'||
     crypto.createPublicKey(witnessPublicKeyPem).asymmetricKeyType!=='ed25519')
    throw Error('Physical QA requires two pinned Ed25519 authorities')
  const operatorKey=Object.freeze({privateKey,
    publicKey:crypto.createPublicKey(privateKey)})
  const url='http://127.0.0.1:24121/'
  let phase='initial'
  function request(name){
    fs.writeFileSync(path.join(directory,name),'1',{mode:0o600,flag:'wx'})
  }
  const witness=Object.freeze({
    async start(){
      if(phase==='initial'){phase='up';return url}
      if(phase!=='down')throw Error('Physical QA witness restart state denied')
      request('restore-requested')

      phase='restored'
      return url
    },
    async close(){
      if(phase!=='up')return
      request('outage-requested')

      phase='down'
    }
  })
  return Object.freeze({operatorKey,witnessPublicKeyPem,witness})
}
module.exports={createPhysicalQaWitnessFixture}
