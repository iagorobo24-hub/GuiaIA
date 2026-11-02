'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const crypto=require('node:crypto')
const {execFileSync,spawnSync}=require('node:child_process')
const {loadQaTunnelConfig,buildPinnedSshArgs,fingerprintKnownHost}=
  require('../qa_witness_tunnel_check')
const script=path.resolve(__dirname,'../qa_witness_tunnel_check.js')

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-witness-tunnel-qa-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  const write=(name,data)=>{
    const file=path.join(root,name)
    fs.writeFileSync(file,data,{mode:0o600,flag:'wx'})
    return file
  }
  const identityFile=path.join(root,'id_ed25519')
  execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-f',identityFile],{
    stdio:['ignore','pipe','pipe'],timeout:5000})
  const hostKeyLine=fs.readFileSync(identityFile+'.pub','utf8').trim()
  fs.unlinkSync(identityFile+'.pub')
  const wire=hostKeyLine.split(' ')[1]
  const sshHost='witness.example.invalid',sshPort=22
  const knownHostsFile=write('known_hosts',
    sshHost+' ssh-ed25519 '+wire+'\n')
  const op=crypto.generateKeyPairSync('ed25519')
  const witness=crypto.generateKeyPairSync('ed25519')
  const operatorPublicKeyFile=write('operator.pem',
    op.publicKey.export({format:'pem',type:'spki'}))
  const witnessPublicKeyFile=write('witness.pem',
    witness.publicKey.export({format:'pem',type:'spki'}))
  const config={
    version:1,sandboxOnly:true,worldId:'qa:real-fabric:25593',
    sshHost,sshPort,sshUser:'qa_witness',
    identityFile,knownHostsFile,
    hostKeyFingerprint:fingerprintKnownHost(
      fs.readFileSync(knownHostsFile),sshHost,sshPort),
    localPort:24561,remotePort:24562,
    operatorPublicKeyFile,witnessPublicKeyFile
  }
  const save=(name='config.json',override={})=>write(name,JSON.stringify({...config,...override}))
  const run=file=>spawnSync(process.execPath,[script,'--qa-check',file],
    {encoding:'utf8',timeout:6000,stdio:['ignore','pipe','pipe']})
  return {root,config,save,run,wire,knownHostsFile,identityFile,write}
}
test('offline preflight accepts exact Ed25519 host key, valid SSH identity and pinned QA keys',t=>{
  const f=fixture(t),file=f.save()
  const loaded=loadQaTunnelConfig(file)
  assert.equal(loaded.sshHost,'witness.example.invalid')
  const args=buildPinnedSshArgs(loaded)
  assert.deepEqual(args.slice(0,4),['-F','/dev/null','-N','-T'])
  assert.ok(args.includes('StrictHostKeyChecking=yes'))
  assert.ok(args.includes('BatchMode=yes'))
  assert.ok(args.includes('ExitOnForwardFailure=yes'))
  assert.ok(args.includes('IdentityAgent=none'))
  assert.ok(args.includes('GatewayPorts=no'))
  assert.ok(!args.includes('ClearAllForwardings=yes'))
  assert.ok(args.includes('127.0.0.1:24561:127.0.0.1:24562'))
  assert.equal(args.at(-1),'qa_witness@witness.example.invalid')
  const res=f.run(file)
  assert.equal(res.status,0,res.stderr)
  const proof=JSON.parse(res.stdout)
  assert.equal(proof.result,'qa_witness_tunnel_offline_preflight_passed')
  assert.equal(proof.connected,false)
  assert.equal(proof.hostKeyFingerprint,f.config.hostKeyFingerprint)
})
test('host key mismatch, wrong hostname, unexpected host entries and malformed wire key all deny',t=>{
  const f=fixture(t)
  assert.equal(f.run(f.save('wrong-hash.json',{
    hostKeyFingerprint:'SHA256:'+'A'.repeat(43)})).status,2)
  const other=f.save('other-host.json',{sshHost:'other.example.invalid'})
  assert.equal(f.run(other).status,2)
  fs.appendFileSync(f.knownHostsFile,'other.example.invalid ssh-ed25519 '+f.wire+'\n')
  assert.equal(f.run(f.save('multi.json')).status,2)
  fs.writeFileSync(f.knownHostsFile,'witness.example.invalid ssh-ed25519 AAAA\n')
  assert.equal(f.run(f.save('bad-wire.json')).status,2)
})
test('insecure permissions, symlinks and invalid private identity deny with no connection',t=>{
  const f=fixture(t)
  const insecure=f.save('insecure.json')
  fs.chmodSync(insecure,0o644)
  assert.equal(f.run(insecure).status,2)
  fs.chmodSync(insecure,0o600)
  const symlink=path.join(f.root,'symlink.json')
  fs.symlinkSync(insecure,symlink)
  assert.equal(f.run(symlink).status,2)
  const malformed=f.write('wrong-identity','not a real private SSH key')
  assert.equal(f.run(f.save('identity.json',{identityFile:malformed})).status,2)
  const outside=f.save('outside.json',{knownHostsFile:'/tmp/not-our-known-hosts'})
  assert.equal(f.run(outside).status,2)
})
test('option injection, unsafe remote endpoints and extraneous config are refused',t=>{
  const f=fixture(t)
  for(const [i,override] of [
    {sshHost:'-oProxyCommand=bad'},
    {sshHost:'localhost'},
    {sshHost:'127.0.0.1'},
    {sshHost:'witness.*'},
    {sshUser:'-root'},
    {sshPort:0},
    {localPort:80},
    {remotePort:65536},
    {worldId:'production'},
    {sandboxOnly:false},
    {unexpected:'no'}
  ].entries()){
    const result=f.run(f.save('unsafe-'+i+'.json',override))
    assert.equal(result.status,2,'unsafe case '+i+' '+result.stdout)
    assert.equal(result.stdout,'')
  }
})
test('nonstandard SSH host key port must be pinned exactly; never infer host key from DNS',t=>{
  const f=fixture(t)
  const config=f.save('alternate-port.json',{sshPort:2222})
  assert.equal(f.run(config).status,2)
  fs.writeFileSync(f.knownHostsFile,
    '[witness.example.invalid]:2222 ssh-ed25519 '+f.wire+'\n')
  assert.equal(f.run(config).status,0)
})
