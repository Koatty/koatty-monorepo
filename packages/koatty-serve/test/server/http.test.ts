import { EventEmitter, once } from 'events';
import * as http from 'http';
import { HttpServer } from '../../src/server/http';
const servers: HttpServer[]=[];
beforeEach(()=>jest.useRealTimers());
afterEach(async()=>{for(const s of servers.splice(0)) await s.destroy();});
function server(handler: any = (_req: any,res: any)=>res.end('ok'), options: any={}) {
 const app:any=Object.assign(new EventEmitter(),{config:()=>({}),callback:()=>handler});
 const s=new HttpServer(app,{protocol:'http',hostname:'127.0.0.1',port:0,shutdown:{drainTimeout:100},...options});servers.push(s);return s;
}
function get(s:HttpServer) {return new Promise<any>((resolve,reject)=>{
 const req=http.get({host:'127.0.0.1',port:(s.getNativeServer() as any).address().port,agent:false},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);
});}
test('native listener starts, handles requests and stops once',async()=>{
 const s=server();expect(s.getStatus()).toBe(0);await new Promise<void>(r=>s.Start(r));
 expect(s.getStatus()).toBe(200);expect(await get(s)).toEqual({status:200,body:'ok'});
 expect(s.getConnectionStats().totalConnections).toBe(1);
 await s.destroy();expect((s.getNativeServer() as any).listening).toBe(false);
});
test.each(['sync','async'])('redacts %s request failures',async mode=>{
 const s=server(mode==='sync'?()=>{throw Error('secret')}:async()=>{throw Error('secret')});
 await new Promise<void>(r=>s.Start(r));const response=await get(s);
 expect(response.status).toBe(500);expect(response.body).not.toContain('secret');
});
test('applies native timeout settings',()=>{
 const s=server(undefined,{connectionPool:{keepAliveTimeout:100,headersTimeout:1000,requestTimeout:500}});
 expect(s.getNativeServer()).toMatchObject({keepAliveTimeout:100,headersTimeout:1000,requestTimeout:500});
});
test('bounded shutdown destroys a request that never finishes',async()=>{
 let arrived!:()=>void;const received=new Promise<void>(r=>arrived=r);
 const s=server(()=>arrived());await new Promise<void>(r=>s.Start(r));
 const response=get(s).catch(error=>error);await received;
 expect(await s.gracefulShutdown({timeout:20})).toMatchObject({status:'forced'});
 expect(await response).toMatchObject({code:"ECONNRESET"});expect(s.getConnectionStats().activeConnections).toBe(0);
});
test('restarts on config change and continues serving',async()=>{
 const s=server();await new Promise<void>(r=>s.Start(r));
 await s.updateConfig({connectionPool:{keepAliveTimeout:1234}});expect(await get(s)).toMatchObject({status:200});
 expect((s.getNativeServer() as any).keepAliveTimeout).toBe(1234);
});
