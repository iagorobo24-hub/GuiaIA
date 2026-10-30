'use strict'

// Strict, stand-alone operator entry point for a PRE-PROVISIONED disposable
// Fabric QA world. It never generates principal keys, signed grants or worlds.
// --qa-preflight proves the current owner session, without creating a bot.
// --qa-operate requires a live local TTY, existing approved journals and
// independently signed grants; every world action is mediated by the runtime.
const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const readline=require('node:readline')
const {openQaPrincipalRegistry}=require('./src/principal_enrollment')
const {createPinnedQaServerBridgeAuthority}=require('./src/fabric_bridge_reader')
const {createPinnedQaLivePresenceAuthority}=require('./src/live_presence')
const {createPinnedQaRemoteCheckpointClient}=require('./src/remote_checkpoint')
const {issueQaBoundPrincipalSession}=require('./src/qa_principal_session_binding')
const {createQaEnrolledOperatorRuntime}=require('./src/qa_operator_bootstrap')
const {openMission}=require('./src/mission')
const {openDepositJournal}=require('./src/deposit')

const ROOT=path.resolve(__dirname,'..')
const QA_ROOT=/^guiaia-operator-qa-[A-Za-z0-9_-]{6,}$/
const BASE=['version','sandboxOnly','worldId','botName','username',
  'principalId','connectionId','eventsFile','registryDirectory',
  'principalPrivateKeyFile','operatorPublicKeyFile','serverBridgePublicKeyFile',
  'witnessPublicKeyFile','witnessUrl','livePort']
const OPERATION=['missionDirectory','depositDirectory','spentDirectory',
  'approvedPlanFile','grantsFile']
const exact=(v,fields)=>v!==null&&typeof v==='object'&&
  Object.getPrototypeOf(v)===Object.prototype&&
  Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k))
