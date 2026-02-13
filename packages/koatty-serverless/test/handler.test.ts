import { resetShutdownState } from '../src/lifecycle';

// Mock koatty 模块的 createApplication
const mockCreateApplication = jest.fn();
jest.mock('koatty', () => ({
  createApplication: (...args: any[]) => mockCreateApplication(...args),
}));

// 必须在 jest.mock 之后 import，确保拿到的是 mock 版本
import { createHandler } from '../src/handler';

describe('createHandler', () => {
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    resetShutdownState();
    mockCreateApplication.mockReset();
    mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockExit.mockRestore();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    resetShutdownState();
  });

  function createMockApp(overrides?: Record<string, any>) {
    return {
      getRequestHandler: jest.fn().mockReturnValue(jest.fn().mockResolvedValue('http-response')),
      isReady: true,
      ...overrides,
    } as any;
  }

  describe('cold start: first call initializes app and caches', () => {
    it('should call createApplication only once across multiple invocations', async () => {
      const mockApp = createMockApp();
      mockCreateApplication.mockResolvedValue(mockApp);

      const handler = createHandler({}, { platform: 'alicloud' });

      await handler();
      expect(mockCreateApplication).toHaveBeenCalledTimes(1);

      await handler();
      expect(mockCreateApplication).toHaveBeenCalledTimes(1);
    });
  });

  describe('healthCheck: called on each invocation', () => {
    it('should call healthCheck on every handler invocation', async () => {
      const mockApp = createMockApp();
      mockCreateApplication.mockResolvedValue(mockApp);
      const mockHealthCheck = jest.fn().mockResolvedValue(undefined);

      const handler = createHandler({}, { platform: 'alicloud', healthCheck: mockHealthCheck });

      await handler();
      await handler();

      expect(mockHealthCheck).toHaveBeenCalledTimes(2);
    });
  });

  describe('event routing: non-HTTP events dispatched to eventHandlers', () => {
    it('should route scheduled events to eventHandlers.scheduled', async () => {
      const mockApp = createMockApp();
      mockCreateApplication.mockResolvedValue(mockApp);
      const mockScheduledHandler = jest.fn().mockResolvedValue({ scheduled: true });

      const handler = createHandler({}, {
        eventHandlers: { scheduled: mockScheduledHandler },
      });

      const event = { source: 'aws.events' };
      const context = {};
      const result = await handler(event, context);

      expect(mockScheduledHandler).toHaveBeenCalledWith(event, context, mockApp);
      expect(result).toEqual({ scheduled: true });
      expect(mockApp.getRequestHandler).not.toHaveBeenCalled();
    });
  });

  describe('HTTP events: go through adapter', () => {
    it('should process HTTP events through the adapter', async () => {
      const mockHttpHandler = jest.fn().mockResolvedValue('http-response');
      const mockApp = createMockApp({
        getRequestHandler: jest.fn().mockReturnValue(mockHttpHandler),
      });
      mockCreateApplication.mockResolvedValue(mockApp);

      const handler = createHandler({}, { platform: 'alicloud' });

      const event = { httpMethod: 'GET', path: '/' };
      const result = await handler(event, {}, {});

      expect(mockApp.getRequestHandler).toHaveBeenCalled();
      expect(mockHttpHandler).toHaveBeenCalled();
    });
  });

  describe('custom adapter: takes priority over platform', () => {
    it('should use custom adapter when provided', async () => {
      const mockApp = createMockApp();
      mockCreateApplication.mockResolvedValue(mockApp);

      const mockCustomHandler = jest.fn().mockResolvedValue('custom-response');
      const customAdapter = {
        name: 'custom',
        createHandler: jest.fn().mockReturnValue(mockCustomHandler),
      };

      const handler = createHandler({}, { adapter: customAdapter as any });

      const result = await handler({});

      expect(customAdapter.createHandler).toHaveBeenCalledWith(mockApp);
      expect(mockCustomHandler).toHaveBeenCalled();
      expect(result).toBe('custom-response');
    });
  });
});
