import { AwsLambdaAdapter } from '../../src/adapters/aws-lambda';

describe('AwsLambdaAdapter', () => {
  let originalRequire: typeof require;

  beforeEach(() => {
    originalRequire = require;
  });

  afterEach(() => {
    (global as any).require = originalRequire;
    jest.resetModules();
  });

  it('adapter.name should be "aws-lambda"', () => {
    const adapter = new AwsLambdaAdapter();
    expect(adapter.name).toBe('aws-lambda');
  });

  it('should call serverlessExpress with app when createHandler is called', () => {
    const mockHandler = jest.fn().mockResolvedValue({ statusCode: 200 });
    const mockServerlessExpress = jest.fn().mockReturnValue(mockHandler);
    
    jest.resetModules();
    jest.doMock('@codegenie/serverless-express', () => mockServerlessExpress);
    
    const { AwsLambdaAdapter: Adapter } = require('../../src/adapters/aws-lambda');
    const adapter = new Adapter();
    const mockApp = { isReady: true } as any;

    const handler = adapter.createHandler(mockApp);

    expect(mockServerlessExpress).toHaveBeenCalledWith({ app: mockApp });
    expect(typeof handler).toBe('function');
  });

  it('should set context.callbackWaitsForEmptyEventLoop to false when handler is called', async () => {
    const mockHandler = jest.fn().mockResolvedValue({ statusCode: 200 });
    const mockServerlessExpress = jest.fn().mockReturnValue(mockHandler);
    
    jest.resetModules();
    jest.doMock('@codegenie/serverless-express', () => mockServerlessExpress);
    
    const { AwsLambdaAdapter: Adapter } = require('../../src/adapters/aws-lambda');
    const adapter = new Adapter();
    const mockApp = { isReady: true } as any;
    const mockContext = { callbackWaitsForEmptyEventLoop: true } as any;

    const handler = adapter.createHandler(mockApp);
    await handler({}, mockContext);

    expect(mockContext.callbackWaitsForEmptyEventLoop).toBe(false);
    expect(mockHandler).toHaveBeenCalledWith({}, mockContext);
  });

  it('should throw error with installation hint when serverless-express is not installed', () => {
    jest.resetModules();
    jest.doMock('@codegenie/serverless-express', () => {
      throw new Error('MODULE_NOT_FOUND');
    });
    
    const { AwsLambdaAdapter: Adapter } = require('../../src/adapters/aws-lambda');
    const adapter = new Adapter();
    const mockApp = { isReady: true } as any;

    expect(() => adapter.createHandler(mockApp)).toThrow(
      'AWS Lambda adapter requires "@codegenie/serverless-express"'
    );
  });
});
