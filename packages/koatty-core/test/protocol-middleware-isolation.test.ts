import { IncomingMessage, ServerResponse } from 'http';
import { KoattyContext, KoattyNext } from '../src/IContext';
import { App } from './app';

describe('Task 1.1: Protocol Middleware Isolation', () => {
  test('should create separate middleware stacks for each protocol', () => {
    const app = new App();
    
    // Register HTTP callback with handler
    const httpHandler = jest.fn(async (ctx: any) => {
      ctx.body = 'HTTP';
    });
    app.callback('http', httpHandler);
    
    // Register gRPC callback with handler
    const grpcHandler = jest.fn(async (ctx: any) => {
      if (ctx.rpc) ctx.rpc.callback(null, {});
    });
    app.callback('grpc', grpcHandler);
    
    // Verify separate stacks exist
    const httpStack = app.getProtocolMiddleware('http');
    const grpcStack = app.getProtocolMiddleware('grpc');
    
    expect(httpStack).toBeDefined();
    expect(grpcStack).toBeDefined();
    expect(httpStack).not.toBe(grpcStack);
    
    // Verify the persistent stacks do NOT contain the handlers: the
    // `reqHandler` given to callback(protocol, reqHandler) is composed
    // per-request ([...stack, reqHandler]) and never persisted into
    // middlewareStacks, so getProtocolMiddleware() only ever returns the
    // copy of the global stack (see Application.callback).
    expect(httpStack).not.toContain(httpHandler);
    expect(grpcStack).not.toContain(grpcHandler);
    expect(httpStack).not.toContain(grpcHandler);
    expect(grpcStack).not.toContain(httpHandler);
  });
  
  test('should only execute protocol-specific handlers', async () => {
    const app = new App();
    const executionLog: string[] = [];
    
    const httpHandler = async (ctx: any) => {
      executionLog.push('http-handler');
      ctx.body = 'HTTP';
    };
    
    const grpcHandler = async (ctx: any) => {
      executionLog.push('grpc-handler');
    };
    
    const httpCallback = app.callback('http', httpHandler);
    app.callback('grpc', grpcHandler);
    
    // Execute HTTP request
    const req = new IncomingMessage({} as any);
    const res = new ServerResponse({} as any);
    await httpCallback(req, res);
    
    // Verify only HTTP handler executed
    expect(executionLog).toContain('http-handler');
    expect(executionLog).not.toContain('grpc-handler');
  });
  
  test('should return correct middleware statistics', () => {
    const app = new App();
    app.use(async (ctx: any, next: any) => await next());
    
    app.callback('http', async (ctx: any) => {});
    app.callback('grpc', async (ctx: any) => {});
    
    const stats = app.getMiddlewareStats();
    
    expect(stats.global).toBeGreaterThan(0);
    // Each protocol stack is initialized as a copy of the global stack; the
    // reqHandler passed to callback() is composed per-request and never
    // persisted, so a protocol stack never grows beyond the global stack.
    expect(stats.protocols.http).toBe(stats.global);
    expect(stats.protocols.grpc).toBe(stats.global);
  });

  test('should copy global middleware to protocol stacks', () => {
    const app = new App();
    
    // Add global middleware before creating protocol callbacks
    const globalMW = async (ctx: any, next: any) => await next();
    app.use(globalMW);
    
    const initialMWCount = app.middleware.length;
    
    // Create protocol callbacks WITHOUT handlers
    app.callback('http');
    app.callback('grpc');
    
    // Verify both protocols have the global middleware
    const httpStack = app.getProtocolMiddleware('http');
    const grpcStack = app.getProtocolMiddleware('grpc');
    
    expect(httpStack).toBeDefined();
    expect(grpcStack).toBeDefined();
    // Each protocol stack should have at least the global middleware
    expect(httpStack!.length).toBeGreaterThanOrEqual(initialMWCount);
    expect(grpcStack!.length).toBeGreaterThanOrEqual(initialMWCount);
  });

  test('should isolate protocol-specific handlers', () => {
    const app = new App();
    
    const httpHandler = jest.fn();
    const grpcHandler = jest.fn();
    
    app.callback('http', httpHandler);
    app.callback('grpc', grpcHandler);
    
    const httpStack = app.getProtocolMiddleware('http');
    const grpcStack = app.getProtocolMiddleware('grpc');
    
    // Handlers are per-request: callback() composes [...stack, reqHandler]
    // temporarily and never persists reqHandler into middlewareStacks, so
    // getProtocolMiddleware() returns only the copy of the global stack.
    // Isolation still holds: neither handler is visible in any persistent
    // stack, and each protocol got its own separate stack.
    expect(httpStack).not.toContain(httpHandler);
    expect(httpStack).not.toContain(grpcHandler);
    expect(grpcStack).not.toContain(grpcHandler);
    expect(grpcStack).not.toContain(httpHandler);
    expect(httpStack).not.toBe(grpcStack);
  });
});

