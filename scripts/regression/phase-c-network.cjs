// Regression gate: real HTTP plus grpc-js -> Serve -> Core -> Trace -> Router -> IOC controller.
const path=require('path'),{createRequire}=require('module'),http=require('http');
const assert=require('node:assert/strict');
const observations=new Map(); const print=console.log; console.log=(key,...values)=>{if(typeof key==='string' && /^(HTTP_|GRPC_|STREAM_ACCOUNTING)/.test(key))observations.set(key,values[0]);print(key,...values)};
const root=process.cwd();require(root+'/node_modules/ts-node').register({transpileOnly:true,skipProject:true,compilerOptions:{module:'commonjs',target:'es2022',esModuleInterop:true,experimentalDecorators:true,emitDecoratorMetadata:true}});
const req=p=>require(root+'/packages/'+p),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const {Koatty}=req('koatty-core/src/Application.ts'),{Trace}=req('koatty-trace/src/trace/trace.ts');
 const {HttpServer}=req('koatty-serve/src/server/http.ts');const {TerminusManager}=req('koatty-serve/src/utils/terminus-manager.ts');
 let reports=0;const app=new Koatty();app.silent=true;app.use(Trace({timeout:200,enableTrace:false,metricsConf:{reporter:()=>reports++}},app));app.use(async ctx=>{if(ctx.path==='/error')throw new Error('audit failure');ctx.body={ok:true}});
 const server=new HttpServer(app,{protocol:'http',hostname:'127.0.0.1',port:0,shutdown:{preStopDelay:0,drainTimeout:100}});app.server=server;
 TerminusManager.getInstance().setExitOnShutdown(false);await new Promise(r=>server.Start(r));const port=server.getNativeServer().address().port;
 const agent=new http.Agent({keepAlive:true,maxSockets:1});
 const get=route=>new Promise(resolve=>{const r=http.get({host:'127.0.0.1',port,path:route,agent,timeout:300},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,connection:res.headers.connection}))});r.on('timeout',()=>r.destroy(new Error('CLIENT_TIMEOUT')));r.on('error',e=>resolve({error:e.message}))});
 console.log('HTTP_BEFORE_DRAIN',await get('/work'));console.log('HTTP_ERROR_CONTROL',await get('/error'));console.log('HTTP_REPORTS_FOR_TWO_REQUESTS',reports);server.beginDrain();console.log('HTTP_READY_DRAIN',await get('/ready'));console.log('HTTP_WORK_DRAIN',await get('/work'));agent.destroy();await new Promise(r=>server.Stop(r));TerminusManager.resetInstance();
 const serveReq=createRequire(path.join(root,'packages/koatty-serve/package.json')),grpc=serveReq('@grpc/grpc-js'),loader=createRequire(path.join(root,'packages/koatty-proto/package.json'))('@grpc/proto-loader');
 const proto=grpc.loadPackageDefinition(loader.loadSync(path.join(__dirname,'fixtures/phase-c.proto'))).audit.Probe;
 const {GrpcServer}=req('koatty-serve/src/server/grpc.ts');
 let currentMethod='',streamFinished=false,grpcReports=0;const ga=new Koatty();ga.silent=true;ga.use(Trace({timeout:200,enableTrace:false,metricsConf:{reporter:()=>{grpcReports++;if(currentMethod.endsWith('/ServerStream'))console.log('STREAM_ACCOUNTING',JSON.stringify({streamFinished}))}}},ga));
 class PhaseCController {
  constructor(ctx) { this.ctx = ctx; }
  async Unary() { const call=this.ctx.rpc.call; currentMethod=call.getPath(); await sleep(call.request.delay||0); return {value:'unary'}; }
  async ClientStream() { const call=this.ctx.rpc.call; currentMethod=call.getPath(); let n=0; await new Promise(resolve=>{call.on('data',()=>n++);call.on('end',resolve)}); return {value:String(n)}; }
  async ServerStream() { const call=this.ctx.rpc.call; currentMethod=call.getPath(); await sleep(500); call.write({value:'stream'}); streamFinished=true; call.end(); }
  BidiStream() { const call=this.ctx.rpc.call; currentMethod=call.getPath(); call.on('data',v=>call.write(v));call.on('end',()=>call.end()); }
 }
 const {Controller}=req('koatty-core/src/Component.ts');
 const {RequestMapping}=req('koatty-router/src/params/mapping.ts');
 const {GrpcRouter}=req('koatty-router/src/router/grpc.ts');
 Controller('/audit.Probe',{protocol:'grpc'})(PhaseCController);
 for(const method of ['Unary','ClientStream','ServerStream','BidiStream'])RequestMapping('/'+method)(PhaseCController.prototype,method,Object.getOwnPropertyDescriptor(PhaseCController.prototype,method));
 const gs=new GrpcServer(ga,{protocol:'grpc',hostname:'127.0.0.1',port:0,shutdown:{preStopDelay:0,drainTimeout:100}});ga.server=gs;TerminusManager.getInstance().setExitOnShutdown(false);
 const router=new GrpcRouter(ga,{protocol:'grpc',prefix:'',ext:{protoFile:path.join(__dirname,'fixtures/phase-c.proto')}}); await router.LoadRouter(ga,['PhaseCController']);
 const native=gs.getNativeServer();const gp=await new Promise((r,j)=>native.bindAsync('127.0.0.1:0',grpc.ServerCredentials.createInsecure(),(e,p)=>e?j(e):r(p)));
 const client=new proto(`127.0.0.1:${gp}`,grpc.credentials.createInsecure());
 try{
  console.log('GRPC_UNARY_CONTROL',await new Promise(r=>client.Unary({delay:0},{deadline:Date.now()+1000},(e,v)=>r(e?{code:e.code,details:e.details}:v))));
  console.log('GRPC_DEADLINE_LONGER_THAN_TRACE',await new Promise(r=>client.Unary({delay:500},{deadline:Date.now()+1000},(e,v)=>r(e?{code:e.code,details:e.details}:v))));
  console.log('GRPC_CLIENT_STREAM',await new Promise(r=>{const c=client.ClientStream({deadline:Date.now()+1000},(e,v)=>r(e?{code:e.code,details:e.details}:v));c.write({value:'a'});c.end()}));
  console.log('GRPC_SERVER_STREAM',await new Promise(r=>{const values=[];let done=false;const c=client.ServerStream({}, {deadline:Date.now()+1200});const finish=v=>{if(!done){done=true;r(v)}};c.on('data',v=>values.push(v));c.on('error',e=>finish({code:e.code,details:e.details,values}));c.on('end',()=>finish({values}))}));
  console.log('GRPC_BIDI_STREAM',await new Promise(r=>{const values=[];let done=false;const c=client.BidiStream({deadline:Date.now()+1200});const finish=v=>{if(!done){done=true;r(v)}};c.on('data',v=>values.push(v));c.on('error',e=>finish({code:e.code,details:e.details,values}));c.on('end',()=>finish({values}));c.write({value:'b'});c.end()}));
 await sleep(5); console.log('GRPC_REPORTS_FOR_FIVE_CALLS',grpcReports);
 assert.deepEqual(observations.get('HTTP_WORK_DRAIN'),{status:503,connection:'close'});
 assert.equal(observations.get('HTTP_REPORTS_FOR_TWO_REQUESTS'),2);
 assert.deepEqual(observations.get('GRPC_DEADLINE_LONGER_THAN_TRACE'),{value:'unary'});
 assert.deepEqual(observations.get('GRPC_UNARY_CONTROL'),{value:'unary'});
 assert.deepEqual(observations.get('GRPC_CLIENT_STREAM'),{value:'1'});
 assert.deepEqual(observations.get('GRPC_SERVER_STREAM'),{values:[{value:'stream'}]});
 assert.deepEqual(observations.get('GRPC_BIDI_STREAM'),{values:[{value:'b'}]});
 assert.equal(grpcReports,5); assert.equal(JSON.parse(observations.get('STREAM_ACCOUNTING')).streamFinished,true);
 const expired=await new Promise(r=>client.Unary({delay:200},{deadline:Date.now()+30},(e,v)=>r(e||v)));
 assert.equal(expired.code,4);
 await sleep(50); assert.equal(grpcReports,6);
 console.log('PHASE_C_NETWORK_PASS');
 }finally{client.close();await gs.destroy();TerminusManager.resetInstance()}
})().catch(e=>{console.error(e);process.exitCode=1});
