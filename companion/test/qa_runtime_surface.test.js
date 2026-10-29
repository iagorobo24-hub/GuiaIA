'use strict'
const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const root=path.resolve(__dirname,'../src')
const permitted=new Set(['cli.js','controller.js','qa_runtime_commands.js'])
const forbidden=new Set([
  'deposit.js','gather.js','mission.js','recovery.js',
  'session_identity.js','operator_authorization.js',
  'principal_enrollment.js','principal_checkpoint.js',
  'fabric_bridge_reader.js','live_presence.js',
  'qa_checkpoint_witness.js','remote_checkpoint.js'
])
function reachable(entry){
  const visited=new Set(),queue=[entry]
  while(queue.length){
    const relative=queue.shift()
    if(visited.has(relative))continue
    visited.add(relative)
    const file=path.join(root,relative)
    const source=fs.readFileSync(file,'utf8')
    // Dynamic imports are not accepted by the runnable QA package.
    assert.doesNotMatch(source,/\bimport\s*\(/)
    const imports=[...source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)]
    const total=(source.match(/\brequire\s*\(/g)||[]).length
    assert.equal(imports.length,total,'Dynamic require requires review in '+relative)
    for(const [,,specifier] of imports){
      if(!specifier.startsWith('.'))continue
      const resolved=path.resolve(path.dirname(file),specifier+'.js')
      assert.equal(resolved.startsWith(root+path.sep),true)
      queue.push(path.relative(root,resolved))
    }
  }
  return visited
}
test('runnable CLI depends only on explicitly reviewed modules',()=>{
  const graph=reachable('cli.js')
  assert.deepEqual([...graph].sort(),[...permitted].sort())
  assert.deepEqual([...graph].filter(m=>forbidden.has(m)),[])
})
test('npm start points to guarded CLI, not a raw mining/deposit entrypoint',()=>{
  const pkg=require('../package.json')
  assert.equal(pkg.scripts.start,'node src/cli.js --qa-local-only')
  const cli=fs.readFileSync(path.join(root,'cli.js'),'utf8')
  assert.match(cli,/process\.argv\.length !== 3/)
  assert.match(cli,/GUIAIA_QA_OWNER/)
  assert.match(cli,/host: '127\.0\.0\.1', port: 25598/)
  assert.match(cli,/executeQaRuntimeCommand\(command,controller,bot\)/)
})
