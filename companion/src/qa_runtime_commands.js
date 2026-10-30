'use strict'

// The runnable QA CLI is an observation / emergency-stop entrypoint.
// A plain stdin line cannot prove possession of a principal signing key,
// connection to a real Fabric session, or independent revocation evidence.
function executeQaRuntimeCommand(command, controller, bot) {
  if (command === 'follow') {
    return Object.freeze({ok:false,reason:'signed_session_authorization_required'})
  }
  if (command === 'quit') {
    controller?.stop('operator_quit')
    bot?.quit()
    return Object.freeze({ok:true,reason:'operator_quit'})
  }
  if (!controller) return Object.freeze({ok:false,reason:'not_spawned'})
  if (command === 'stop') return controller.stop('operator_stop')
  if (command === 'status') return controller.status()
  return Object.freeze({ok:false,reason:'unknown_local_command'})
}

module.exports={executeQaRuntimeCommand}
