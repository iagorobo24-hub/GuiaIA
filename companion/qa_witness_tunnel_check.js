'use strict'
// QA-only offline preflight for a future SSH forward to an independently
// hosted checkpoint witness. Never connects, executes SSH or opens any port.
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const crypto=require('node:crypto')
const {spawnSync}=require('node:child_process')
const allowed=['version','sandboxOnly','worldId','sshHost','sshPort','sshUser',
  'identityFile','knownHostsFile','hostKeyFingerprint','localPort',
  'remotePort','operatorPublicKeyFile','witnessPublicKeyFile']
const abs=p=>typeof p==='string'&&path.isAbsolute(p)&&path.normalize(p)===p
const safeName=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(s)&&
  !s.includes('..')&&!s.endsWith('.')&&!s.startsWith('127.')&&
  !['localhost','0.0.0.0','::1'].includes(s.toLowerCase())
function rootFor(configFile){
  if(!abs(configFile))throw Error('Absolute QA tunnel configuration required')
  const root=path.dirname(configFile)
  if(path.dirname(root)!==os.tmpdir()||
     !/^guiaia-witness-tunnel-qa-[A-Za-z0-9_-]{6,}$/.test(path.basename(root))||
     fs.realpathSync(root)!==root)throw Error('Only private temporary QA tunnel root allowed')
  const stat=fs.lstatSync(root)
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (process.platform!=='win32'&&(stat.mode&0o777)!==0o700)||
     (typeof process.getuid==='function'&&stat.uid!==process.getuid()))
    throw Error('Unsafe QA tunnel directory')
  return root
}
function readPrivate(file,root,max=8192){
  if(!abs(file)||path.dirname(file)!==root)throw Error('QA tunnel file outside private root')
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
  try{
    const s=fs.fstatSync(fd)
    if(!s.isFile()||s.nlink!==1||s.size<2||s.size>max||
       (process.platform!=='win32'&&(s.mode&0o777)!==0o600)||
       (typeof process.getuid==='function'&&s.uid!==process.getuid()))
      throw Error('Unsafe QA tunnel file')
    const out=Buffer.alloc(s.size)
    if(fs.readSync(fd,out,0,s.size,0)!==s.size)throw Error('Incomplete QA tunnel file')
    return out
  }finally{fs.closeSync(fd)}
}
function fingerprintKnownHost(raw,host,sshPort){
  const lines=raw.toString('utf8').trim().split(/\r?\n/)
  if(lines.length!==1)throw Error('Exactly one pinned SSH host key required')
  const parts=lines[0].split(' ')
  const name=sshPort===22?host:`[${host}]:${sshPort}`
  if(parts.length!==3||parts[0]!==name||parts[1]!=='ssh-ed25519'||
     !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[2]))
    throw Error('SSH host key must bind exact named host and port')
  const key=Buffer.from(parts[2],'base64')
  // OpenSSH wire format: length-prefixed name + 32-byte key.
  if(key.length!==51||key.readUInt32BE(0)!==11||
     key.subarray(4,15).toString('ascii')!=='ssh-ed25519'||
     key.readUInt32BE(15)!==32)
    throw Error('Invalid Ed25519 SSH host key')
  return 'SHA256:'+crypto.createHash('sha256').update(key)
    .digest('base64').replace(/=+$/,'')
}
function loadQaTunnelConfig(file){
  const root=rootFor(file)
  const conf=JSON.parse(readPrivate(file,root,4096).toString('utf8'))
  if(!conf||Array.isArray(conf)||Object.getPrototypeOf(conf)!==Object.prototype||
     Object.keys(conf).length!==allowed.length||
     !allowed.every(k=>Object.hasOwn(conf,k))||
     conf.version!==1||conf.sandboxOnly!==true||
     !/^qa:[A-Za-z0-9:_-]{1,61}$/.test(conf.worldId||'')||
     !safeName(conf.sshHost)||!/^[a-z_][a-z0-9_-]{0,31}$/.test(conf.sshUser||'')||
     !Number.isSafeInteger(conf.sshPort)||conf.sshPort<1||conf.sshPort>65535||
     ![conf.localPort,conf.remotePort].every(
       n=>Number.isSafeInteger(n)&&n>=1024&&n<=65535)||
     !/^SHA256:[A-Za-z0-9+/]{43}$/.test(conf.hostKeyFingerprint||''))
    throw Error('Incomplete or unsafe signed QA tunnel configuration')
  // SSH config and credential must reside in one 0700 directory.
  const identity=readPrivate(conf.identityFile,root,8192).toString('utf8')
  if(!identity.includes('-----BEGIN OPENSSH PRIVATE KEY-----')||
     !identity.includes('-----END OPENSSH PRIVATE KEY-----'))
    throw Error('QA tunnel requires private OpenSSH identity')
  // Validate the actual unencrypted private key offline with ssh-keygen.
  // Password prompts, key agents, and network requests are not permitted.
  const parsed=spawnSync('ssh-keygen',['-y','-P','','-f',conf.identityFile],{
    timeout:3500,maxBuffer:1024*8,encoding:'utf8',stdio:['ignore','pipe','pipe']})
  if(parsed.error||parsed.status!==0||
     !/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\n]*)?\n?$/.test(parsed.stdout||''))
    throw Error('Invalid or encrypted QA tunnel SSH identity')
  const actual=fingerprintKnownHost(readPrivate(conf.knownHostsFile,root,1024),
    conf.sshHost,conf.sshPort)
  if(actual!==conf.hostKeyFingerprint)
    throw Error('Pinned SSH server host fingerprint disagrees')
  for(const name of ['operatorPublicKeyFile','witnessPublicKeyFile']){
    const key=crypto.createPublicKey(readPrivate(conf[name],root))
    if(key.asymmetricKeyType!=='ed25519')
      throw Error('QA checkpoint trust key must be Ed25519')
  }
  return Object.freeze({...conf})
}
function buildPinnedSshArgs(conf){
  const o=[
    'BatchMode=yes','StrictHostKeyChecking=yes','UpdateHostKeys=no',
    'IdentitiesOnly=yes','IdentityAgent=none',
    'PasswordAuthentication=no','KbdInteractiveAuthentication=no',
    'PubkeyAuthentication=yes','PreferredAuthentications=publickey',
    'NumberOfPasswordPrompts=0','ForwardAgent=no','ForwardX11=no',
    'PermitLocalCommand=no','RequestTTY=no',
    'ControlMaster=no','ControlPath=none','ProxyCommand=none',
    'GatewayPorts=no','VerifyHostKeyDNS=no',
    'ExitOnForwardFailure=yes','ConnectTimeout=8',
    'ServerAliveInterval=6','ServerAliveCountMax=2',
    'HostKeyAlgorithms=ssh-ed25519',
    'GlobalKnownHostsFile=/dev/null',
    'UserKnownHostsFile='+conf.knownHostsFile
  ]
  // -F /dev/null excludes per-user config. Explicit -L binds both ends
  // to loopback; do not set ClearAllForwardings, which would remove -L.
  return ['-F','/dev/null','-N','-T',...o.flatMap(x=>['-o',x]),
    '-i',conf.identityFile,'-p',String(conf.sshPort),
    '-L',`127.0.0.1:${conf.localPort}:127.0.0.1:${conf.remotePort}`,
    '--',`${conf.sshUser}@${conf.sshHost}`]
}
function main(){
  const [mode,file]=process.argv.slice(2)
  if(process.argv.length!==4||mode!=='--qa-check')
    throw Error('Only offline --qa-check of private QA tunnel config is supported')
  const conf=loadQaTunnelConfig(file)
  buildPinnedSshArgs(conf)
  // No command execution or network: only report structural readiness.
  process.stdout.write(JSON.stringify({
    result:'qa_witness_tunnel_offline_preflight_passed',
    worldId:conf.worldId,localPort:conf.localPort,
    hostKeyFingerprint:conf.hostKeyFingerprint,
    transport:'ssh_local_forward_design_only',connected:false
  })+'\n')
}
if(require.main===module)try{main()}catch(e){
  const reason=String(e?.message||'qa_tunnel_denied')
  process.stderr.write('QA tunnel preflight denied: '+
    (/^[a-zA-Z0-9 _.,:-]{1,100}$/.test(reason)?reason:'qa_tunnel_denied')+'\n')
  process.exitCode=2
}
module.exports={loadQaTunnelConfig,buildPinnedSshArgs,fingerprintKnownHost}
