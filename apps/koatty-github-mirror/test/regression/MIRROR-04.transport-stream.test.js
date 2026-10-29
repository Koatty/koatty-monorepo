const http = require('node:http');
const {PassThrough} = require('node:stream');
let mockPort;
jest.mock('node:dns/promises',()=>({lookup:jest.fn(async()=>[{address:'140.82.112.3',family:4}])}));
// Exercise the production upload/timer/pipeline code with loopback TCP.
// Only DNS and TLS connection establishment are replaced, not the body transport.
jest.mock('node:https',()=>({request:(_url,options,callback)=>{
  const req=require('node:http').request({hostname:'127.0.0.1',port:mockPort,path:_url.pathname,method:options.method,headers:options.headers,signal:options.signal,agent:false},callback);
  req.once('socket',socket=>socket.once('connect',()=>socket.emit('secureConnect')));return req;
}}));
const {safeTransport}=require('../../dist/utils/transport');
let server,received;
beforeAll(async()=>{
  server=http.createServer((req,res)=>{received=0;req.on('data',chunk=>received+=chunk.length);req.on('end',()=>{if(req.url==='/late')return;res.end('ok');});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));mockPort=server.address().port;
});
afterAll(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
const options=body=>({method:'POST',headers:{},body,signal:new AbortController().signal,headerTimeoutMs:50,idleTimeoutMs:1000});
test('header deadline starts after streaming body, not before a long active upload',async()=>{
  const body=new PassThrough();const pending=safeTransport(new URL('https://github.com/ok'),options(body));
  body.write('first');await new Promise(r=>setTimeout(r,120));body.end('second');
  const response=await pending;const chunks=[];for await(const c of response)chunks.push(c);
  expect(Buffer.concat(chunks).toString()).toBe('ok');expect(received).toBe(11);
});
test('header deadline still rejects an upstream that stalls after upload',async()=>{
  const body=new PassThrough();const pending=safeTransport(new URL('https://github.com/late'),options(body));body.end('data');
  await expect(pending).rejects.toMatchObject({status:504,code:'UPSTREAM_TIMEOUT'});
});
test('upload stream failure is handled and destroys outgoing request',async()=>{
  const body=new PassThrough();const pending=safeTransport(new URL('https://github.com/ok'),options(body));const error=new Error('fixture upload failure');
  setImmediate(()=>body.destroy(error));await expect(pending).rejects.toThrow('fixture upload failure');
});
