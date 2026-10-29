'use strict'

// Explicit opt-in for disposable QA worlds, not an autonomous explorer.
// The caller MUST already be executing an operator-signed durable world step.
// Only walk toward the one exact approved block/chest, within short bounds.
const HAZARDS=new Set(['water','lava','fire','soul_fire','cactus',
  'powder_snow','magma_block','sweet_berry_bush'])
const MAX_APPROACH_BLOCKS=10
const MAX_OWNER_DISTANCE=18
const MIN_HEALTH=12
const DEFAULT_TIMEOUT_MS=12000
const OBSERVE_MS=100
const OWNER=/^[A-Za-z0-9_]{3,16}$/
const numericPosition=p=>p && ['x','y','z'].every(k=>Number.isFinite(p[k]))
const approvedPosition=p=>p && ['x','y','z'].every(k=>
  Number.isInteger(p[k]) && Math.abs(p[k])<30000000)
const distance=(a,b)=>numericPosition(a)&&numericPosition(b)
  ?Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z):Infinity

function createQaBoundedNavigation({bot,GoalNear,Movements,ownerName,
  sandboxOnly,timeoutMs=DEFAULT_TIMEOUT_MS}={}){
  if(sandboxOnly!==true || !OWNER.test(ownerName||'') ||
     typeof GoalNear!=='function' || typeof Movements!=='function' ||
     !Number.isSafeInteger(timeoutMs) || timeoutMs<200 || timeoutMs>30000 ||
     typeof bot?.pathfinder?.goto!=='function' ||
     typeof bot.pathfinder.setGoal!=='function' ||
     typeof bot.pathfinder.setMovements!=='function' ||
     typeof bot?.blockAt!=='function' ||
     typeof bot?.on!=='function' || typeof bot?.off!=='function' ||
     typeof bot?.clearControlStates!=='function'){
    throw Error('Bounded navigation requires a complete explicit QA pathfinder')
  }
  let cancelled=false,active=false,abort=null
  const stopMotion=()=>{
    try{bot.pathfinder.setGoal(null)}catch{}
    try{bot.clearControlStates()}catch{}
  }
  function cancel(){
    cancelled=true
    const reject=abort
    if(reject)reject(Error('QA navigation cancelled'))
    stopMotion()
  }
  function status(){return Object.freeze({active,cancelled})}
  function safety(target,start){
    const position=bot.entity?.position
    const owner=bot.players?.[ownerName]?.entity
    if(!numericPosition(position)||!numericPosition(owner?.position))
      return 'owner_or_bot_not_visible'
    if(!Number.isFinite(bot.health)||bot.health<MIN_HEALTH)
      return 'unsafe_bot_health'
    if(distance(position,owner.position)>MAX_OWNER_DISTANCE)
      return 'owner_out_of_range'
    if(distance(position,start)>MAX_APPROACH_BLOCKS+2 ||
       distance(position,target)>MAX_APPROACH_BLOCKS+2)
      return 'navigation_out_of_bounds'
    // Reject incomplete local world knowledge rather than treating an
    // unloaded block as safe. Do not inspect hidden or distant chunks.
    let feet,head
    try{
      feet=bot.blockAt(position.floored?position.floored():{
        x:Math.floor(position.x),y:Math.floor(position.y),z:Math.floor(position.z)})
      head=bot.blockAt(position.offset?position.offset(0,1,0):{
        x:position.x,y:position.y+1,z:position.z})
    }catch{return 'navigation_world_unavailable'}
    if(!feet || !head)return 'navigation_world_unavailable'
    if(HAZARDS.has(feet.name)||HAZARDS.has(head.name))return 'navigation_hazard'
    return null
  }
  async function approach(target,{desiredDistance=3.2}={}){
    if(cancelled)throw Error('QA navigation previously cancelled')
    if(active)throw Error('Concurrent QA navigation denied')
    if(!approvedPosition(target) || !Number.isFinite(desiredDistance) ||
       desiredDistance<1 || desiredDistance>4)
      throw Error('Unapproved QA navigation target')
    const current=bot.entity?.position
    const start=numericPosition(current)
      ?Object.freeze({x:current.x,y:current.y,z:current.z}):null
    // Seal coordinates: the caller cannot redirect an in-flight movement
    // by mutating a referenced Vec3 or plan object after validation.
    const goalTarget=Object.freeze({x:target.x,y:target.y,z:target.z})
    const owner=bot.players?.[ownerName]?.entity
    if(!numericPosition(start)||!numericPosition(owner?.position) ||
       distance(start,goalTarget)>MAX_APPROACH_BLOCKS ||
       distance(owner.position,goalTarget)>MAX_OWNER_DISTANCE)
      throw Error('QA navigation target beyond signed nearby operation')
    const unsafe=safety(goalTarget,start)
    if(unsafe)throw Error(unsafe)
    if(distance(start,goalTarget)<=desiredDistance)
      return Object.freeze({ok:true,reason:'already_within_reach',moved:false})
    active=true
    let interval=null,timer=null,aborted=false
    let rejectAbort
    const abortPromise=new Promise((_,reject)=>{rejectAbort=reject})
    const abortWith=error=>{
      if(aborted)return
      aborted=true
      stopMotion()
      rejectAbort(error)
    }
    abort=abortWith
    const onDisconnect=()=>abortWith(Error('QA navigation disconnected'))
    for(const event of ['end','kicked','death'])bot.on(event,onDisconnect)
    try{
      const moves=new Movements(bot)
      moves.canDig=false
      moves.canOpenDoors=false
      moves.allow1by1towers=false
      moves.allowFreeMotion=false
      moves.allowParkour=false
      moves.allowSprinting=false
      bot.pathfinder.setMovements(moves)
      // Explicitly scoped: no generic waypoint list and no pathfinder mining.
      const goal=new GoalNear(goalTarget.x,goalTarget.y,goalTarget.z,
        Math.max(1,Math.floor(desiredDistance)))
      interval=setInterval(()=>{
        const reason=safety(goalTarget,start)
        if(reason || cancelled)abortWith(Error(reason||'QA navigation cancelled'))
      },OBSERVE_MS)
      timer=setTimeout(()=>abortWith(Error('QA navigation timed out')),timeoutMs)
      await Promise.race([
        Promise.resolve().then(()=>bot.pathfinder.goto(goal)),abortPromise
      ])
      if(cancelled)throw Error('QA navigation cancelled')
      const finalUnsafe=safety(goalTarget,start)
      if(finalUnsafe)throw Error(finalUnsafe)
      if(distance(bot.entity.position,goalTarget)>desiredDistance)
        throw Error('QA pathfinder did not reach exact approved target')
      return Object.freeze({ok:true,reason:'approved_target_reached',moved:true})
    }finally{
      abort=null
      if(timer)clearTimeout(timer)
      if(interval)clearInterval(interval)
      for(const event of ['end','kicked','death'])bot.off(event,onDisconnect)
      stopMotion()
      active=false
    }
  }
  return Object.freeze({approach,cancel,status})
}
module.exports={createQaBoundedNavigation,MAX_APPROACH_BLOCKS,
  MAX_OWNER_DISTANCE,MIN_HEALTH,DEFAULT_TIMEOUT_MS}
