import {EventEmitter} from 'events';
import * as h2 from 'http2';
import * as https from 'https';
import path from 'path';
import {Http2Server} from '../../src/server/http2';
beforeEach(()=>jest.useRealTimers());
test('real HTTP/2 streams and HTTP/1 fallback share dispatch and graceful close',async()=>{
 const app:any=Object.assign(new EventEmitter(),{config:()=>({}),callback:()=> (_req:any,res:any)=>res.end('shared')});
 const s=new Http2Server(app,{protocol:'http2',hostname:'127.0.0.1',port:0,ssl:{key:path.join(__dirname,'../temp/test-key.pem'),cert:path.join(__dirname,'../temp/test-cert.pem')}});
 let client:h2.ClientHttp2Session|undefined;
 try{await new Promise<void>(r=>s.Start(r));const port=(s.getNativeServer() as any).address().port;
 client=h2.connect(`https://localhost:${port}`,{rejectUnauthorized:false});
 const body=await new Promise<string>((resolve,reject)=>{const req=client!.request({':path':'/'});let body='';req.on('data',c=>body+=c);req.on('end',()=>resolve(body));req.on('error',reject);req.end();});expect(body).toBe('shared');
 const fallback=await new Promise<string>((resolve,reject)=>https.get({host:'127.0.0.1',port,rejectUnauthorized:false,agent:false},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve(body));}).on('error',reject));expect(fallback).toBe('shared');
 client.close();await s.destroy();expect(s.getConnectionStats().activeConnections).toBe(0);
 }finally{client?.destroy();await s.destroy();}
});
