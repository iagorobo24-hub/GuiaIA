'use strict'
const mineflayer=require('mineflayer')
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function connectAndQuit(username) {
  const bot=mineflayer.createBot({host:'127.0.0.1',port:25593,
    username,auth:'offline',version:'1.21.1',hideErrors:true})
  try{
    await Promise.race([
      new Promise((resolve,reject)=>{
        bot.once('spawn',resolve)
        bot.once('error',()=>reject(Error('Bridge QA cannot join')))
        bot.once('end',()=>reject(Error('Bridge QA disconnected before spawn')))
      }),
      wait(20000).then(()=>{throw Error('Bridge QA login timeout')})
    ])
    await wait(450)
  }finally{
    bot.quit()
    await wait(750)
  }
}
async function main(){
  await connectAndQuit('OwnerQA')
  await connectAndQuit('OwnerQA')
  console.log('GUIAIA_REAL_BRIDGE_CLIENTS_QA_EVIDENCE='+JSON.stringify({
    result:'pass',logins:2,username:'OwnerQA',
    reconnect_with_same_name:true,offline_login:true,
    production:false
  }))
}
main().catch(error=>{
  console.error('REAL BRIDGE LOGIN TEST FAILED: '+String(error.message).slice(0,200))
  process.exitCode=1
})
