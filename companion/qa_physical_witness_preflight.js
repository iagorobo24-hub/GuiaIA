'use strict'
// Read-only network preflight for disposable two-host QA, not an authorization.
// This never sends a signed ticket, modifies a checkpoint or retries CAS.
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const http=require('node:http')
const crypto=require('node:crypto')
const {performance}=require('node:perf_hooks')
const EXPECTED_PORT=24121
function qaPrivateFixture(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||
    path.dirname(dir)!==os.tmpdir()||
    !/^guiaia-crosshost-fabric-qa-[A-Za-z0-9_-]{6,}$/.test(path.basename(dir))||
    path.normalize(dir)!==dir||fs.realpathSync(dir)!==dir||
    !fs.lstatSync(dir).isDirectory()||(fs.statSync(dir).mode&0o077)!==0||
    fs.existsSync(path.join(dir,'outage-requested')))
    throw Error('Private two-host QA preflight fixture required')
  return dir
}
function readonlyProbe(port,deadlineMs){
  return new Promise((resolve,reject)=>{
    const start=performance.now()
    const nonce=crypto.randomUUID()
    const req=http.request({host:'127.0.0.1',port,method:'GET',
      path:'/checkpoint?nonce='+nonce,
      headers:{'cache-control':'no-store','connection':'keep-alive'}},res=>{
      // Before first signed bootstrap a real witness MUST deny read-only GET.
      // A 200, redirect, 502 or any other reply is never success.
      const status=res.statusCode
      let size=0
      res.on('data',chunk=>{
        size+=chunk.length
        if(size>256)req.destroy(Error('Oversized preflight response'))
      })
      res.on('end',()=>status===403?resolve(performance.now()-start):
        reject(Error('Read-only witness preflight denied: unexpected status')))
      res.on('error',()=>reject(Error('Read-only witness preflight response failed')))
    })
    const timer=setTimeout(()=>req.destroy(Error('Read-only preflight deadline exceeded')),deadlineMs)
    timer.unref()
    req.once('close',()=>clearTimeout(timer))
    req.on('error',()=>reject(Error('Read-only witness preflight transport unavailable')))
    req.end()
  })
}
async function preflight({port=EXPECTED_PORT,maxRequests=6,stableCount=3,
  stableThresholdMs=750,probeDeadlineMs=3000}={}){
  if(!Number.isInteger(port)||port<1024||port>65535||
    !Number.isInteger(maxRequests)||maxRequests<1||maxRequests>8||
    !Number.isInteger(stableCount)||stableCount<1||stableCount>maxRequests||
    !Number.isInteger(stableThresholdMs)||stableThresholdMs<1||
    stableThresholdMs>1000||!Number.isInteger(probeDeadlineMs)||
    probeDeadlineMs<50||probeDeadlineMs>3000)
    throw Error('Invalid bounded QA read-only preflight parameters')
  const samples=[]
  let stable=0
  for(let i=0;i<maxRequests;i++){
    let ms
    try{ms=await readonlyProbe(port,probeDeadlineMs)}
    catch{throw Error('Read-only physical witness transport not ready')}
    samples.push(Math.round(ms))
    stable=ms<=stableThresholdMs?stable+1:0
    if(stable>=stableCount)return Object.freeze({result:'pass',
      qa_only:true,read_only:true,authorization:false,
      requests:samples.length,latency_ms:samples})
  }
  throw Error('Read-only witness transport did not stabilize')
}
async function main(){
  if(process.argv.length!==3||process.argv[2]!=='--qa-readonly-preflight')
    throw Error('Explicit QA-only read-only preflight flag required')
  qaPrivateFixture(process.env.GUIAIA_QA_PHYSICAL_WITNESS_DIRECTORY)
  const result=await preflight()
  process.stdout.write('GUIAIA_PHYSICAL_WITNESS_READONLY_PREFLIGHT='+JSON.stringify(result)+'\n')
}
if(require.main===module)main().catch(error=>{
  process.stderr.write('QA read-only preflight refused: '+String(error.message)+'\n')
  process.exitCode=2
})
module.exports={preflight,qaPrivateFixture}
