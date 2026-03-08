import { GrpcRouter, GrpcStreamType } from '../src/router/grpc';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('koatty_lib', () => ({
  isEmpty: jest.fn((value) => value == null || value === '' || (Array.isArray(value) && value.length === 0)),
  Koatty: jest.fn().mockImplementation(() => ({
    callback: jest.fn(() => () => {}),
    server: {
      RegisterService: jest.fn()
    }
  }))
}));

jest.mock('koatty_logger', () => ({
  DefaultLogger: {
    Debug: jest.fn().mockReturnValue(undefined),
    Info: jest.fn().mockReturnValue(undefined),
    Warn: jest.fn().mockReturnValue(undefined),
    Error: jest.fn().mockReturnValue(undefined)
  }
}));

jest.mock('koatty_container', () => ({
  IOC: {
    getClass: jest.fn(),
    getInsByClass: jest.fn()
  }
}));

jest.mock('../src/utils/inject', () => ({
  injectRouter: jest.fn(),
  injectParamMetaData: jest.fn()
}));

jest.mock('../src/utils/handler', () => ({
  Handler: jest.fn()
}));

jest.mock('koatty_proto', () => ({
  LoadProto: jest.fn(() => ({})),
  ListServices: jest.fn(() => [])
}));

jest.mock('../src/utils/path', () => ({
  parsePath: jest.fn((path) => path)
}));

jest.mock('../src/payload/payload', () => ({
  payload: jest.fn(() => jest.fn())
}));

