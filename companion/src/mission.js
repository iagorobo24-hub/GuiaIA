'use strict'

// Durable mission journal for the *disposable, local* Minecraft QA runner.
// Not a production persistence system or a generic executable mission API.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { RESOURCE_ITEMS } = require('./gather')
const MAX_BYTES = 16384
const STATES = new Set(['ready', 'dispatching', 'needs_review', 'paused', 'completed', 'cancelled'])

function validateSpec(spec) {
  if (!spec || spec.sandboxOnly !== true ||
      !/^[a-zA-Z0-9_]{3,16}$/.test(spec.ownerName || '') ||
      !Array.isArray(spec.targets) || spec.targets.length < 1 || spec.targets.length > 3) {
    throw new Error('Only a bounded owner-authorized QA mission is permitted')
  }
  const seen = new Set()
  for (const p of spec.targets) {
    if (!p || !['x','y','z'].every(k => Number.isInteger(p[k]) && Math.abs(p[k]) <= 30000000) ||
        (p.block !== undefined && !Object.hasOwn(RESOURCE_ITEMS, p.block))) {
      throw new Error('Unsafe mission coordinates')
    }
    const key = [p.x,p.y,p.z].join(':')
    if (seen.has(key)) throw new Error('Duplicate blocks could be replayed')
    seen.add(key)
  }
}

function validateState(state) {
  if (!state || state.version !== 1 || state.sandboxOnly !== true ||
      typeof state.missionId !== 'string' || !/^[0-9a-f-]{36}$/.test(state.missionId) ||
      !STATES.has(state.phase) || !Array.isArray(state.receipts) ||
      !Number.isInteger(state.index) || state.index < 0) throw new Error('Corrupted QA mission journal')
  validateSpec(state)
  if (state.index > state.targets.length || state.receipts.length !== state.index ||
      state.receipts.some((r,i) => !r || r.step !== i ||
        r.item !== RESOURCE_ITEMS[state.targets[i].block || 'oak_log'] ||
        !Number.isInteger(r.inventoryDelta) || r.inventoryDelta < 1 ||
        typeof r.operationId !== 'string')) throw new Error('Inconsistent QA mission receipts')
  if (state.phase === 'completed' && state.index !== state.targets.length) {
    throw new Error('Unverified mission completion')
  }
  if (state.phase === 'dispatching' && !state.operationId) throw new Error('Missing operation ID')
}

