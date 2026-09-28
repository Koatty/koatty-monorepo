import { EventEmitter } from 'events';
import { GrpcRouter } from '../../src/router/grpc';

test('stream setup failure and router shutdown release their own RPC deadline timers', async () => {
  const app: any = {createContext: () => {throw new Error('cannot create context');}};
  const router: any = new GrpcRouter(app,{protocol:'grpc',ext:{protoFile:'./test.proto'}});
  const call: any = Object.assign(new EventEmitter(), {end: jest.fn()});
  await router.handleServerStreaming(call,app,{name:'Broken',method:'stream'});
  expect(router.streamTimers.size).toBe(0);
  router.handleClientStreaming(call,jest.fn(),app,{name:'Client',method:'stream'});
  expect(router.streamTimers.size).toBe(1);
  const timers = [...router.streamTimers.values()] as any[];
  router.cleanup(); expect(router.streamTimers.size).toBe(0);
  expect(timers.every(timer => timer._destroyed)).toBe(true);
});
