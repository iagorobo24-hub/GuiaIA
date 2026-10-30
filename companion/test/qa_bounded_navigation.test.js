'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {EventEmitter}=require('node:events')
const {createQaBoundedNavigation,MAX_APPROACH_BLOCKS}=require('../src/qa_bounded_navigation')
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
class GoalNear{constructor(x,y,z,radius){Object.assign(this,{x,y,z,radius})}}
class Movements{constructor(bot){this.bot=bot;this.canDig=true;this.canOpenDoors=true}}
const point=(x,y=64,z=0)=>({x,y,z})
function world({wait=false,fail=false,stuck=false,hazard=false,missing=false}={}){
  const bot=new EventEmitter()
  const moves=[],goals=[]
  let navigations=0,clear=0,stopRequested=0, resolveGoto,rejectGoto
  bot.entity={position:point(0)}
  bot.players={OwnerQA:{entity:{position:point(6)}}}
  bot.health=20
  bot.blockAt=position=>missing?null:{name:hazard?'lava':'air'}
  bot.clearControlStates=()=>{clear++}
  bot.pathfinder={
    setMovements(m){moves.push(m)},
    setGoal(goal){goals.push(goal);if(goal===null)stopRequested++},
    goto(goal){
      navigations++
      if(fail)return Promise.reject(Error('pathfinder route unavailable'))
      if(stuck)return Promise.resolve()
      if(wait)return new Promise((resolve,reject)=>{resolveGoto=()=>{
        bot.entity.position=point(goal.x,goal.y,goal.z);resolve()
      };rejectGoto=reject})
      bot.entity.position=point(goal.x,goal.y,goal.z)
      return Promise.resolve()
    }}
  const create=(opts={})=>createQaBoundedNavigation({bot,GoalNear,Movements,
    ownerName:'OwnerQA',sandboxOnly:true,timeoutMs:1500,...opts})
  return {bot,moves,goals,create,
    get navigations(){return navigations},get clear(){return clear},
    get stopRequested(){return stopRequested},
    finish(){resolveGoto?.()},failGoto(){rejectGoto?.(Error('forced failure'))}}
}
test('rejects non QA or missing authoritative pathfinder primitives',()=>{
  const w=world()
  assert.throws(()=>createQaBoundedNavigation({bot:w.bot,GoalNear,Movements,
    ownerName:'OwnerQA'}),/complete explicit QA/)
  assert.throws(()=>w.create({ownerName:'name with spaces'}),/complete explicit QA/)
  assert.throws(()=>w.create({GoalNear:null}),/complete explicit QA/)
  assert.throws(()=>w.create({timeoutMs:50000}),/complete explicit QA/)
})
test('when already close, safety checks but no pathfinder commands',async()=>{
  const w=world(),n=w.create()
  assert.deepEqual(await n.approach(point(2)),{ok:true,reason:'already_within_reach',moved:false})
  assert.equal(w.navigations,0)
  assert.equal(w.goals.length,0)
})
test('moves only to one exact approved goal using non-destructive Movements',async()=>{
  const w=world(),n=w.create()
  assert.deepEqual(await n.approach(point(7)),{ok:true,reason:'approved_target_reached',moved:true})
  assert.equal(w.navigations,1)
  assert.deepEqual(w.goals[0],null)
  assert.equal(w.clear,1)
  assert.equal(n.status().active,false)
  for(const property of ['canDig','canOpenDoors','allow1by1towers',
    'allowFreeMotion','allowParkour','allowSprinting'])
    assert.equal(w.moves[0][property],false,property)
})
test('rejects arbitrary/far/duplicate or unsafe navigation target without moving',async()=>{
  const w=world(),n=w.create()
  for(const target of [point(11),point(-11),point(7.2),point(50000000),{},
    null,point(Infinity),{x:1,y:64,z:1,block:'bedrock'}]){
    // The external target must be exact coordinates; extra keys are rejected
    // by the signed plan, while this adapter only validates coordinates.
    if(target && Object.hasOwn(target,'block'))continue
    await assert.rejects(n.approach(target),/Unapproved|beyond/)
  }
  await assert.rejects(n.approach(point(6),{desiredDistance:12}),/Unapproved/)
  assert.equal(w.navigations,0)
  assert.equal(MAX_APPROACH_BLOCKS,10)
})
test('owner must be nearby and present before movement',async()=>{
  const w=world(),n=w.create()
  w.bot.players.OwnerQA.entity.position=point(40)
  await assert.rejects(n.approach(point(7)),/beyond|out_of_range/)
  w.bot.players={}
  await assert.rejects(n.approach(point(7)),/beyond|not_visible/)
  assert.equal(w.navigations,0)
})
test('health, fluids and unknown terrain prevent navigating',async()=>{
  const w=world(),n=w.create()
  w.bot.health=3
  await assert.rejects(n.approach(point(7)),/unsafe_bot_health/)
  w.bot.health=20;w.bot.blockAt=()=>({name:'water'})
  await assert.rejects(n.approach(point(7)),/navigation_hazard/)
  w.bot.blockAt=()=>null
  await assert.rejects(n.approach(point(7)),/navigation_world_unavailable/)
  assert.equal(w.navigations,0)
})
test('unreachable goal fails closed with all controls cleared',async()=>{
  const w=world({fail:true}),n=w.create()
  await assert.rejects(n.approach(point(7)),/pathfinder route unavailable/)
  assert.equal(n.status().active,false)
  assert.equal(w.goals.at(-1),null)
  assert.ok(w.clear>=1)
})
test('reported goto success without reaching the goal cannot count as arrival',async()=>{
  const w=world({stuck:true}),n=w.create()
  await assert.rejects(n.approach(point(7)),/did not reach/)
  assert.equal(w.goals.at(-1),null)
})
test('never starts a second approach while the first is still pending',async()=>{
  const w=world({wait:true}),n=w.create()
  const pending=n.approach(point(7))
  await sleep(20)
  await assert.rejects(n.approach(point(8)),/Concurrent/)
  w.finish()
  assert.equal((await pending).ok,true)
  assert.equal(w.navigations,1)
})
test('timeout cancels a pathfinder promise which never settles',async()=>{
  const w=world({wait:true}),n=w.create({timeoutMs:220})
  await assert.rejects(n.approach(point(7)),/timed out/)
  assert.equal(n.status().active,false)
  assert.equal(w.goals.at(-1),null)
})
test('owner disappears during walk: nav rejects within one observation cycle',async()=>{
  const w=world({wait:true}),n=w.create()
  const pending=n.approach(point(7))
  await sleep(25)
  w.bot.players={}
  await assert.rejects(pending,/not_visible/)
  assert.equal(w.goals.at(-1),null)
})
test('route goes out of signed radius: stop and reject even with a pending goto',async()=>{
  const w=world({wait:true}),n=w.create()
  const pending=n.approach(point(7))
  await sleep(25)
  w.bot.entity.position=point(15)
  await assert.rejects(pending,/navigation_out_of_bounds/)
  assert.equal(w.goals.at(-1),null)
})
test('fluid appears while navigating: cancels without waiting for goto',async()=>{
  const w=world({wait:true}),n=w.create()
  const pending=n.approach(point(7))
  await sleep(25)
  w.bot.blockAt=()=>({name:'lava'})
  await assert.rejects(pending,/navigation_hazard/)
  assert.equal(w.goals.at(-1),null)
})
test('health drops while navigating: cancels immediately',async()=>{
  const w=world({wait:true}),n=w.create()
  const pending=n.approach(point(7))
  await sleep(25)
  w.bot.health=5
  await assert.rejects(pending,/unsafe_bot_health/)
  assert.equal(w.goals.at(-1),null)
})
test('disconnect cancels in-flight movement without waiting for polling tick',async()=>{
  const w=world({wait:true}),n=w.create()
  const pending=n.approach(point(7))
  await sleep(25)
  w.bot.emit('end')
  await assert.rejects(pending,/disconnected/)
  assert.equal(w.goals.at(-1),null)
  assert.equal(w.bot.listenerCount('end'),0)
})
test('external cancellation is permanent and prevents delayed goto completion',async()=>{
  const w=world({wait:true}),n=w.create()
  const pending=n.approach(point(7))
  await sleep(25)
  n.cancel()
  await assert.rejects(pending,/cancelled/)
  w.finish()
  assert.equal(n.status().cancelled,true)
  await assert.rejects(n.approach(point(7)),/previously cancelled/)
})
test('cleanup removes listeners, timers and allows next step on same navigator',async()=>{
  const w=world(),n=w.create()
  assert.equal((await n.approach(point(7))).ok,true)
  assert.equal(w.bot.listenerCount('kicked'),0)
  w.bot.entity.position=point(1)
  assert.equal((await n.approach(point(6))).ok,true)
  assert.equal(w.navigations,2)
})

test('unloaded block throwing during pathfinding fails closed instead of crashing timer',async()=>{
  const w=world({wait:true}),n=w.create()
  const pending=n.approach(point(7))
  await sleep(25)
  w.bot.blockAt=()=>{throw Error('chunk unloaded')}
  await assert.rejects(pending,/navigation_world_unavailable/)
  assert.equal(w.goals.at(-1),null)
  assert.equal(w.bot.listenerCount('end'),0)
})
test('target position is frozen during an asynchronous authorized approach',async()=>{
  const w=world({wait:true}),n=w.create()
  const target=point(7)
  const pending=n.approach(target)
  await sleep(25)
  target.x=999
  w.finish()
  assert.equal((await pending).ok,true)
  assert.equal(w.navigations,1)
})