function openMission(directory, specification = null) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
    throw new Error('QA journal requires explicit absolute directory')
  }
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
    throw new Error('QA journal symlink directory denied')
  }
  fs.mkdirSync(directory, { recursive:true, mode:0o700 })
  if (!fs.statSync(directory).isDirectory()) throw new Error('Invalid journal directory')
  fs.chmodSync(directory, 0o700)
  const journal = path.join(directory, 'mission.json')
  const lock = path.join(directory, 'mission.lock')
  if (fs.existsSync(journal) && fs.lstatSync(journal).isSymbolicLink()) {
    throw new Error('QA journal symlink denied')
  }
  // Fail closed on concurrent processes or an unreviewed stale lock after
  // a crash; explicit operator inspection required before releasing it.
  const lockFd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600)
  let closed = false
  let busy = false
  let activeAction = null
  let state
  const save = () => {
    validateState(state)
    const encoded = Buffer.from(JSON.stringify(state) + '\n')
    if (encoded.length > MAX_BYTES) throw new Error('QA journal exceeds size budget')
    const tmp = path.join(directory, '.mission-' + randomUUID() + '.tmp')
    let fd
    try {
      fd = fs.openSync(tmp, 'wx', 0o600)
      fs.writeSync(fd, encoded)
      fs.fsyncSync(fd)
      fs.closeSync(fd)
      fd = null
      fs.renameSync(tmp, journal)
      if (process.platform !== 'win32') { const d = fs.openSync(directory, fs.constants.O_RDONLY)
      try { fs.fsyncSync(d) } finally { fs.closeSync(d) } }
    } finally {
      if (fd !== null && fd !== undefined) fs.closeSync(fd)
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    }
  }
  const view = () => JSON.parse(JSON.stringify(state))
  const ensureOpen = () => { if (closed) throw new Error('QA journal closed') }
  try {
    if (fs.existsSync(journal)) {
      const fd = fs.openSync(journal, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
      try {
        const stats = fs.fstatSync(fd)
        if (!stats.isFile() || stats.size > MAX_BYTES) throw new Error('Unsafe QA journal file')
        const bytes = Buffer.alloc(MAX_BYTES + 1)
        const n = fs.readSync(fd, bytes, 0, bytes.length, 0)
        if (n > MAX_BYTES) throw new Error('QA journal exceeds size budget')
        state = JSON.parse(bytes.subarray(0,n).toString('utf8'))
        validateState(state)
      } finally { fs.closeSync(fd) }
      if (specification !== null) throw new Error('Cannot replace existing QA mission')
      // Once any operation has been dispatched, an unexpected process stop
      // must NEVER cause automatic mining or replay of the unknown step.
      if (state.phase === 'dispatching') {
        state.phase = 'needs_review'
        state.reason = 'unverified_dispatch_after_restart'
        save()
      }
    } else {
      validateSpec(specification)
      state = {
        version:1, sandboxOnly:true, missionId:randomUUID(),
        ownerName: specification.ownerName,
        targets: specification.targets.map(p=>({x:p.x,y:p.y,z:p.z,
          ...(p.block === undefined ? {} : {block:p.block})})),
        index:0, receipts:[], phase:'ready', operationId:null, reason:'created'
      }
      save()
    }
  } catch (err) {
    fs.closeSync(lockFd)
    fs.unlinkSync(lock)
    throw err
  }
  return {
    view,
    async runNext(action) {
      ensureOpen()
      if (busy || state.phase !== 'ready') {
        return {ok:false, reason:busy ? 'mission_busy' : 'mission_not_ready', state:view()}
      }
      if (state.index >= state.targets.length) throw new Error('Invalid next step')
      const target = state.targets[state.index]
      if (!action || typeof action.gatherOne !== 'function' || action.sandboxOnly !== true ||
          action.ownerName !== state.ownerName || !action.target ||
          !['x','y','z'].every(k => action.target[k] === target[k]) ||
          (target.block !== undefined && action.block !== target.block)) {
        throw new Error('Action does not match authorized mission step')
      }
      busy = true
      activeAction = action
      const expected = state.index
      state.operationId = randomUUID()
      state.phase = 'dispatching'
      state.reason = 'awaiting_real_world_receipt'
      try {
        save() // durability barrier BEFORE any world mutation
        let result
        try { result = await action.gatherOne() }
        catch { result = {ok:false, dig_attempted:true, reason:'gather_exception'} }
        if (state.phase !== 'dispatching') {
          return {ok:false, reason:'operation_interrupted', state:view()}
        }
        const expectedBlock = target.block || 'oak_log'
        if (result.ok === true && result.reason === 'verified_inventory_drop' &&
            Number.isInteger(result.inventory_delta) && result.inventory_delta >= 1 &&
            result.dig_attempted === true &&
            (target.block === undefined ||
              (result.block === expectedBlock && result.item === RESOURCE_ITEMS[expectedBlock]))) {
          state.receipts.push({step:expected, operationId:state.operationId,
                               item:RESOURCE_ITEMS[expectedBlock], inventoryDelta:result.inventory_delta})
          state.index++
          state.phase = state.index === state.targets.length ? 'completed' : 'ready'
          state.reason = 'inventory_and_block_verified'
          state.operationId = null
          save()
          return {ok:true, state:view()}
        }
        state.phase = result.ok === false && result.dig_attempted === false ? 'paused' : 'needs_review'
        state.reason = 'unverified_step_no_replay'
        save()
        return {ok:false, reason:state.reason, state:view()}
      } finally {
        busy = false
        activeAction = null
      }
    },
    stop() {
      ensureOpen()
      if (state.phase === 'completed' || state.phase === 'cancelled') return view()
      if (state.phase === 'dispatching') {
        state.phase = 'needs_review'
        state.reason = 'cancelled_during_unknown_world_step'
        activeAction?.cancel?.()
      } else if (state.phase === 'ready' || state.phase === 'paused') {
        state.phase = 'cancelled'
        state.reason = 'operator_cancelled'
      }
      save()
      return view()
    },
    resume() {
      ensureOpen()
      // Paused is safe only if gatherOne never attempted a world mutation.
      // Unknown outcomes always require manual forensic review.
      if (busy || state.phase !== 'paused') return {ok:false, reason:'manual_review_required', state:view()}
      state.phase = 'ready'
      state.reason = 'operator_resumed_unattempted_step'
      save()
      return {ok:true, state:view()}
    },
    close() {
      if (closed) return
      if (busy) throw new Error('Cannot close journal while operation runs')
      closed = true
      fs.closeSync(lockFd)
      fs.unlinkSync(lock)
    },
  }
}
module.exports = {openMission, validateSpec, validateState}
