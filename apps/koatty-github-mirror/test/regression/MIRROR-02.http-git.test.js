const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const git = (...args) => promisify(execFile)('git',args,{timeout:30000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull}});
const { Koatty } = require('koatty');
const { createTestApp } = require('koatty_testing');
const { ProxyService } = require('../../dist/service/ProxyService');
const { LinkService } = require('../../dist/service/LinkService');
const { defaults } = require('../../dist/utils/settings');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { randomBytes } = require('node:crypto');
const auth = 'Basic '+Buffer.from('mirror-test:fixture-only').toString('base64');
let requireReadAuth=false;
let streamedBytes=0,streamedClosed=false;
const credentialArgs=['-c', 'credential.helper=!f() { echo username=mirror-test; echo password=fixture-only; }; f', '-c', 'credential.useHttpPath=true'];
const { gzipSync } = require('node:zlib');

class TestApp extends Koatty { init() { this.rootPath = process.cwd(); this.appPath = path.join(process.cwd(),'dist'); this.silent = true; } }
const listen = server => new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const close = server => new Promise(resolve => server.close(resolve));
let fixture, server, upstream, origin, temp, bare, working;
let requests = [], slowClosed = false;
const content = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');

beforeAll(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(),'koatty-mirror-test-')); working = path.join(temp,'working'); bare = path.join(temp,'demo.git');
  await git('init','--initial-branch=main',working); await git('-C',working,'config','user.name','Mirror Test'); await git('-C',working,'config','user.email','mirror@example.invalid');
  await fs.writeFile(path.join(working,'README.md'),'first\n'); await git('-C',working,'add','.'); await git('-C',working,'commit','-m','first'); await git('clone','--bare',working,bare);await git('-C',bare,'config','http.receivepack','true');
  upstream = http.createServer((req,res) => {
    requests.push({url:req.url,headers:req.headers});
    if(req.url.startsWith('/owner/redirect.git/')){res.writeHead(307,{Location:'https://github.com/other/repo.git/git-receive-pack'});res.end();return;}
    if(req.url==='/owner/stream.git/git-receive-pack'){req.on('data',chunk=>{streamedBytes+=chunk.length;});req.on('end',()=>{res.writeHead(200,{'Content-Type':'application/x-git-receive-pack-result'});res.end('0000');});req.on('close',()=>{streamedClosed=true;});return;}
    if (req.url === '/owner/encoded.git/git-upload-pack') {
      const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{requests.at(-1).body=Buffer.concat(chunks);res.writeHead(200,{'Content-Type':'application/x-git-upload-pack-result'});res.end('0000');});return;
    }
    if (req.url.includes('/demo.git/')) {
      if ((req.url.includes('git-receive-pack') || requireReadAuth) && req.headers.authorization !== auth) {res.writeHead(401,{'WWW-Authenticate':'Basic realm="fixture"'});res.end('private auth debug');return;}
      const url = new URL(req.url,'http://fixture');
      const cgi = spawn('git',['http-backend'],{env:{...process.env,GIT_PROJECT_ROOT:temp,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:url.pathname.replace('/owner',''),REQUEST_METHOD:req.method,QUERY_STRING:url.search.slice(1),CONTENT_TYPE:req.headers['content-type'] || '',CONTENT_LENGTH:req.headers['content-length'] || '',HTTP_GIT_PROTOCOL:req.headers['git-protocol'] || '',REMOTE_USER:'mirror-test',REMOTE_ADDR:'127.0.0.1'}});
      let buffered = Buffer.alloc(0), headersSent = false;
      cgi.stdout.on('data',chunk => {
        if (headersSent) { res.write(chunk); return; }
        buffered = Buffer.concat([buffered,chunk]); const separator = buffered.indexOf('\r\n\r\n'); if(separator < 0) return;
        const headers = buffered.subarray(0,separator).toString().split('\r\n');
        for(const header of headers) { const at = header.indexOf(':'); const name = header.slice(0,at); const value = header.slice(at+1).trim(); if(name.toLowerCase() === 'status') res.statusCode = Number(value.split(' ')[0]); else res.setHeader(name,value); }
        headersSent=true; res.write(buffered.subarray(separator+4));
      });
      cgi.stdout.once('end',() => res.end()); cgi.stderr.resume(); req.pipe(cgi.stdin); cgi.stdin.on('error',()=>{}); res.once('close',()=>cgi.kill()); return;
    }
    const name = req.url.split('?')[0].split('/').pop();
    if (name === 'redirect') { res.writeHead(302,{location:'https://release-assets.githubusercontent.com/asset/file'}); res.end(); return; }
    if (name === 'unsafe') { res.writeHead(302,{location:'http://127.0.0.1/private'}); res.end(); return; }
    if (name === 'loop') { res.writeHead(302,{location:'https://raw.githubusercontent.com/a/b/main/loop'}); res.end(); return; }
    if (name === 'missing') { res.writeHead(404); res.end('private upstream debug'); return; }
    if (name === 'slow') { res.writeHead(200); res.write('first'); const tick = setInterval(()=>res.write('chunk'),20); res.once('close',()=>{clearInterval(tick);slowClosed=true;}); return; }
    if (name === 'hang') { res.once('close',()=>{}); return; }
    res.setHeader('ETag','"fixture"'); res.setHeader('Accept-Ranges','bytes'); res.setHeader('Set-Cookie','must-not-leak=1');
    if(req.headers['if-none-match'] === '"fixture"') {res.writeHead(304);res.end();return;}
    if(req.headers.range) {const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range); if(!match || Number(match[1])>=content.length) {res.writeHead(416,{'Content-Range':`bytes */${content.length}`,'Content-Length':'5'});res.end('error');return;} const start=Number(match[1]),end=match[2]?Number(match[2]):content.length-1;const bytes=content.subarray(start,end+1);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${content.length}`,'Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);return;}
    res.setHeader('Content-Length',content.length); res.end(req.method==='HEAD'?undefined:content);
  });
  await listen(upstream);
  // Real local TCP upstream with real git-http-backend; production policy still runs.
},30000);

afterAll(async () => { if(server) await close(server); await fixture?.stop(); upstream?.closeAllConnections(); if(upstream) await close(upstream); await fs.rm(temp,{recursive:true,force:true}); });

test('boot full Koatty, inject services, serve UI, health and validated link API',async () => {
  fixture = await createTestApp(TestApp);
  const service = fixture.app.container.get('ProxyService','SERVICE');
  expect(service).toBeInstanceOf(ProxyService);
  service.transport = (url,options) => new Promise((resolve,reject) => {
    const req = http.request({hostname:'127.0.0.1',port:upstream.address().port,path:url.pathname+url.search,method:options.method,headers:options.headers,signal:options.signal},resolve);
    const timer=setTimeout(()=>req.destroy(new Error('timeout')),options.headerTimeoutMs);req.once('response',()=>clearTimeout(timer));req.once('error',error=>{clearTimeout(timer);reject(error);});if(options.body instanceof Readable) pipeline(options.body,req).catch(reject);else req.end(options.body);
  });
  server = http.createServer(fixture.app.callback()); await listen(server); origin = 'http://127.0.0.1:'+server.address().port;
  const homepage = await fetch(origin); expect(homepage.status).toBe(200); expect(await homepage.text()).toContain('Git 版本控制');
  expect((await fetch(origin+'/healthz').then(r=>r.json())).status).toBe('ok');
  const spy=jest.spyOn(LinkService.prototype,'create');
  const valid=await fetch(origin+'/api/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://github.com/a/b.git'})});
  expect(valid.status).toBe(200); expect(await valid.json()).toMatchObject({kind:'git',path:'/github.com/a/b.git'}); expect(spy).toHaveBeenCalledTimes(1);
  for(const input of [{},{url:42},{url:''},{url:'x'.repeat(4097)}]) {const response=await fetch(origin+'/api/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}); expect(response.status).toBe(400);}
  expect(spy).toHaveBeenCalledTimes(1); spy.mockRestore();
});

test('Git link generation uses configured origin while files stay on the web origin', async () => {
  const post=url=>fetch(origin+'/api/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})}).then(r=>r.json());
  fixture.app.config(undefined,'link',{gitOrigin:'https://git.koatty.org'});
  try {
    expect(await post('https://github.com/Koatty/koatty.git')).toMatchObject({kind:'git',baseUrl:'https://git.koatty.org',path:'/github.com/Koatty/koatty.git'});
    expect(await fetch(origin).then(r=>r.text())).toContain('data-git-origin="https://git.koatty.org"');
    const file=await post('https://raw.githubusercontent.com/Koatty/koatty/master/README.md');
    expect(file.kind).toBe('file'); expect(file.baseUrl).toBeUndefined();
  } finally { fixture.app.config(undefined,'link',{gitOrigin:''}); }
  expect((await post('https://github.com/Koatty/koatty.git')).baseUrl).toBeUndefined();
});

test('real git clone, protocol v2, incremental fetch/pull and protocol v0',async () => {
  const clone=path.join(temp,'clone'); await git('-c','protocol.version=2','clone',origin+'/github.com/owner/demo.git',clone);
  expect(await fs.readFile(path.join(clone,'README.md'),'utf8')).toBe('first\n');
  expect(requests.some(r=>r.url.endsWith('/git-upload-pack') && r.headers['git-protocol']==='version=2')).toBe(true);
  await fs.writeFile(path.join(working,'README.md'),'second\n'); await git('-C',working,'add','.'); await git('-C',working,'commit','-m','second'); await git('-C',working,'push',bare,'main');
  await git('-C',clone,'fetch','origin'); await git('-C',clone,'pull','--ff-only');
  expect(await fs.readFile(path.join(clone,'README.md'),'utf8')).toBe('second\n');
  const remote=await git('-c','protocol.version=0','ls-remote',origin+'/github.com/owner/demo.git'); expect(remote.stdout).toContain('refs/heads/main');
},30000);

test('file bytes, range resume, HEAD, conditional requests and sanitized headers',async () => {
  const url=origin+'/raw.githubusercontent.com/a/b/main/file';
  const full=await fetch(url,{headers:{Authorization:'Bearer not-forwarded',Cookie:'private=1'}}); expect(full.status).toBe(200);expect(Buffer.from(await full.arrayBuffer())).toEqual(content);expect(full.headers.get('set-cookie')).toBeNull();expect(full.headers.get('content-disposition')).toContain('attachment');
  const last=requests.at(-1);expect(last.headers.authorization).toBeUndefined();expect(last.headers.cookie).toBeUndefined();
  const partial=await fetch(url,{headers:{Range:'bytes=10-'}});expect(partial.status).toBe(206);expect(Buffer.from(await partial.arrayBuffer())).toEqual(content.subarray(10));expect(partial.headers.get('content-range')).toBe('bytes 10-35/36');
  const head=await fetch(url,{method:'HEAD'});expect(head.status).toBe(200);expect(head.headers.get('content-length')).toBe('36');expect(await head.text()).toBe('');
  expect((await fetch(url,{headers:{'If-None-Match':'"fixture"'}})).status).toBe(304);
  const invalid=await fetch(url,{headers:{Range:'bytes=100-'}});expect(invalid.status).toBe(416);expect(invalid.headers.get('content-range')).toBe('bytes */36');expect(await invalid.text()).toBe('');
  expect((await fetch(url,{headers:{Range:'bytes=0-1,3-4'}})).status).toBe(400);
});

test('forwards gzip-compressed Git negotiation byte-for-byte',async () => {
  const body=gzipSync(Buffer.from('0000'));
  const response=await fetch(origin+'/github.com/owner/encoded.git/git-upload-pack',{method:'POST',headers:{'Content-Type':'application/x-git-upload-pack-request','Content-Encoding':'gzip'},body});
  expect(response.status).toBe(200);expect(await response.text()).toBe('0000');expect(requests.at(-1).headers['content-encoding']).toBe('gzip');expect(requests.at(-1).body).toEqual(body);
});

test('follows safe redirects, rejects unsafe redirects/loops and preserves safe 404',async () => {
  const prefix=origin+'/raw.githubusercontent.com/a/b/main/';
  const good=await fetch(prefix+'redirect');expect(good.status).toBe(200);expect(Buffer.from(await good.arrayBuffer())).toEqual(content);
  for(const name of ['unsafe','loop']) expect((await fetch(prefix+name)).status).toBe(502);
  const missing=await fetch(prefix+'missing');expect(missing.status).toBe(404);expect(await missing.text()).not.toContain('private upstream debug');
});

test('rejects unknown Git services, oversized upload-pack and unsupported methods before upstream',async () => {
  const count=requests.length;
  expect((await fetch(origin+'/github.com/a/b.git/info/refs?service=git-delete-pack')).status).toBe(403);
  expect((await fetch(origin+'/github.com/a/b.git/git-delete-pack',{method:'POST'})).status).toBe(403);
  expect((await fetch(origin+'/raw.githubusercontent.com/a/b/main/file',{method:'POST',body:'x'})).status).toBe(405);
  fixture.app.config(undefined,'mirror',{...defaults,maxGitBodyBytes:2});
  expect((await fetch(origin+'/github.com/a/b.git/git-upload-pack',{method:'POST',headers:{'Content-Type':'application/x-git-upload-pack-request'},body:'123'})).status).toBe(413);
  expect(requests.length).toBe(count);fixture.app.config(undefined,'mirror',defaults);
});

test('disconnect cancels upstream and releases concurrency capacity',async () => {
  fixture.app.config(undefined,'mirror',{...defaults,maxConcurrent:1});
  await new Promise((resolve,reject)=>{const req=http.get(origin+'/raw.githubusercontent.com/a/b/main/slow',res=>{res.once('data',()=>{res.destroy();resolve();});});req.once('error',reject);});
  for(let i=0;i<30&&!slowClosed;i++) await new Promise(resolve=>setTimeout(resolve,20));
  expect(slowClosed).toBe(true);
  const response=await fetch(origin+'/raw.githubusercontent.com/a/b/main/file');expect(response.status).toBe(200);await response.arrayBuffer();
  fixture.app.config(undefined,'mirror',defaults);
});

test('header timeout fails safely and subsequent requests recover',async () => {
  fixture.app.config(undefined,'mirror',{...defaults,headerTimeoutMs:50});
  expect((await fetch(origin+'/raw.githubusercontent.com/a/b/main/hang')).status).toBe(502);
  const response=await fetch(origin+'/raw.githubusercontent.com/a/b/main/file');expect(response.status).toBe(200);await response.arrayBuffer();fixture.app.config(undefined,'mirror',defaults);
});


test('Release page resolves through real Koatty injection and returns safe API errors',async()=>{
  const {Readable}=require('node:stream');
  const service=fixture.app.container.get('ReleaseService','SERVICE');
  service.transport=async()=>Object.assign(Readable.from([JSON.stringify([{name:'Release',tag_name:'v1',assets:[{name:'app.zip',size:10,state:'uploaded',browser_download_url:'https://github.com/a/b/releases/download/v1/app.zip'}]}])]),{statusCode:200});
  const post=url=>fetch(origin+'/api/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
  const good=await post('https://github.com/a/b/releases');expect(good.status).toBe(200);expect(await good.json()).toMatchObject({kind:'releases',releases:[{assets:[{path:'/github.com/a/b/releases/download/v1/app.zip'}]}]});
  service.transport=async()=>Object.assign(Readable.from(['private debug']),{statusCode:403});
  const failure=await post('https://github.com/a/other/releases');expect(failure.status).toBe(429);expect(JSON.stringify(await failure.json())).toContain('GitHub');
});

test('homepage versions static assets by content and prevents stale release UI caching',async()=>{
  const {createHash}=require('node:crypto');
  const response=await fetch(origin);expect(response.headers.get('cache-control')).toBe('no-store');
  const html=await response.text();
  for(const name of ['site.js','site.css']){
    const source=await fs.readFile(path.join(process.cwd(),'static',name));
    const hash=createHash('sha256').update(source).digest('hex').slice(0,16);
    const url='/assets/'+name+'?v='+hash;
    expect(html).toContain(url);
    const asset=await fetch(origin+url);expect(asset.status).toBe(200);expect(asset.headers.get('cache-control')).toBe('no-store');expect(Buffer.from(await asset.arrayBuffer())).toEqual(source);
    const legacy=await fetch(origin+'/assets/'+name);expect(legacy.headers.get('cache-control')).toBe('no-store');await legacy.arrayBuffer();
  }
});

test('direct Release page renders download links safely without JavaScript, while .git root stays non-HTML',async()=>{
  const {Readable}=require('node:stream');const service=fixture.app.container.get('ReleaseService','SERVICE');
  const item={id:123,name:'<script>alert(1)</script>',tag_name:'v1',assets:[{state:'uploaded',name:'app<&>.zip',size:36,browser_download_url:'https://github.com/browser/demo/releases/download/v1/app.zip'}]};
  service.transport=async url=>Object.assign(Readable.from([JSON.stringify(url.pathname.endsWith('/latest')?item:[item])]),{statusCode:200});
  const url=origin+'/github.com/browser/demo/releases';
  const response=await fetch(url);expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('text/html');expect(response.headers.get('cache-control')).toBe('no-store');
  const html=await response.text();expect(html).toContain('Latest · 最新版');expect(html).toContain('class="release-latest"');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('app&lt;&amp;&gt;.zip');expect(html).toContain('href="/github.com/browser/demo/releases/download/v1/app.zip"');
  const file=await fetch(origin+'/github.com/browser/demo/releases/download/v1/app.zip');expect(file.status).toBe(200);expect(Buffer.from(await file.arrayBuffer())).toEqual(content);
  const head=await fetch(url,{method:'HEAD'});expect(head.status).toBe(200);expect(await head.text()).toBe('');
  expect((await fetch(url+'/')).status).toBe(200);expect((await fetch(url,{method:'POST'})).status).toBe(405);
  const gitRoot=await fetch(origin+'/github.com/browser/demo.git');expect(gitRoot.status).toBe(405);expect(gitRoot.headers.get('content-type')).not.toContain('text/html');
});

test('direct Release pages render empty and failure states with correct status',async()=>{
  const {Readable}=require('node:stream');const service=fixture.app.container.get('ReleaseService','SERVICE');
  service.transport=async()=>Object.assign(Readable.from(['[]']),{statusCode:200});
  const empty=await fetch(origin+'/github.com/browser/empty/releases');expect(empty.status).toBe(200);expect(await empty.text()).toContain('暂时没有公开发布的版本');
  service.transport=async()=>Object.assign(Readable.from(['private debug']),{statusCode:404});
  const missing=await fetch(origin+'/github.com/browser/missing/releases');expect(missing.status).toBe(404);expect(missing.headers.get('content-type')).toContain('text/html');const body=await missing.text();expect(body).toContain('未找到公开仓库');expect(body).not.toContain('private debug');
});


test('real authenticated Git pushes commits, branches, tags and deletions; rejects stale lease/non-fast-forward',async()=>{
  const clone=path.join(temp,'clone'),url=origin+'/github.com/owner/demo.git';
  await git('-C',clone,'config','user.name','Mirror Test');await git('-C',clone,'config','user.email','mirror@example.invalid');
  await fs.writeFile(path.join(clone,'pushed.txt'),'pushed through mirror');await git('-C',clone,'add','.');await git('-C',clone,'commit','-m','mirror push');
  const before=requests.length;
  await git(...credentialArgs,'-C',clone,'push','origin','main');
  const head=(await git('-C',clone,'rev-parse','HEAD')).stdout.trim();expect((await git('-C',bare,'rev-parse','main')).stdout.trim()).toBe(head);
  expect(requests.slice(before).some(r=>r.url.includes('git-receive-pack')&&!r.headers.authorization)).toBe(true);
  expect(requests.slice(before).some(r=>r.url.endsWith('/git-receive-pack')&&r.headers.authorization===auth)).toBe(true);
  await git(...credentialArgs,'-C',clone,'push','origin','HEAD:refs/heads/mirror-feature');
  await git('-C',clone,'tag','mirror-v1');await git(...credentialArgs,'-C',clone,'push','origin','refs/tags/mirror-v1');
  expect((await git('-C',bare,'rev-parse','mirror-feature')).stdout.trim()).toBe(head);expect((await git('-C',bare,'rev-parse','mirror-v1')).stdout.trim()).toBe(head);
  await expect(git(...credentialArgs,'-C',working,'push',url,'main')).rejects.toThrow();
  await expect(git(...credentialArgs,'-C',working,'push','--force-with-lease=main:'+ '0'.repeat(40),url,'main')).rejects.toThrow();
  expect((await git('-C',bare,'rev-parse','main')).stdout.trim()).toBe(head);
  await git(...credentialArgs,'-C',clone,'push','--force-with-lease=refs/heads/mirror-feature:'+head,'origin','HEAD~1:refs/heads/mirror-feature');
  expect((await git('-C',bare,'rev-parse','mirror-feature')).stdout.trim()).toBe((await git('-C',clone,'rev-parse','HEAD~1')).stdout.trim());
  await git(...credentialArgs,'-C',clone,'push','--delete','origin','mirror-feature');await git(...credentialArgs,'-C',clone,'push','origin',':refs/tags/mirror-v1');
  await expect(git('-C',bare,'rev-parse','--verify','refs/heads/mirror-feature')).rejects.toThrow();await expect(git('-C',bare,'rev-parse','--verify','refs/tags/mirror-v1')).rejects.toThrow();
},30000);

test('authenticated clone supports upstream-controlled private repository access',async()=>{
  requireReadAuth=true;
  try {await git(...credentialArgs,'clone',origin+'/github.com/owner/demo.git',path.join(temp,'private-clone'));expect(await fs.readFile(path.join(temp,'private-clone','pushed.txt'),'utf8')).toBe('pushed through mirror');}
  finally {requireReadAuth=false;}
});

test('push streams a pack larger than read-request limit with chunked HTTP and backpressure',async()=>{
  const clone=path.join(temp,'clone');
  fixture.app.config(undefined,'mirror',{...defaults,maxGitBodyBytes:1024,maxGitPushBodyBytes:12*1024*1024});
  try {
    const bytes=randomBytes(9*1024*1024);await fs.writeFile(path.join(clone,'large.bin'),bytes);await git('-C',clone,'add','.');await git('-C',clone,'commit','-m','large streamed push');
    await git(...credentialArgs,'-c','http.postBuffer=1024','-C',clone,'push','origin','main');
    const result=await promisify(execFile)('git',['-C',bare,'show','main:large.bin'],{encoding:'buffer',maxBuffer:12*1024*1024});expect(result.stdout.equals(bytes)).toBe(true);
    expect(requests.some(r=>r.url.endsWith('/git-receive-pack')&&r.headers['transfer-encoding']==='chunked')).toBe(true);
  } finally {fixture.app.config(undefined,'mirror',defaults);}
},30000);

test('401 challenges survive and denied pushes cannot mutate refs',async()=>{
  const head=(await git('-C',bare,'rev-parse','main')).stdout;
  const response=await fetch(origin+'/github.com/owner/demo.git/info/refs?service=git-receive-pack');expect(response.status).toBe(401);expect(response.headers.get('www-authenticate')).toContain('Basic');expect(await response.text()).not.toContain('private auth debug');
  const bad=await fetch(origin+'/github.com/owner/demo.git/git-receive-pack',{method:'POST',headers:{'Content-Type':'application/x-git-receive-pack-request',Authorization:'Basic aW52YWxpZDppbnZhbGlk'},body:'0000'});expect(bad.status).toBe(401);expect((await git('-C',bare,'rev-parse','main')).stdout).toBe(head);
});


test('push uploads reach upstream before EOF and enforce both declared and chunked limits',async()=>{
  const url=origin+'/github.com/owner/stream.git/git-receive-pack';streamedBytes=0;
  fixture.app.config(undefined,'mirror',{...defaults,maxGitPushBodyBytes:32});
  try {
    await new Promise((resolve,reject)=>{
      const req=http.request(url,{method:'POST',headers:{'Content-Type':'application/x-git-receive-pack-request'}},res=>{const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>{try{expect(res.statusCode).toBe(200);resolve();}catch(e){reject(e);}});});req.on('error',reject);
      req.write(Buffer.alloc(16));
      (async()=>{for(let i=0;i<50&&!streamedBytes;i++)await new Promise(r=>setTimeout(r,10));expect(streamedBytes).toBe(16);req.end(Buffer.alloc(8));})().catch(e=>{req.destroy();reject(e);});
    });
    const before=requests.length;
    expect((await fetch(url,{method:'POST',headers:{'Content-Type':'application/x-git-receive-pack-request'},body:Buffer.alloc(33)})).status).toBe(413);expect(requests.length).toBe(before);
    const chunked=await new Promise((resolve,reject)=>{const req=http.request(url,{method:'POST',headers:{'Content-Type':'application/x-git-receive-pack-request'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(Buffer.alloc(16));req.end(Buffer.alloc(17));});expect(chunked).toBe(413);
  } finally {fixture.app.config(undefined,'mirror',defaults);}
});

test('push disconnect releases its slot and never replays an authenticated or POST redirect',async()=>{
  streamedClosed=false;streamedBytes=0;fixture.app.config(undefined,'mirror',{...defaults,maxConcurrent:1});
  try{
    const req=http.request(origin+'/github.com/owner/stream.git/git-receive-pack',{method:'POST',headers:{'Content-Type':'application/x-git-receive-pack-request'}});req.on('error',()=>{});req.write(Buffer.alloc(128));
    for(let i=0;i<50&&!streamedBytes;i++)await new Promise(r=>setTimeout(r,10));req.destroy();
    for(let i=0;i<50&&!streamedClosed;i++)await new Promise(r=>setTimeout(r,10));expect(streamedClosed).toBe(true);
    const before=requests.length;
    const redirected=await fetch(origin+'/github.com/owner/redirect.git/git-receive-pack',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/x-git-receive-pack-request'},body:'0000'});expect(redirected.status).toBe(502);expect(requests.length).toBe(before+1);
    const discovery=await fetch(origin+'/github.com/owner/redirect.git/info/refs?service=git-upload-pack',{headers:{Authorization:auth}});expect(discovery.status).toBe(502);expect(requests.length).toBe(before+2);
    const file=await fetch(origin+'/raw.githubusercontent.com/a/b/main/file',{headers:{Authorization:auth}});expect(file.status).toBe(200);await file.arrayBuffer();expect(requests.at(-1).headers.authorization).toBeUndefined();
  }finally{fixture.app.config(undefined,'mirror',defaults);}
});


test('upstream hooks reject protected refs and preserve atomic push failure',async()=>{
  const hook=path.join(bare,'hooks','pre-receive');
  await fs.writeFile(hook,'#!/bin/sh\nwhile read old new ref; do\n  if [ "$ref" = "refs/heads/protected-fixture" ]; then echo "fixture protected branch" >&2; exit 1; fi\ndone\n');await fs.chmod(hook,0o755);
  try {
    await expect(git(...credentialArgs,'-C',path.join(temp,'clone'),'push','--atomic','origin','HEAD:refs/heads/atomic-ok','HEAD:refs/heads/protected-fixture')).rejects.toThrow('fixture protected branch');
    await expect(git('-C',bare,'rev-parse','--verify','refs/heads/atomic-ok')).rejects.toThrow();await expect(git('-C',bare,'rev-parse','--verify','refs/heads/protected-fixture')).rejects.toThrow();
  } finally {await fs.rm(hook);}
});


test('Git 401 explicitly explains PAT in the realm and message for pull and push',async()=>{
  requireReadAuth=true;
  try {
    for(const service of ['git-upload-pack','git-receive-pack']){
      const r=await fetch(origin+'/github.com/owner/demo.git/info/refs?service='+service);
      expect(r.status).toBe(401);expect(r.headers.get('www-authenticate')).toMatch(/^Basic realm=".*Personal Access Token.*not your account password"$/);
      expect(r.headers.get('cache-control')).toBe('no-store');
      const body=await r.json();expect(body.error.code).toBe('GITHUB_AUTH_REQUIRED');expect(body.error.message).toContain('密码框填写 Personal Access Token');expect(body.error.message).toContain('不是 GitHub 账号密码');
    }
  } finally {requireReadAuth=false;}
});
