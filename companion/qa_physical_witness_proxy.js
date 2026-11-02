'use strict'
// QA-only loopback HTTPS bridge to a physically separate Ed25519 witness.
// A fault marker closes ONLY the client-side transport; it cannot edit witness
// state, world journals, or server data. Never bind this HTTP shim to a LAN.
const fs=require('node:fs')
const os=require('node:os')
const path=require('node:path')
const http=require('node:http')
const https=require('node:https')
function main(){
  const dir=process.env.GUIAIA_QA_PHYSICAL_WITNESS_DIRECTORY
  const host=process.env.GUIAIA_QA_REMOTE_WITNESS_HOST
  if(typeof dir!=='string'||path.dirname(dir)!==os.tmpdir()||
     !/^guiaia-crosshost-fabric-qa-[A-Za-z0-9_-]{6,}$/.test(path.basename(dir))||
     fs.realpathSync(dir)!==dir||(fs.statSync(dir).mode&0o077)!==0||
     !/^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+\.ts\.net$/.test(host||''))
    throw Error('Explicit private physical QA transport and pinned tailnet hostname required')
  const denied=()=>fs.existsSync(path.join(dir,'outage-requested'))&&
    !fs.existsSync(path.join(dir,'restore-requested'))
  const server=http.createServer((req,res)=>{
    if(req.socket.remoteAddress!=='127.0.0.1'){
      req.socket.destroy();return
    }
    if(denied()){
      req.socket.destroy();return
    }
    const upstream=https.request({hostname:'127.0.0.1',port:24119,
      servername:host,rejectUnauthorized:true,method:req.method,path:req.url,
      headers:{...req.headers,host},timeout:1250},reply=>{
        if(reply.socket.authorized!==true){
          if(!res.headersSent)res.writeHead(502)
          res.end();return
        }
        res.writeHead(reply.statusCode||502,reply.headers)
        reply.pipe(res)
      })
    upstream.on('timeout',()=>upstream.destroy())
    upstream.on('error',()=>{
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
