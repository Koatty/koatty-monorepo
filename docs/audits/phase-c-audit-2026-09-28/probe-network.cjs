// Actual loopback HTTP and grpc-js clients with Koatty + Trace + serve.
const path=require('path'),{createRequire}=require('module'),http=require('http');
const root=process.cwd();require(root+'/node_modules/ts-node').register({transpileOnly:true,skipProject:true,compilerOptions:{module:'commonjs',target:'es2022',esModuleInterop:true,experimentalDecorators:true,emitDecoratorMetadata:true}});
const req=p=>require(root+'/packages/'+p),sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const {Koatty}=req('koatty-core/src/application.ts'),{Trace}=req('koatty-trace/src/trace/trace.ts');
 const {HttpServer}=req('koatty-serve/src/server/http.ts');const {TerminusManager}=req('koatty-serve/src/utils/terminus-manager.ts');
 let reports=0;const app=new Koatty();app.silent=true;app.use(Trace({timeout:200,enableTrace:false,metricsConf:{reporter:()=>reports++}},app));app.use(async ctx=>{if(ctx.path==='/error')throw new Error('audit failure');ctx.body={ok:true}});
 const server=new HttpServer(app,{protocol:'http',hostname:'127.0.0.1',port:0,shutdown:{preStopDelay:0,drainTimeout:100}});app.server=server;
 TerminusManager.getInstance().setExitOnShutdown(false);await new Promise(r=>server.Start(r));const port=server.getNativeServer().address().port;
 const agent=new http.Agent({keepAlive:true,maxSockets:1});
 const get=route=>new Promise(resolve=>{const r=http.get({host:'127.0.0.1',port,path:route,agent,timeout:300},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,connection:res.headers.connection}))});r.on('timeout',()=>r.destroy(new Error('CLIENT_TIMEOUT')));r.on('error',e=>resolve({error:e.message}))});
 console.log('HTTP_BEFORE_DRAIN',await get('/work'));console.log('HTTP_ERROR_CONTROL',await get('/error'));console.log('HTTP_REPORTS_FOR_TWO_REQUESTS',reports);server.beginDrain();console.log('HTTP_READY_DRAIN',await get('/ready'));console.log('HTTP_WORK_DRAIN',await get('/work'));agent.destroy();await new Promise(r=>server.Stop(r));TerminusManager.resetInstance();
 const serveReq=createRequire(path.join(root,'packages/koatty-serve/package.json')),grpc=serveReq('@grpc/grpc-js'),loader=createRequire(path.join(root,'packages/koatty-proto/package.json'))('@grpc/proto-loader');
 const proto=grpc.loadPackageDefinition(loader.loadSync(path.join(__dirname,'stream.proto'))).audit.Probe;
 const {GrpcServer}=req('koatty-serve/src/server/grpc.ts');
 const {BaseHandler}=req('koatty-trace/src/handler/base.ts');const originalError=BaseHandler.prototype.handleError;BaseHandler.prototype.handleError=function(e,...a){console.log('GRPC_HANDLER_ERROR',e.stack);return originalError.call(this,e,...a)};
 let currentMethod='',streamFinished=false,grpcReports=0;const ga=new Koatty();ga.silent=true;ga.use(Trace({timeout:200,enableTrace:false,metricsConf:{reporter:()=>{grpcReports++;if(currentMethod.endsWith('/ServerStream'))console.log('STREAM_ACCOUNTING',JSON.stringify({streamFinished}))}}},ga));
 ga.use(async ctx=>{const call=ctx.rpc.call;ctx.status=200;const name=call.getPath();currentMethod=name;
  if(name.endsWith('/Unary')){await sleep(call.request.delay||0);ctx.body={value:'unary'};return}
  if(name.endsWith('/ClientStream')){let n=0;await new Promise(resolve=>{call.on('data',()=>n++);call.on('end',resolve)});ctx.body={value:String(n)};return}
  if(name.endsWith('/ServerStream')){await sleep(500);call.write({value:'stream'});call.end();streamFinished=true;return}
  if(name.endsWith('/BidiStream')){await new Promise(resolve=>{call.on('data',v=>call.write(v));call.on('end',()=>{call.end();resolve()})});return}
 });
 const gs=new GrpcServer(ga,{protocol:'grpc',hostname:'127.0.0.1',port:0,shutdown:{preStopDelay:0,drainTimeout:100}});ga.server=gs;TerminusManager.getInstance().setExitOnShutdown(false);
 gs.RegisterService({service:proto.service,implementation:Object.fromEntries(Object.keys(proto.service).map(k=>[k,()=>{}]))});
 const native=gs.getNativeServer();const gp=await new Promise((r,j)=>native.bindAsync('127.0.0.1:0',grpc.ServerCredentials.createInsecure(),(e,p)=>e?j(e):r(p)));
 const client=new proto(`127.0.0.1:${gp}`,grpc.credentials.createInsecure());
 try{
  console.log('GRPC_UNARY_CONTROL',await new Promise(r=>client.Unary({delay:0},{deadline:Date.now()+1000},(e,v)=>r(e?{code:e.code,details:e.details}:v))));
  console.log('GRPC_DEADLINE_LONGER_THAN_TRACE',await new Promise(r=>client.Unary({delay:500},{deadline:Date.now()+1000},(e,v)=>r(e?{code:e.code,details:e.details}:v))));
  console.log('GRPC_CLIENT_STREAM',await new Promise(r=>{const c=client.ClientStream({deadline:Date.now()+1000},(e,v)=>r(e?{code:e.code,details:e.details}:v));c.write({value:'a'});c.end()}));
  console.log('GRPC_SERVER_STREAM',await new Promise(r=>{const values=[];let done=false;const c=client.ServerStream({}, {deadline:Date.now()+1200});const finish=v=>{if(!done){done=true;r(v)}};c.on('data',v=>values.push(v));c.on('error',e=>finish({code:e.code,details:e.details,values}));c.on('end',()=>finish({values}))}));
  console.log('GRPC_BIDI_STREAM',await new Promise(r=>{const values=[];let done=false;const c=client.BidiStream({deadline:Date.now()+1200});const finish=v=>{if(!done){done=true;r(v)}};c.on('data',v=>values.push(v));c.on('error',e=>finish({code:e.code,details:e.details,values}));c.on('end',()=>finish({values}));c.write({value:'b'});c.end()}));
 console.log('GRPC_REPORTS_FOR_FIVE_CALLS',grpcReports);
 }finally{client.close();native.forceShutdown();await gs.connectionPool.destroy();gs.timerManager.destroy();TerminusManager.resetInstance()}
})().catch(e=>{console.error(e);process.exitCode=1});
