import { EventEmitter } from 'events';
import { GrpcHandler } from '../../src/handler/grpc';
function context(stream = false): any {
  const call = Object.assign(new EventEmitter(), { koattyMethodKind: stream ? 'server_stream' : 'unary',
    getPath: () => '/test', getDeadline: () => Infinity, destroy: jest.fn(), metadata: {} });
  return { rpc: { call, callback: stream ? undefined : jest.fn() }, protocol: 'grpc',
    status: 200, body: { ok: true }, set: jest.fn(), startTime: Date.now() };
}
const handler = GrpcHandler.getInstance();
afterEach(() => jest.useRealTimers());
test('unary completes once without fabricating a stream finish', async () => {
  const ctx = context(); const finish = jest.fn(); ctx.rpc.call.on('finish', finish);
  await handler.handle(ctx, async () => {}, {});
  expect(ctx.rpc.callback).toHaveBeenCalledTimes(1);
  expect(ctx.rpc.callback).toHaveBeenCalledWith(null, { ok: true });
  expect(finish).not.toHaveBeenCalled();
});
test('client deadline replaces configured timeout', async () => {
  jest.useFakeTimers();
  const ctx = context(); ctx.rpc.call.getDeadline = () => Date.now() + 1000;
  const pending = handler.handle(ctx, () => new Promise(resolve => setTimeout(resolve, 500)), { timeout: 200 });
  await jest.advanceTimersByTimeAsync(501);
  await pending;
  expect(ctx.rpc.callback).toHaveBeenCalledWith(null, { ok: true });
});
test('fallback timeout returns DEADLINE_EXCEEDED once and does not rerun business', async () => {
  jest.useFakeTimers();
  const ctx = context(); const business = jest.fn(() => new Promise(() => {}));
  const pending = handler.handle(ctx, business, { timeout: 20 });
  await jest.advanceTimersByTimeAsync(21); await pending;
  expect(ctx.rpc.callback).toHaveBeenCalledWith(expect.objectContaining({ code: 4 }), null);
  expect(business).toHaveBeenCalledTimes(1);
});
test('stream middleware return is not stream completion and has no fixed timeout', async () => {
  jest.useFakeTimers();
  const ctx = context(true); let complete = false;
  const pending = handler.handle(ctx, async () => {}, { timeout: 20 }).then(() => { complete = true; });
  await jest.advanceTimersByTimeAsync(100);
  expect(complete).toBe(false);
  ctx.rpc.call.emit('finish'); await pending;
  expect(ctx.rpc.call.destroy).not.toHaveBeenCalled();
});
test('stream error destroys stream, and cancellation ends tracing', async () => {
  const ctx = context(true);
  await handler.handle(ctx, async () => { throw new Error('private error'); }, {});
  expect(ctx.rpc.call.destroy).toHaveBeenCalledWith(expect.objectContaining({ code: 13, message: 'Internal Server Error' }));
  const cancel = context(true);
  const pending = handler.handle(cancel, async () => {}, {});
  cancel.rpc.call.cancelled = true; cancel.rpc.call.emit('cancelled'); await pending;
  expect(cancel.status).toBe(499);
});
test('maps HTTP exception status to gRPC status', async () => {
  const ctx = context(); ctx.status = 401;
  await handler.handle(ctx, async () => {}, {});
  expect(ctx.rpc.callback).toHaveBeenCalledWith(expect.objectContaining({ code: 16 }), null);
});
