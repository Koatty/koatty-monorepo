import { HttpServer } from '../../src/server/http';
import { EventEmitter } from 'events';

test('HTTP construction and startup do not schedule discarded 30-second metric snapshots', async () => {
  jest.useRealTimers();
  const app: any = Object.assign(new EventEmitter(), {config: () => ({}), callback: () => (_req: any,res: any) => res.end('ok')});
  const intervals = jest.spyOn(global, 'setInterval');
  const server = new HttpServer(app, {protocol:'http',hostname:'127.0.0.1',port:0,shutdown:{preStopDelay:0,drainTimeout:10}});
  try {
    await new Promise<void>(resolve => server.Start(resolve));
    expect(intervals).not.toHaveBeenCalled();
  } finally { await server.destroy(); intervals.mockRestore(); }
});
