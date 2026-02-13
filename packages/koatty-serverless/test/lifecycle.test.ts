import { bindShutdownHook, resetShutdownState } from '../src/lifecycle';

/** 等待异步 shutdown handler 中的 await 完成（刷新微任务队列） */
const flushMicrotasks = () => new Promise(r => process.nextTick(r));

describe('bindShutdownHook', () => {
  let mockExit: jest.SpyInstance;

  beforeEach(() => {
    resetShutdownState();
    mockExit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockExit.mockRestore();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    resetShutdownState();
  });

  it('should increase SIGTERM listener count after binding', () => {
    const initialCount = process.listenerCount('SIGTERM');
    const mockApp = { stop: jest.fn() } as any;
    
    bindShutdownHook(mockApp);
    
    expect(process.listenerCount('SIGTERM')).toBe(initialCount + 1);
  });

  it('should be idempotent - not increase listener count on second call', () => {
    const mockApp = { stop: jest.fn() } as any;
    
    bindShutdownHook(mockApp);
    const countAfterFirst = process.listenerCount('SIGTERM');
    
    bindShutdownHook(mockApp);
    const countAfterSecond = process.listenerCount('SIGTERM');
    
    expect(countAfterFirst).toBe(countAfterSecond);
  });

  it('should call app.stop on SIGTERM', async () => {
    const mockStop = jest.fn();
    const mockApp = { stop: mockStop } as any;
    
    bindShutdownHook(mockApp);
    process.emit('SIGTERM');
    await flushMicrotasks();
    
    expect(mockStop).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('should call app.stop on SIGINT', async () => {
    const mockStop = jest.fn();
    const mockApp = { stop: mockStop } as any;
    
    bindShutdownHook(mockApp);
    process.emit('SIGINT');
    await flushMicrotasks();
    
    expect(mockStop).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('should still exit when app.stop throws', async () => {
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation();
    const mockApp = { stop: jest.fn().mockImplementation(() => { throw new Error('test'); }) } as any;
    
    bindShutdownHook(mockApp);
    process.emit('SIGTERM');
    await flushMicrotasks();
    
    expect(mockConsoleError).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(0);
    mockConsoleError.mockRestore();
  });
});
