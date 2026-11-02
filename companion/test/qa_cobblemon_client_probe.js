'use strict'
// Disposable offline-only connection probe. It never issues game commands.
const mineflayer=require('mineflayer')
let finished=false,kicked='',firstError='',ended=''
const finish=(spawned,reason)=>{
  if(finished)return
  finished=true
  clearTimeout(timeout)
  console.log('GUIAIA_COBBLEMON_MINEFLAYER_PROTOCOL_PROBE='+JSON.stringify({
    result:'observed',qa_only:true,spawned,reason:reason.slice(0,230),
    kicked:kicked.slice(0,230),error:firstError.slice(0,230),end:ended.slice(0,100)
  }))
  try{bot.quit()}catch{}
}
let bot
try{
  bot=mineflayer.createBot({host:'127.0.0.1',port:25596,
    username:'CobblemonProbeQA',auth:'offline',version:'1.21.1',hideErrors:true})
}catch(error){
  console.log('GUIAIA_COBBLEMON_MINEFLAYER_PROTOCOL_PROBE='+JSON.stringify({
    result:'observed',qa_only:true,spawned:false,
    reason:'createBot: '+String(error?.message||'unknown').slice(0,230)
  }))
  process.exit(0)
}
bot.on('spawn',()=>finish(true,'login and spawn completed'))
bot.on('kicked',reason=>{kicked=typeof reason==='string'?reason:JSON.stringify(reason)})
bot.on('error',error=>{firstError=String(error?.message||error||'unknown');finish(false,'minecraft protocol error')})
bot.on('end',reason=>{ended=String(reason||'end');finish(false,'connection ended')})
const timeout=setTimeout(()=>finish(false,'client spawn timeout'),16000)
