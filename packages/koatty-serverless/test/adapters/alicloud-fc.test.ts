import { AliCloudFcAdapter } from '../../src/adapters/alicloud-fc';

describe('AliCloudFcAdapter', () => {
  it('adapter.name should be "alicloud-fc"', () => {
    const adapter = new AliCloudFcAdapter();
    expect(adapter.name).toBe('alicloud-fc');
  });

  it('createHandler should return a function', () => {
    const adapter = new AliCloudFcAdapter();
    const mockHttpHandler = jest.fn().mockResolvedValue(undefined);
    const mockApp = {
      getRequestHandler: jest.fn().mockReturnValue(mockHttpHandler),
      isReady: true,
    } as any;

    const handler = adapter.createHandler(mockApp);
    expect(typeof handler).toBe('function');
  });

  it('should call app.getRequestHandler() and httpHandler with req/res', async () => {
    const adapter = new AliCloudFcAdapter();
    const mockHttpHandler = jest.fn().mockResolvedValue(undefined);
    const mockApp = {
      getRequestHandler: jest.fn().mockReturnValue(mockHttpHandler),
      isReady: true,
    } as any;

    const handler = adapter.createHandler(mockApp);
    const mockReq = {} as any;
    const mockRes = {} as any;
    const mockContext = { requestId: 'test-123' };

    await handler(mockReq, mockRes, mockContext);

    expect(mockApp.getRequestHandler).toHaveBeenCalled();
    expect(mockHttpHandler).toHaveBeenCalledWith(mockReq, mockRes);
    expect(mockReq.fcContext).toBe(mockContext);
  });

  it('should not set fcContext when context is not provided', async () => {
    const adapter = new AliCloudFcAdapter();
    const mockHttpHandler = jest.fn().mockResolvedValue(undefined);
    const mockApp = {
      getRequestHandler: jest.fn().mockReturnValue(mockHttpHandler),
      isReady: true,
    } as any;

    const handler = adapter.createHandler(mockApp);
    const mockReq = {} as any;
    const mockRes = {} as any;

    await handler(mockReq, mockRes);

    expect(mockReq.fcContext).toBeUndefined();
  });
});
