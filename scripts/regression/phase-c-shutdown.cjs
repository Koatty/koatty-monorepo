const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const http = require('node:http');
const root=process.cwd();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if (process.argv.includes('--child')) {
  require('ts-node').register({transpileOnly:true,skipProject:true,compilerOptions:{module:'commonjs',target:'es2022',esModuleInterop:true,experimentalDecorators:true,emitDecoratorMetadata:true}});
  const {Koatty}=require('../../packages/koatty-core/src/Application.ts');
  const {HttpServer}=require('../../packages/koatty-serve/src/server/http.ts');
  const {TerminusManager}=require('../../packages/koatty-serve/src/utils/terminus-manager.ts');
  const {Trace}=require('../../packages/koatty-trace/src/trace/trace.ts');
  (async()=>{
    const app=new Koatty(); app.silent=true;
    app.use(Trace({timeout:2000,enableTrace:false},app));
    app.use(async ctx=>{process.send({event:'inflight'});await sleep(100);ctx.body='finished';});
    app.once('appStop',async()=>{await sleep(30);process.send({event:'cleanup'});});
    const server=new HttpServer(app,{protocol:'http',hostname:'127.0.0.1',port:0,shutdown:{preStopDelay:20,drainTimeout:500}});
    app.server=server;
    const manager=TerminusManager.getInstance(); manager.setPreStopDelay(20); manager.setDrainTimeout(500);
    await new Promise(resolve=>server.Start(resolve));
    process.send({event:'ready',port:server.getNativeServer().address().port});
  })().catch(error=>{console.error(error);process.exit(1)});
} else {
  (async()=>{
    const child=fork(__filename,['--child'],{cwd:root,stdio:['ignore','pipe','pipe','ipc']});
    let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
    const messages=[]; const waiters=[];
    child.on('message',message=>{messages.push(message);for(const waiter of waiters.splice(0))waiter();});
    const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    const watchdog=setTimeout(()=>child.kill('SIGKILL'),10000);
    const wait=async event=>{while(!messages.find(m=>m.event===event))await Promise.race([new Promise(r=>waiters.push(r)),exited.then(()=>{throw new Error('Child exited early: '+output)})]);return messages.find(m=>m.event===event)};
    try {
      const {port}=await wait('ready');
      const response=new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path:'/slow'},res=>{
        let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,body}));
      }).on('error',reject));
      await wait('inflight'); const started=Date.now();child.kill('SIGTERM');
      const result=await response;assert.equal(result.status,200);assert.equal(result.body,'finished');
      assert.deepEqual(await exited,{code:0,signal:null});assert(messages.some(m=>m.event==='cleanup'));
      assert(Date.now()-started<30000);console.log('OS_SIGTERM_SHUTDOWN_PASS');
    } finally {clearTimeout(watchdog);if(child.exitCode===null)child.kill('SIGKILL');}
  })().catch(error=>{console.error(error);process.exitCode=1});
}