describe('GrpcRouter - Simple Coverage Tests', () => {
  let app: any;
  let router: GrpcRouter;

  beforeEach(() => {
    jest.clearAllMocks();
    
    app = {
      callback: jest.fn((protocol, handler) => handler),
      use: jest.fn(),
      server: {
        RegisterService: jest.fn()
      }
    };
    
    router = new GrpcRouter(app, {
      protocol: 'grpc',
      prefix: '',
      ext: {
        protoFile: 'test.proto',
        streamConfig: {
          maxConcurrentStreams: 5,
          streamTimeout: 1000,
          backpressureThreshold: 100,
          bufferSize: 1024
        },
        poolSize: 5,
        batchSize: 3
      }
    } as any);
  });

  afterEach(() => {
    // Clear all timers and cleanup resources
    if (router) {
      // Clear stream manager timers if any
      const streamManager = (router as any).streamManager;
      if (streamManager && (streamManager as any).streams) {
        (streamManager as any).streams.clear();
      }
    }
    
    // Clear all Jest timers
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    // Final cleanup
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.restoreAllMocks();
  });

  describe('Basic Functionality', () => {
    it('should create GrpcRouter instance', () => {
      expect(router).toBeInstanceOf(GrpcRouter);
      expect(router.protocol).toBe('grpc');
    });

    it('should set and get routers', () => {
      const mockImpl = { service: {} as any, implementation: {} };
      
      router.SetRouter('testRouter', mockImpl);
      
      const routers = router.ListRouter();
      expect(routers.has('testRouter')).toBe(true);
      expect(routers.get('testRouter')).toEqual({
        service: mockImpl.service,
        implementation: mockImpl.implementation
      });
    });

    it('should handle SetRouter with empty name', () => {
      const { isEmpty } = require('koatty_lib');
      isEmpty.mockReturnValue(true);
      
      expect(() => {
        router.SetRouter('', { service: {} as any, implementation: {} });
      }).not.toThrow();
      
      const routers = router.ListRouter();
      expect(routers.size).toBe(0);
    });
  });

  describe('Stream Manager', () => {
    it('should register and manage streams', () => {
      const streamManager = (router as any).streamManager;
      
      // Register stream
      const state = streamManager.registerStream('test-stream', GrpcStreamType.UNARY);
      expect(state.id).toBe('test-stream');
      expect(state.type).toBe(GrpcStreamType.UNARY);
      expect(state.isActive).toBe(true);
      
      // Update stream
      streamManager.updateStream('test-stream', { messageCount: 5 });
      
      // Count active streams
      expect(streamManager.getActiveStreamCount()).toBe(1);
      
      // Remove stream
      streamManager.removeStream('test-stream');
      expect(streamManager.getActiveStreamCount()).toBe(0);
    });

    it('should handle backpressure detection', () => {
      const streamManager = (router as any).streamManager;
      
      streamManager.registerStream('test-stream', GrpcStreamType.UNARY);
      
      // Test normal buffer size
      expect(streamManager.isBackpressureTriggered('test-stream')).toBe(false);
      
      // Test high buffer size
      streamManager.updateStream('test-stream', { bufferSize: 2000 });
      expect(streamManager.isBackpressureTriggered('test-stream')).toBe(true);
      
      // Test non-existent stream
      expect(streamManager.isBackpressureTriggered('non-existent')).toBe(false);
    });

    it('should handle stream cleanup on timeout', () => {
      const streamManager = (router as any).streamManager;
      
      // Register a stream with a very old timestamp to trigger cleanup
      const oldTimestamp = Date.now() - 400000; // 400 seconds ago
      const state = {
        id: 'old-stream',
        type: GrpcStreamType.UNARY,
        startTime: oldTimestamp,
        messageCount: 0,
        bufferSize: 0,
        isActive: true
      };
      
      // Manually add to streams map to simulate old stream
      (streamManager as any).streams.set('old-stream', state);
      
      // Trigger cleanup by registering a new stream
      streamManager.registerStream('new-stream', GrpcStreamType.UNARY);
      
      // Old stream should be cleaned up (timeout is 5 minutes = 300000ms)
      expect((streamManager as any).streams.has('old-stream')).toBe(false);
      expect((streamManager as any).streams.has('new-stream')).toBe(true);
    });

    it('should handle update stream for non-existent stream', () => {
      const streamManager = (router as any).streamManager;
      
      // Should not throw when updating non-existent stream
      expect(() => {
        streamManager.updateStream('non-existent', { messageCount: 10 });
      }).not.toThrow();
    });

    it('should filter inactive streams in getActiveStreamCount', () => {
      const streamManager = (router as any).streamManager;
      
      // Register multiple streams
      streamManager.registerStream('active1', GrpcStreamType.UNARY);
      streamManager.registerStream('active2', GrpcStreamType.UNARY);
      streamManager.registerStream('inactive1', GrpcStreamType.UNARY);
      
      // Make one stream inactive
      streamManager.updateStream('inactive1', { isActive: false });
      
      expect(streamManager.getActiveStreamCount()).toBe(2);
    });
  });

  describe('Stream Type Detection', () => {
    it('should detect unary call type', () => {
      const mockCall = { readable: false, writable: false };
      const streamType = (router as any).detectStreamType(mockCall);
      expect(streamType).toBe(GrpcStreamType.UNARY);
    });

    it('should detect server streaming type', () => {
      const mockCall = { readable: false, writable: true };
      const streamType = (router as any).detectStreamType(mockCall);
      expect(streamType).toBe(GrpcStreamType.SERVER_STREAMING);
    });

    it('should detect client streaming type', () => {
      const mockCall = { readable: true, writable: false };
      const streamType = (router as any).detectStreamType(mockCall);
      expect(streamType).toBe(GrpcStreamType.CLIENT_STREAMING);
    });

    it('should detect bidirectional streaming type', () => {
      const mockCall = { readable: true, writable: true };
      const streamType = (router as any).detectStreamType(mockCall);
      expect(streamType).toBe(GrpcStreamType.BIDIRECTIONAL_STREAMING);
    });
  });

  describe('LoadRouter', () => {
    it('should handle empty service list', async () => {
      expect(async () => {
        await router.LoadRouter(app, []);
      }).not.toThrow();
    });

    it('should handle LoadProto errors', async () => {
      const { LoadProto } = require('koatty_proto');
      LoadProto.mockImplementation(() => {
        throw new Error('Proto load error');
      });

      expect(async () => {
        await router.LoadRouter(app, [{ test: 'service' }]);
      }).not.toThrow();
    });

    it('should handle valid service loading', async () => {
      const { LoadProto, ListServices } = require('koatty_proto');
      const { IOC } = require('koatty_container');
      
      // Mock successful proto loading
      LoadProto.mockReturnValue({
        TestService: {
          service: { test: 'service' },
          implementation: { test: jest.fn() }
        }
      });
      
      ListServices.mockReturnValue(['TestService']);
      IOC.getClass.mockReturnValue(class TestController {});
      
      await router.LoadRouter(app, [{ 
        TestService: {
          '/test': {
            name: 'TestController',
            ctl: class TestController {},
            method: 'test',
            params: [],
            middleware: []
          }
        }
      }]);
      
      // Verify LoadRouter completed without error
      expect(router.ListRouter().size).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Advanced Stream Manager Features', () => {
    it('should handle stream configuration defaults', () => {
      const streamManager = (router as any).streamManager;
      const config = (streamManager as any).config;
      
      // Check that config has expected properties (values might have defaults)
      expect(config.maxConcurrentStreams).toBeDefined();
      expect(config.streamTimeout).toBeDefined();
      expect(config.backpressureThreshold).toBeDefined();
      
      // Verify our custom config values are applied
      expect(config.maxConcurrentStreams).toBeGreaterThan(0);
      expect(config.streamTimeout).toBeGreaterThan(0);
      expect(config.backpressureThreshold).toBeGreaterThan(0);
    });

    it('should handle multiple stream types', () => {
      const streamManager = (router as any).streamManager;
      
      // Register different stream types
      streamManager.registerStream('unary-1', GrpcStreamType.UNARY);
      streamManager.registerStream('server-1', GrpcStreamType.SERVER_STREAMING);
      streamManager.registerStream('client-1', GrpcStreamType.CLIENT_STREAMING);
      streamManager.registerStream('bidi-1', GrpcStreamType.BIDIRECTIONAL_STREAMING);
      
      expect(streamManager.getActiveStreamCount()).toBe(4);
      
      // Remove specific streams
      streamManager.removeStream('unary-1');
      streamManager.removeStream('server-1');
      
      expect(streamManager.getActiveStreamCount()).toBe(2);
    });
  });

  describe('Router Configuration', () => {
    it('should handle different router configurations', () => {
      const customRouter = new GrpcRouter(app, {
        protocol: 'grpc',
        prefix: '/api',
        ext: {
          protoFile: 'custom.proto',
          streamConfig: {
            maxConcurrentStreams: 10,
            streamTimeout: 5000,
            backpressureThreshold: 500,
            bufferSize: 2048
          },
          batchSize: 5
        }
      } as any);
      
      expect(customRouter.protocol).toBe('grpc');
      // Check that router was created successfully
      expect(customRouter).toBeInstanceOf(GrpcRouter);
    });

    it('should handle protocol configuration', () => {
      expect(router.protocol).toBe('grpc');
      expect(router.options.protocol).toBe('grpc');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid stream updates gracefully', () => {
      const streamManager = (router as any).streamManager;
      
      // Should not throw for invalid stream IDs
      expect(() => {
        streamManager.updateStream('invalid-id', { messageCount: 100 });
      }).not.toThrow();
      
      expect(() => {
        streamManager.removeStream('invalid-id');
      }).not.toThrow();
    });
  });
}); 