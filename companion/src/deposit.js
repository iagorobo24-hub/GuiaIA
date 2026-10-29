'use strict'

// Exact, operator-authorized chest deposit for the disposable loopback QA.
// This module has NO chat/MCP/LLM entrypoint and is not a production system.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { finiteDistance, OWNER_MAX_DISTANCE } = require('./controller')
const { inventoryCount, RESOURCE_ITEMS } = require('./gather')

const MAX_JOURNAL_BYTES = 8192
const STATES = new Set(['ready', 'transferring', 'paused', 'needs_review', 'completed', 'cancelled'])
const allowed = (name) => typeof name === 'string' && Object.hasOwn(RESOURCE_ITEMS, name)
const positionValid = p => p && ['x','y','z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 30000000)
const samePosition = (a,b) => a && b && ['x','y','z'].every(k => a[k] === b[k])

function validatePlan(plan) {
  if (!plan || plan.sandboxOnly !== true ||
      !/^[A-Za-z0-9_]{3,16}$/.test(plan.ownerName || '') ||
      !positionValid(plan.chest) || !Array.isArray(plan.items) ||
      plan.items.length < 1 || plan.items.length > 2) {
    throw Error('Invalid bounded QA chest plan')
  }
  const names = new Set()
  for (const step of plan.items) {
    if (!step || !allowed(step.name) || !Number.isInteger(step.count) ||
        step.count < 1 || step.count > 2 || names.has(step.name)) {
      throw Error('Unauthorized QA item or count')
    }
    names.add(step.name)
  }
}
function validateJournal(state) {
  validatePlan(state)
  if (state.version !== 1 || !/^[0-9a-f-]{36}$/.test(state.planId || '') ||
      !STATES.has(state.phase) ||
      !Number.isInteger(state.index) || state.index < 0 ||
      state.index > state.items.length || !Array.isArray(state.receipts) ||
      state.receipts.length !== state.index) throw Error('Invalid deposit journal state')
  if (state.receipts.some((receipt,i) => {
    const expected=state.items[i]
    return !receipt || receipt.step !== i || receipt.name !== expected.name ||
      receipt.count !== expected.count ||
      !/^[0-9a-f-]{36}$/.test(receipt.operationId || '') ||
      !Number.isInteger(receipt.playerBefore) ||
      receipt.playerAfter !== receipt.playerBefore - expected.count ||
      !Number.isInteger(receipt.chestBefore) ||
      receipt.chestAfter !== receipt.chestBefore + expected.count
  })) throw Error('Invalid durable deposit receipt')
  if (state.phase === 'completed' && state.index !== state.items.length) {
    throw Error('Unverified deposit completion')
  }
  if (state.phase === 'transferring' &&
      !/^[0-9a-f-]{36}$/.test(state.operationId || '')) {
    throw Error('Missing pending transfer operation')
  }
}

function chestCount(window, itemName) {
  if (!window || !Number.isInteger(window.inventoryStart) ||
      window.inventoryStart <= 0 || window.inventoryStart > 54 ||
      !Array.isArray(window.slots) || window.slots.length < window.inventoryStart) return null
  return window.slots.slice(0,window.inventoryStart).reduce(
    (sum,slot) => sum+(slot?.name===itemName && Number.isInteger(slot.count) && slot.count>0?slot.count:0),0)
}
function chestPlayerCount(window,itemName) {
  if (!window || !Number.isInteger(window.inventoryStart) ||
      !Number.isInteger(window.inventoryEnd) ||
      window.inventoryEnd < window.inventoryStart ||
      !Array.isArray(window.slots) || window.slots.length < window.inventoryEnd) return null
  return window.slots.slice(window.inventoryStart,window.inventoryEnd).reduce(
    (sum,slot) => sum+(slot?.name===itemName && Number.isInteger(slot.count) && slot.count>0?slot.count:0),0)
}
function createQaChestDeposit(bot, plan) {
  validatePlan({...plan,items:[{name:plan.item,count:plan.count}]})
  const {ownerName,chest:position,item,count}=plan
  if (typeof bot.blockAt !== 'function' || typeof bot.openContainer !== 'function' ||
      !bot.inventory || typeof bot.inventory.items !== 'function') {
    throw Error('QA chest observations unavailable')
  }
  let active=false, cancelled=false, window=null
  const cancel=()=>{cancelled=true;try{window?.close()}catch{}}
  for(const event of ['end','kicked','death']) bot.on(event,cancel)
  const safe=()=>{
    const owner=bot.players?.[ownerName]?.entity
    if (!owner || !bot.entity?.position) return 'owner_not_visible'
    if (!Number.isFinite(bot.health) || bot.health<12) return 'low_health'
    if (finiteDistance(bot.entity.position,owner.position)>OWNER_MAX_DISTANCE) return 'owner_out_of_range'
    if (finiteDistance(bot.entity.position,position)>4.2) return 'chest_out_of_reach'
    return null
  }
  async function depositOne() {
    if (active) return {ok:false,reason:'deposit_busy',transferAttempted:false}
    active=true;cancelled=false
    let transferAttempted=false
    const response=(ok,reason,data={})=>({
      ok,reason,name:item,count,transferAttempted,
      chest:{...position},production:false,...data
    })
    try {
      const reason=safe()
      if(reason) return response(false,reason)
      const block=bot.blockAt(position)
      if(!block || block.name!=='chest') return response(false,'chest_not_authorized')
      const inventoryBefore=inventoryCount(bot,item)
      if(inventoryBefore===null || inventoryBefore<count) return response(false,'insufficient_inventory')
      const registryItem=bot.registry?.itemsByName?.[item]
      if(!registryItem || !Number.isInteger(registryItem.id)) return response(false,'unknown_registry_item')
      try { window=await bot.openContainer(block) }
      catch { return response(false,'chest_open_failed') }
      if(cancelled || safe()) return response(false,'unsafe_after_chest_open')
      const chestBefore=chestCount(window,item)
      const playerWindowBefore=chestPlayerCount(window,item)
      if(chestBefore===null || playerWindowBefore===null ||
          playerWindowBefore!==inventoryBefore) {
        return response(false,'unverified_pre_transfer',{
          inventoryBefore,playerWindowBefore,chestBefore,
          windowSlots:window.slots?.length, inventoryStart:window.inventoryStart,
          inventoryEnd:window.inventoryEnd
        })
      }
      transferAttempted=true
      try { await window.deposit(registryItem.id,null,count) }
      catch (error) { return response(false,'transfer_failed',{
        transferError:String(error?.message||'unknown').slice(0,145)
      }) }
      const deadline=Date.now()+5500
      while(!cancelled && !safe() && Date.now()<deadline){
        const chestAfter=chestCount(window,item)
        const playerAfter=chestPlayerCount(window,item)
        if(chestAfter===chestBefore+count && playerAfter===inventoryBefore-count){
          return response(true,'both_inventory_deltas_verified',{
            playerBefore:inventoryBefore,playerAfter,
            chestBefore,chestAfter
          })
        }
        await new Promise(resolve=>setTimeout(resolve,150))
      }
      return response(false,cancelled?'cancelled':'unverified_inventory_transfer',{
        observedPlayer:chestPlayerCount(window,item),
        observedChest:chestCount(window,item),
        inventoryBefore,chestBefore
      })
    } finally {
      try{window?.close()}catch{}
      window=null;active=false
    }
  }
  return {depositOne,cancel,item,count,chest:{...position},ownerName,sandboxOnly:true}
}

function openDepositJournal(directory,plan=null) {
  if(typeof directory!=='string' || !path.isAbsolute(directory)) {
    throw Error('Absolute operator-owned QA deposit directory required')
  }
  if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink()) {
    throw Error('Deposit directory symlink denied')
  }
  fs.mkdirSync(directory,{recursive:true,mode:0o700})
  if(!fs.statSync(directory).isDirectory())throw Error('Invalid deposit directory')
  fs.chmodSync(directory,0o700)
  const file=path.join(directory,'deposit.json')
  const lock=path.join(directory,'deposit.lock')
  if(fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())throw Error('Deposit file symlink denied')
  const lockFd=fs.openSync(lock,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600)
  let state,busy=false,closed=false,activeAction=null
  const save=()=>{
    validateJournal(state)
    const bytes=Buffer.from(JSON.stringify(state)+'\n')
    if(bytes.length>MAX_JOURNAL_BYTES)throw Error('Deposit journal too large')
    const tmp=path.join(directory,'.deposit-'+randomUUID()+'.tmp')
    let fd=null
    try{
      fd=fs.openSync(tmp,'wx',0o600)
      fs.writeSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null
      fs.renameSync(tmp,file)
      const d=fs.openSync(directory,fs.constants.O_RDONLY)
      try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
    }finally{
      if(fd!==null)fs.closeSync(fd)
      if(fs.existsSync(tmp))fs.unlinkSync(tmp)
    }
  }
  const view=()=>JSON.parse(JSON.stringify(state))
  const ensureOpen=()=>{if(closed)throw Error('Deposit journal closed')}
  try{
    if(fs.existsSync(file)){
      if(plan!==null)throw Error('Cannot replace a persisted deposit plan')
      const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
      try{
        const metadata=fs.fstatSync(fd)
        if(!metadata.isFile() || metadata.size>MAX_JOURNAL_BYTES)throw Error('Unsafe deposit journal')
        const buf=Buffer.alloc(MAX_JOURNAL_BYTES+1)
        const n=fs.readSync(fd,buf,0,buf.length,0)
        if(n>MAX_JOURNAL_BYTES)throw Error('Oversized deposit journal')
        state=JSON.parse(buf.subarray(0,n).toString('utf8'))
        validateJournal(state)
      }finally{fs.closeSync(fd)}
      if(state.phase==='transferring'){
        state.phase='needs_review'
        state.reason='unknown_outcome_after_restart'
        save()
      }
    }else{
      validatePlan(plan)
      state={version:1,sandboxOnly:true,planId:randomUUID(),
        ownerName:plan.ownerName,chest:{...plan.chest},
        items:plan.items.map(i=>({name:i.name,count:i.count})),
        index:0,phase:'ready',operationId:null,receipts:[],reason:'created'}
      save()
    }
  }catch(err){
    fs.closeSync(lockFd);fs.unlinkSync(lock);throw err
  }
  return {
    view,
    async runNext(action){
      ensureOpen()
      if(busy||state.phase!=='ready')return {ok:false,reason:busy?'busy':'not_ready',state:view()}
      const expected=state.items[state.index]
      if(!expected || !action || action.sandboxOnly!==true ||
          action.ownerName!==state.ownerName ||
          action.item!==expected.name || action.count!==expected.count ||
          !samePosition(action.chest,state.chest) ||
          typeof action.depositOne!=='function') {
        throw Error('Deposit adapter does not match authorized step')
      }
      busy=true;activeAction=action
      state.phase='transferring';state.operationId=randomUUID()
      state.reason='write_ahead_transfer_unverified'
      try{
        save() // fsync before opening/altering container
        let proof
        try{proof=await action.depositOne()}
        catch{proof={ok:false,transferAttempted:true,reason:'unknown_transfer_exception'}}
        if(state.phase!=='transferring')return {ok:false,reason:'interrupted',state:view()}
        if(proof?.ok===true && proof.reason==='both_inventory_deltas_verified' &&
            proof.name===expected.name && proof.count===expected.count &&
            proof.transferAttempted===true &&
            samePosition(proof.chest,state.chest) &&
            Number.isInteger(proof.playerBefore) &&
            Number.isInteger(proof.chestBefore) &&
            proof.playerAfter===proof.playerBefore-expected.count &&
            proof.chestAfter===proof.chestBefore+expected.count){
          state.receipts.push({step:state.index,operationId:state.operationId,
            name:expected.name,count:expected.count,
            playerBefore:proof.playerBefore,playerAfter:proof.playerAfter,
            chestBefore:proof.chestBefore,chestAfter:proof.chestAfter})
          state.index++
          state.phase=state.index===state.items.length?'completed':'ready'
          state.reason='two_sided_inventory_receipt'
          state.operationId=null
          save()
          return {ok:true,state:view()}
        }
        state.phase=proof?.transferAttempted===false?'paused':'needs_review'
        state.reason='no_confirmed_two_sided_receipt'
        save()
        return {ok:false,reason:state.reason,state:view()}
      }finally{busy=false;activeAction=null}
    },
    stop(){
      ensureOpen()
      if(state.phase==='transferring'){
        state.phase='needs_review';state.reason='cancelled_unknown_transfer'
        activeAction?.cancel?.();save()
      }else if(state.phase==='ready'||state.phase==='paused'){
        state.phase='cancelled';state.reason='operator_cancelled';save()
      }
      return view()
    },
    resume(){
      ensureOpen()
      if(busy||state.phase!=='paused')return {ok:false,reason:'manual_review_required',state:view()}
      state.phase='ready';state.reason='explicit_resume_before_transfer'
      save();return {ok:true,state:view()}
    },
    close(){
      if(closed)return
      if(busy)throw Error('Cannot release deposit lock during transfer')
      closed=true;fs.closeSync(lockFd);fs.unlinkSync(lock)
    }
  }
}
module.exports={createQaChestDeposit,openDepositJournal,validatePlan,validateJournal,chestCount,chestPlayerCount}
