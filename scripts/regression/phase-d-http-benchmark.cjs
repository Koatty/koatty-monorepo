// Separate client/server processes; same actual Koatty Core -> Router -> IOC -> Serve.
// KOATTY_BASELINE_MODULES points to an immutable pre-change package snapshot.
const {fork,execFileSync}=require('child_process'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../..');
if(process.argv[2]==='server'){
 process.on('uncaughtException',e=>{console.error(e);process.exitCode=1});
 const base=process.argv[3];const load=name=>require(path.join(base,name));
 const {Koatty}=load('koatty_core'),{DefaultLogger}=load('koatty_logger');DefaultLogger.enable(false);
 const {HttpServer}=load('koatty_serve'),{NewRouter,GetMapping}=load('koatty_router'),{Controller}=load('koatty_core');
 const app=new Koatty();app.silent=true;app.use(load('koatty_trace').Trace({enableTrace:false},app));
 class ProbeController{index(){return {ok:true}}}Controller()(ProbeController);GetMapping('/probe')(ProbeController.prototype,'index',Object.getOwnPropertyDescriptor(ProbeController.prototype,'index'));
 app.container.saveClass('CONTROLLER',ProbeController,'ProbeController');app.container.reg(ProbeController,{scope:'Prototype'});
 (async()=>{const {router}=NewRouter(app,{protocol:'http'});await router.LoadRouter(app,['ProbeController']);const server=new HttpServer(app,{protocol:'http',hostname:'127.0.0.1',port:0});app.server=server;await new Promise(r=>server.Start(r));process.send({port:server.getNativeServer().address().port});process.on('message',async msg=>{if(msg==='stop'){await app.stop();process.disconnect();}});})().catch(e=>{console.error(e);process.exitCode=1});
}else (async()=>{
 const fs=require('fs');const baseline=process.env.KOATTY_BASELINE_MODULES;if(!baseline)throw Error('KOATTY_BASELINE_MODULES required');
 const current=fs.mkdtempSync(path.join(require('os').tmpdir(),'koatty-bench-packages-'));
 for(const name of fs.readdirSync(path.join(root,'packages'))){const dir=path.join(root,'packages',name),pkg=path.join(dir,'package.json');if(fs.existsSync(pkg))fs.symlinkSync(dir,path.join(current,JSON.parse(fs.readFileSync(pkg)).name));}
 const count=12000,concurrency=16,runs=[];
 async function measure(base){const child=fork(__filename,['server',base],{stdio:['ignore','pipe','pipe','ipc']});let errors='';child.stderr.on('data',b=>errors+=b);child.stdout.resume();
 const port=await new Promise((resolve,reject)=>{child.once('message',m=>resolve(m.port));child.once('exit',code=>reject(Error(`Server failed ${code}: ${errors}`)));});
 const agent=new http.Agent({keepAlive:true,maxSockets:concurrency});
 async function load(n){
  let next=0,resets=0;const latency=[],start=process.hrtime.bigint();
  async function request(agent){return new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path:'/probe',agent,timeout:5000},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{assert.equal(res.statusCode,200);assert.deepEqual(JSON.parse(text),{ok:true});resolve()}catch(e){reject(e)}})}).on('error',reject).on('timeout',function(){this.destroy(Error('request timed out'))}));}
  await Promise.all(Array.from({length:concurrency},async()=>{
   let workerAgent=new http.Agent({keepAlive:true,maxSockets:1}),used=0;
   try{while(next++<n){
    if(used++===80){workerAgent.destroy();workerAgent=new http.Agent({keepAlive:true,maxSockets:1});used=1;}
    const t=process.hrtime.bigint();
    try{await request(workerAgent)}catch(e){if(e.code!=='ECONNRESET')throw e;resets++;workerAgent.destroy();workerAgent=new http.Agent({keepAlive:true,maxSockets:1});used=1;await request(workerAgent)}
    latency.push(Number(process.hrtime.bigint()-t)/1e6);
   }}finally{workerAgent.destroy();}
  }));latency.sort((a,b)=>a-b);
  return {rps:n/(Number(process.hrtime.bigint()-start)/1e9),p99ms:latency[Math.floor(latency.length*.99)],connectionResets:resets};
 }

 try{await load(4000);return await load(count);}catch(error){error.message+=' ['+base+'] '+errors;throw error;}finally{agent.destroy();child.send('stop');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('benchmark server did not exit'))},10000);child.once('exit',code=>{clearTimeout(timer);code?reject(Error(errors)):resolve()})});}
 }
 try{for(let i=0;i<7;i++){const pair={};for(const key of i%2?['current','baseline']:['baseline','current'])pair[key]=await measure(key==='current'?current:baseline);runs.push(pair);}
 const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];const b=median(runs.map(r=>r.baseline.rps)),c=median(runs.map(r=>r.current.rps)),bp=median(runs.map(r=>r.baseline.p99ms)),cp=median(runs.map(r=>r.current.p99ms));console.log(JSON.stringify({mode:'real-framework-separate-client-server',node:process.version,platform:process.platform,baseline,concurrency,count,runs,median:{baselineRps:b,currentRps:c,improvementPercent:(c/b-1)*100,baselineP99ms:bp,currentP99ms:cp},targetMet:c>=b*1.1&&cp<=bp},null,2));
 if(process.argv.includes('--check')&&!(c>=b*1.1&&cp<=bp))process.exitCode=1;
 }finally{fs.rmSync(current,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
