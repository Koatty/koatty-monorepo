import { Koatty } from '../../src';

test('manual stop and signal cleanup share async once listeners', async () => {
  const app = new Koatty();
  let release!: () => void;
  const cleanup = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
  app.once('appStop', cleanup);
  let complete = false;
  const first = app.stop().then(() => { complete = true; });
  const second = app.stopResources();
  await new Promise(resolve => setImmediate(resolve));
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(complete).toBe(false);
  release();
  await Promise.all([first, second, app.stop()]);
  expect(app.listenerCount('appStop')).toBe(0);
  expect(cleanup).toHaveBeenCalledTimes(1);
});

test('cleanup failures remain visible and later listeners still run', async () => {
  const app = new Koatty();
  const last = jest.fn();
  app.once('appStop', () => { throw new Error('cleanup failed'); });
  app.once('appStop', last);
  await expect(app.stop()).rejects.toThrow('cleanup failed');
  await expect(app.stop()).rejects.toThrow('cleanup failed');
  expect(last).toHaveBeenCalledTimes(1);
});
