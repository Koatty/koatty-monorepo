import {EventEmitter} from 'events';
import * as https from 'https';
import * as net from 'net';
import path from 'path';
import {HttpsServer} from '../../src/server/https';
const ssl={key:path.join(__dirname,'../temp/test-key.pem'),cert:path.join(__dirname,'../temp/test-cert.pem')};
const app=()=>Object.assign(new EventEmitter(),{config:()=>({}),callback:()=> (_req:any,res:any)=>res.end('tls')}) as any;
beforeEach(()=>jest.useRealTimers());
test('requires real key and certificate',()=>{expect(()=>new HttpsServer(app(),{protocol:'https',port:0,hostname:'127.0.0.1'})).toThrow();});
test('serves TLS 1.2+ and bounds shutdown of an incomplete handshake',async()=>{
 const s=new HttpsServer(app(),{protocol:'https',port:0,hostname:'127.0.0.1',ssl});let idle:net.Socket|undefined;
 try {await new Promise<void>(r=>s.Start(r));const port=(s.getNativeServer() as any).address().port;
 const response=await new Promise<string>((resolve,reject)=>{https.get({host:'127.0.0.1',port,rejectUnauthorized:false,agent:false,minVersion:'TLSv1.2'},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve(text));}).on('error',reject);});expect(response).toBe('tls');
 idle=net.connect(port,'127.0.0.1');await new Promise<void>(r=>idle!.once('connect',r));
 await s.gracefulShutdown({timeout:20});expect(s.getConnectionStats().activeConnections).toBe(0);
 }finally{idle?.destroy();await s.destroy();}
});
test('mutual TLS requests a client certificate and rejects an unauthenticated client',async()=>{
 const s=new HttpsServer(app(),{protocol:'https',port:0,hostname:'127.0.0.1',ssl:{...ssl,mode:'mutual_tls',ca:ssl.cert}});
 try {await new Promise<void>(r=>s.Start(r));
 await expect(new Promise((resolve,reject)=>https.get({host:'127.0.0.1',port:(s.getNativeServer() as any).address().port,rejectUnauthorized:false,agent:false},resolve).on('error',reject))).rejects.toThrow();
 }finally{await s.destroy();}
});
