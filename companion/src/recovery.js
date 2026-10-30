'use strict'

// Read-only forensic reconciliation of a QA chest journal against a freshly
// observed Minecraft player+chest snapshot. NEVER executes a transfer.
// A completed journal is NOT alone evidence of persisted world state.
const fs = require('node:fs')
const path = require('node:path')
const {validateJournal} = require('./deposit')
const MAX_BYTES = 8192
const NAMES = Object.freeze(['oak_log','birch_log'])
function samePosition(a,b) {
  return a && b && ['x','y','z'].every(k=>a[k]===b[k])
}
function readDepositJournalPassive(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw Error('Passive QA audit requires explicit absolute directory')
  }
  const root=fs.lstatSync(directory)
  if(!root.isDirectory() || root.isSymbolicLink())throw Error('Unsafe QA directory')
  const file=path.join(directory,'deposit.json')
  if(fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())throw Error('Unsafe symlink QA journal')
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
  try {
    const stat=fs.fstatSync(fd)
    if(!stat.isFile() || stat.size<1 || stat.size>MAX_BYTES)throw Error('Unsafe QA journal size/type')
    const data=Buffer.alloc(MAX_BYTES+1)
    const bytes=fs.readSync(fd,data,0,data.length,0)
    if(bytes<1 || bytes>MAX_BYTES)throw Error('Unsafe QA journal read')
    const state=JSON.parse(data.subarray(0,bytes).toString('utf8'))
    validateJournal(state)
    return state
  }finally {fs.closeSync(fd)}
}
function reconcileDepositSnapshot(state,observation) {
  validateJournal(state)
  const incomplete={ok:false,canAutoReplay:false}
  if(!observation || observation.source!=='live_minecraft_after_restart' ||
      observation.ownerName!==state.ownerName ||
      !samePosition(observation.chest,state.chest) ||
      observation.chestBlock!=='chest' ||
      !observation.player || !observation.container) {
    return {...incomplete,status:'untrusted_or_incomplete_observation'}
  }
  // JavaScript objects are accepted only when every approved type has an
  // explicit safe count. No missing=>zero or string-to-number coercion.
  for(const name of NAMES) {
    if(!Number.isSafeInteger(observation.player[name])||observation.player[name]<0 ||
       !Number.isSafeInteger(observation.container[name])||observation.container[name]<0) {
      return {...incomplete,status:'untrusted_or_incomplete_observation'}
    }
  }
  const discrepancies=[]
  for(const receipt of state.receipts) {
    const name=receipt.name
    if(observation.player[name]!==receipt.playerAfter ||
       observation.container[name]!==receipt.chestAfter){
      discrepancies.push(name)
    }
  }
  if(discrepancies.length) {
    return {...incomplete,status:'inventory_mismatch',discrepancies}
  }
  // Any unknown/in-flight operation stays blocked even if world counts happen
  // to match. Observational equivalence does not prove exactly-once execution.
  if(['transferring','needs_review','paused','cancelled'].includes(state.phase)) {
    return {...incomplete,status:'manual_review_required',journalPhase:state.phase}
  }
  if(state.phase==='completed' && state.receipts.length===state.items.length &&
     state.items.length>0){
    return {ok:true,canAutoReplay:false,status:'completed_inventory_verified',
      receiptCount:state.receipts.length,player:{...observation.player},
      container:{...observation.container}}
  }
  // A ready partial journal is not authorization to replay after restart;
  // additional independent operator review is required.
  return {...incomplete,status:'unfinished_requires_operator',journalPhase:state.phase}
}
module.exports={readDepositJournalPassive,reconcileDepositSnapshot}
