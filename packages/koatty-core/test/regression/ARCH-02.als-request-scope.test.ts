/**
 * ARCH-02 / D-2 end-to-end: the container must resolve Request-scoped beans
 * from the application's AsyncLocalStorage context, without any explicit
 * `runInRequestScope` call.
 *
 * This exercises the real wiring added for D-2:
 *   request -> app.ctxStorage.run(ctx) -> container.get() -> getCurrentContext()
 *
 * @ license: BSD (3-Clause)
 */
import { Container, IOC } from 'koatty_container';
import { Koatty } from '../../src/Application';

function asRequestScoped<T extends Function>(cls: T): T {
  Reflect.defineProperty(cls.prototype, '_options', {
    value: { scope: 'Request' },
    configurable: true,
  });
  return cls;
}

describe('ARCH-02: AsyncLocalStorage-driven request scope', () => {
  test('getCurrentContext returns the context inside ctxStorage.run', () => {
    const app = new (class extends Koatty { })();
    expect(app.getCurrentContext()).toBeUndefined();

    const ctx = { requestId: 'req-1' };
    const seen = app.ctxStorage.run(ctx, () => app.getCurrentContext());
    expect(seen).toBe(ctx);

    // Outside the run callback the store is empty again.
    expect(app.getCurrentContext()).toBeUndefined();
  });

  test('the container resolves Request-scoped beans from the ALS context', () => {
    class AlsScopedBean {
      id = Math.random();
    }
    asRequestScoped(AlsScopedBean);

    const app = new (class extends Koatty { })();
    const isolated = new Container();
    isolated.setApp(app as any);
    app.container = isolated;
    isolated.saveClass('COMPONENT', AlsScopedBean, AlsScopedBean.name);

    const ctxA = { requestId: 'a' };
    const ctxB = { requestId: 'b' };

    // No runInRequestScope: resolution must come from the ALS store.
    const a1 = app.ctxStorage.run(ctxA, () => app.container.get<any>(AlsScopedBean.name, 'COMPONENT'));
    const a2 = app.ctxStorage.run(ctxA, () => app.container.get<any>(AlsScopedBean.name, 'COMPONENT'));
    const b1 = app.ctxStorage.run(ctxB, () => app.container.get<any>(AlsScopedBean.name, 'COMPONENT'));

    expect(a1).toBe(a2);
    expect(b1).not.toBe(a1);

    // The default container is untouched by the isolated one.
    expect(IOC.getClass(AlsScopedBean.name, 'COMPONENT')).toBeUndefined();
  });

  test('resolution outside any request rejects instead of capturing singleton state', () => {
    class OutsideBean {
      id = Math.random();
    }
    asRequestScoped(OutsideBean);

    const app = new (class extends Koatty { })();
    const isolated = new Container();
    isolated.setApp(app as any);
    isolated.saveClass('COMPONENT', OutsideBean, OutsideBean.name);

    // No active context: must not silently allocate unbounded instances.
    expect(app.getCurrentContext()).toBeUndefined();
    expect(() => isolated.get<any>(OutsideBean.name, 'COMPONENT')).toThrow(/active request context/);
  });
});
