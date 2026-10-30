'use strict'
// Connect only to the disposable QA Minecraft at loopback:25599.
// Both accounts are fake lab identities. No chat/RCON/operator credentials.
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { createQaGather, inventoryCount } = require('../src/gather')

const connection = (username) => ({
  host:'127.0.0.1', port:25599, username, auth:'offline',
  version:'1.21.1', hideErrors:true
})
const owner = mineflayer.createBot(connection('OwnerQA'))
const worker = mineflayer.createBot(connection('GuiaIA_QA'))
worker.loadPlugin(pathfinder)
const pause = (ms) => new Promise(resolve => setTimeout(resolve,ms))
function spawned(bot) {
  if (bot.entity?.position) return Promise.resolve()
  return new Promise((resolve,reject)=>{
    bot.once('spawn',resolve)
    bot.once('end',()=>reject(new Error('Disconnected before spawn')))
    bot.once('error',()=>reject(new Error('QA Minecraft connection failed')))
  })
}
async function main(){
  const watchdog=setTimeout(()=>{
    console.error('QA gather timeout')
    process.exitCode=1
    owner.end()
    worker.end()
  },65000)
  try {
    await Promise.all([spawned(owner),spawned(worker)])
    const target = new Vec3(3,64,2)
    // Verify both real client entities and the real target chunk are loaded.
    let ready=false
    for(let i=0;i<70;i++){
      if(worker.players?.OwnerQA?.entity &&
         worker.blockAt(target)?.name === 'oak_log' &&
         Number.isFinite(worker.health)) {ready=true;break}
      await pause(250)
    }
    if(!ready) throw new Error('QA owner or oak log never observed')
    // Keep the QA owner visibly nearby but out of pickup range. If both bots
    // stand on the same worldspawn, either one can randomly collect the drop,
    // producing a false-negative for the worker's verified inventory receipt.
    await owner.lookAt(new Vec3(owner.entity.position.x, owner.entity.position.y + 1.6,
                                owner.entity.position.z + 7), true)
    owner.setControlState('forward', true)
    let ownerDropDistance = 0
    for (let i=0; i<15; i++) {
      await pause(140)
      ownerDropDistance = Math.hypot(owner.entity.position.x - 3.5,
                                      owner.entity.position.z - 2.5)
      if (ownerDropDistance >= 3.2) break
    }
    owner.setControlState('forward', false)
    if (ownerDropDistance < 2.6 || ownerDropDistance > 12) {
      throw new Error('QA owner could still compete for the planted item drop')
    }
    const before=inventoryCount(worker,'oak_log')
    const moves=new Movements(worker)
    moves.canDig=false
    moves.canOpenDoors=false
    moves.allowParkour=false
    moves.allow1by1towers=false
    moves.allowFreeMotion=false
    worker.pathfinder.setMovements(moves)
    const gather=createQaGather(worker,{
      sandboxOnly:true, ownerName:'OwnerQA',target, pickupTimeoutMs:16000,
      pickupApproach: async (position) => {
        // Only the already-approved oak-log position in this disposable world.
        worker.pathfinder.setGoal(new goals.GoalBlock(position.x, position.y, position.z))
      }
    })
    const result=await gather.gatherOne()
    if(!result.ok) {
      const drops=Object.values(worker.entities||{}).filter(e=>e.name==='item').length
      throw new Error('QA gather failed: '+result.reason+'; nearby_lab_drops='+drops)
    }
    const after=inventoryCount(worker,'oak_log')
    if(after-before < 1 || worker.blockAt(target)?.name==='oak_log') {
      throw new Error('Inventory and block-state receipts do not match')
    }
    console.log('GUIAIA_GATHER_QA_EVIDENCE='+JSON.stringify({
      result:'pass', real_minecraft_server:true, real_bot_login:true,
      owner_present:true, block_before:'oak_log',
      block_after:worker.blockAt(target)?.name,
      inventory_before:before, inventory_after:after,
      inventory_delta:after-before, verified:true,
      owner_outside_item_pickup_radius:true,
      source:'real_mineflayer_inventory_and_world',
      sandbox_only:true, production:false
    }))
  }finally{
    clearTimeout(watchdog)
    try{ owner.clearControlStates();worker.clearControlStates() }catch{}
    owner.quit(); worker.quit()
  }
}
main().catch(err=>{
  console.error('QA GATHER FAILURE: '+String(err.message).slice(0,240))
  process.exitCode=1
  owner.end();worker.end()
})
