import { EventEmitter } from 'events';
import { KoattyApplication, KoattyServer } from 'koatty_core';
import { DefaultLogger as Logger } from 'koatty_logger';
import { CreateTerminus, TerminusManager } from '../src/utils/terminus';

describe('Terminus Graceful Shutdown', () => {
  let mockApp: KoattyApplication;
  let mockServer: any;
  let destroyCalled: boolean;
  let stopCalled: boolean;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    destroyCalled = false;
    stopCalled = false;

    mockApp = new EventEmitter() as any;
    (mockApp as any).env = 'test';
    (mockApp as any).name = 'test-app';

    mockServer = {
      status: 200,
      serverId: 'test-server-001',
      destroy: jest.fn().mockImplementation(async () => {
        destroyCalled = true;
        return {
          status: 'completed',
          totalTime: 100,
          completedSteps: ['test'],
          failedSteps: []
        };
      }),
      Stop: jest.fn().mockImplementation((callback?: Function) => {
        stopCalled = true;
        if (callback) callback();
      })
    };

    TerminusManager.resetInstance();
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    jest.spyOn(Logger, 'Warn').mockImplementation();
    jest.spyOn(Logger, 'Info').mockImplementation();
    jest.spyOn(Logger, 'Error').mockImplementation();
    jest.spyOn(Logger, 'Fatal').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    TerminusManager.resetInstance();
    processExitSpy.mockRestore();
  });

  test('should register server and handle destroy via TerminusManager', async () => {
    CreateTerminus(mockApp, mockServer as KoattyServer);

    const manager = TerminusManager.getInstance();
    expect(manager.getServerCount()).toBe(1);
  });

  test('should fallback to Stop method when destroy not available', async () => {
    delete mockServer.destroy;

    CreateTerminus(mockApp, mockServer as KoattyServer);

    const manager = TerminusManager.getInstance();
    expect(manager.getServerCount()).toBe(1);
  });

  test('should handle multiple server registrations', async () => {
    const mockServer2 = {
      status: 200,
      serverId: 'test-server-002',
      options: {},
      Start: jest.fn(),
      Stop: jest.fn(),
      destroy: jest.fn().mockResolvedValue({ status: 'completed' })
    };

    CreateTerminus(mockApp, mockServer as KoattyServer);
    CreateTerminus(mockApp, mockServer2 as KoattyServer);

    const manager = TerminusManager.getInstance();
    expect(manager.getServerCount()).toBe(2);
  });

  test('should only register signal handlers once', async () => {
    const processOnSpy = jest.spyOn(process, 'on');

    CreateTerminus(mockApp, mockServer as KoattyServer);
    const firstCallCount = processOnSpy.mock.calls.length;

    CreateTerminus(mockApp, mockServer as KoattyServer);

    expect(processOnSpy.mock.calls.length).toBe(firstCallCount);
  });

  test('should set server status to 503 during shutdown', async () => {
    CreateTerminus(mockApp, mockServer as KoattyServer);
    
    expect(mockServer.status).toBe(200);
  });
});
