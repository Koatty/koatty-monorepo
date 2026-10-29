import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const base = (process.env.MIRROR_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/,'');
const run = promisify(execFile);
const execute = (command,args,options) => run(command,command === 'git' ? ['-c','http.version=HTTP/1.1',...args] : args,options);
const options = {timeout:60000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_GLOBAL:os.devNull,GIT_CONFIG_NOSYSTEM:'1'}};
const temp=await mkdtemp(path.join(os.tmpdir(),'mirror-live-'));
const results=[];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let requestId=0;
// curl uses the same working TLS/proxy environment as the VPS deployment probes.
async function get(url,init={}) {
  const id=++requestId, bodyFile=path.join(temp,`body-${id}`), headerFile=path.join(temp,`headers-${id}`);
  const args=['--silent','--show-error','--location','--connect-timeout','10','--retry','1','--retry-delay','1','--max-time','30','--dump-header',headerFile,'--output',bodyFile,'--write-out','%{http_code}'];
  if(init.method==='HEAD') args.push('--head');
  else if(init.method) args.push('--request',init.method);
  for(const [key,value] of Object.entries(init.headers||{})) args.push('--header',key+': '+value);
  if(init.body) args.push('--data',init.body);
  args.push(url);
  const {stdout}=await execute('curl',args,{timeout:70000});
  const status=Number(stdout),headers=new Headers();
  const blocks=(await readFile(headerFile,'utf8')).trim().split(/\r?\n\r?\n/);
  for(const line of blocks.at(-1).split(/\r?\n/).slice(1)){const at=line.indexOf(':');if(at>0)headers.append(line.slice(0,at),line.slice(at+1).trim());}
  const bytes=init.method==='HEAD'||[204,304].includes(status)?null:await readFile(bodyFile);
  return new Response(bytes,{status,headers});
}
const mirror=url=>base+'/'+url.replace(/^https:\/\//,'');
async function check(name, run) {
  if(process.env.MIRROR_CHECK_FILTER && !name.includes(process.env.MIRROR_CHECK_FILTER)) return;
  try {const detail=await run();results.push({name,ok:true,...detail});console.log('PASS '+name,JSON.stringify(detail||{}));}
  catch(error){results.push({name,ok:false,error:error.message});console.error('FAIL '+name+': '+error.message);}
}
async function equalDownload(url, localPath) {
  const direct=await get(url),proxy=await get(localPath||mirror(url));
  assert.equal(direct.status,200,'direct HTTP');assert.equal(proxy.status,200,'mirror HTTP');
  const expected=Buffer.from(await direct.arrayBuffer()),actual=Buffer.from(await proxy.arrayBuffer());
  assert.ok(expected.length>0);assert.deepEqual(actual,expected);
  assert.match(proxy.headers.get('content-disposition')||'',/attachment/);
  return {bytes:actual.length,sha256:sha(actual)};
}
const raw='https://raw.githubusercontent.com/octocat/Hello-World/master/README';
const release='https://github.com/jqlang/jq/releases/download/jq-1.7.1/sha256sum.txt';
try {
  await check('health',async()=>{const r=await get(base+'/healthz');assert.equal(r.status,200);assert.equal((await r.json()).status,'ok');});
  await check('Git clone/fetch/pull (real GitHub)',async()=>{
    const repo='https://github.com/octocat/Hello-World.git',clone=path.join(temp,'clone');
    const refs=await get(repo+'/info/refs?service=git-upload-pack');assert.equal(refs.status,200);
    const head=Buffer.from(await refs.arrayBuffer()).toString().match(/([a-f0-9]{40}) HEAD(?:\0|\n)/);assert.ok(head,'upstream HEAD advertisement');
    const direct={stdout:head[1]+'\tHEAD\n'};
    const proxy=await execute('git',['ls-remote',mirror(repo),'HEAD'],options);assert.equal(proxy.stdout,direct.stdout);
    await execute('git',['-c','protocol.version=2','clone','--depth=1',mirror(repo),clone],options);
    await execute('git',['-C',clone,'fetch','origin'],options);
    await execute('git',['-C',clone,'pull','--ff-only'],options);
    const legacy=await execute('git',['-c','protocol.version=0','ls-remote',mirror(repo),'HEAD'],options);assert.equal(legacy.stdout,direct.stdout);
    assert.ok((await readFile(path.join(clone,'README'))).length);
    return {head:direct.stdout.trim().split(/\s/)[0],protocols:[0,2],note:'Incremental changes verified separately by local git-http-backend regression.'};
  });
  await check('Raw file bytes',()=>equalDownload(raw));
  await check('GitHub blob conversion bytes',()=>equalDownload(raw,mirror('https://github.com/octocat/Hello-World/blob/master/README')));
  await check('GitHub raw conversion bytes',()=>equalDownload(raw,mirror('https://github.com/octocat/Hello-World/raw/master/README')));
  for(const ext of ['zip','tar.gz']) await check('Source archive '+ext,async()=>{
    const url=`https://github.com/octocat/Hello-World/archive/refs/heads/master.${ext}`;
    const proof=await equalDownload(url);const response=await get(mirror(url));const filename=path.join(temp,'source.'+ext);await writeFile(filename,Buffer.from(await response.arrayBuffer()));
    const listing=ext==='zip'?await execute('unzip',['-t',filename],options):await execute('tar',['-tzf',filename],options);assert.match(listing.stdout,/README/);return proof;
  });
  await check('Codeload direct archive',()=>equalDownload('https://codeload.github.com/octocat/Hello-World/zip/refs/heads/master'));
  await check('Release attachment bytes and redirects',()=>equalDownload(release));
  await check('Release latest attachment',()=>equalDownload('https://github.com/jqlang/jq/releases/latest/download/sha256sum.txt'));
  await check('Release list selection and actual attachment download',async()=>{
    const r=await get(base+'/api/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'https://github.com/richenlin/HuashanAICode-releases/releases'})});
    assert.equal(r.status,200,'release listing HTTP');const data=await r.json();assert.equal(data.kind,'releases');assert.ok(data.releases.length);
    const asset=data.releases.flatMap(r=>r.assets).find(a=>a.name.endsWith('.sha256'));assert.ok(asset,'checksum asset');
    const proof=await equalDownload(asset.source,base+asset.path);return {releases:data.releases.length,asset:asset.name,...proof};
  });
  await check('Direct browser Release page',async()=>{
    const r=await get(base+'/github.com/richenlin/HuashanAICode-releases/releases');assert.equal(r.status,200);assert.match(r.headers.get('content-type')||'',/text\/html/);
    const html=await r.text();assert.match(html,/Release 附件/);assert.match(html,/href="\/github\.com\/richenlin\/HuashanAICode-releases\/releases\/download\//);assert.equal(r.headers.get('cache-control'),'no-store');
    const root=await get(base+'/github.com/richenlin/HuashanAICode-releases.git');assert.equal(root.status,405);assert.doesNotMatch(root.headers.get('content-type')||'',/text\/html/);
  });
  await check('Release HEAD and Range resume',async()=>{
    const complete=await get(mirror(release));assert.equal(complete.status,200);const bytes=Buffer.from(await complete.arrayBuffer());
    const head=await get(mirror(release),{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
    const range=await get(mirror(release),{headers:{Range:'bytes=10-29'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),`bytes 10-29/${bytes.length}`);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(10,30));
    return {range:'bytes=10-29',status:206};
  });
  await check('Raw conditional request',async()=>{
    const r=await get(mirror(raw));assert.equal(r.status,200);await r.arrayBuffer();const etag=r.headers.get('etag');assert.ok(etag);
    const cached=await get(mirror(raw),{headers:{'If-None-Match':etag}});assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);
  });
  await check('Link conversion API: Git / release / zip / tar / raw / blob',async()=>{
    const inputs=['https://github.com/octocat/Hello-World.git',release,'https://github.com/octocat/Hello-World/archive/refs/heads/master.zip','https://github.com/octocat/Hello-World/archive/refs/heads/master.tar.gz',raw,'https://github.com/octocat/Hello-World/blob/master/README'];
    for(const url of inputs){const r=await get(base+'/api/links',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});assert.equal(r.status,200,url);const d=await r.json();assert.equal(d.kind,url.endsWith('.git')?'git':'file');assert.ok(d.path.startsWith('/'));}
  });
  await check('Reject unsupported host and unknown Git service',async()=>{
    assert.equal((await get(base+'/example.com/file')).status,403);
    assert.equal((await get(base+'/github.com/octocat/Hello-World.git/info/refs?service=git-delete-pack')).status,403);
  });
} finally {
  await rm(temp,{recursive:true,force:true});
  const report={base,at:new Date().toISOString(),passed:results.filter(r=>r.ok).length,total:results.length,results};
  if(process.env.MIRROR_REPORT_PATH) await writeFile(process.env.MIRROR_REPORT_PATH,JSON.stringify(report,null,2)+'\n');
  console.log(`LIVE_GITHUB_RESULT ${report.passed}/${report.total} ${base}`);
  if(report.passed!==report.total) process.exitCode=1;
}
