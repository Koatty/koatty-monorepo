import { TencentScfAdapter } from '../../src/adapters/tencent-scf';

describe('TencentScfAdapter', () => {
  it('adapter.name should be "tencent-scf"', () => {
    const adapter = new TencentScfAdapter();
    expect(adapter.name).toBe('tencent-scf');
  });

  describe('basic GET request conversion', () => {
    it('should convert event to mock req/res', async () => {
      const adapter = new TencentScfAdapter();
      let capturedReq: any = null;
      let capturedRes: any = null;
      
      const mockHttpHandler = jest.fn((req, res) => {
        capturedReq = req;
        capturedRes = res;
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end('{"ok":true}');
      });
      
      const mockApp = {
        getRequestHandler: jest.fn().mockReturnValue(mockHttpHandler),
        isReady: true,
      } as any;

      const handler = adapter.createHandler(mockApp);
      
      const event = {
        httpMethod: 'GET',
        path: '/api/users',
        headers: { 'Content-Type': 'application/json' },
      };
      const mockContext = { requestId: 'test-123' };
      
      const result = await handler(event, mockContext);
      
      expect(capturedReq.method).toBe('GET');
      expect(capturedReq.url).toBe('/api/users');
      expect(capturedReq.headers['content-type']).toBe('application/json');
      expect(capturedReq.scfContext).toBe(mockContext);
      
      expect(result.statusCode).toBe(200);
      expect(result.headers['content-type']).toBe('application/json');
      expect(result.body).toBe('{"ok":true}');
    });
  });

  describe('query string handling', () => {
    it('should include query string in req.url', async () => {
      const adapter = new TencentScfAdapter();
      let capturedReq: any = null;
      
      const mockHttpHandler = jest.fn((req, res) => {
        capturedReq = req;
        res.statusCode = 200;
        res.end('OK');
      });
      
      const mockApp = {
        getRequestHandler: jest.fn().mockReturnValue(mockHttpHandler),
        isReady: true,
      } as any;

      const handler = adapter.createHandler(mockApp);
      
      const event = {
        httpMethod: 'GET',
        path: '/search',
        queryString: { q: 'hello', page: '1' },
        headers: {},
      };
      
      await handler(event, {});
      
      expect(capturedReq.url).toBe('/search?q=hello&page=1');
    });
  });

  describe('POST request with body', () => {
    it('should write body to req stream', async () => {
      const adapter = new TencentScfAdapter();
      let capturedBody: string = '';
      
      const mockHttpHandler = jest.fn((req, res) => {
        req.on('data', (chunk: Buffer) => {
          capturedBody += chunk.toString();
        });
        req.on('end', () => {
          res.statusCode = 200;
          res.end('OK');
        });
      });
      
      const mockApp = {
        getRequestHandler: jest.fn().mockReturnValue(mockHttpHandler),
        isReady: true,
      } as any;

      const handler = adapter.createHandler(mockApp);
      
      const event = {
        httpMethod: 'POST',
        path: '/api/data',
        body: '{"name":"test"}',
        headers: {},
      };
      
      await handler(event, {});
      
      expect(capturedBody).toBe('{"name":"test"}');
    });
  });

  describe('Base64 encoded body', () => {
    it('should decode Base64 body', async () => {
      const adapter = new TencentScfAdapter();
      let capturedBody: string = '';
      
      const mockHttpHandler = jest.fn((req, res) => {
        req.on('data', (chunk: Buffer) => {
          capturedBody += chunk.toString();
        });
        req.on('end', () => {
          res.statusCode = 200;
          res.end('OK');
        });
      });
      
      const mockApp = {
        getRequestHandler: jest.fn().mockReturnValue(mockHttpHandler),
        isReady: true,
      } as any;

      const handler = adapter.createHandler(mockApp);
      
      const event = {
        httpMethod: 'POST',
        path: '/api/data',
        body: Buffer.from('hello').toString('base64'),
        isBase64Encoded: true,
        headers: {},
      };
      
      await handler(event, {});
      
      expect(capturedBody).toBe('hello');
    });
  });

  describe('response format', () => {
    it('should return API Gateway response format', async () => {
      const adapter = new TencentScfAdapter();
      
      const mockHttpHandler = jest.fn((req, res) => {
        res.statusCode = 201;
        res.setHeader('x-custom', 'value');
        res.end('Created');
      });
      
      const mockApp = {
        getRequestHandler: jest.fn().mockReturnValue(mockHttpHandler),
        isReady: true,
      } as any;

      const handler = adapter.createHandler(mockApp);
      
      const event = { httpMethod: 'POST', path: '/', headers: {} };
      const result = await handler(event, {});
      
      expect(result).toEqual({
        isBase64Encoded: false,
        statusCode: 201,
        headers: { 'x-custom': 'value' },
        body: 'Created',
      });
    });
  });
});
