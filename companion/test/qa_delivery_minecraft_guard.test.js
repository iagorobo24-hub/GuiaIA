'use strict'
// Portable tests: the actual signed Minecraft wiring requires a live Fabric
// QA world and real per-resource signed chest grants, so no fake gateway is
// substituted in the normal repository test suite.
const test=require('node:test')
const assert=require('node:assert/strict')
const {createQaSignedMinecraftDelivery}=require('../src/qa_delivery_minecraft')

test('Minecraft QA delivery API rejects missing trusted inputs',()=>{
  assert.throws(()=>createQaSignedMinecraftDelivery(),/Only bounded/)
  assert.throws(()=>createQaSignedMinecraftDelivery({bot:{username:'GuiaIA_QA'},
    authority:{sandboxOnly:true,identityMode:'unverified_offline_lab',
      botName:'GuiaIA_QA'},depositGrants:{oak_log:{}}}),/Only bounded/)
})

test('Minecraft QA delivery API rejects unknown items and unsafe timeouts',()=>{
  const config={bot:{username:'GuiaIA_QA'},authority:{sandboxOnly:true,
    identityMode:'trusted_server_bridge_lab',botName:'GuiaIA_QA'},
    depositGrants:{oak_log:{}}}
  assert.throws(()=>createQaSignedMinecraftDelivery({...config,
    depositGrants:{stone:{}}}),/Only bounded/)
  assert.throws(()=>createQaSignedMinecraftDelivery({...config,
    pickupTimeoutMs:100000}),/Only bounded/)
})

test('Minecraft QA delivery API rejects wrong bot identity before factory use',()=>{
  assert.throws(()=>createQaSignedMinecraftDelivery({bot:{username:'WrongQA'},
    authority:{sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
      botName:'GuiaIA_QA'},depositGrants:{oak_log:{}}}),/Only bounded/)
})
