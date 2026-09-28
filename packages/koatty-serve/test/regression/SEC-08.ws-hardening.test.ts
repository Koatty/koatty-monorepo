/**
 * SEC-08 + COR-14 regression tests (B-8): WebSocket hardening.
 *
 * - hardened defaults: maxPayload from the security profile, perMessageDeflate off;
 * - upgrade origin checking (`ws.checkOrigin` profile flag + `ws.allowedOrigins`
 *   patterns with wildcard subdomain support) rejects with 403;
 * - connection-limit rejection with 503;
 * - internal error details are never echoed to the client;
 * - slow consumers are closed instead of buffering without bounds;
 * - ws pool destroy() clears ping/heartbeat timers (COR-14).
 *
 * @ license: BSD (3-Clause)
 */
import { WsServer } from "../../src/server/ws";
import { EventEmitter } from "events";
const servers: WsServer[] = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.destroy(); });

function makeApp(options: { wsProfile?: any; wsConfig?: any } = {}): any {
  return Object.assign(new EventEmitter(), {
    callback: () => (_req: any, res: any) => res.send("response"),
    security: { ws: options.wsProfile ?? {} },
    config: (key: string) => (key === "ws" ? (options.wsConfig ?? {}) : {}),
  });
}

function makeWsServer(appOptions: Parameters<typeof makeApp>[0] = {}, wsOptions: any = {}): WsServer {
  const app = makeApp(appOptions);
  const server = new WsServer(app, {
    wsOptions,
    hostname: "127.0.0.1",
    port: 0,
    protocol: "ws",
  } as any);
  servers.push(server);
  return server;
}

describe("SEC-08: WebSocket server defaults", () => {
  test("perMessageDeflate defaults to off and maxPayload comes from the profile", () => {
    const server = makeWsServer({ wsProfile: { maxPayload: 1024 * 1024, checkOrigin: true } });
    expect((server.options.wsOptions as any).perMessageDeflate).toBe(false);
    expect((server.options.wsOptions as any).maxPayload).toBe(1024 * 1024);
  });

  test("without a profile maxPayload fails closed to 1MiB", () => {
    const server = makeWsServer();
    expect((server.options.wsOptions as any).maxPayload).toBe(1024 * 1024);
    expect((server.options.wsOptions as any).perMessageDeflate).toBe(false);
  });

  test("explicit wsOptions win over the profile", () => {
    const server = makeWsServer({ wsProfile: { maxPayload: 1024 * 1024 } }, {maxPayload:4096});
    expect((server.options.wsOptions as any).maxPayload).toBe(4096);
  });

  test("checkOrigin without allowedOrigins rejects every origin", () => {
    const server = makeWsServer({ wsProfile: { checkOrigin: true } });
    expect((server as any).isOriginAllowed("https://anything.example.com")).toBe(false);
    expect((server as any).isOriginAllowed(undefined)).toBe(false);
  });

  test("origin allowlist supports exact hosts and wildcard subdomains", () => {
    const server = makeWsServer({
      wsProfile: { checkOrigin: true },
      wsConfig: { allowedOrigins: ["https://app.example.com", "*.other.org"] },
    });
    const check = (o: string) => (server as any).isOriginAllowed(o);

    expect(check("https://app.example.com")).toBe(true);
    expect(check("https://app.example.com:443")).toBe(true);
    expect(check("https://evil.example.com")).toBe(false);
    expect(check("https://a.other.org")).toBe(true);
    // '*' matches exactly one label (conventional wildcard-subdomain semantics)
    expect(check("https://a.b.other.org")).toBe(false);
    expect(check("https://other.org")).toBe(false);
    expect(check("not a url")).toBe(false);
  });

  test("a global '*' allowlist accepts every origin", () => {
    const server = makeWsServer({
      wsProfile: { checkOrigin: true },
      wsConfig: { allowedOrigins: ["*"] },
    });
    expect((server as any).isOriginAllowed("https://anything.net")).toBe(true);
  });

  test("upgrades from disallowed origins are rejected with 403", () => {
    const server = makeWsServer({
      wsProfile: { checkOrigin: true },
      wsConfig: { allowedOrigins: ["https://app.example.com"] },
    });

    const writes: string[] = [];
    const socket: any = {
      end: (data: string) => { writes.push(data); socket.destroyed = true; },
      destroy: () => { (socket as any).destroyed = true; },
      destroyed: false,
      remoteAddress: "203.0.113.5",
    };
    const handled: any[] = [];
    (server as any).server.handleUpgrade = (...args: any[]) => handled.push(args);

    (server as any).upgradeHandler(
      { headers: { origin: "https://evil.example.com" } }, socket, Buffer.alloc(0)
    );
    expect(writes.some((w) => w.includes("403 Forbidden"))).toBe(true);
    expect(socket.destroyed).toBe(true);
    expect(handled.length).toBe(0);

    (server as any).upgradeHandler(
      { headers: { origin: "https://app.example.com" } }, socket, Buffer.alloc(0)
    );
    expect(handled.length).toBe(1);
  });

  test("upgrades beyond the connection limit are rejected with 503", () => {
    const server = makeWsServer({
      wsConfig: { maxConnections: 1 },
    });
    (server as any).tracker.add(Object.assign(new EventEmitter(), {close: jest.fn()}));

    const writes: string[] = [];
    const socket: any = {
      end: (data: string) => { writes.push(data); socket.destroyed = true; },
      destroy: () => { (socket as any).destroyed = true; },
      destroyed: false,
    };
    (server as any).upgradeHandler({ headers: {} }, socket, Buffer.alloc(0));
    expect(writes.some((w) => w.includes("503 Service Unavailable"))).toBe(true);
    expect(socket.destroyed).toBe(true);
  });
});

describe("SEC-08: slow consumer guard", () => {
  test("pseudoRes.end closes the connection past maxBufferedAmount", async () => {
    const server = makeWsServer({ wsConfig: { maxBufferedAmount: 100 } });

    const ws: any = Object.assign(new EventEmitter(), {
      readyState: 1, bufferedAmount: 101, send: jest.fn(), close: jest.fn(), terminate: jest.fn(),
    });
    (server.getNativeServer() as any).emit('connection', ws, {headers:{},url:'/'});
    await (server as any).onMessage(ws, Buffer.from('hello'));
    expect(ws.close).toHaveBeenCalledWith(1008, 'Slow consumer');
  });
});

describe("COR-14: ws heartbeat cleanup", () => {
  test("destroy clears its owned heartbeat", async () => {
    const server = makeWsServer();
    expect((server as any).heartbeat).toBeDefined();
    await server.destroy();
    expect((server as any).heartbeat).toBeUndefined();
  });
});
