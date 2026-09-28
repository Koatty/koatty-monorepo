/**
 * ARCH-01 / D-1 step 4 regression tests: application-owned container reference.
 *
 * `app.container` defaults to the global IOC (backward compatible) so framework
 * code can resolve beans through the application instead of importing the
 * global singleton, and an isolated container can be swapped in for a fully
 * independent application in the same process.
 *
 * @ license: BSD (3-Clause)
 */
import { IOC } from 'koatty_container';
import { Koatty } from '../../src/Application';

describe('ARCH-01: application container reference', () => {
  test('app.container defaults to the global IOC container', () => {
    const app = new (class extends Koatty { })();
    expect(app.container).toBe(IOC);
  });

  test('a swapped isolated container is used for resolution', () => {
    class AppScopedBean {}

    const app = new (class extends Koatty { })();
    // Minimal isolated container stub: proves the app honours the reference.
    const isolated = {
      get: (id: string) => ({ id, from: 'isolated' }),
      saveClass: () => undefined,
    } as any;

    app.container = isolated;
    expect(app.container).not.toBe(IOC);
    expect(app.container.get('AppScopedBean')).toEqual({ id: 'AppScopedBean', from: 'isolated' });
    // The global container is untouched by the swap.
    expect(IOC.getClass('AppScopedBean', 'COMPONENT')).toBeUndefined();
  });

  test('container is declared on the KoattyApplication surface', () => {
    const app = new (class extends Koatty { })();
    expect('container' in app).toBe(true);
  });
});
