'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const crypto=require('node:crypto')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {spawnSync}=require('node:child_process')
const {openQaPrincipalRegistry}=require('../src/principal_enrollment')
const {createPrincipalRequest,validateRequest,approvePrincipalRequest,
  completePrincipalHandoff,verifyPrincipalHandoff,fingerprint,
  createPrincipalRevocation,verifyPrincipalRevocation}=
  require('../src/offline_principal_handoff')
const cli=path.resolve(__dirname,'../offline_principal_handoff.js')
const worldId='qa:real-fabric:25593',principalId='owner_approved_1'
const pair=()=>crypto.generateKeyPairSync('ed25519')
const pub=x=>x.publicKey.export({format:'pem',type:'spki'})
const priv=x=>x.privateKey.export({format:'pem',type:'pkcs8'})
const cmd=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:12000})
function fixture(t){
  const principalRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-offline-principal-'))
  const operatorRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-offline-operator-'))
  const registryRoot=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-enrollment-qa-'))
  t.after(()=>{for(const dir of [principalRoot,operatorRoot,registryRoot])
    fs.rmSync(dir,{recursive:true,force:true})})
  const principal=pair(),operator=pair()
  const principalKey=path.join(principalRoot,'principal.pk8')
  const operatorKey=path.join(operatorRoot,'operator.pk8')
  const operatorPublic=path.join(principalRoot,'operator.pem')
  fs.writeFileSync(principalKey,priv(principal),{mode:0o600})
  fs.writeFileSync(operatorKey,priv(operator),{mode:0o600})
  fs.writeFileSync(operatorPublic,pub(operator),{mode:0o600})
  return {principalRoot,operatorRoot,registryRoot,principal,operator,
    principalKey,operatorKey,operatorPublic,
    requestFile:path.join(principalRoot,'request.json'),
    ticketFile:path.join(operatorRoot,'ticket.json'),
    handoffFile:path.join(principalRoot,'handoff.json')}
}
const approve=(f,request,{world=worldId,id=principalId,finger=fingerprint(request.payload.publicKeyDer)}={})=>
  approvePrincipalRequest({request,operatorPrivateKey:priv(f.operator),
    expectedWorldId:world,reviewedPrincipalId:id,reviewedFingerprint:finger})

test('separate principal process, operator approval, consent, verification and registry import',t=>{
  const x=fixture(t)
  const first=cmd('principal-request',worldId,principalId,x.principalKey,x.requestFile)
  assert.equal(first.status,0,first.stderr)
  const request=JSON.parse(fs.readFileSync(x.requestFile,'utf8'))
  assert.equal(validateRequest(request,worldId).principalId,principalId)
  assert.equal(fs.statSync(x.requestFile).mode&0o777,0o600)
  const ticket=approve(x,request)
  fs.writeFileSync(x.ticketFile,JSON.stringify(ticket),{mode:0o600})
  const second=cmd('principal-consent',worldId,x.principalKey,
    x.operatorPublic,x.ticketFile,x.handoffFile)
  assert.equal(second.status,0,second.stderr)
  const third=cmd('verify',worldId,x.operatorPublic,x.handoffFile)
  assert.equal(third.status,0,third.stderr)
  const report=JSON.parse(third.stdout)
  assert.equal(report.registryEnrolled,false)
  assert.equal(report.worldActionsEnabled,false)
  assert.equal(report.principalId,principalId)
  assert.equal(report.fingerprint,fingerprint(request.payload.publicKeyDer))
  assert.equal(fs.statSync(x.handoffFile).mode&0o777,0o600)
  for(const output of [first.stdout,second.stdout,third.stdout,
    fs.readFileSync(x.requestFile,'utf8'),fs.readFileSync(x.handoffFile,'utf8')]){
    assert.ok(!output.includes('PRIVATE KEY'))
    assert.ok(!output.includes(priv(x.principal).slice(35,75)))
    assert.ok(!output.includes(priv(x.operator).slice(35,75)))
  }
  const config={sandboxOnly:true,worldId,operatorPublicKeyPem:pub(x.operator)}
  const registry=openQaPrincipalRegistry(path.join(x.registryRoot,'registry'),config)
  const handoff=JSON.parse(fs.readFileSync(x.handoffFile,'utf8'))
  assert.equal(registry.applySignedChange(handoff.ticket,handoff.consent).action,'enrolled')
  assert.match(registry.trustedPrincipals()[principalId],/BEGIN PUBLIC KEY/)
  assert.throws(()=>registry.applySignedChange(handoff.ticket,handoff.consent),/Replayed/)
  registry.close()
  const reopened=openQaPrincipalRegistry(path.join(x.registryRoot,'registry'),config)
  assert.equal(Object.keys(reopened.trustedPrincipals()).length,1)
  reopened.close()
})

