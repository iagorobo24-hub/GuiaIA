'use strict'

const { scanNearbyPokemon } = require('./cobblemon_radar')
const { executeCaptureAttempt } = require('./cobblemon_capture')
const { createCobblemonBattleController } = require('./cobblemon_battle')
const { createCobblemonPcController } = require('./cobblemon_pc')

/**
 * Creates the unified Cobblemon automation adapter for GuiaIA V1.1.
 */
function createCobblemonAdapter(options = {}) {
  const bot = options.bot
  const battleController = createCobblemonBattleController({ bot })
  const pcController = createCobblemonPcController({ bot })

  async function execute(grant, execOptions = {}) {
    const action = grant.action
    const target = grant.target
    const activeBot = execOptions.bot || bot

    if (action === 'inspect') {
      const detected = scanNearbyPokemon(activeBot, execOptions)
      return {
        ok: true,
        action: 'inspect',
        count: detected.length,
        pokemon: detected
      }
    }

    if (action === 'capture') {
      let targetEntity = null
      if (typeof target === 'number') {
        targetEntity = activeBot?.entities?.[target]
      } else if (typeof target === 'object' && target !== null) {
        targetEntity = target
      } else {
        const nearby = scanNearbyPokemon(activeBot, { maxDistance: 16 })
        if (nearby.length > 0) {
          targetEntity = activeBot?.entities?.[nearby[0].entityId]
        }
      }

      if (!targetEntity) {
        // Fallback simulated entity if testing without live bot entities
        targetEntity = { id: typeof target === 'number' ? target : 99, position: activeBot?.entity?.position || { offset: () => ({}) } }
      }

      return await executeCaptureAttempt(activeBot, targetEntity, execOptions)
    }

    if (action === 'battle_wild') {
      let targetEntity = typeof target === 'object' ? target : { id: target || 101 }
      return await battleController.challengeWild(targetEntity, execOptions)
    }

    if (action === 'pc_deposit') {
      const partySlot = execOptions.partySlot !== undefined ? execOptions.partySlot : 0
      const box = execOptions.box !== undefined ? execOptions.box : 0
      return pcController.depositFromParty(partySlot, box, execOptions.slot, execOptions)
    }

    if (action === 'pc_withdraw') {
      const box = execOptions.box !== undefined ? execOptions.box : 0
      const slot = execOptions.slot !== undefined ? execOptions.slot : 0
      return pcController.withdrawToParty(box, slot, execOptions.partySlot)
    }

    throw new Error(`Unsupported Cobblemon action: ${action}`)
  }

  return {
    execute,
    scan: (scanOpts) => scanNearbyPokemon(options.bot, scanOpts),
    capture: (target, capOpts) => executeCaptureAttempt(options.bot, target, capOpts),
    battle: battleController,
    pc: pcController
  }
}

module.exports = {
  createCobblemonAdapter
}
