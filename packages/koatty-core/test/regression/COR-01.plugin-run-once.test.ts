/**
 * COR-01 regression test: a user plugin that only defines `run()` (no
 * @OnEvent binding) must execute exactly once (auto-bound to `appReady`).
 * The direct `run()` invocation during loadUserComponents was removed.
 *
 * @ license: BSD (3-Clause)
 */
import { IOC } from "koatty_container";
import { Koatty } from "../../src/Application";
import { ComponentManager, Plugin, OnEvent } from "../../src/index";
import { AppEvent } from "../../src/IApplication";

describe("COR-01: plugin run() executes exactly once", () => {
  test("run()-only plugin executes once via the appReady auto-binding", async () => {
    let runCount = 0;

    @Plugin("Cor01RunOncePlugin")
    class Cor01RunOncePlugin {
      run() {
        runCount++;
      }
    }

    // mirror Loader.LoadComponents: register the class in the IOC so the
    // instance exists before event registration (instances now exist)
    IOC.reg("Cor01RunOncePlugin", Cor01RunOncePlugin, { scope: "Singleton", type: "COMPONENT", args: [] });

    const app = new (class extends Koatty { })();
    app.setMetaData("_configs", {
      plugin: { list: ["Cor01RunOncePlugin"] },
    });

    const manager = new ComponentManager(app as any);
    manager.discoverComponents();
    await manager.loadUserComponents();

    // simulate bootstrap reaching appReady
    await app.emit(AppEvent.appReady, app);

    expect(runCount).toBe(1);
  });

  test("explicitly bound run() (@OnEvent) executes only for that event", async () => {
    const calls: string[] = [];

    @Plugin("Cor01OnEventPlugin")
    class Cor01OnEventPlugin {
      run() {
        calls.push("run");
      }

      @OnEvent(AppEvent.appReady)
      onReady() {
        calls.push("onReady");
      }
    }

    IOC.reg("Cor01OnEventPlugin", Cor01OnEventPlugin, { scope: "Singleton", type: "COMPONENT", args: [] });

    const app = new (class extends Koatty { })();
    app.setMetaData("_configs", {
      plugin: { list: ["Cor01OnEventPlugin"] },
    });

    const manager = new ComponentManager(app as any);
    manager.discoverComponents();
    await manager.loadUserComponents();
    await app.emit(AppEvent.appReady, app);

    // binding order: @OnEvent handlers register first, then the unmarked
    // run() auto-binds to appReady — each executes exactly once
    expect(calls).toEqual(["onReady", "run"]);
  });

  test("double registration of component events does not double-bind handlers", async () => {
    let runCount = 0;

    @Plugin("Cor01IdempotentPlugin")
    class Cor01IdempotentPlugin {
      run() {
        runCount++;
      }
    }

    IOC.reg("Cor01IdempotentPlugin", Cor01IdempotentPlugin, { scope: "Singleton", type: "COMPONENT", args: [] });

    const app = new (class extends Koatty { })();
    app.setMetaData("_configs", {
      plugin: { list: ["Cor01IdempotentPlugin"] },
    });

    const manager = new ComponentManager(app as any);
    manager.discoverComponents();
    // loadUserComponents twice: the second pass must be a no-op
    await manager.loadUserComponents();
    await manager.loadUserComponents();
    await app.emit(AppEvent.appReady, app);

    expect(runCount).toBe(1);
  });
});
