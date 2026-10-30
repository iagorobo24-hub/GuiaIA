'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const {executeQaRuntimeCommand}=require('../src/qa_runtime_commands')
function fixture(){
  const calls=[]
  const controller={
    follow(){calls.push('FOLLOW');return {ok:true}},
    stop(reason){calls.push(['stop',reason]);return {ok:true,mode:'idle'}},
    status(){calls.push('status');return {mode:'idle',reason:'safe'}}
  }
  const bot={quit(){calls.push('quit')}}
  return {calls,controller,bot}
}
test('untrusted local follow never invokes controller movement even when visible',()=>{
  const {calls,controller,bot}=fixture()
  const result=executeQaRuntimeCommand('follow',controller,bot)
  assert.deepEqual(result,{ok:false,reason:'signed_session_authorization_required'})
  assert.deepEqual(calls,[])
  assert.equal(Object.isFrozen(result),true)
})
test('only exact follow keyword is recognized for explicit denial',()=>{
  const {calls,controller,bot}=fixture()
  for(const cmd of [' follow','follow ','FOLLOW','follow\0','follow now',
    'follow\\n','follow;status','follow\r']){
    const result=executeQaRuntimeCommand(cmd,controller,bot)
    assert.equal(result.ok,false)
  }
  assert.deepEqual(calls,[])
})
test('status, emergency stop and quit remain available without signed identity',()=>{
  const {calls,controller,bot}=fixture()
  assert.equal(executeQaRuntimeCommand('status',controller,bot).mode,'idle')
  assert.equal(executeQaRuntimeCommand('stop',controller,bot).mode,'idle')
  assert.equal(executeQaRuntimeCommand('quit',controller,bot).ok,true)
  assert.deepEqual(calls,['status',['stop','operator_stop'],['stop','operator_quit'],'quit'])
})
test('stop and quit are safe before spawn, follow stays blocked even before spawn',()=>{
  const {calls,bot}=fixture()
  assert.equal(executeQaRuntimeCommand('follow',null,bot).reason,
    'signed_session_authorization_required')
  assert.equal(executeQaRuntimeCommand('status',null,bot).reason,'not_spawned')
  assert.equal(executeQaRuntimeCommand('stop',null,bot).reason,'not_spawned')
  assert.equal(executeQaRuntimeCommand('quit',null,bot).ok,true)
  assert.deepEqual(calls,['quit'])
})
test('runnable CLI cannot call unverified follow controller directly',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/cli.js'),'utf8')
  assert.match(source,/executeQaRuntimeCommand\(command,controller,bot\)/)
  assert.doesNotMatch(source,/\bcontroller\.follow\s*\(/)
  assert.doesNotMatch(source,/\bpathfinder\.setGoal\s*\(/)
  assert.doesNotMatch(source,/\bcreateQaChestDeposit\s*\(/)
})
