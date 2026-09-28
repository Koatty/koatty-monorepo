// Real HTTP, alternating paired runs. Baseline is the repository HEAD handler.
// This isolates the handler change; it does not compare two complete releases.
const {execFileSync} = require('child_process');
const path = require('path');
const Module = require('module');
const http = require('http');
require('ts-node').register({transpileOnly:true,skipProject:true,compilerOptions:{module:'commonjs',target:'es2022',esModuleInterop:true,experimentalDecorators:true}});
const ts = require('typescript');
const Koa = require('koa');
const {DefaultLogger} = require('koatty_logger'); DefaultLogger.enable(false);
const root = path.resolve(__dirname,'../../..');
const filename = path.resolve(__dirname,'../src/utils/handler.ts');
const baseline = execFileSync('git',['show','HEAD:packages/koatty-router/src/utils/handler.ts'],{cwd:root,encoding:'utf8'});
const old = new Module(filename,module); old.filename=filename; old.paths=Module._nodeModulePaths(path.dirname(filename));
old._compile(ts.transpileModule(baseline,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const {createRouteHandler} = require(filename);
const app = new Koa(); let invoke; class Controller { index(){return 'ok';} }
app.use(ctx => invoke(ctx,new Controller()));
const current = createRouteHandler(app,'index');
const previous = (ctx,ctl) => old.exports.Handler(app,ctx,ctl,'index');
(async()=>{
 const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 const concurrency=16, requests=5000, runs=[];
 const agent=new http.Agent({keepAlive:true,maxSockets:concurrency});
 async function measure(fn,count){
  invoke=fn; let next=0; const latency=[]; const start=process.hrtime.bigint();
  await Promise.all(Array.from({length:concurrency},async()=>{while(next++<count){
   const t=process.hrtime.bigint();
   await new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port:server.address().port,agent},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>res.statusCode===200&&body==='ok'?resolve():reject(new Error('invalid response')));});req.on('error',reject);});
   latency.push(Number(process.hrtime.bigint()-t)/1e6);
  }}));
  const seconds=Number(process.hrtime.bigint()-start)/1e9; latency.sort((a,b)=>a-b);
  return {rps:count/seconds,p99ms:latency[Math.floor(latency.length*.99)]};
 }
 try {
  await measure(previous,2000);await measure(current,2000);
  for(let i=0;i<7;i++){
   const pair={}; for(const name of (i%2?['current','baseline']:['baseline','current'])) pair[name]=await measure(name==='current'?current:previous,requests);
   runs.push(pair);
  }
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const b=median(runs.map(r=>r.baseline.rps)),c=median(runs.map(r=>r.current.rps));
  const bp=median(runs.map(r=>r.baseline.p99ms)),cp=median(runs.map(r=>r.current.p99ms));
  console.log(JSON.stringify({mode:'real-http-handler-comparison',node:process.version,baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),concurrency,requests,runs,median:{baselineRps:b,currentRps:c,rpsChangePercent:(c/b-1)*100,baselineP99ms:bp,currentP99ms:cp},targetMet:c>=b*1.1&&cp<=bp},null,2));
 } finally {agent.destroy();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
