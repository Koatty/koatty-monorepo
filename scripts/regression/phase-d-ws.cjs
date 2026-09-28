// Actual WebSocket -> Serve -> Core -> Trace -> Router -> controller; no protocol mocks.
const {createRequire}=require('module'),path=require('path'),assert=require('assert/strict'),{once}=require('events');
const root=path.resolve(__dirname,'../..'),load=p=>require(path.join(root,'packages',p));
const {Koatty,Controller}=load('koatty-core'),{GetMapping,NewRouter}=load('koatty-router'),{Trace}=load('koatty-trace'),{WsServer}=load('koatty-serve');
const WS=createRequire(path.join(root,'packages/koatty-serve/package.json'))('ws');
(async()=>{const app=new Koatty();app.silent=true;app.config("ws","config",{allowedOrigins:["https://fixture.local"]});app.use(Trace({enableTrace:false,timeout:500},app));
 class EchoController{constructor(ctx){this.ctx=ctx}echo(){return {value:this.ctx.getMetaData('_body')}}}
 Controller('/',{protocol:'ws'})(EchoController);GetMapping('/echo')(EchoController.prototype,'echo',Object.getOwnPropertyDescriptor(EchoController.prototype,'echo'));
 app.container.reg('EchoController',EchoController,{type:'CONTROLLER',scope:'Prototype'});
 const {router}=NewRouter(app,{protocol:'ws'});await router.LoadRouter(app,['EchoController']);
 const server=new WsServer(app,{protocol:'ws',hostname:'127.0.0.1',port:0,shutdown:{drainTimeout:100}});app.server=server;let client;
 try{await new Promise(r=>server.Start(r));client=new WS(`ws://127.0.0.1:${server.httpServer.address().port}/echo`,{origin:'https://fixture.local'});await once(client,'open');
 for(const value of ['first','second','third']){const response=once(client,'message');client.send(value);const [data]=await Promise.race([response,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('WS reply timeout')),2000);t.unref()})]);assert.match(data.toString(),new RegExp(value));}
 assert.equal(server.getConnectionStats().activeConnections,1);client.close();await once(client,'close');
 console.log('PHASE_D_REAL_WS_PASS');
 }finally{client?.terminate();await app.stop();}
})().catch(e=>{console.error(e);process.exitCode=1});
