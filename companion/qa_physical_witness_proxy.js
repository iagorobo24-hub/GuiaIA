'use strict'
// QA-only loopback HTTPS bridge to a physically separate Ed25519 witness.
// A fault marker closes ONLY the client-side transport; it cannot edit witness
// state, world journals, or server data. Never bind this HTTP shim to a LAN.
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const http=require('node:http')
const https=require('node:https')
const {performance}=require('node:perf_hooks')
// Strictly opt-in QA metadata. Never log URLs, bodies, keys, UUIDs or headers.
const diagnostics=process.env.GUIAIA_QA_TRANSPORT_DIAGNOSTICS==='1'
function pinnedWitnessHost(value){
  if(typeof value!=='string'||!/^[1-9][0-9]{3,4}$/.test(value)||
    !Number.isSafeInteger(Number(value))||Number(value)<1024||
    Number(value)>65535)
    throw Error('Explicit bounded QA witness loopback port required')
  return '127.0.0.1:'+value
}
function trace(method,stage,status,started){
  if(!diagnostics)return
  process.stderr.write('GUIAIA_PHYSICAL_TLS_TRANSPORT='+JSON.stringify({
    method:method==='POST'?'POST':'GET',stage,status,
    elapsed_ms:Math.round(performance.now()-started)})+'\n')
}
function main(){
  const dir=process.env.GUIAIA_QA_PHYSICAL_WITNESS_DIRECTORY
  const host=process.env.GUIAIA_QA_REMOTE_WITNESS_HOST
  // Tailscale Serve preserves the incoming HTTPS Host in the HTTP hop.
  // The signed witness intentionally accepts ONLY 127.0.0.1:<actual port>.
  // Explicitly pin that hop's Host while preserving the verified TLS SNI.
  const witnessHost=pinnedWitnessHost(process.env.GUIAIA_QA_REMOTE_WITNESS_LOOPBACK_PORT)
  if(typeof dir!=='string'||path.dirname(dir)!==os.tmpdir()||
     !/^guiaia-crosshost-fabric-qa-[A-Za-z0-9_-]{6,}$/.test(path.basename(dir))||
     fs.realpathSync(dir)!==dir||(fs.statSync(dir).mode&0o077)!==0||
     !/^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+\.ts\.net$/.test(host||''))
    throw Error('Explicit private physical QA transport and pinned tailnet hostname required')
  const denied=()=>fs.existsSync(path.join(dir,'outage-requested'))&&
    !fs.existsSync(path.join(dir,'restore-requested'))
  const server=http.createServer((req,res)=>{
    const started=performance.now()
    if(req.socket.remoteAddress!=='127.0.0.1'){
      req.socket.destroy();return
    }
    if(denied()){
      req.socket.destroy();return
    }
    const upstream=https.request({hostname:'127.0.0.1',port:24119,
      servername:host,rejectUnauthorized:true,method:req.method,path:req.url,
      // Drop untrusted forwarded headers. No identity is derived from Host;
      // the witness still checks its loopback socket + Ed25519/CAS itself.
      headers:{host:witnessHost,
        ...(req.method==='POST'?{'content-type':'application/json',
          'content-length':req.headers['content-length']}: {})},
      timeout:1250},reply=>{
        trace(req.method,'headers',reply.statusCode||502,started)
        reply.once('end',()=>trace(req.method,'complete',reply.statusCode||502,started))
        if(reply.socket.authorized!==true){
          if(!res.headersSent)res.writeHead(502)
          res.end();return
        }
        res.writeHead(reply.statusCode||502,reply.headers)
        reply.pipe(res)
      })
    upstream.on('timeout',()=>{
      trace(req.method,'upstream_timeout',0,started)
      upstream.destroy()
    })
    upstream.on('error',()=>{
      trace(req.method,'upstream_error',0,started)
      if(!res.headersSent)res.writeHead(502)
      res.end()
    })
    req.pipe(upstream)
  })
  server.headersTimeout=2500
  server.requestTimeout=2500
  server.listen(24121,'127.0.0.1',()=>console.log('QA_PHYSICAL_TLS_PROXY_READY'))
  process.on('SIGINT',()=>server.close())
  process.on('SIGTERM',()=>server.close())
}
if(require.main===module)main()

module.exports={pinnedWitnessHost}
