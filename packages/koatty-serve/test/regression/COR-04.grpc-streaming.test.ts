/**
 * COR-04 regression tests (C-2): gRPC call-shape dispatch.
 *
 * Before the fix `RegisterService` wrapped every method as `(call, callback)`,
 * so server-streaming and bidirectional methods were broken: the wrapper armed a
 * response-callback timeout and never handed the raw call to the middleware
 * chain as a stream.
 *
 * The tests below drive the wrapped handlers that are handed to
 * `server.addService()` and assert the contract from the plan:
 *
 * | kind          | wrapper signature | timeout                      |
 * |---------------|-------------------|------------------------------|
 * | unary         | (call, callback)  | call.getDeadline() ?? config |
 * | client stream | (call, callback)  | same as unary                |
 * | server stream | (call)            | none                         |
 * | bidi stream   | (call)            | none                         |
 *
 * @license: BSD (3-Clause)
 */
import { GrpcServer, getGrpcDeadlineMs, getGrpcMethodKind } from '../../src/server/grpc';
import { KoattyApplication } from 'koatty_core';

const mockGrpcServer = {
  addService: jest.fn(),
  bind: jest.fn(() => 0),
  bindAsync: jest.fn((address: string, credentials: any, callback: any) => {
    setTimeout(() => callback(null, 50051), 0);
  }),
  start: jest.fn(),
  tryShutdown: jest.fn((callback: any) => setImmediate(() => callback())),
  forceShutdown: jest.fn(),
  register: jest.fn(),
  _acceptingNewConnections: true,
};

jest.mock('@grpc/grpc-js', () => ({
  Server: jest.fn().mockImplementation(() => mockGrpcServer),
  ServerCredentials: { createInsecure: jest.fn(() => ({})), createSsl: jest.fn(() => ({})) },
  credentials: { createInsecure: jest.fn(() => ({})), createSsl: jest.fn(() => ({})) },
  loadPackageDefinition: jest.fn(() => ({})),
  status: { OK: 0, CANCELLED: 1, DEADLINE_EXCEEDED: 4, INTERNAL: 13, UNIMPLEMENTED: 12 },
}));

jest.mock('@grpc/proto-loader', () => ({ loadSync: jest.fn(() => ({})) }));
jest.mock('fs');

/** Minimal EventEmitter + grpc-js stream surface used by the wrapper. */
function makeCall(overrides: Record<string, any> = {}) {
  const { EventEmitter } = require('events');
  const call: any = Object.assign(new EventEmitter(), {
    getPeer: () => '127.0.0.1:5555',
    write: jest.fn(() => true), end: jest.fn(), destroy: jest.fn(), ...overrides,
  });
  return call;
}

const SERVICE = {
  Unary: { path: '/t.S/Unary', requestStream: false, responseStream: false },
  ClientStream: { path: '/t.S/ClientStream', requestStream: true, responseStream: false },
  ServerStream: { path: '/t.S/ServerStream', requestStream: false, responseStream: true },
  BidiStream: { path: '/t.S/BidiStream', requestStream: true, responseStream: true },
} as any;