test('request cryptographically binds principal, exact world and canonical fields',t=>{
  const x=fixture(t),r=createPrincipalRequest({worldId,principalId,principalPrivateKey:priv(x.principal)})
  assert.equal(validateRequest(r,worldId).principalId,principalId)
  assert.throws(()=>validateRequest(r,'qa:other'),/wrong-world/)
  assert.throws(()=>validateRequest({...r,payload:{...r.payload,principalId:'attacker'}},worldId),/proof/)
  assert.throws(()=>validateRequest({...r,payload:{...r.payload,extra:'surprise'}},worldId),/Malformed/)
  assert.throws(()=>validateRequest({...r,signature:'A'.repeat(86)},worldId),/proof/)
  assert.throws(()=>validateRequest({...r,payload:{...r.payload,nonce:'bad'}},worldId),/wrong-world/)
  assert.throws(()=>createPrincipalRequest({worldId:'prod:world',principalId,principalPrivateKey:priv(x.principal)}),/QA world/)
  const rsa=crypto.generateKeyPairSync('rsa',{modulusLength:2048})
  assert.throws(()=>createPrincipalRequest({worldId,principalId,principalPrivateKey:rsa.privateKey}),/Ed25519/)
  assert.throws(()=>validateRequest(r,worldId,Date.now()+130000),/Expired/)
})

test('operator approval requires separately reviewed identity and public-key fingerprint',t=>{
  const x=fixture(t),r=createPrincipalRequest({worldId,principalId,principalPrivateKey:priv(x.principal)})
  assert.throws(()=>approve(x,r,{id:'other_id'}),/operator approval/)
  assert.throws(()=>approve(x,r,{finger:'0'.repeat(64)}),/operator approval/)
  assert.throws(()=>approve(x,r,{world:'qa:other'}),/wrong-world/)
  const ticket=approve(x,r)
  assert.equal(ticket.payload.nonce,r.payload.nonce)
  assert.equal(ticket.payload.publicKeyDer,r.payload.publicKeyDer)
  const handoff=completePrincipalHandoff({ticket,principalPrivateKey:priv(x.principal),
    operatorPublicKeyPem:pub(x.operator),expectedWorldId:worldId})
  assert.equal(verifyPrincipalHandoff({handoff,operatorPublicKeyPem:pub(x.operator),
    expectedWorldId:worldId}).principalId,principalId)
})

test('consent denies impersonated key, operator, tampering and expired approval',t=>{
  const x=fixture(t),r=createPrincipalRequest({worldId,principalId,principalPrivateKey:priv(x.principal)})
  const ticket=approve(x,r),imposter=pair(),otherOperator=pair()
  const complete=({tkt=ticket,key=priv(x.principal),operator=pub(x.operator)}={})=>
    completePrincipalHandoff({ticket:tkt,principalPrivateKey:key,
      operatorPublicKeyPem:operator,expectedWorldId:worldId})
  assert.throws(()=>complete({key:priv(imposter)}),/does not belong/)
  assert.throws(()=>complete({operator:pub(otherOperator)}),/signature/)
  assert.throws(()=>complete({tkt:{...ticket,payload:{...ticket.payload,principalId:'attacker'}}}),/signature/)
  const handoff=complete()
  assert.throws(()=>verifyPrincipalHandoff({handoff,
    operatorPublicKeyPem:pub(otherOperator),expectedWorldId:worldId}),/signature/)
  assert.throws(()=>verifyPrincipalHandoff({handoff:{ticket,consent:'A'.repeat(86)},
    operatorPublicKeyPem:pub(x.operator),expectedWorldId:worldId}),/possession/)
  assert.throws(()=>verifyPrincipalHandoff({handoff,
    operatorPublicKeyPem:pub(x.operator),expectedWorldId:worldId,now:Date.now()+121000}),/expired/)
})

