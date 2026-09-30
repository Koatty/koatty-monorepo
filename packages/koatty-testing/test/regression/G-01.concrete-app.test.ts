import { Koatty } from 'koatty';
import { createTestApp } from '../../src/testApp';

class ConcreteApp extends Koatty {}

test('createTestApp accepts a real Koatty subclass without an unsafe cast', () => {
  // Compile-time regression: the old Constructor<KoattyApplication> rejected the
  // concrete class with newer Koa ctxStorage declarations.
  const appClass: Parameters<typeof createTestApp>[0] = ConcreteApp;
  expect(appClass.prototype).toBeInstanceOf(Koatty);
});
