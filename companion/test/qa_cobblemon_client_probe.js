'use strict'
// Read-only, disposable offline-only Cobblemon protocol diagnostic.
// Observe packet NAMES and states, never payloads, identifiers, chat or secrets.
const mineflayer=require('mineflayer')
const port=25596
const timeoutMs=65000
let bot=null,clock=null,done=false,kicked='',issue='',ended=''
const stateHistory=[]
const events=[]
const packetCounts={}
const lastPackets=[]
const note=(name)=>{if(events.length<20)events.push(name)}
function finish(spawned,reason){
  if(done)return
  done=true
  clearTimeout(clock)
  const result={result:'observed',qa_only:true,spawned,reason,
    kicked:kicked.slice(0,120),error:issue.slice(0,180),
    end:ended.slice(0,100),states:stateHistory,
    events,packet_counts:packetCounts,last_packets:lastPackets}
  process.stdout.write('GUIAIA_COBBLEMON_MINEFLAYER_PROTOCOL_PROBE='+JSON.stringify(result)+'\n')
  try{bot?.quit()}catch{}
  const hardExit=setTimeout(()=>process.exit(0),2000)
  hardExit.unref()
}
try{
  bot=mineflayer.createBot({host:'127.0.0.1',port,
    username:'CobblemonProbeQA',auth:'offline',version:'1.21.1',
    hideErrors:true,checkTimeoutInterval:70000})
}catch(error){
  finish(false,'createBot failed')
  process.exit(0)
}
const client=bot._client
const recordState=state=>{if(stateHistory.length<15)stateHistory.push(String(state).slice(0,35))}
recordState(client.state)
client.on('state',recordState)
client.on('packet',(_data,meta)=>{
  const state=String(meta?.state||client.state||'unknown').slice(0,30)
  const name=String(meta?.name||'unknown').slice(0,60)
  const key=state+':'+name
  packetCounts[state]=(packetCounts[state]||0)+1
  lastPackets.push(key)
  if(lastPackets.length>18)lastPackets.shift()
})
bot.on('login',()=>note('mineflayer:login'))
bot.on('spawn',()=>{note('mineflayer:spawn');finish(true,'spawn completed')})
bot.on('game',()=>note('mineflayer:game'))
bot.on('kicked',value=>{kicked=String(typeof value==='string'?value:'server kick').slice(0,120);note('mineflayer:kicked')})
bot.on('error',error=>{issue=String(error?.message||error||'error').slice(0,180);note('mineflayer:error');finish(false,'bot error')})
bot.on('end',reason=>{ended=String(reason||'end').slice(0,100);note('mineflayer:end');finish(false,'connection ended')})
clock=setTimeout(()=>finish(false,'spawn timeout at 65 seconds'),timeoutMs)