test('operator review CLI refuses redirected stdin, never signing the request',t=>{
  const x=fixture(t),r=createPrincipalRequest({worldId,principalId,principalPrivateKey:priv(x.principal)})
  fs.writeFileSync(x.requestFile,JSON.stringify(r),{mode:0o600})
  const result=cmd('operator-review',worldId,x.operatorKey,x.requestFile,x.ticketFile)
  assert.equal(result.status,2)
  assert.match(result.stderr,/interactive local TTY/)
  assert.ok(!fs.existsSync(x.ticketFile))
})

test('CLI refuses weak permissions, symlinks, hardlinks, overwrites and unsafe parents',t=>{
  const x=fixture(t)
  fs.chmodSync(x.principalKey,0o644)
  let result=cmd('principal-request',worldId,principalId,x.principalKey,x.requestFile)
  assert.equal(result.status,2)
  fs.chmodSync(x.principalKey,0o600)
  const linked=path.join(x.principalRoot,'linked.pk8')
  fs.symlinkSync(x.principalKey,linked)
  result=cmd('principal-request',worldId,principalId,linked,x.requestFile)
  assert.equal(result.status,2)
  const hard=path.join(x.principalRoot,'hard.pk8')
  fs.linkSync(x.principalKey,hard)
  result=cmd('principal-request',worldId,principalId,x.principalKey,x.requestFile)
  assert.equal(result.status,2)
  fs.unlinkSync(hard)
  result=cmd('principal-request',worldId,principalId,x.principalKey,x.requestFile)
  assert.equal(result.status,0,result.stderr)
  result=cmd('principal-request',worldId,principalId,x.principalKey,x.requestFile)
  assert.equal(result.status,2)
  fs.chmodSync(x.principalRoot,0o750)
  result=cmd('principal-request',worldId,principalId,x.principalKey,
    path.join(x.principalRoot,'another.json'))
  assert.equal(result.status,2)
})

test('CLI refuses project keys, nonabsolute paths, unsupported modes',t=>{
  const x=fixture(t)
  let result=cmd('principal-request',worldId,principalId,
    path.resolve(__dirname,'../package.json'),x.requestFile)
  assert.equal(result.status,2)
  assert.match(result.stderr,/inside Git project/)
  result=cmd('principal-request',worldId,principalId,'relative.key',x.requestFile)
  assert.equal(result.status,2)
  result=cmd('unknown',worldId,principalId,x.principalKey,x.requestFile)
  assert.equal(result.status,2)
  assert.ok(!fs.existsSync(x.requestFile))
})

test('interactive operator-review CLI signs only after exact TTY confirmation',t=>{
  if(process.platform!=='linux')return t.skip('Requires Linux pseudoterminal')
  const available=spawnSync('which',['script'],{encoding:'utf8'})
  if(available.status!==0)return t.skip('No isolated script pseudoterminal')
  const x=fixture(t)
  const request=createPrincipalRequest({worldId,principalId,principalPrivateKey:priv(x.principal)})
  fs.writeFileSync(x.requestFile,JSON.stringify(request),{mode:0o600})
  const digest=fingerprint(request.payload.publicKeyDer)
  const quote=p=>JSON.stringify(p)
  const command=[process.execPath,cli,'operator-review',worldId,
    x.operatorKey,x.requestFile,x.ticketFile].map(quote).join(' ')
  const response=spawnSync('script',['-q','-e','-c',command,'/dev/null'],{
    input:'APROBAR '+principalId+' '+digest+'\n',encoding:'utf8',timeout:12000
  })
  assert.equal(response.status,0,response.stdout+'\n'+response.stderr)
  const ticket=JSON.parse(fs.readFileSync(x.ticketFile,'utf8'))
  assert.equal(ticket.payload.publicKeyDer,request.payload.publicKeyDer)
  assert.equal(ticket.payload.nonce,request.payload.nonce)
  assert.equal(fs.statSync(x.ticketFile).mode&0o777,0o600)
  const consent=cmd('principal-consent',worldId,x.principalKey,
    x.operatorPublic,x.ticketFile,x.handoffFile)
  assert.equal(consent.status,0,consent.stderr)
  const verified=cmd('verify',worldId,x.operatorPublic,x.handoffFile)
  assert.equal(verified.status,0,verified.stderr)
})

