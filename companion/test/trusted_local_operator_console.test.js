'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const {PassThrough}=require('node:stream')
const {createTrustedLocalOperatorConsole,attachTrustedLocalOperatorStdin}=
  require('../src/trusted_local_operator_console')

test('an actual local TTY command yields structured state and EOF triggers emergency stop',async t=>{
  let stops=0
  const runtime={
    status:()=>({phase:'gather'}),
    inventory:()=>({ok:true,items:{}}),
    follow:async()=>({ok:false,reason:'no_grant'}),
    runNext:async()=>({ok:false,reason:'no_grant'}),
    runAll:async()=>({ok:false,reason:'no_grant'}),
    stop:()=>{stops++;return {ok:true,reason:'operator_stopped'}}
  }
  const input=new PassThrough()
  input.isTTY=true
  input.setRawMode=()=>{}
  const output=new PassThrough()
  output.isTTY=true
  const operator=createTrustedLocalOperatorConsole(runtime)
  const attached=attachTrustedLocalOperatorStdin(operator,{input,output})
  t.after(()=>attached.close())
  const response=new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>reject(Error('Local TTY emitted no response')),1000)
    output.on('data',chunk=>{
      const line=chunk.toString()
      if(line.includes('"source":"guiaia-local-operator"')){
        clearTimeout(deadline)
        resolve(line)
      }
    })
  })
  input.write('estado\n')
  const text=await response
  assert.match(text,/"command":"estado"/)
  assert.match(text,/"phase":"gather"/)
  assert.equal(stops,0)
  input.end()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(stops,1)
})
