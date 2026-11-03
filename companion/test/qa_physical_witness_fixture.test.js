'use strict'
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {test}=require('node:test')
const {createPhysicalQaWitnessFixture}=require('./qa_physical_witness_fixture')
function setup(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-crosshost-fabric-qa-'))
  const operator=crypto.generateKeyPairSync('ed25519')
  const witness=crypto.generateKeyPairSync('ed25519')
  const write=(name,data)=>fs.writeFileSync(path.join(dir,name),data,{flag:'wx',mode:0o600})
  write('operator-private.pem',operator.privateKey.export({format:'pem',type:'pkcs8'}))
  write('witness-public.pem',witness.publicKey.export({format:'pem',type:'spki'}))
  return dir
}
test('physical QA witness requires private ed25519 material in a disposable private root',t=>{
  if(process.platform==='win32'&&!process.env.GUIAIA_QA_PHYSICAL_WITNESS_DIRECTORY) return t.skip('Requiere infraestructura física multi-host y permisos POSIX; verificación pendiente')
  assert.throws(()=>createPhysicalQaWitnessFixture('/etc'),/isolated/)
  const dir=setup()
  try{
    const w=createPhysicalQaWitnessFixture(dir)
    assert.equal(w.operatorKey.privateKey.asymmetricKeyType,'ed25519')
    assert.equal(crypto.createPublicKey(w.witnessPublicKeyPem).asymmetricKeyType,'ed25519')
    fs.chmodSync(dir,0o755)
    assert.throws(()=>createPhysicalQaWitnessFixture(dir),/private/)
    fs.chmodSync(dir,0o700)
    fs.chmodSync(path.join(dir,'operator-private.pem'),0o644)
    assert.throws(()=>createPhysicalQaWitnessFixture(dir),/Unsafe/)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('physical QA witness outage and recovery require distinct external signals',async t=>{
  if(process.platform==='win32'&&!process.env.GUIAIA_QA_PHYSICAL_WITNESS_DIRECTORY) return t.skip('Requiere infraestructura física multi-host y permisos POSIX; verificación pendiente')
  const dir=setup()
  try{
    const witness=createPhysicalQaWitnessFixture(dir).witness
    assert.equal(await witness.start(),'http://127.0.0.1:24121/')
    const closing=witness.close()
    await closing
    assert.equal(fs.existsSync(path.join(dir,'outage-requested')),true)
    const restoring=witness.start()
    assert.equal(await restoring,'http://127.0.0.1:24121/')
    assert.equal(fs.existsSync(path.join(dir,'restore-requested')),true)
    await witness.close()
    await assert.rejects(witness.start(),/restart state/)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
