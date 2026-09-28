import {EventEmitter} from 'events';
import * as grpc from '@grpc/grpc-js';
import {GrpcServer} from '../../src/server/grpc';
beforeEach(()=>jest.useRealTimers());
test('real unary dispatch uses middleware registered after service registration and stops',async()=>{
 let handler:any;
 const app:any=Object.assign(new EventEmitter(),{config:()=>({}),callback:()=>handler});
 const s=new GrpcServer(app,{protocol:'grpc',hostname:'127.0.0.1',port:0});
 const encode=(v:any)=>Buffer.from(JSON.stringify(v)),decode=(v:Buffer)=>JSON.parse(v.toString());
 const definition:any={echo:{path:'/test.Service/echo',requestStream:false,responseStream:false,requestSerialize:encode,requestDeserialize:decode,responseSerialize:encode,responseDeserialize:decode}};
 s.RegisterService({service:definition,implementation:{echo:()=>{}}});
 handler=(call:any,done:any)=>done(null,call.request);
 // Keep the actual bind callback's assigned port; native grpc has no public address().
 const native:any=s.getNativeServer();const bind=native.bindAsync.bind(native);let port=0;
 native.bindAsync=(address:any,credentials:any,callback:any)=>bind(address,credentials,(err:any,p:number)=>{port=p;callback(err,p)});
 let client:any;
 try{await new Promise<void>(r=>s.Start(r));const Client=grpc.makeGenericClientConstructor(definition,'Service');client=new Client(`127.0.0.1:${port}`,grpc.credentials.createInsecure());
 expect(await new Promise((resolve,reject)=>client.echo({ok:true},(e:any,v:any)=>e?reject(e):resolve(v)))).toEqual({ok:true});
 expect(s.getConnectionStats().activeConnections).toBe(0);
 }finally{client?.close();await s.destroy();}expect(s.getStatus()).toBe(0);
});
test('explicit TLS requires both certificate and key',()=>{
 const app:any=Object.assign(new EventEmitter(),{config:()=>({}),callback:()=>()=>{}});
 const s=new GrpcServer(app,{protocol:'grpc',hostname:'127.0.0.1',port:0,ssl:{enabled:true}});
 expect(()=>s.Start()).toThrow('key or cert');return s.destroy();
});
