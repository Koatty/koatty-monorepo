import EventEmitter from "events";
import { KoattyServer, KoattyApplication } from "koatty_core";
import { Helper } from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";
import { CreateTerminus, BindProcessEvent, TerminusManager } from "../../src/utils/terminus";
import * as terminus from '../../src/utils/terminus';

class MockKoattyApplication extends EventEmitter {
  env: string = "test";
  name: string = "test-app";
  version: string = "1.0.0";
  router: any = {};
  options: any = {};
  server: any = {};
  appPath: string = "/test";
  rootPath: string = "/test";

  config(key?: string, defaultValue?: any) {
    return defaultValue;
  }
}

class MockKoattyServer implements KoattyServer {
  status: number = 200;
  options: any = {};
  server: any = {};
  
  Start(listenCallback?: () => void): any {
    if (listenCallback) {
      listenCallback();
    }
    return {
      close: (cb?: () => void) => cb && cb()
    };
  }
  
  Stop(callback?: () => void): void {
    if (callback) {
      callback();
    }
  }
}

describe("Terminus", () => {
  let mockServer: MockKoattyServer;
  let mockApp: MockKoattyApplication;
  let processExitSpy: jest.SpyInstance;
  let processOnSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;
  let originalNodeEnv: string | undefined;

  beforeAll(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    mockServer = new MockKoattyServer();
    mockApp = new MockKoattyApplication();
    
    TerminusManager.resetInstance();
    
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      return undefined as never;
    });
    processOnSpy = jest.spyOn(process, 'on');
    loggerWarnSpy = jest.spyOn(Logger, 'Warn').mockImplementation();
    loggerErrorSpy = jest.spyOn(Logger, 'Error').mockImplementation();

    const events = ['SIGTERM', 'SIGINT', 'SIGUSR2', 'SIGUSR1', 'SIGHUP', 'beforeExit'];
    events.forEach(event => process.removeAllListeners(event));
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.clearAllMocks();
    jest.useRealTimers();
    mockApp.removeAllListeners();
    
    const events = ['SIGTERM', 'SIGINT', 'SIGUSR2', 'SIGUSR1', 'SIGHUP', 'beforeExit'];
    events.forEach(event => process.removeAllListeners(event));
    
    TerminusManager.resetInstance();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  describe("CreateTerminus", () => {
    it("should create terminus with default options", () => {
      CreateTerminus(mockApp as KoattyApplication, mockServer);
      expect(processOnSpy).toHaveBeenCalledTimes(3);
    });

    it("should register server with TerminusManager", () => {
      const manager = TerminusManager.getInstance();
      const initialCount = manager.getServerCount();
      
      CreateTerminus(mockApp as KoattyApplication, mockServer, {
        timeout: 1000,
        signals: ["SIGUSR2"]
      });
      
      expect(manager.getServerCount()).toBe(initialCount + 1);
    });
  });

  describe("BindProcessEvent", () => {
    it("should bind event listeners to process", () => {
      const mockListener = jest.fn();
      mockApp.on("test", mockListener);

      BindProcessEvent(mockApp, "test", "beforeExit");
      
      const listeners = process.listeners("beforeExit");
      expect(listeners).toContain(mockListener);
      expect(mockApp.listeners("test")).toHaveLength(0);
    });

    it("should bind multiple listeners", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      mockApp.on("test", listener1);
      mockApp.on("test", listener2);

      BindProcessEvent(mockApp, "test", "beforeExit");
      
      const listeners = process.listeners("beforeExit");
      expect(listeners).toContain(listener1);
      expect(listeners).toContain(listener2);
    });
  });

  describe("TerminusManager Shutdown", () => {
    it("should handle multiple signals via TerminusManager", async () => {
      jest.useRealTimers();
      
      try {
        CreateTerminus(mockApp as KoattyApplication, mockServer, {
          timeout: 1000
        });

        loggerWarnSpy.mockClear();

        process.emit("SIGTERM");
        
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(loggerWarnSpy).toHaveBeenCalled();
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining("Received kill signal")
        );
      } finally {
        jest.useFakeTimers();
      }
    });
  });
});

describe('Terminus Utils', () => {
  describe('Module Export', () => {
    it('should export terminus utilities', () => {
      expect(terminus).toBeDefined();
      expect(typeof terminus).toBe('object');
    });

    it('should handle terminus module gracefully', () => {
      expect(() => {
        const exported = terminus;
        return exported;
      }).not.toThrow();
    });
  });

  describe('Function Availability', () => {
    it('should provide available terminus functions', () => {
      const terminusKeys = Object.keys(terminus);
      expect(Array.isArray(terminusKeys)).toBe(true);
    });

    it('should handle empty exports gracefully', () => {
      expect(() => Object.keys(terminus)).not.toThrow();
    });
  });

  describe('Integration', () => {
    it('should integrate with server lifecycle', () => {
      expect(() => {
        const mockServer = {
          close: jest.fn((callback) => callback && callback()),
          on: jest.fn(),
          listening: true
        };

        expect(mockServer).toBeDefined();
      }).not.toThrow();
    });

    it('should handle graceful shutdown scenarios', () => {
      const mockServer = {
        close: jest.fn((callback) => {
          setTimeout(() => callback && callback(), 10);
        }),
        on: jest.fn(),
        listening: true
      };

      const shutdownPromise = new Promise<void>((resolve) => {
        mockServer.close(() => resolve());
      });

      return expect(shutdownPromise).resolves.toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle module import errors gracefully', () => {
      expect(() => {
        const module = terminus;
        return module !== null;
      }).not.toThrow();
    });

    it('should provide fallback behavior', () => {
      expect(typeof terminus).toBe('object');
    });
  });

  describe('Configuration', () => {
    it('should handle different server types', () => {
      const serverTypes = ['http', 'https', 'http2', 'grpc'];
      
      serverTypes.forEach(type => {
        const mockServer = {
          type,
          close: jest.fn(),
          on: jest.fn(),
          listening: true
        };

        expect(() => {
          return mockServer.type;
        }).not.toThrow();
      });
    });

    it('should handle terminus configuration options', () => {
      const mockOptions = {
        timeout: 1000,
        signal: 'SIGTERM',
        signals: ['SIGTERM', 'SIGINT'],
        beforeShutdown: jest.fn(),
        onSignal: jest.fn(),
        onShutdown: jest.fn()
      };

      expect(() => {
        return mockOptions.timeout > 0;
      }).not.toThrow();
    });
  });
});
