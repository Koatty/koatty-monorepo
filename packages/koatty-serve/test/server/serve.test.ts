import {EventEmitter} from 'events';
import {NewServe,SingleProtocolServer} from '../../src/server/serve';
import path from 'path';
const app=()=>Object.assign(new EventEmitter(),{rootPath:path.join(__dirname,'uninstalled-app'),config:()=>({}),callback:()=> (_req:any,res:any)=>res.end('ok')}) as any;
beforeEach(()=>jest.useRealTimers());
test('wrapper forwards native lifetime and status',async()=>{
 const s:any=NewServe(app(),{protocol:'http',hostname:'127.0.0.1',port:0});expect(s).toBeInstanceOf(SingleProtocolServer);
 await new Promise<void>(r=>s.Start(r));expect(s.getStatus()).toBe(200);expect(s.getNativeServer().listening).toBe(true);
 s.beginDrain();expect(s.getStatus()).toBe(503);
 await new Promise<void>((r,j)=>s.Stop((e:any)=>e?j(e):r()));expect(s.getStatus()).toBe(0);
});
test('HTTP/3 is an explicit optional application dependency',()=>{
 const {execFileSync}=require('child_process');
 const script=`const {NewServe}=require(${JSON.stringify(path.resolve(__dirname,'../../dist/index.js'))});
 const assert=require('assert');const app={rootPath:'/tmp/koatty-uninstalled-app',config:()=>({})};
 assert.throws(()=>NewServe(app,{protocol:'http3',hostname:'127.0.0.1',port:8443,ssl:{key:${JSON.stringify(path.join(__dirname,'../temp/test-key.pem'))},cert:${JSON.stringify(path.join(__dirname,'../temp/test-cert.pem'))}}}),/install koatty_http3/);`;
 expect(()=>execFileSync(process.execPath,['-e',script],{stdio:'pipe',env:{...process.env,NODE_PATH:''}})).not.toThrow();
});
test.each([-1,65536,1.5])('rejects invalid explicit port %s',port=>{
 expect(()=>NewServe(app(),{protocol:'http',hostname:'127.0.0.1',port})).toThrow();
});
