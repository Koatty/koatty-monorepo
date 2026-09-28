// Run from the repository root: node docs/audits/phase-d-audit-2026-09-28/probes.cjs
// Read current TS sources directly. This is an audit reproducer, not a passing
// release gate: each REPRODUCED result means the described defect still exists.
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert/strict');
const { createRequire } = require('module');
const { EventEmitter } = require('events');
const root = process.cwd();
const r = createRequire(path.join(root, 'packages/koatty-router/package.json'));
const ts = r('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(
  fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    esModuleInterop: true, experimentalDecorators: true,
  } }).outputText, file);
const source = name => require(path.join(root, 'packages', name));
const { Container, IOC } = source('koatty-container/src/container/container.ts');
const { Autowired } = source('koatty-container/src/decorator/autowired.ts');
const { Around } = source('koatty-container/src/decorator/aop.ts');
const { injectAOP } = source('koatty-container/src/processor/aop_processor.ts');
const { streamSSE, SSE, isSSEHandler } = source('koatty-router/src/sse/index.ts');
const { prefersJson } = source('koatty-router/src/negotiation/index.ts');
const { Load } = source('koatty-loader/src/index.ts');
let reproduced = 0;
async function probe(name, fn) {
  try { const detail = await fn(); reproduced++; console.log('REPRODUCED', name, JSON.stringify(detail)); }
  catch (err) { console.error('PROBE FAILED', name, err); process.exitCode = 1; }
}
(async () => {
  await probe('D1 isolated consumer resolves dependency from global IOC', async () => {
    class AuditDependency { value = 'global'; }
    class AuditConsumer {}
    IOC.reg(AuditDependency);
    Autowired(AuditDependency)(AuditConsumer.prototype, 'dependency');
    const c = new Container(); c.reg(AuditDependency);
    c.get('AuditDependency').value = 'isolated'; c.reg(AuditConsumer);
    const value = c.get('AuditConsumer').dependency.value;
    assert.equal(value, 'global'); await c.clear(); return { value, expected: 'isolated' };
  });
  await probe('D2 request binding disappears after await', async () => {
    class AuditRequest {}
    const c = new Container(); c.reg(AuditRequest, { scope: 'Request' });
    const results = await Promise.all([{}, {}].map(ctx => c.runInRequestScope(ctx, async () => {
      const before = c.get('AuditRequest'); await Promise.resolve();
      return { before, after: c.get('AuditRequest') };
    })));
    assert.notEqual(results[0].before, results[0].after);
    assert.equal(results[0].after, results[1].after);
    await c.clear(); return { sameWithinRequest: false, sharedAcrossRequestsAfterAwait: true };
  });
  await probe('D2 Prototype dependencies remain shared', async () => {
    class AuditPrototypeDependency {}
    class AuditPrototypeConsumer {}
    IOC.reg(AuditPrototypeDependency, { scope: 'Prototype' });
    Autowired(AuditPrototypeDependency)(AuditPrototypeConsumer.prototype, 'dependency');
    IOC.reg(AuditPrototypeConsumer, { scope: 'Prototype' });
    const a = IOC.get('AuditPrototypeConsumer'), b = IOC.get('AuditPrototypeConsumer');
    assert.notEqual(a, b); assert.equal(a.dependency, b.dependency);
    return { distinctConsumers: true, sharedDependency: true };
  });
  await probe('D3 asynchronous builtin before does not block business', async () => {
    const order = [];
    class AuditBuiltinBefore {
      async __before() { await Promise.resolve(); order.push('authorized'); }
      work() { order.push('business'); return 1; }
    }
    injectAOP(AuditBuiltinBefore, IOC); const result = new AuditBuiltinBefore().work();
    await Promise.resolve(); assert.equal(result, 1);
    assert.deepEqual(order, ['business', 'authorized']); return order;
  });
  await probe('D3 synchronous Around proceeds twice', async () => {
    class AuditTwiceAspect {
      async run() {}
      runSync(args, proceed) { proceed(); return proceed(); }
    }
    class AuditTwiceTarget { calls = 0; work() { return ++this.calls; } }
    IOC.reg(AuditTwiceAspect);
    Around(AuditTwiceAspect)(AuditTwiceTarget.prototype, 'work', Object.getOwnPropertyDescriptor(AuditTwiceTarget.prototype, 'work'));
    injectAOP(AuditTwiceTarget, IOC); const target = new AuditTwiceTarget(); target.work();
    assert.equal(target.calls, 2); return { businessCalls: target.calls };
  });
  await probe('D6 TC39 method metadata is not discoverable', async () => {
    class AuditEvents { events() {} }
    SSE()(AuditEvents.prototype.events, { kind: 'method', name: 'events', addInitializer() {} });
    const recognized = isSSEHandler(AuditEvents.prototype, 'events');
    assert.equal(recognized, false); return { recognized };
  });
  await probe('D6 actual TypeScript TC39 emit loses guard and SSE metadata', async () => {
    const guardFile = path.join(root, 'packages/koatty-router/src/guard/index.ts');
    const sseFile = path.join(root, 'packages/koatty-router/src/sse/index.ts');
    const fixture = `const { UseGuard, getGuards } = require(${JSON.stringify(guardFile)});
      const { SSE, isSSEHandler } = require(${JSON.stringify(sseFile)});
      class DenyGuard { canActivate() { return false; } }
      class CompiledController { @SSE() @UseGuard(DenyGuard) events() {} }
      module.exports = { guards: getGuards(CompiledController, 'events').length,
        sse: isSSEHandler(CompiledController.prototype, 'events') };`;
    function compile(legacy) {
      const output = ts.transpileModule(fixture, { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
        experimentalDecorators: legacy,
      } }).outputText;
      const fixtureModule = new (require('module').Module)('audit-decorators', module);
      fixtureModule._compile(output, path.join(root, 'audit-decorators.cjs'));
      return fixtureModule.exports;
    }
    const legacy = compile(true), tc39 = compile(false);
    assert.deepEqual(legacy, { guards: 1, sse: true });
    assert.deepEqual(tc39, { guards: 0, sse: false });
    return { legacy, tc39 };
  });
  await probe('D6 disconnect leaves a pending source active', async () => {
    const req = new EventEmitter(); let finish; let closed = false, settled = false;
    async function* events() { try { await new Promise(resolve => { finish = resolve; }); yield 1; } finally { closed = true; } }
    const res = { setHeader() {}, write() { return true; }, end() {} };
    const pending = streamSSE({ req, res }, events(), { heartbeatInterval: 0 }).then(() => { settled = true; });
    await Promise.resolve(); req.emit('close'); await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(settled, false); assert.equal(closed, false);
    finish(); await pending; return { settledOnDisconnect: false, sourceClosedOnDisconnect: false };
  });
  await probe('D6 ignores response backpressure', async () => {
    let writes = 0; const req = new EventEmitter();
    const res = { setHeader() {}, write() { writes++; return false; }, end() {} };
    async function* events() { yield 1; yield 2; yield 3; }
    await streamSSE({ req, res }, events(), { heartbeatInterval: 0 });
    assert.equal(writes, 3); return { writesWithoutDrain: writes };
  });
  await probe('D6 Accept q=0 still selects JSON', async () => {
    const selected = prefersJson({ headers: { accept: 'application/json;q=0, text/plain;q=1' } });
    assert.equal(selected, true); return { selectedJson: selected };
  });
  await probe('D6 real HTTP class middleware is lost while method middleware denies', async () => {
    const Koa = r('koa'), request = r('supertest');
    const { Controller } = source('koatty-core/src/Component.ts');
    const { GetMapping } = source('koatty-router/src/params/mapping.ts');
    const { HttpRouter } = source('koatty-router/src/router/http.ts');
    const app = new Koa(); app.config = () => ({}); app.container = IOC; app.appDebug = false;
    app.on('error', () => {});
    let calls = 0;
    class AuditDenyMiddleware { run() { return async ctx => { calls++; ctx.throw(403); }; } }
    class AuditClassController { index() { return 'secret'; } }
    class AuditMethodController { index() { return 'secret'; } }
    Controller('/audit-class', { middleware: [AuditDenyMiddleware] })(AuditClassController);
    Controller('/audit-method')(AuditMethodController);
    GetMapping('/')(AuditClassController.prototype, 'index', Object.getOwnPropertyDescriptor(AuditClassController.prototype, 'index'));
    GetMapping('/', { middleware: [AuditDenyMiddleware] })(AuditMethodController.prototype, 'index', Object.getOwnPropertyDescriptor(AuditMethodController.prototype, 'index'));
    IOC.reg('AuditClassController', AuditClassController, { scope: 'Prototype', type: 'CONTROLLER' });
    IOC.reg('AuditMethodController', AuditMethodController, { scope: 'Prototype', type: 'CONTROLLER' });
    const router = new HttpRouter(app);
    await router.LoadRouter(app, ['AuditClassController', 'AuditMethodController']);
    const classResponse = await request(app.callback()).get('/audit-class/');
    const methodResponse = await request(app.callback()).get('/audit-method/');
    assert.equal(classResponse.status, 200); assert.equal(classResponse.text, 'secret');
    assert.equal(methodResponse.status, 403); assert.equal(calls, 1);
    return { classStatus: classResponse.status, methodStatus: methodResponse.status, authCalls: calls };
  });
  await probe('D7 symlink scan escapes base directory', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'koatty-d-audit-'));
    try {
      const base = path.join(temp, 'project'), outside = path.join(temp, 'outside');
      fs.mkdirSync(base); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'escape.js'), 'module.exports = "OUTSIDE"');
      fs.symlinkSync(outside, path.join(base, 'linked'), 'dir');
      const result = Load(['linked'], base, undefined, ['**/*.js'], [], { scanCache: false });
      assert.equal(result[0].target, 'OUTSIDE'); return { loadedOutsideBase: true };
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
  await probe('D7 cache misses newly copied files with older timestamps', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'koatty-d-cache-'));
    try {
      fs.writeFileSync(path.join(base, 'first.js'), 'module.exports = 1');
      const opts = { cacheFile: path.join(base, '.koatty/cache.json') };
      Load(['.'], base, undefined, ['*.js'], [], opts);
      fs.writeFileSync(path.join(base, 'second.js'), 'module.exports = 2');
      fs.utimesSync(path.join(base, 'second.js'), new Date(0), new Date(0));
      const cached = Load(['.'], base, undefined, ['*.js'], [], opts);
      const fresh = Load(['.'], base, undefined, ['*.js'], [], { scanCache: false });
      assert.equal(cached.length, 1); assert.equal(fresh.length, 2);
      return { cachedCount: cached.length, actualCount: fresh.length };
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
  console.log('Total reproduced:', reproduced); await IOC.clear();
})().catch(err => { console.error(err); process.exitCode = 1; });
