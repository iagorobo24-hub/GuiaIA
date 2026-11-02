'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {pinnedWitnessHost}=require('../qa_physical_witness_proxy')
test('QA proxy pins upstream HTTP Host to explicit witness loopback port',()=>{
  assert.equal(pinnedWitnessHost('44047'),'127.0.0.1:44047')
  assert.equal(pinnedWitnessHost('1024'),'127.0.0.1:1024')
  assert.equal(pinnedWitnessHost('65535'),'127.0.0.1:65535')
})
test('QA proxy refuses unset, malformed, remote and privileged witness ports',()=>{
  for(const invalid of [undefined,null,'','0','80','443','999','65536',
    '044047','44047x','-1','localhost:44047','durn.taild703f5.ts.net',
    '44047\nInjected: true',1234])
    assert.throws(()=>pinnedWitnessHost(invalid),/QA witness loopback port/)
})
