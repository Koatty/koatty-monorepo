import Koa from 'koa';
import request from 'supertest';
import ts from 'typescript';
import { Container } from 'koatty_container';
import { HttpRouter } from '../../src/router/http';
import { RouterFactory } from '../../src/router/factory';

for (const legacy of [true, false]) {
  test(`existing Controller/GetMapping middleware rejects HTTP requests (${legacy ? 'Legacy' : 'TC39'} emit)`, async () => {
    const fixture = `
      const { Controller } = require('koatty_core');
      const { GetMapping } = require('../../src/params/mapping');
      class DenyMiddleware { run() { return async ctx => ctx.throw(403); } }
      @Controller('/class', { middleware: [DenyMiddleware] })
      class ClassController { @GetMapping('/') index() { throw new Error('must not execute'); } }
      @Controller('/method')
      class MethodController { @GetMapping('/', { middleware: [DenyMiddleware] }) index() { throw new Error('must not execute'); } }
      module.exports = { ClassController, MethodController };
    `;
    const output = ts.transpileModule(fixture, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: legacy,
    } }).outputText;
    const compiled = { exports: {} as any };
    new Function('require', 'module', output)(require, compiled);
    const app: any = new Koa(); app.config = () => ({}); app.container = new Container(); app.container.setApp(app);
    app.on('error', () => undefined);
    const names = Object.entries(compiled.exports).map(([name, cls]) => {
      app.container.reg(name, cls, { scope: 'Prototype', type: 'CONTROLLER' }); return name;
    });
    const router = new HttpRouter(app);
    await router.LoadRouter(app, names);
    expect((await request(app.callback()).get('/class/')).status).toBe(403);
    expect((await request(app.callback()).get('/method/')).status).toBe(403);
    app.emit('appStop'); await app.container.clear();
  });
}

test('closing one application only closes its own routers', async () => {
  const a = {} as any, b = {} as any;
  const fa = RouterFactory.getInstance(a), fb = RouterFactory.getInstance(b);
  expect(fa).not.toBe(fb);
  const ra = { cleanup: jest.fn() }, rb = { cleanup: jest.fn() };
  (fa as any).activeRouters = [ra]; (fb as any).activeRouters = [rb];
  await fa.shutdownAll();
  expect(ra.cleanup).toHaveBeenCalledTimes(1); expect(rb.cleanup).not.toHaveBeenCalled();
  await fb.shutdownAll(); expect(rb.cleanup).toHaveBeenCalledTimes(1);
});

test('a real HTTP disconnect aborts an SSE producer and settles request cleanup', async () => {
  const { streamSSE } = await import('../../src/sse');
  const http = await import('http');
  const app = new Koa(); let aborted = false, settled = false;
  app.use(async ctx => {
    try {
      await streamSSE(ctx, signal => (async function* () {
        yield {data:'ready'};
        await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, {once:true}));
      })(), {heartbeatInterval:0});
    } finally { settled = true; }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    await new Promise<void>((resolve,reject) => {
      const req = http.get({host:'127.0.0.1',port:(server.address() as any).port}, res => {
        expect(res.headers['content-type']).toContain('text/event-stream');
        res.once('data', chunk => { expect(String(chunk)).toContain('ready'); req.destroy(); resolve(); });
      }); req.on('error', reject);
    });
    const deadline = Date.now()+1000;
    while (!settled && Date.now()<deadline) await new Promise(r => setTimeout(r,10));
    expect(aborted).toBe(true); expect(settled).toBe(true);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
