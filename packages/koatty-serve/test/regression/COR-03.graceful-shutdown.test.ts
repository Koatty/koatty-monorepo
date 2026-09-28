/**
 * COR-03 regression tests (C-1): graceful shutdown closed loop.
 *
 * The contract (plan §6 C-1):
 *
 * ```
 * SIGTERM
 *   -> /ready returns 503 (load balancer takes this instance out of rotation)
 *   -> wait preStopDelay (default 5s)
 *   -> stop accepting new connections
 *   -> wait for in-flight requests (drainTimeout, default 25s)
 *   -> force close whatever is left
 *   -> emit appStop (db / redis / tracing / log flush)
 * ```
 *
 * These tests run a REAL http server on an ephemeral port (no `jest.mock('http')`)
 * so the assertions cover the observable behaviour rather than the wiring.
 *
 * @ license: BSD (3-Clause)
 */
import { EventEmitter } from "events";
import { request } from "http";
import { HttpServer } from "../../src/server/http";
import { TerminusManager } from "../../src/utils/terminus";

interface HttpResult {
  status: number;
  body: string;
}

function get(port: number, path: string, timeoutMs = 4000): Promise<HttpResult> {
  return new Promise<HttpResult>((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: "GET", timeout: timeoutMs },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString() })
        );
      }
    );
    req.on("timeout", () => req.destroy(new Error(`timeout waiting for ${path}`)));
    req.on("error", reject);
    req.end();
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function makeApp(handlers: Record<string, (req: any, res: any) => void> = {}): any {
  const app: any = new EventEmitter();
  app.name = "cor03-test-app";
  app.env = "test";
  app.security = { ops: {} };
  app.config = (key?: string, defaultValue?: any) => {
    const configs: Record<string, any> = {
      server: {
        hostname: "127.0.0.1",
        port: 0,
        protocol: "http",
        shutdown: { preStopDelay: 200, drainTimeout: 2000 },
      },
    };
    if (key) return configs[key] ?? defaultValue;
    return defaultValue;
  };
  app.callback = () => (req: any, res: any) => {
    const url = (req.url || "").split("?")[0];
    const handler = handlers[url];
    if (handler) return handler(req, res);
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  };
  return app;
}

describe("COR-03: graceful shutdown closed loop", () => {
  let app: any;
  let server: HttpServer;
  let port = 0;
  let appStopCount = 0;

  async function startServer(handlers?: Record<string, (req: any, res: any) => void>) {
    app = makeApp(handlers);
    appStopCount = 0;
    app.on("appStop", async () => {
      appStopCount++;
    });

    server = new HttpServer(app, {
      hostname: "127.0.0.1",
      port: 0,
      protocol: "http",
      shutdown: { preStopDelay: 200, drainTimeout: 2000 },
    } as any);

    await new Promise<void>((resolve) => server.Start(() => resolve()));
    port = (server.getNativeServer() as any).address().port;

    const manager = TerminusManager.getInstance();
    manager.setExitOnShutdown(false);
    manager.setPreStopDelay(150);
    manager.setDrainTimeout(2000);
    return manager;
  }

  async function stopServer() {
    if (server && server.getStatus() !== 0) {
      await new Promise<void>((resolve) => server.Stop(() => resolve()));
    }
    TerminusManager.resetInstance();
  }

  afterEach(async () => {
    await stopServer();
  });

  test("a healthy instance serves /ready 200 and /health with a minimal body", async () => {
    await startServer();

    const ready = await get(port, "/ready");
    expect(ready.status).toBe(200);

    const health = await get(port, "/health");
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toEqual({ status: "ok" });
    // no memory/cpu details leak into the liveness payload (SEC-06)
    expect(health.body).not.toContain("memory");
    expect(health.body).not.toContain("uptime");
  });

  test("beginDrain() flips /ready to 503 without closing the listener", async () => {
    await startServer();

    expect(server.getStatus()).toBe(200);
    expect(await get(port, "/ready")).toMatchObject({ status: 200 });

    server.beginDrain();

    expect(server.getStatus()).toBe(503);
    const draining = await get(port, "/ready");
    expect(draining.status).toBe(503);
    // still accepting connections: in-flight work may continue
    expect((await get(port, "/health")).status).toBe(200);
  });

  test("SIGTERM drains: /ready 503 first, in-flight request still completes, appStop fires once", async () => {
    let slowStarted = false;
    const manager = await startServer({
      "/slow": (_req: any, res: any) => {
        slowStarted = true;
        setTimeout(() => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("slow-done");
        }, 300);
      },
    });

    // let the in-flight request reach the handler before the signal
    const inFlight = get(port, "/slow");
    while (!slowStarted) {
      await sleep(10);
    }

    process.emit("SIGTERM");

    // during preStopDelay the instance is out of rotation but still serving
    await sleep(60);
    expect((await get(port, "/ready")).status).toBe(503);

    // the in-flight request is drained, not dropped
    await expect(inFlight).resolves.toMatchObject({ status: 200, body: "slow-done" });

    // wait for the shutdown sequence to finish
    for (let i = 0; i < 100 && appStopCount === 0; i++) {
      await sleep(50);
    }
    expect(appStopCount).toBe(1);
    expect(manager.getServerCount()).toBe(1);

    // sockets are closed: new connections are refused
    await expect(get(port, "/health", 500)).rejects.toThrow();
  });

  test("appStop runs after the servers are down (resource cleanup ordering)", async () => {
    const manager = await startServer();
    let listeningAtAppStop: boolean | undefined;
    app.on("appStop", () => {
      listeningAtAppStop = !!(server.getNativeServer() as any)?.listening;
    });

    await manager.shutdown("SIGTERM");
    for (let i = 0; i < 100 && appStopCount === 0; i++) {
      await sleep(50);
    }

    expect(appStopCount).toBe(1);
    // the listener must already be closed when resource cleanup runs
    expect(listeningAtAppStop).toBe(false);
  });
});

test('one signal cleans every application once and propagates failures after all cleanup', async () => {
  const manager = TerminusManager.getInstance();manager.setExitOnShutdown(false);manager.setPreStopDelay(0);
  const calls:string[]=[];
  const a:any=Object.assign(new EventEmitter(),{stopResources:async()=>{calls.push('a');throw Error('a cleanup failed')}});
  const b:any=Object.assign(new EventEmitter(),{stopResources:async()=>{calls.push('b')}});
  manager.registerServer(a,{Stop:(cb:any)=>cb(Error('transport failed'))} as any,'a');
  manager.registerServer(b,{Stop:(cb:any)=>cb()} as any,'b');
  manager.registerServer(b,{Stop:(cb:any)=>cb()} as any,'b2');
  await expect(manager.shutdown()).rejects.toThrow('shutdowns failed');expect(calls).toEqual(['a','b']);
  TerminusManager.resetInstance();
});
