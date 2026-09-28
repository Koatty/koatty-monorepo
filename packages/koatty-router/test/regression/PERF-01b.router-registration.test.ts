/*
 * PERF-01 (plan D-4): route handlers are built once, at registration time.
 *
 * The router must call `createRouteHandler()` while loading controller metadata,
 * never while serving requests: a request may only invoke the pre-built handler.
 */

const mockGetHandlers: Array<{ path: string; handler: Function }> = [];
const mockCreateRouteHandler = jest.fn();

jest.mock('@koa/router', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn((path: string, handler: Function) => { mockGetHandlers.push({ path, handler }); }),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    head: jest.fn(),
    options: jest.fn(),
    all: jest.fn(),
    routes: jest.fn().mockReturnValue(jest.fn()),
    allowedMethods: jest.fn().mockReturnValue(jest.fn()),
  }));
});

jest.mock('koatty_container', () => ({
  IOC: {
    getClass: jest.fn(() => class Ctrl {}),
    getInsByClass: jest.fn(() => ({ index: jest.fn(() => 'ok') })),
  },
}));

jest.mock('koatty_logger', () => ({
  DefaultLogger: {
    Error: jest.fn(),
    Debug: jest.fn(),
    Warn: jest.fn(),
    get isDebugEnabled() { return false; },
  },
}));

jest.mock('koatty_lib', () => ({
  isEmpty: jest.fn((val: any) => val === undefined || val === null || val === ''),
  isFunction: jest.fn((val: any) => typeof val === 'function'),
  isError: jest.fn((val: any) => val instanceof Error),
}));

jest.mock('../../src/utils/inject', () => ({
  injectRouter: jest.fn(),
  injectParamMetaData: jest.fn(() => ({ index: [] })),
}));

jest.mock('../../src/utils/path', () => ({ parsePath: jest.fn((p: string) => p) }));

jest.mock('../../src/utils/handler', () => ({
  Handler: jest.fn(),
  createRouteHandler: (...args: any[]) => mockCreateRouteHandler(...args),
}));

import { IOC } from 'koatty_container';
import { HttpRouter } from '../../src/router/http';
import { injectParamMetaData, injectRouter } from '../../src/utils/inject';

describe('PERF-01: router registers one handler per route', () => {
  let app: any;
  let router: HttpRouter;

  beforeEach(async () => {
    mockGetHandlers.length = 0;
    mockCreateRouteHandler.mockReset();
    // the pre-built invoker returned to the router
    mockCreateRouteHandler.mockImplementation(() => jest.fn(async (ctx: any) => ctx.body));
    (IOC.getInsByClass as jest.Mock).mockClear();
    (injectParamMetaData as jest.Mock).mockReturnValue({ index: [] });
    (injectRouter as jest.Mock).mockResolvedValue({
      index: { method: 'index', path: '/', requestMethod: 'get' },
    });

    app = { use: jest.fn(), env: 'test' };
    router = new HttpRouter(app, { protocol: 'http', prefix: '' });
    await router.LoadRouter(app, ['ctrl']);
  });

  test('createRouteHandler() runs during LoadRouter, not per request', async () => {
    expect(mockCreateRouteHandler).toHaveBeenCalledTimes(1);
    // 6th arg retains the controller class for internal call compatibility
    // at registration time rather than per request).
    expect(mockCreateRouteHandler).toHaveBeenCalledWith(app, 'index', [], undefined, undefined, expect.anything());

    const { handler } = mockGetHandlers[0];
    const invoker = mockCreateRouteHandler.mock.results[0].value;

    await handler({ body: undefined });
    await handler({ body: undefined });
    await handler({ body: undefined });

    expect(invoker).toHaveBeenCalledTimes(3);
    expect(mockCreateRouteHandler).toHaveBeenCalledTimes(1); // still one
  });

  test('the controller instance is resolved per request', async () => {
    const { handler } = mockGetHandlers[0];
    await handler({ body: undefined });
    await handler({ body: undefined });
    expect(IOC.getInsByClass).toHaveBeenCalledTimes(2);
  });

  test('every route is registered on the underlying router', () => {
    expect(mockGetHandlers.map((h) => h.path)).toEqual(['/']);
  });
});
