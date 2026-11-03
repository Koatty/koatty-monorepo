const { Readable } = require('node:stream');
const { ReleaseService } = require('../../dist/service/ReleaseService');
const release = {tag_name:'v1',name:'Version 1',assets:[{state:'uploaded',name:'app.zip',size:123,browser_download_url:'https://github.com/a/b/releases/download/v1/app.zip'}]};
const reply = (status, body) => Object.assign(Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]),{statusCode:status});
const setup = (status=200, body=[release]) => { const service = new ReleaseService(); service.transport = jest.fn(async url=>url.pathname.endsWith('/latest')?reply(404,{}):reply(status,body)); return service; };

test('Latest follows GitHub designation, not ordering, tag comparison or prerelease',async()=>{
  const designated={...release,id:2,tag_name:'v1.0'};
  const items=[{...release,id:1,tag_name:'v9-beta',prerelease:true},{...release,id:3,tag_name:'v8'},designated];
  const service=setup();service.transport=jest.fn(async url=>reply(200,url.pathname.endsWith('/latest')?designated:items));
  const result=await service.resolve('https://github.com/a/b/releases');
  expect(result.releases.map(r=>r.latest)).toEqual([false,false,true]);
  await service.resolve('https://github.com/a/b/releases');expect(service.transport).toHaveBeenCalledTimes(2);
});
test('designated Latest outside the first page is included within the 20 item bound',async()=>{
  const designated={...release,id:99,tag_name:'stable'};
  const items=Array.from({length:20},(_,i)=>({...release,id:i+1,tag_name:'v'+i}));
  const service=setup();service.transport=async url=>reply(200,url.pathname.endsWith('/latest')?designated:items);
  const result=await service.resolve('https://github.com/a/b/releases');
  expect(result.releases).toHaveLength(20);expect(result.releases[0]).toMatchObject({tag:'stable',latest:true});
});
test.each([404,403,429,500])('Latest endpoint %s keeps listing available without guessing',async status=>{
  const service=setup();service.transport=async url=>url.pathname.endsWith('/latest')?reply(status,{}):reply(200,[{...release,id:1}]);
  const result=await service.resolve('https://github.com/a/b/releases');expect(result.releases[0].latest).toBe(false);
});
test('invalid, draft, prerelease and oversized latest responses never create a badge',async()=>{
  for(const body of ['invalid',{...release,id:1,draft:true},{...release,id:1,prerelease:true},{...release,id:99,assets:[{...release.assets[0],browser_download_url:'https://evil.test/x'}]},'x'.repeat(4*1024*1024+1)]) {
    const service=setup();service.transport=async url=>reply(200,url.pathname.endsWith('/latest')?body:[{...release,id:1}]);
    expect((await service.resolve('https://github.com/a/b/releases')).releases[0].latest).toBe(false);
  }
});

test('lists uploaded assets and produces validated mirror paths with caching and deduplication',async()=>{
  const service=setup();
  const [a,b]=await Promise.all([service.resolve('https://github.com/a/b/releases'),service.resolve('github.com/a/b/releases/')]);
  expect(a).toEqual(b);expect(a).toMatchObject({kind:'releases',limit:20,releases:[{tag:'v1',assets:[{path:'/github.com/a/b/releases/download/v1/app.zip',name:'app.zip'}]}]});
  await service.resolve('https://github.com/a/b/releases');expect(service.transport).toHaveBeenCalledTimes(2);
  const [url,options]=service.transport.mock.calls[0];expect(url.href).toBe('https://api.github.com/repos/a/b/releases?per_page=20');expect(options.headers.Authorization).toBeUndefined();
});
test.each(['https://evil.test/a/b/releases','https://github.com@127.0.0.1/a/b/releases','https://github.com/a/../releases','https://github.com/a/b/releases?x=1','https://github.com/a/b/releases/download/v1/app.zip','https://github.com/a/b/releases#x'])('does not resolve unsupported page %s',async value=>{
  const service=setup();expect(await service.resolve(value)).toBeUndefined();expect(service.transport).not.toHaveBeenCalled();
});
test.each([[404,'RELEASE_NOT_FOUND'],[403,'GITHUB_API_LIMIT'],[429,'GITHUB_API_LIMIT'],[302,'RELEASE_UPSTREAM'],[500,'RELEASE_UPSTREAM']])('maps upstream %s safely and does not cache failures',async(status,code)=>{
  const service=setup(status,'private debug');await expect(service.resolve('https://github.com/a/b/releases')).rejects.toMatchObject({code});await expect(service.resolve('https://github.com/a/b/releases')).rejects.toMatchObject({code});expect(service.transport).toHaveBeenCalledTimes(2);
});
test('empty release lists and versions without assets are supported',async()=>{
  expect((await setup(200,[]).resolve('https://github.com/a/b/releases')).releases).toEqual([]);
  expect((await setup(200,[{...release,assets:[]}]).resolve('https://github.com/a/b/releases')).releases[0].assets).toEqual([]);
});
test.each(['https://evil.test/app.zip','https://github.com/other/repo/releases/download/v1/app.zip','https://raw.githubusercontent.com/a/b/main/app.zip'])('rejects untrusted asset %s',async url=>{
  const service=setup(200,[{...release,assets:[{...release.assets[0],browser_download_url:url}]}]);await expect(service.resolve('https://github.com/a/b/releases')).rejects.toThrow();
});
test('bounds response bytes and rejects invalid JSON',async()=>{
  await expect(setup(200,'x'.repeat(4*1024*1024+1)).resolve('https://github.com/a/b/releases')).rejects.toMatchObject({code:'RELEASE_TOO_LARGE'});
  await expect(setup(200,'invalid').resolve('https://github.com/a/b/releases')).rejects.toMatchObject({code:'RELEASE_UNAVAILABLE'});
});
test('bounds concurrent upstream lookups and releases slots after network errors',async()=>{
  const service=setup();const rejects=[];
  service.transport=jest.fn(()=>new Promise((_,fail)=>{rejects.push(fail);}));
  const tasks=Array.from({length:4},(_,i)=>service.resolve(`https://github.com/a/b${i}/releases`).catch(e=>e));
  await expect(service.resolve('https://github.com/a/b4/releases')).rejects.toMatchObject({code:'RELEASE_BUSY'});
  rejects[3](new Error('network'));await tasks[3];service.transport=jest.fn(async()=>reply(200,[]));
  await expect(service.resolve('https://github.com/a/b4/releases')).resolves.toMatchObject({kind:'releases'});
  // Settle remaining test-only transports, which intentionally don't consume AbortSignal.
  rejects.slice(0,3).forEach(fail=>fail(new Error('network')));await Promise.all(tasks);
});