describe('COR-04: gRPC call-shape dispatch', () => {
  let mockApp: any;
  let grpcServer: GrpcServer;
  let middlewareHandler: jest.Mock;
  let registered: Record<string, any>;

  beforeEach(() => {
    jest.clearAllMocks();
    middlewareHandler = jest.fn().mockResolvedValue(undefined);
    mockApp = {
      config: jest.fn(() => ({ hostname: '127.0.0.1', port: 50051, protocol: 'grpc' })),
      on: jest.fn(),
      emit: jest.fn(),
      callback: jest.fn(() => middlewareHandler),
    };
    grpcServer = new GrpcServer(mockApp as KoattyApplication, {
      hostname: '127.0.0.1',
      port: 50051,
      protocol: 'grpc',
    });
    grpcServer.RegisterService({
      service: { ...SERVICE, serviceName: 't.S' },
      implementation: {
        Unary: jest.fn(),
        ClientStream: jest.fn(),
        ServerStream: jest.fn(),
        BidiStream: jest.fn(),
      },
    } as any);
    registered = mockGrpcServer.addService.mock.calls.at(-1)![1];
  });

  afterEach(async () => { await grpcServer.destroy(); });

  it('classifies each method from its proto definition', () => {
    expect(getGrpcMethodKind(SERVICE, 'Unary')).toBe('unary');
    expect(getGrpcMethodKind(SERVICE, 'ClientStream')).toBe('client_stream');
    expect(getGrpcMethodKind(SERVICE, 'ServerStream')).toBe('server_stream');
    expect(getGrpcMethodKind(SERVICE, 'BidiStream')).toBe('bidi_stream');
  });

  it('registers a wrapper for every service method that has an implementation', () => {
    expect(Object.keys(registered).sort()).toEqual(
      ['BidiStream', 'ClientStream', 'ServerStream', 'Unary'].sort()
    );
  });

  it('unary: keeps the (call, callback) shape and answers through the callback', async () => {
    const call = makeCall({ request: { id: 1 } });
    const callback = jest.fn();

    expect(registered.Unary.length).toBe(2);
    await registered.Unary(call, callback);

    expect(middlewareHandler).toHaveBeenCalledWith(call, expect.any(Function));
    // the middleware answers through the wrapped callback (the router does this)
    const wrappedCallback = middlewareHandler.mock.calls[0][1];
    wrappedCallback(null, { ok: true });
    expect(callback).toHaveBeenCalledWith(null, { ok: true });
  });

  it('client stream: keeps the (call, callback) shape', () => {
    expect(registered.ClientStream.length).toBe(2);
  });

  it('server stream: is wrapped as (call) and never arms a callback timeout', async () => {
    const call = makeCall({ writable: true });
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    expect(registered.ServerStream.length).toBe(1);
    await registered.ServerStream(call);

    // the middleware chain receives the raw call and no response callback
    expect(middlewareHandler).toHaveBeenCalledWith(call, undefined);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it('bidi stream: is wrapped as (call)', async () => {
    const call = makeCall({ readable: true, writable: true });

    expect(registered.BidiStream.length).toBe(1);
    await registered.BidiStream(call);

    expect(middlewareHandler).toHaveBeenCalledWith(call, undefined);
  });

  it('stops writing after the client cancels, without destroying the call', async () => {
    const call = makeCall({ writable: true });

    await registered.ServerStream(call);
    call.write({ chunk: 1 });
    expect(call.write).toBeDefined();

    call.emit('cancelled');
    const result = call.write({ chunk: 2 });

    expect(result).toBe(false);
    // a client-side cancel is not an error: the server must not destroy the call
    expect(call.destroy).not.toHaveBeenCalled();
  });

  it('honours the client deadline and reports DEADLINE_EXCEEDED when it passes', async () => {
    const deadline = new Date(Date.now() - 5); // already in the past
    const call = makeCall({ request: {}, getDeadline: () => deadline });
    const callback = jest.fn();

    await registered.Unary(call, callback);
    // the framework timeout is armed with the (clamped) remaining deadline
    expect((call as any).koattyDeadlineMs).toBe(1);

    // wait for the armed timer to fire
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: 4 }),
      null
    );
  });

  it('falls back to the configured timeout when the call carries no deadline', async () => {
    const call = makeCall({ request: {} });
    const callback = jest.fn();

    await registered.Unary(call, callback);

    expect((call as any).koattyDeadlineMs).toBeUndefined();
    expect(middlewareHandler).toHaveBeenCalledWith(call, expect.any(Function));
    const wrappedCallback = middlewareHandler.mock.calls[0][1];
    wrappedCallback(null, { ok: true });
    expect(callback).toHaveBeenCalledWith(null, { ok: true });
  });

  it('getGrpcDeadlineMs normalises deadlines and tolerates missing ones', () => {
    expect(getGrpcDeadlineMs({ getDeadline: () => new Date(Date.now() + 5000) })).toBeGreaterThan(4000);
    expect(getGrpcDeadlineMs({ getDeadline: () => new Date(Date.now() - 5000) })).toBe(1);
    expect(getGrpcDeadlineMs({ getDeadline: () => null })).toBeUndefined();
    expect(getGrpcDeadlineMs({})).toBeUndefined();
  });
});
