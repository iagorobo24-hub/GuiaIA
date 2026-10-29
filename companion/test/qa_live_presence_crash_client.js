'use strict'
// Connect an actual offline-mode player to an isolated Fabric world. Parent
// harness kills ONLY that disposable server while the JOIN is still live.
const mineflayer=require('mineflayer')
const {verifyBridgeLog}=require('../src/fabric_bridge_reader')
const {createPinnedQaLivePresenceAuthority}=require('../src/live_presence')
const fs=require('node:fs')
const [eventsFile,pubFile]=process.argv.slice(2)
if(!eventsFile?.startsWith('/tmp/guiaia-fabric-bridge-qa-') ||
   !pubFile?.startsWith('/tmp/guiaia-fabric-bridge-qa-'))
  throw Error('Actual connection crash QA requires disposable files')
const worldId='qa:real-fabric:25593'
const pub=fs.readFileSync(pubFile,'utf8')
const live=createPinnedQaLivePresenceAuthority({
  port:25594,worldId,serverBridgePublicKeyPem:pub})
const bot=mineflayer.createBot({host:'127.0.0.1',port:25593,
  username:'OwnerQA',auth:'offline',version:'1.21.1',hideErrors:true})
const delay=ms=>new Promise(done=>setTimeout(done,ms))
const fail=setTimeout(()=>{console.error('QA live-client setup timeout');process.exit(1)},45000)
async function start(){
  await new Promise((resolve,reject)=>{
    bot.once('spawn',resolve)
    bot.once('error',reject)
    bot.once('end',()=>reject(Error('Player disconnected before readiness')))
  })
  for(let k=0;k<110;k++){
    const active=[...verifyBridgeLog(eventsFile,pub,worldId).active.values()]
      .find(p=>p.username==='OwnerQA')
    if(active){
      const check=await live.livePresence(active.connectionId)
      if(check.connected===true){
        console.log('GUIAIA_REAL_CRASH_QA_JOIN_READY='+JSON.stringify({
          connectionId:active.connectionId,worldId}))
        clearTimeout(fail)
        // Explicitly hold the client until parent kills the disposable server.
        setInterval(()=>{},1000)
        return
      }
    }
    await delay(120)
  }
  throw Error('No actual signed JOIN and live server evidence')
}
start().catch(e=>{console.error('Crash QA client: '+e.message);process.exitCode=1;bot.quit()})
