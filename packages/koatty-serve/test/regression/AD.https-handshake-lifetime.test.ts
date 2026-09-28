import { EventEmitter } from 'events';
test('a real HTTPS server tracks a completed handshake without a client certificate', async () => {
  jest.useRealTimers();
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const {execFileSync} = await import('child_process');
  const {get} = await import('https');
  const {HttpsServer} = await import('../../src/server/https');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'koatty-handshake-'));
  const key = path.join(dir,'key.pem'), cert = path.join(dir,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',key,'-out',cert],{stdio:'ignore'});
  const app: any = Object.assign(new EventEmitter(),{config:()=>({}),callback:()=> (_req: any,res: any)=>res.end('ok')});
  const server = new HttpsServer(app,{protocol:'https',hostname:'127.0.0.1',port:0,ssl:{key,cert},shutdown:{preStopDelay:0,drainTimeout:10}});
  try {
    await new Promise<void>(resolve=>server.Start(resolve));
    const native = (server as any).server;
    const body = await new Promise<string>((resolve,reject)=> {
      const req = get({hostname:'127.0.0.1',port:native.address().port,rejectUnauthorized:false,agent:false}, res=> {
        let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve(text));
      });req.on('error',reject);
    });
    expect(body).toBe('ok');
    expect(server.getConnectionStats().totalConnections).toBe(1);
  } finally { await server.destroy();fs.rmSync(dir,{recursive:true,force:true}); }
},10000);
