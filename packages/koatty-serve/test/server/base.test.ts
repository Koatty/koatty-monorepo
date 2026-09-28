import { BaseServer } from '../../src/server/base';
class Transport extends BaseServer {
  close = jest.fn<Promise<void>, []>(() => Promise.resolve());
  force = jest.fn(); release = jest.fn();
  constructor() {super({} as any, {protocol:'http',port:0,hostname:'127.0.0.1'});}
  Start(cb?: () => void) {this.markStarted();cb?.();}
  protected closeTransport() {return this.close();}
  protected forceTransport() {this.force();}
  protected cleanup() {this.release();}
  protected recreate() {}
}
beforeEach(() => jest.useRealTimers());
test('concurrent stop callers share the same shutdown and run cleanup once', async () => {
  const s = new Transport();s.Start();
  const first=s.gracefulShutdown();expect(s.gracefulShutdown()).toBe(first);
  expect(await first).toMatchObject({status:'completed'});
  await s.destroy();expect(s.close).toHaveBeenCalledTimes(1);expect(s.release).toHaveBeenCalledTimes(1);expect(s.status).toBe(0);
});
test('a stalled close is bounded and force-closes the transport', async () => {
  const s = new Transport();s.close.mockImplementation(() => new Promise(() => {}));
  expect(await s.gracefulShutdown({timeout:5})).toMatchObject({status:'forced'});
  expect(s.force).toHaveBeenCalledTimes(1);expect(s.release).toHaveBeenCalledTimes(1);
});
test.each(['close','force','release'])('reports %s failure without skipping final cleanup', async method => {
  const s = new Transport();
  if(method==='force') s.close.mockImplementation(() => new Promise(() => {}));
  (s as any)[method].mockImplementation(() => {throw Error('failure')});
  expect(await s.gracefulShutdown({timeout:5})).toMatchObject({status:'failed'});
  expect(s.release).toHaveBeenCalledTimes(1);expect(s.status).toBe(0);
});
test('Stop propagates failures to its callback', async () => {
  const s=new Transport();s.close.mockRejectedValue(Error('failure'));
  const error=await new Promise(resolve=>s.Stop(resolve));expect(error).toBeInstanceOf(Error);
});
test('unchanged config does not restart; changed config recreates and starts', async () => {
  const s=new Transport();s.Start();expect(await s.updateConfig({port:0})).toBe(false);
  expect(await s.updateConfig({port:12345})).toBe(true);expect(s.getConfigVersion()).toBe(1);expect(s.status).toBe(200);await s.destroy();
});
