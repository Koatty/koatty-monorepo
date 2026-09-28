import {EventEmitter, once} from 'events';
import {createServer} from 'http';
import WebSocket from 'ws';
import {WsServer} from '../../src/server/ws';
beforeEach(()=>jest.useRealTimers());
const makeApp=(config: any={}, handler: any=(req:any,ws:any)=>ws.send(req.url+':'+req.data.toString()))=>Object.assign(new EventEmitter(),{config:()=>config,callback:()=>handler}) as any;
test('real messages retain upgrade URL/data; closing does not close an externally owned HTTP server',async()=>{
 const external=createServer((_req,res)=>res.end('external'));await new Promise<void>(r=>external.listen(0,'127.0.0.1',r));
 const s=new WsServer(makeApp(),{protocol:'ws',hostname:'127.0.0.1',port:0,ext:{server:external}});
 const ws=new WebSocket(`ws://127.0.0.1:${(external.address() as any).port}/echo`);
 try{await new Promise<void>(r=>s.Start(r));await once(ws,'open');expect((s.getNativeServer() as any).address()).toEqual(external.address());
 for(const data of ['first','second']) {const message=once(ws,'message');ws.send(data);expect((await message)[0].toString()).toBe('/echo:'+data);}
 expect(s.getConnectionStats().activeConnections).toBe(1);
 ws.close();await once(ws,'close');await s.destroy();expect(external.listening).toBe(true);expect(external.listenerCount('upgrade')).toBe(0);
 }finally{ws.terminate();await s.destroy();await new Promise<void>(r=>external.close(()=>r()));}
});
test('real oversized payload is rejected by ws before application dispatch',async()=>{
 const handler=jest.fn();const s=new WsServer(makeApp({},handler),{protocol:'ws',hostname:'127.0.0.1',port:0,wsOptions:{maxPayload:4}});
 let ws:WebSocket|undefined;
 try{await new Promise<void>(r=>s.Start(r));ws=new WebSocket(`ws://127.0.0.1:${s.httpServer.address() && (s.httpServer.address() as any).port}`);await once(ws,'open');
 const closed=once(ws,'close');ws.send('too large');expect((await closed)[0]).toBe(1009);expect(handler).not.toHaveBeenCalled();
 }finally{ws?.terminate();await s.destroy();}
});
test('application errors are redacted on the real socket',async()=>{
 const s=new WsServer(makeApp({},()=>{throw Error('private credential')}),{protocol:'ws',hostname:'127.0.0.1',port:0});let ws:WebSocket|undefined;
 try{await new Promise<void>(r=>s.Start(r));ws=new WebSocket(`ws://127.0.0.1:${(s.httpServer.address() as any).port}`);await once(ws,'open');
 const message=once(ws,'message');ws.send('hello');const body=JSON.parse((await message)[0].toString());expect(body.error).toBe('Internal server error');expect(body.requestId).toBeDefined();
 }finally{ws?.terminate();await s.gracefulShutdown({timeout:20});}
});
