jest.mock('@matrixai/quic', () => { throw new Error('fixture: native backend unavailable'); }, {virtual:true});
import {Http3ServerAdapter,isMatrixaiQuicReady} from '../src';
test('missing native backend rejects listen and never announces readiness', async () => {
  const server=new Http3ServerAdapter({hostname:'127.0.0.1',port:0,keyFile:'unused',certFile:'unused'});
  const ready=jest.fn();
  await expect(server.listen(ready)).rejects.toThrow(/not installed or failed to load/);
  expect(ready).not.toHaveBeenCalled();expect(isMatrixaiQuicReady()).toBe(false);
  await server.close();
});
