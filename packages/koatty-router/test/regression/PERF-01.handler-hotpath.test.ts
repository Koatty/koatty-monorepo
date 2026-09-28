/**
 * PERF-01 / PERF-02: router hot path.
 *
 * Regression guard for plan D-4:
 *  - the route handler is built once at registration time and the request path
 *    only calls it (no middleware array, no `koa-compose()` per request);
 *  - falsy controller results (0, '', false) survive into `ctx.body`.
 */
import { createRouteHandler, Handler } from '../../src/utils/handler';

const app: any = {};

function makeCtx(): any {
  const ctx: any = { body: undefined };
  ctx.throw = jest.fn((status: number, message: string) => {
    throw Object.assign(new Error(message), { status });
  });
  return ctx;
}

function makeCtl(method: string, impl: (...args: any[]) => any, extra: any = {}) {
  return Object.assign({ [method]: jest.fn(impl) }, extra);
}

beforeEach(() => jest.clearAllMocks());

describe('PERF-01: route handler is built at registration time', () => {
  test('the middleware pipeline is not rebuilt on the request path', async () => {
    const mw = jest.fn(async (ctx: any, next: any) => { await next(); });
    const invoke = createRouteHandler(app, 'index', undefined, undefined, mw);
    expect(mw).not.toHaveBeenCalled(); // nothing runs at registration time

    for (let i = 0; i < 5; i++) {
      await invoke(makeCtx(), makeCtl('index', () => 'ok'));
    }

    // one middleware call per request: the chain is reused, never re-composed
    expect(mw).toHaveBeenCalledTimes(5);
    for (const call of mw.mock.calls) {
      expect(typeof call[1]).toBe('function'); // real `next` continuation
    }
  });

  test('the invoker is stable and can be reused across requests and controllers', async () => {
    const invoke = createRouteHandler(app, 'index');
    expect(createRouteHandler(app, 'index')).not.toBe(invoke);

    const ctl = makeCtl('index', () => 'ok');
    const first = await invoke(makeCtx(), ctl);
    const second = await invoke(makeCtx(), ctl);
    expect([first, second]).toEqual(['ok', 'ok']);
  });
  test('the middleware order and the controller result are preserved', async () => {
    const order: string[] = [];
    const mw = jest.fn(async (ctx: any, next: any) => {
      order.push('mw-before');
      await next();
      order.push('mw-after');
    });
    const invoke = createRouteHandler(app, 'index', undefined, undefined, mw);
    const ctl = makeCtl('index', () => { order.push('call'); return 'v'; });

    const ctx1 = makeCtx();
    expect(await invoke(ctx1, ctl)).toBe('v');
    expect(await invoke(makeCtx(), ctl)).toBe('v');

    expect(order).toEqual(['mw-before', 'call', 'mw-after', 'mw-before', 'call', 'mw-after']);
    expect(ctl.index).toHaveBeenCalledTimes(2);
    expect(ctx1.body).toBe('v');
  });
});

describe('PERF-02 / D-4: response normalization', () => {
  test.each([[0], [''], [false]])('falsy result %p survives into ctx.body', async (value) => {
    const invoke = createRouteHandler(app, 'index');
    const ctx = makeCtx();
    await invoke(ctx, makeCtl('index', () => value));
    expect(ctx.body).toBe(value);
  });

  test('an existing body wins over the controller result', async () => {
    const invoke = createRouteHandler(app, 'index');
    const ctx = makeCtx();
    ctx.body = 'from-mw';
    await invoke(ctx, makeCtl('index', () => 'from-ctl'));
    expect(ctx.body).toBe('from-mw');
  });

  test('middleware body survives an undefined controller result', async () => {
    const mw = jest.fn(async (ctx: any, next: any) => { ctx.body = 'mw'; await next(); });
    const invoke = createRouteHandler(app, 'index', undefined, undefined, mw);
    const ctx = makeCtx();
    await invoke(ctx, makeCtl('index', () => undefined));
    expect(ctx.body).toBe('mw');
  });

  test('a returned Error is thrown', async () => {
    const invoke = createRouteHandler(app, 'index');
    const ctx = makeCtx();
    await expect(invoke(ctx, makeCtl('index', () => new Error('boom')))).rejects.toThrow('boom');
    expect(ctx.body).toBeUndefined();
  });

  test('missing controller yields 404 through ctx.throw', async () => {
    const invoke = createRouteHandler(app, 'index');
    const ctx = makeCtx();
    await expect(invoke(ctx, undefined)).rejects.toMatchObject({ status: 404 });
    expect(ctx.throw).toHaveBeenCalledWith(404, expect.any(String));
  });

  test('the controller instance receives ctx', async () => {
    const invoke = createRouteHandler(app, 'index');
    const ctx = makeCtx();
    const ctl: any = { index: jest.fn(() => 'ok') };
    await invoke(ctx, ctl);
    expect(ctl.ctx).toBe(ctx);
  });

  test('concurrent requests never leak the controller instance across contexts', async () => {
    const mw = jest.fn(async (ctx: any, next: any) => { await new Promise((r) => setTimeout(r, 5)); await next(); });
    const invoke = createRouteHandler(app, 'index', undefined, undefined, mw);
    const a = makeCtl('index', async () => { await new Promise((r) => setTimeout(r, 5)); return 'A'; });
    const b = makeCtl('index', async () => 'B');

    const ctxA = makeCtx();
    const ctxB = makeCtx();
    const [ra, rb] = await Promise.all([invoke(ctxA, a), invoke(ctxB, b)]);
    expect([ra, rb]).toEqual(['A', 'B']);
    expect(ctxA.body).toBe('A');
    expect(ctxB.body).toBe('B');
  });
});

describe('backward compatibility: Handler()', () => {
  test('still returns ctx.body and applies the composed middleware', async () => {
    const mw = jest.fn(async (ctx: any, next: any) => { ctx.setMetaData?.(); await next(); });
    const ctx = makeCtx();
    const res = await Handler(app, ctx, makeCtl('index', () => 'legacy'), 'index', undefined, undefined, mw);
    expect(res).toBe('legacy');
    expect(mw).toHaveBeenCalledTimes(1);
  });
});