test('offline operator revocation is signed, exact-world and registry-enforced',t=>{
  const x=fixture(t)
  const registry=openQaPrincipalRegistry(path.join(x.registryRoot,'registry'),{
    sandboxOnly:true,worldId,operatorPublicKeyPem:pub(x.operator)
  })
  const request=createPrincipalRequest({worldId,principalId,principalPrivateKey:priv(x.principal)})
  const ticket=approve(x,request)
  const handoff=completePrincipalHandoff({ticket,principalPrivateKey:priv(x.principal),
    operatorPublicKeyPem:pub(x.operator),expectedWorldId:worldId})
  registry.applySignedChange(handoff.ticket,handoff.consent)
  assert.equal(registry.isRevoked(principalId),false)
  assert.throws(()=>createPrincipalRevocation({worldId,principalId,
    operatorPrivateKey:priv(x.operator),reviewedPrincipalId:'someone_else'}),/matching/)
  assert.throws(()=>createPrincipalRevocation({worldId:'prod:server',principalId,
    operatorPrivateKey:priv(x.operator),reviewedPrincipalId:principalId}),/QA world/)
  const revoke=createPrincipalRevocation({worldId,principalId,
    operatorPrivateKey:priv(x.operator),reviewedPrincipalId:principalId})
  assert.equal(verifyPrincipalRevocation({ticket:revoke,operatorPublicKeyPem:pub(x.operator),
    expectedWorldId:worldId}).principalId,principalId)
  assert.throws(()=>verifyPrincipalRevocation({ticket:revoke,
    operatorPublicKeyPem:pub(pair()),expectedWorldId:worldId}),/signature/)
  assert.throws(()=>verifyPrincipalRevocation({ticket:revoke,
    operatorPublicKeyPem:pub(x.operator),expectedWorldId:'qa:other'}),/wrong-world/)
  assert.equal(registry.applySignedChange(revoke).action,'revoked')
  assert.equal(registry.isRevoked(principalId),true)
  assert.deepEqual(Object.keys(registry.trustedPrincipals()),[])
  assert.throws(()=>registry.applySignedChange(revoke),/Replayed/)
  assert.throws(()=>registry.applySignedChange(handoff.ticket,handoff.consent),/Replayed/)
  registry.close()
})

test('operator-revoke requires TTY and can issue a valid isolated revocation ticket',t=>{
  const x=fixture(t),revocation=path.join(x.operatorRoot,'revoke.json')
  const denied=cmd('operator-revoke',worldId,principalId,x.operatorKey,revocation)
  assert.equal(denied.status,2)
  assert.match(denied.stderr,/interactive local TTY/)
  assert.ok(!fs.existsSync(revocation))
  if(process.platform!=='linux'||spawnSync('which',['script']).status!==0)
    return t.skip('TTY utility unavailable')
  const command=[process.execPath,cli,'operator-revoke',worldId,
    principalId,x.operatorKey,revocation].map(JSON.stringify).join(' ')
  const response=spawnSync('script',['-q','-e','-c',command,'/dev/null'],{
    input:'REVOCAR '+principalId+' '+worldId+'\n',encoding:'utf8',timeout:12000
  })
  assert.equal(response.status,0,response.stdout+'\n'+response.stderr)
  const ticket=JSON.parse(fs.readFileSync(revocation,'utf8'))
  assert.equal(ticket.payload.principalId,principalId)
  assert.equal(fs.statSync(revocation).mode&0o777,0o600)
  const verification=cmd('verify-revocation',worldId,x.operatorPublic,revocation)
  assert.equal(verification.status,0,verification.stderr)
  assert.equal(JSON.parse(verification.stdout).registryRevoked,false)
})

test('malformed external JSON never echoes its content or private-looking bytes',t=>{
  const x=fixture(t)
  const secret='NEVER_PRINT_THIS_PEM_CONTENT'
  fs.writeFileSync(x.handoffFile,'{"unsafe":"'+secret+'",bad}',{mode:0o600})
  const result=cmd('verify',worldId,x.operatorPublic,x.handoffFile)
  assert.equal(result.status,2)
  assert.match(result.stderr,/Malformed public QA JSON/)
  assert.ok(!result.stderr.includes(secret))
  assert.ok(!result.stdout.includes(secret))
})
