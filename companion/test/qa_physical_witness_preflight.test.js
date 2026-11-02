'use strict'
const {test}=require('node:test')
const assert=require('node:assert/strict')
const http=require('node:http')
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const {preflight,qaPrivateFixture}=require('../qa_physical_witness_preflight')
async function server(t,reply){
  const calls=[]
  const s=http.createServer((req,res)=>{
    calls.push({method:req.method,path:req.url})
    reply(req,res)
  })
  await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve))
  t.after(()=>new Promise(resolve=>s.close(resolve)))
  return {port:s.address().port,calls}
}
test('read-only preflight accepts consecutive, quick explicit denials only',async t=>{
  const {port,calls}=await server(t,(_req,res)=>{res.writeHead(403);res.end('denied')})
  const result=await preflight({port,stableCount:3,maxRequests:5,
    stableThresholdMs:900,probeDeadlineMs:1000})
  assert.equal(result.result,'pass')
  assert.equal(result.read_only,true)
  assert.equal(result.authorization,false)
  assert.ok(result.requests>=3&&result.requests<=5)
  assert.deepEqual(new Set(calls.map(c=>c.method)),new Set(['GET']))
  for(const call of calls)assert.match(call.path,
    /^\/checkpoint\?nonce=[0-9a-f-]{36}$/)
})
test('cold read-only connection does not count as stable transport',async t=>{
  let count=0
  const {port,calls}=await server(t,(_req,res)=>{
    count++
    const send=()=>{res.writeHead(403);res.end('denied')}
    if(count===1)setTimeout(send,350)
    else send()
  })
  const result=await preflight({port,maxRequests:6,stableCount:3,
    stableThresholdMs:200,probeDeadlineMs:950})
  assert.equal(result.requests,4)
  assert.ok(result.latency_ms[0]>=300)
  assert.ok(result.latency_ms.slice(1).every(ms=>ms<=200))
  assert.ok(calls.every(c=>c.method==='GET'))
})
test('preflight cannot mistake 200, 502, or redirects for readiness',async t=>{
  for(const code of [200,302,502]){
    const {port}=await server(t,(_req,res)=>{res.writeHead(code);res.end('unexpected')})
    await assert.rejects(preflight({port,stableCount:1,maxRequests:1}),/not ready/)
  }
})
test('preflight fails closed if the read-only witness never responds',async t=>{
  const {port}=await server(t,()=>{})
  await assert.rejects(preflight({port,maxRequests:2,stableCount:1,
    probeDeadlineMs:80}),/not ready/)
})
test('preflight refuses unsafe parameters and non-private fixture',async()=>{
  await assert.rejects(preflight({port:80}),/Invalid/)
  await assert.rejects(preflight({maxRequests:99}),/Invalid/)
  await assert.rejects(preflight({probeDeadlineMs:90000}),/Invalid/)
  assert.throws(()=>qaPrivateFixture('/etc'),/QA preflight fixture/)
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'guiaia-crosshost-fabric-qa-'))
  try{
    assert.equal(qaPrivateFixture(dir),dir)
    fs.writeFileSync(path.join(dir,'outage-requested'),'1',{mode:0o600})
    assert.throws(()=>qaPrivateFixture(dir),/QA preflight fixture/)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
