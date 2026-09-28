// Execute TypeScript's actual Legacy and TC39 decorator emit. Only the lock backend
// and cache storage are adapters; decorator context/initializers are not mocked.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = process.cwd();
require('ts-node').register({ transpileOnly: true, skipProject: true, compilerOptions: {
  module: 'commonjs', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true, esModuleInterop: true
}});
const ts = require('typescript');
const packageRequire = createRequire(path.join(root, 'packages/koatty-schedule/package.json'));
const { IOC } = packageRequire('koatty_container');
const { RedLock } = require('../../packages/koatty-schedule/src/decorator/redlock.ts');
const { RedLocker } = require('../../packages/koatty-schedule/src/locker/redlock.ts');
const { CacheAble } = require('../../packages/koatty-cacheable/src/cache.ts');
const store = require('../../packages/koatty-cacheable/src/store.ts');
const { Container, PostConstruct, PreDestroy } = require('../../packages/koatty-container/src/index.ts');
const originalBackend = RedLocker.getInstance;
const originalStore = store.GetCacheStore;
const cache = new Map();
const adapter = { get: async key => cache.get(key), set: async (key, value) => cache.set(key, value) };
let leasesFinished = 0;
RedLocker.getInstance = () => ({ using: async (_keys, _ttl, _threshold, handler) => {
  try { return await handler(new AbortController().signal); } finally { leasesFinished++; }
}});
store.GetCacheStore = async () => adapter;
(async () => {
  try {
    for (const legacy of [true, false]) {
      const source = `
        export class MatrixService {
          initialized = 0; destroyed = 0; loads = 0; calls = 0; aborted = false;
          @PostConstruct() async init() { await Promise.resolve(); this.initialized++; }
          @PreDestroy() async dispose() { this.destroyed++; }
          @CacheAble('matrix-${legacy}', {params: ['key']})
          async load(key: string) { this.loads++; await new Promise(r=>setTimeout(r,5)); return '123'; }
          @RedLock('matrix-lock', {lockTimeOut:1000,maxHoldTime:10})
          async work({signal}: any) { this.calls++; await new Promise(r=>signal.addEventListener('abort',r,{once:true})); this.aborted=signal.aborted; }
        }`;
      const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS, experimentalDecorators: legacy, emitDecoratorMetadata: legacy } });
      // Legacy validates type when applying methods; TC39 validates in the instance initializer.
      // Register the class through the real IOC metadata rather than mocking createDecorator.
      const originalType = IOC.getType;
      IOC.getType = () => 'SERVICE';
      const exports = {};
      let Service;
      try {
        new Function('exports','RedLock','CacheAble','PostConstruct','PreDestroy',compiled.outputText)(exports,RedLock,CacheAble,PostConstruct,PreDestroy);
        Service=exports.MatrixService;
        IOC.saveClass('SERVICE',Service,'MatrixService');
        const container=new Container(); container.reg('MatrixService',Service);
        await container.ready(); const service=container.get('MatrixService');
        assert.equal(service.initialized,1);
        assert.deepEqual(await Promise.all(Array.from({length:8},()=>service.load('key'))),Array(8).fill('123'));
        assert.equal(await service.load('key'),'123'); assert.equal(service.loads,1);
        await assert.rejects(service.work(),/exceeded maxHoldTime/);
        await new Promise(r=>setImmediate(r));
        assert.equal(service.calls,1);assert.equal(service.aborted,true);
        await container.clear();assert.equal(service.destroyed,1);
        console.log('DECORATOR_MATRIX_PASS',legacy?'legacy':'tc39');
      } finally { IOC.getType=originalType; }
    }
    assert.equal(leasesFinished,2);
  } finally { RedLocker.getInstance=originalBackend;store.GetCacheStore=originalStore; }
})().catch(error=>{console.error(error);process.exitCode=1});