function confidentialPath(file,{base=null}={}){
  if(typeof file!=='string'||!path.isAbsolute(file)||
     path.normalize(file)!==file)throw Error('Normalized absolute QA file required')
  const parent=path.dirname(file),relative=path.relative(ROOT,file)
  if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'))
    throw Error('QA credentials inside source repository denied')
  if(base!==null && path.dirname(file)!==base)
    throw Error('Untrusted QA configuration file location')
  if(fs.realpathSync(parent)!==parent)
    throw Error('Symlinked QA credential parent denied')
  const folder=fs.statSync(parent)
  if(!folder.isDirectory() || (process.platform!=='win32' &&
     (folder.mode&0o077)!==0))
    throw Error('QA credential parent must be private (0700)')
  const info=fs.lstatSync(file)
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||
    (process.platform!=='win32' && (info.mode&0o077)!==0))
    throw Error('QA credential must be private (0600)')
  return file
}
function readPrivate(file,limit=8192){
  const fd=fs.openSync(confidentialPath(file),
    fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0))
  try{
    const stat=fs.fstatSync(fd)
    if(!stat.isFile()||stat.nlink!==1||stat.size<=0||stat.size>limit||
       (process.platform!=='win32' && (stat.mode&0o077)!==0))
      throw Error('Unsafe QA credential metadata')
    const data=Buffer.alloc(stat.size)
    if(fs.readSync(fd,data,0,stat.size,0)!==stat.size)
      throw Error('Truncated private QA credential')
    return data
  }finally{fs.closeSync(fd)}
}
function readJson(file){
  try{return JSON.parse(readPrivate(file,16384).toString('utf8'))}
  catch(error){if(error instanceof SyntaxError)
    throw Error('Malformed QA JSON credential')
    throw error}
}
function directoryInRoot(folder,root,leaf){
  if(folder!==path.join(root,leaf)||fs.realpathSync(root)!==root)
    throw Error('QA journal directory outside isolated operator root')
  if(fs.existsSync(folder)&&fs.lstatSync(folder).isSymbolicLink())
    throw Error('Symlink QA journal denied')
  return folder
}
function validateConfig(file,mode){
  const qaRoot=path.dirname(file)
  if(path.dirname(qaRoot)!==os.tmpdir()||!QA_ROOT.test(path.basename(qaRoot)))
    throw Error('Only isolated /tmp/guiaia-operator-qa-* configuration allowed')
  confidentialPath(file,{base:qaRoot})
  const config=readJson(file),keys=mode==='--qa-operate'
    ?[...BASE,...OPERATION]:BASE
  if(!exact(config,keys)||config.version!==1||
     config.sandboxOnly!==true||
     config.worldId!=='qa:real-fabric:25593'||
     config.botName!=='GuiaIA_QA'||
     !/^[A-Za-z0-9_]{3,16}$/.test(config.username||'')||
     !/^[A-Za-z0-9:_-]{1,64}$/.test(config.principalId||'')||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(config.connectionId||'')||
     !Number.isInteger(config.livePort)||
     config.livePort<1024||config.livePort>65535)
    throw Error('Explicit, complete and loopback-only QA config required')
  if(typeof config.registryDirectory!=='string'||
     typeof config.eventsFile!=='string')
    throw Error('Absolute QA registry and signed Fabric event paths required')
  const registryRoot=path.dirname(config.registryDirectory)
  if(registryRoot!==path.join(os.tmpdir(),path.basename(registryRoot))||
     !/^guiaia-enrollment-qa-[A-Za-z0-9_-]{6,}$/.test(path.basename(registryRoot))||
     path.basename(config.registryDirectory)!=='registry')
    throw Error('Registry must reside in isolated enrollment QA root')
  const fabricRoot=path.relative(os.tmpdir(),config.eventsFile)
  if(!/^guiaia-fabric-bridge-qa-[A-Za-z0-9_-]{6,}[/\\]/.test(fabricRoot))
    throw Error('Signed Fabric events must be in disposable QA world')
  if(mode==='--qa-operate'){
    directoryInRoot(config.missionDirectory,qaRoot,'mission')
    directoryInRoot(config.depositDirectory,qaRoot,'deposit')
    directoryInRoot(config.spentDirectory,qaRoot,'spent')
    // Plan, permits and output files are explicitly provisioned by an
    // independent operator, never generated from player chat or this CLI.
    confidentialPath(config.approvedPlanFile,{base:qaRoot})
    confidentialPath(config.grantsFile,{base:qaRoot})
  }
  return config
}
async function run(mode,file){
  const conf=validateConfig(file,mode)
  if(mode==='--qa-operate'&&
     (process.stdin.isTTY!==true||process.stdout.isTTY!==true))
    throw Error('World operator requires a local interactive TTY')
  const operatorPublicKeyPem=readPrivate(conf.operatorPublicKeyFile).toString('utf8')
  const serverBridgePublicKeyPem=readPrivate(conf.serverBridgePublicKeyFile).toString('utf8')
  const witnessPublicKeyPem=readPrivate(conf.witnessPublicKeyFile).toString('utf8')
  const principalPrivateKey=readPrivate(conf.principalPrivateKeyFile)
  const bridge=createPinnedQaServerBridgeAuthority(
    conf.eventsFile,serverBridgePublicKeyPem,conf.worldId)
  const live=createPinnedQaLivePresenceAuthority({
    port:conf.livePort,worldId:conf.worldId,serverBridgePublicKeyPem})
  const witness=createPinnedQaRemoteCheckpointClient({
    url:conf.witnessUrl,worldId:conf.worldId,
    operatorPublicKeyPem,witnessPublicKeyPem})
  const registry=openQaPrincipalRegistry(conf.registryDirectory,{
    worldId:conf.worldId,sandboxOnly:true,operatorPublicKeyPem})
  let bot=null,mission=null,deposit=null,runtime=null,tty=null
  let closed=false
  const clean=()=>{
    if(closed)return
    closed=true
    try{runtime?.stop()}catch{}
    try{tty?.close()}catch{}
    try{bot?.end()}catch{}
    try{mission?.close()}catch{}
    try{deposit?.close()}catch{}
    registry.close()
  }
  try{
    const identity={
      sandboxOnly:true,identityMode:'trusted_server_bridge_lab',
      worldId:conf.worldId,botName:conf.botName,
      username:conf.username,principalId:conf.principalId,
      connectionId:conf.connectionId,principalPrivateKey,
      serverBridgePublicKeyPem,registry,bridge,live,witness
    }
    if(mode==='--qa-preflight'){
      const proof=await issueQaBoundPrincipalSession(identity)
      console.log(JSON.stringify({result:'qa_session_preflight_passed',
        ...proof.scope,worldActionsEnabled:false}))
      return
    }
    const grants=readJson(conf.grantsFile)
    const approvedPlan=readJson(conf.approvedPlanFile)
    if(!exact(grants,['gather','deposit','followGrant'])||
       !Array.isArray(grants.gather)||!Array.isArray(grants.deposit))
      throw Error('Independent signed world-action grants required')
    mission=openMission(conf.missionDirectory)
    deposit=openDepositJournal(conf.depositDirectory)
    // Prepare and check independent live identity BEFORE joining with bot.
    await issueQaBoundPrincipalSession(identity)
    const mineflayer=require('mineflayer')
    const {pathfinder,Movements,goals}=require('mineflayer-pathfinder')
    bot=mineflayer.createBot({
      host:'127.0.0.1',port:25593,username:conf.botName,
      auth:'offline',version:'1.21.1',hideErrors:true
    })
    bot.loadPlugin(pathfinder)
    await new Promise((resolve,reject)=>{
      let done=false
      const finish=error=>{if(done)return;done=true;clearTimeout(timeout)
        if(error)reject(error);else resolve()}
      const timeout=setTimeout(()=>finish(Error('QA Fabric bot spawn timed out')),12000)
      bot.once('spawn',()=>finish())
      bot.once('end',()=>finish(Error('QA Fabric bot disconnected before spawn')))
      bot.once('error',()=>finish(Error('QA Fabric bot unavailable')))
    })
    const sessionBound=await createQaEnrolledOperatorRuntime({
      bot,classes:{GoalNear:goals.GoalNear,
        GoalFollow:goals.GoalFollow,Movements},
      identity,operatorPublicKeyPem,ledgerDirectory:conf.spentDirectory,
      missionJournal:mission,depositJournal:deposit,approvedPlan,
      grants:{gather:grants.gather,deposit:grants.deposit},
      ...(grants.followGrant===null?{}:{followGrant:grants.followGrant})
    })
    runtime=sessionBound.runtime
    console.log(JSON.stringify({result:'qa_operator_ready',
      ...sessionBound.scope,
      requiresSignedGrants:true,operatorInput:'local_tty_only'}))
    await new Promise((resolve,reject)=>{
      tty=readline.createInterface({input:process.stdin,
        output:process.stdout,terminal:true})
      tty.on('line',line=>{
        const quit=['salir','quit'].includes(line.trim().toLowerCase())
        void sessionBound.operator.execute(line).then(result=>{
          console.log(JSON.stringify({result,command:'qa_operator_input'}))
          if(quit)tty.close()
        }).catch(()=>tty.close())
      })
      tty.once('close',resolve)
      bot.once('end',()=>{tty.close()})
      process.once('SIGINT',()=>{tty.close()})
      process.once('SIGTERM',()=>{tty.close()})
    })
  }finally{clean()}
}
async function main(){
  const [mode,file]=process.argv.slice(2)
  if(process.argv.length!==4||
     !['--qa-preflight','--qa-operate'].includes(mode))
    throw Error('Use --qa-preflight or --qa-operate with one external QA config')
  await run(mode,file)
}
if(require.main===module){
  main().catch(error=>{
    // Filesystem errors contain private paths. Never print raw source,
    // keys, signed grants, user input or filesystem identifiers.
    const message=String(error?.message||'qa_operator_denied')
    const reason=typeof error?.code==='string'?'qa_file_access_denied':
      /^[A-Za-z0-9 ,.:()_-]{1,120}$/.test(message)?message:'qa_operator_denied'
    console.error('GuiaIA QA startup denied: '+reason)
    process.exitCode=2
  })
}
module.exports={validateConfig,run}
