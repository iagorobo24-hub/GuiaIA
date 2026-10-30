'use strict'

// Trusted local laboratory runtime. Binds the existing signed action controller
// to the two write-ahead QA journals. This module does not issue credentials,
// take Minecraft chat/LLM commands, or connect to production servers.
const { createSecureCompanionController } = require('./secure_companion_controller')
const { createQaDeliveryPipeline } = require('./qa_delivery_pipeline')
const {
  verifySessionBundle, verifySessionGatherGrant, verifySessionDepositGrant
} = require('./session_identity')

const samePosition = (a, b) => Boolean(a && b) &&
  ['x', 'y', 'z'].every(k => Number.isInteger(a[k]) && a[k] === b[k])

function createSecureDeliveryRuntime({
  bot, authority, classes, session, grants, missionJournal, depositJournal,
  approvedPlan
} = {}) {
  if (!Array.isArray(grants?.gather) || !Array.isArray(grants?.deposit) ||
      typeof missionJournal?.view !== 'function' ||
      typeof depositJournal?.view !== 'function') {
    throw Error('Signed step grants and durable journal handles required')
  }
  // Snapshot caller-provided data before any awaits. A future interface
  // cannot replace a verified coordinate or capability while queued.
  const fixedSession = structuredClone(session)
  const fixedGrants = {
    gather: grants.gather.map(token => structuredClone(token)),
    deposit: grants.deposit.map(token => structuredClone(token))
  }
  const principal = verifySessionBundle(fixedSession, authority)
  const mission = missionJournal.view()
  const deposit = depositJournal.view()
  if (fixedGrants.gather.length !== mission.targets?.length ||
      fixedGrants.deposit.length !== deposit.items?.length ||
      mission.ownerName !== principal.username ||
      deposit.ownerName !== principal.username) {
    throw Error('Signed steps do not match the durable mission')
  }
  const usedNonces = new Set()
  function permit(kind, index) {
    const token = fixedGrants[kind]?.[index]
    if (!token) throw Error('Missing signed step permit')
    return token
  }
  // Validate the exact signed plans BEFORE building any executable adapter.
  for (let i = 0; i < fixedGrants.gather.length; i++) {
    const p = verifySessionGatherGrant(permit('gather', i), principal, authority)
    const step = mission.targets[i]
    if (!samePosition(p.target, step) || p.item !== (step.block || 'oak_log') ||
        usedNonces.has(p.nonce)) throw Error('Gather permit does not match mission step')
    usedNonces.add(p.nonce)
  }
  for (let i = 0; i < fixedGrants.deposit.length; i++) {
    const p = verifySessionDepositGrant(permit('deposit', i), principal, authority)
    const step = deposit.items[i]
    if (!samePosition(p.chest, deposit.chest) || p.item !== step.name ||
        p.count !== step.count || usedNonces.has(p.nonce)) {
      throw Error('Deposit permit does not match durable step')
    }
    usedNonces.add(p.nonce)
  }

  const controller = createSecureCompanionController({bot, authority, classes})
  const pipeline = createQaDeliveryPipeline({
    missionJournal, depositJournal, approvedPlan,
    authorizeDispatch: async summary => {
      const {kind, index, target, item, count} = summary
      if ((kind !== 'gather' && kind !== 'deposit') ||
          !Number.isInteger(index)) return false
      const token = permit(kind, index)
      const p = token.payload
      if (p.item !== item || p.count !== count ||
          !samePosition(kind === 'gather' ? p.target : p.chest, target)) return false
      await controller.authorizeAction(fixedSession, token, kind)
      return true
    },
    createGatherAction: (step, summary) => Object.freeze({
      sandboxOnly: true,
      ownerName: principal.username,
      target: Object.freeze({x: step.x, y: step.y, z: step.z}),
      block: step.block || 'oak_log',
      gatherOne: () => controller.gather(
        fixedSession, permit('gather', summary.index),
        {x: step.x, y: step.y, z: step.z}, step.block || 'oak_log'
      ),
      cancel: () => controller.emergencyStop('mission_cancelled')
    }),
    createDepositAction: (step, summary) => Object.freeze({
      sandboxOnly: true,
      ownerName: principal.username,
      chest: Object.freeze({...step.chest}),
      item: step.name,
      count: step.count,
      depositOne: () => controller.deposit(
        fixedSession, permit('deposit', summary.index), {...step.chest}
      ),
      cancel: () => controller.emergencyStop('mission_cancelled')
    })
  })
  return Object.freeze({
    status: () => Object.freeze({
      ...pipeline.status(), companion: controller.status(),
      inventory: controller.checkInventory()
    }),
    runNext: () => pipeline.runNext(),
    runAll: () => pipeline.runAll(),
    stop: () => {
      controller.emergencyStop('operator_stop')
      return pipeline.stop()
    }
  })
}
module.exports = {createSecureDeliveryRuntime}
