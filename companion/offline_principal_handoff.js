'use strict'

// External-file QA principal enrollment ceremony. Never creates keys, launches
// Minecraft, writes to Git, or approves credentials from a piped command.
const fs=require('node:fs')
const path=require('node:path')
const readline=require('node:readline')
const {createPrincipalRequest,validateRequest,approvePrincipalRequest,
  completePrincipalHandoff,verifyPrincipalHandoff,fingerprint,
  createPrincipalRevocation,verifyPrincipalRevocation}=
  require('./src/offline_principal_handoff')

const PROJECT=path.resolve(__dirname,'..')
const MODES=['principal-request','operator-review','principal-consent',
  'verify','operator-revoke','verify-revocation']
function securePath(file,{output=false}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     path.normalize(file)!==file||file.includes('..'+path.sep))
    throw Error('Absolute normalized external path required')
  const parent=path.dirname(file)
  const relative=path.relative(PROJECT,file)
  if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'))
    throw Error('Credential or handoff files inside Git project denied')
  // The POSIX 0700/0600 masks are not NTFS ACL verification. Do not read or
  // write principal/operator key material on native Windows until there is
  // an independently tested policy for owner, inheritance and allowed SIDs.
  if(process.platform==='win32')
    throw Error('Native Windows principal handoff requires verified NTFS ACL isolation')
  // Reject symlink parent AND symlink ancestors, including aliases that
  // would route apparently external material through the repository.
  if(fs.realpathSync(parent)!==parent)
    throw Error('Linked parent path denied')
  const directory=fs.statSync(parent)
  if(!directory.isDirectory() ||
     (process.platform!=='win32' && ((directory.mode&0o077)!==0 ||
       directory.uid!==process.getuid())))
    throw Error('Credential directory must be owner-only (0700)')
  if(!output){
    const info=fs.lstatSync(file)
    if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
       (process.platform!=='win32' && (info.mode&0o077)!==0))
      throw Error('Unsafe credential file, owner-only (0600) required')
  }
  return file
}
function readFile(file,limit=16384){
  securePath(file)
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
  try{
    const info=fs.fstatSync(fd)
    if(!info.isFile()||info.nlink!==1||info.size<1||info.size>limit||
       (process.platform!=='win32' && (info.mode&0o077)!==0))
      throw Error('Unsafe credential size or permissions')
    const bytes=Buffer.alloc(info.size)
    if(fs.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)
      throw Error('Incomplete credential read')
    return bytes
  }finally{fs.closeSync(fd)}
}
function readJson(file){
  try{return JSON.parse(readFile(file).toString('utf8'))}
  catch(error){
    if(error instanceof SyntaxError)throw Error('Malformed public QA JSON')
    throw error
  }
}
function writeJson(file,content){
  securePath(file,{output:true})
  const bytes=Buffer.from(JSON.stringify(content)+'\n')
  if(bytes.length>16384)throw Error('Oversized handoff')
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600)
  try{fs.writeSync(fd,bytes);fs.fsyncSync(fd)}
  finally{fs.closeSync(fd)}
  if(process.platform!=='win32'){
    const dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY)
    try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
  }
}
async function main(args){
  const [mode,...params]=args
  if(!MODES.includes(mode))throw Error('Unsupported offline QA ceremony mode')
  if(mode==='principal-request'){
    if(params.length!==4)throw Error('Expected world, principal, private PEM, output')
    const [worldId,principalId,privatePath,output]=params
    const request=createPrincipalRequest({worldId,principalId,
      principalPrivateKey:readFile(privatePath)})
    writeJson(output,request)
    console.log(JSON.stringify({result:'request_written',worldId,principalId,
      fingerprint:fingerprint(request.payload.publicKeyDer)}))
    return
  }
  if(mode==='operator-review'){
    if(params.length!==4)throw Error('Expected world, private PEM, request, output')
    // Never issue signed operator approvals from redirected/automated stdin.
    if(process.stdin.isTTY!==true || process.stdout.isTTY!==true)
      throw Error('Operator approval requires an interactive local TTY')
    const [worldId,privatePath,requestPath,output]=params
    const request=readJson(requestPath)
    const p=validateRequest(request,worldId)
    const digest=fingerprint(p.publicKeyDer)
    const expected='APROBAR '+p.principalId+' '+digest
    console.log('Solicitud de alta QA para '+p.principalId+' en '+worldId)
    console.log('Huella de clave publica: '+digest)
    console.log('Verifique la identidad y la huella por otro canal ANTES de aprobar.')
    const rl=readline.createInterface({input:process.stdin,output:process.stdout})
    const typed=await new Promise(resolve=>rl.question(
      'Escriba la confirmacion exacta para aprobar: ',resolve))
    rl.close()
    if(typed!==expected)throw Error('Independent operator approval not confirmed')
    const ticket=approvePrincipalRequest({request,expectedWorldId:worldId,
      reviewedPrincipalId:p.principalId,reviewedFingerprint:digest,
      operatorPrivateKey:readFile(privatePath)})
    writeJson(output,ticket)
    console.log(JSON.stringify({result:'operator_ticket_written',worldId,
      principalId:p.principalId,fingerprint:digest}))
    return
  }
  if(mode==='operator-revoke'){
    if(params.length!==4)throw Error('Expected world, principal, operator private PEM, output')
    if(process.stdin.isTTY!==true || process.stdout.isTTY!==true)
      throw Error('Operator revocation requires an interactive local TTY')
    const [worldId,principalId,privatePath,output]=params
    if(!/^qa:[A-Za-z0-9:_-]{1,61}$/.test(worldId)||
       !/^[A-Za-z0-9:_-]{1,64}$/.test(principalId))
      throw Error('Invalid QA revocation target')
    console.log('Revocacion QA propuesta: '+principalId+' en '+worldId)
    console.log('Confirme la identidad a revocar mediante otro canal.')
    const rl=readline.createInterface({input:process.stdin,output:process.stdout})
    const typed=await new Promise(resolve=>rl.question('Confirmacion exacta: ',resolve))
    rl.close()
    if(typed!=='REVOCAR '+principalId+' '+worldId)
      throw Error('Explicit operator revocation not confirmed')
    const ticket=createPrincipalRevocation({worldId,principalId,
      reviewedPrincipalId:principalId,operatorPrivateKey:readFile(privatePath)})
    writeJson(output,ticket)
    console.log(JSON.stringify({result:'operator_revocation_ticket_written',
      worldId,principalId,registryRevoked:false}))
    return
  }
  if(mode==='principal-consent'){
    if(params.length!==5)throw Error('Expected world, principal PEM, operator public PEM, ticket, output')
    const [worldId,privatePath,publicPath,ticketPath,output]=params
    const handoff=completePrincipalHandoff({expectedWorldId:worldId,
      principalPrivateKey:readFile(privatePath),
      operatorPublicKeyPem:readFile(publicPath),
      ticket:readJson(ticketPath)})
    writeJson(output,handoff)
    console.log(JSON.stringify({result:'principal_consent_written',
      worldId,principalId:handoff.ticket.payload.principalId}))
    return
  }
  if(mode==='verify-revocation'){
    if(params.length!==3)throw Error('Expected world, operator public PEM, revocation ticket')
    const [worldId,publicPath,ticketPath]=params
    const report=verifyPrincipalRevocation({expectedWorldId:worldId,
      operatorPublicKeyPem:readFile(publicPath),ticket:readJson(ticketPath)})
    console.log(JSON.stringify({result:'revocation_ticket_verified',...report,
      registryRevoked:false,worldActionsEnabled:false}))
    return
  }
  if(params.length!==3)throw Error('Expected world, pinned operator public PEM, handoff')
  const [worldId,publicPath,handoffPath]=params
  const report=verifyPrincipalHandoff({expectedWorldId:worldId,
    operatorPublicKeyPem:readFile(publicPath),
    handoff:readJson(handoffPath)})
  console.log(JSON.stringify({result:'public_handoff_verified',...report,
    registryEnrolled:false,worldActionsEnabled:false}))
}
main(process.argv.slice(2)).catch(error=>{
  // Do not log payloads, file paths or private key material in failures.
  // Node fs system errors often include full local paths. Never print them.
  const reason=typeof error?.code==='string' ? 'credential_file_access_denied' :
    String(error?.message||'invalid_handoff').slice(0,140)
  console.error('QA principal handoff denied: '+reason)
  process.exitCode=2
})
