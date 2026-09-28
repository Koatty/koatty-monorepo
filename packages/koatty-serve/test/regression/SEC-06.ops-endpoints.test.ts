/**
 * SEC-06 regression tests (B-6): ops endpoint hardening.
 *
 * - /health and /healthz always return the minimal liveness body;
 * - details are only served when `detailed` is enabled AND the caller is
 *   authorized (loopback/RFC1918 by socket.remoteAddress, allowCidrs, or
 *   the ops bearer token);
 * - /metrics exposure follows the `exposeMetrics` policy:
 *   off -> 404, internal (default) -> 403 for untrusted sources, public -> open;
 * - X-Forwarded-For is never trusted for the source decision.
 *
 * @ license: BSD (3-Clause)
 */
import {
  createHealthCheckMiddleware,
  isTrustedRemoteIp,
  resolveOpsConfig,
  HealthCheckConfig,
} from "../../src/middleware/healthCheck";

interface ResStub {
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
  writeHead: (code: number, headers?: Record<string, unknown>) => void;
  end: (data?: string) => void;
}

function makeRes(): ResStub {
  const stub: ResStub = {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers ?? {};
    },
    end(data) {
      this.body = data ?? "";
    },
  };
  return stub;
}

function makeReq(options: {
  url: string;
  remoteAddress?: string;
  headers?: Record<string, string>;
}): any {
  return {
    url: options.url,
    headers: options.headers ?? {},
    socket: { remoteAddress: options.remoteAddress ?? "203.0.113.9" },
  };
}

async function run(mw: ReturnType<typeof createHealthCheckMiddleware>, req: any) {
  const res = makeRes();
  let nextCalled = false;
  await mw(req, res, async () => { nextCalled = true; });
  return { res, nextCalled };
}

const EXTERNAL_IP = "203.0.113.9";

describe("SEC-06: liveness endpoints are minimal", () => {
  test("/health returns only {status:'ok'} for unauthorized (probe) callers", async () => {
    const mw = createHealthCheckMiddleware({ detailed: true });
    const { res } = await run(mw, makeReq({ url: "/health", remoteAddress: EXTERNAL_IP }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });

  test("/health minimal body has no memory/cpu/connection details", async () => {
    const mw = createHealthCheckMiddleware({});
    const { res } = await run(mw, makeReq({ url: "/health", remoteAddress: "127.0.0.1" }));
    const parsed = JSON.parse(res.body);
    expect(Object.keys(parsed)).toEqual(["status"]);
  });

  test("/healthz alias behaves the same", async () => {
    const mw = createHealthCheckMiddleware({});
    const { res } = await run(mw, makeReq({ url: "/healthz", remoteAddress: EXTERNAL_IP }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });
});

describe("SEC-06: detailed health requires authorization", () => {
  test("private-network callers still need a token for details", async () => {
    const mw = createHealthCheckMiddleware({ detailed: true });
    const { res } = await run(mw, makeReq({ url: "/health?detailed=1", remoteAddress: "10.1.2.3" }));
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toBe("ok");
    expect(parsed.details).toBeUndefined();
  });

  test("ops bearer token authorizes external callers", async () => {
    const mw = createHealthCheckMiddleware({ detailed: true, opsToken: "s3cret" });
    const { res } = await run(mw, makeReq({
      url: "/health?detailed=1",
      remoteAddress: EXTERNAL_IP,
      headers: { authorization: "Bearer s3cret" },
    }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).details).toBeDefined();
  });
});

describe("SEC-06: readiness", () => {
  test("/ready returns 200 and flips to 503 while draining (COR-03 hook)", async () => {
    const { HealthCheckMiddleware } = await import("../../src/middleware/healthCheck");
    const instance = new HealthCheckMiddleware({ memoryThresholdMB: 4096 });
    const { res: ready } = await run(instance.middleware(), makeReq({ url: "/ready", remoteAddress: EXTERNAL_IP }));
    expect(ready.statusCode).toBe(200);

    instance.setDraining(true);
    const { res: draining } = await run(instance.middleware(), makeReq({ url: "/ready", remoteAddress: "127.0.0.1" }));
    expect(draining.statusCode).toBe(503);

    // liveness stays available while draining
    const { res: live } = await run(instance.middleware(), makeReq({ url: "/health", remoteAddress: "127.0.0.1" }));
    expect(live.statusCode).toBe(200);
  });
});

describe("SEC-06: metrics exposure policy", () => {
  const metricsProvider = () => "# HELP test_metric 1\n";

  test("internal policy (default) blocks external sources with 403", async () => {
    const mw = createHealthCheckMiddleware({ metricsProvider });
    const { res } = await run(mw, makeReq({ url: "/metrics", remoteAddress: EXTERNAL_IP }));
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("test_metric");
  });

  test("internal policy serves loopback and private-range sources", async () => {
    const mw = createHealthCheckMiddleware({ metricsProvider });
    for (const ip of ["127.0.0.1", "::1", "10.0.0.5", "172.20.1.9", "192.168.1.10", "::ffff:192.168.0.3"]) {
      const { res } = await run(mw, makeReq({ url: "/metrics", remoteAddress: ip }));
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("test_metric");
    }
  });

  test("allowCidrs extends access", async () => {
    const mw = createHealthCheckMiddleware({ metricsProvider, allowCidrs: ["203.0.113.0/24"] });
    const { res } = await run(mw, makeReq({ url: "/metrics", remoteAddress: "203.0.113.77" }));
    expect(res.statusCode).toBe(200);
  });

  test("ops bearer token authorizes external scraping", async () => {
    const mw = createHealthCheckMiddleware({ metricsProvider, opsToken: "tok" });
    const { res } = await run(mw, makeReq({
      url: "/metrics",
      remoteAddress: EXTERNAL_IP,
      headers: { authorization: "Bearer tok" },
    }));
    expect(res.statusCode).toBe(200);
  });

  test("off policy hides the endpoint with 404", async () => {
    const mw = createHealthCheckMiddleware({ metricsProvider, exposeMetrics: "off" });
    const { res } = await run(mw, makeReq({ url: "/metrics", remoteAddress: "127.0.0.1" }));
    expect(res.statusCode).toBe(404);
  });

  test("public policy serves everyone", async () => {
    const mw = createHealthCheckMiddleware({ metricsProvider, exposeMetrics: "public" });
    const { res } = await run(mw, makeReq({ url: "/metrics", remoteAddress: EXTERNAL_IP }));
    expect(res.statusCode).toBe(200);
  });
});

describe("SEC-06: source address handling", () => {
  test("X-Forwarded-For is never trusted", async () => {
    const mw = createHealthCheckMiddleware({ metricsProvider: () => "m" });
    const { res } = await run(mw, makeReq({
      url: "/metrics",
      remoteAddress: EXTERNAL_IP,
      headers: { "x-forwarded-for": "10.0.0.1" },
    }));
    expect(res.statusCode).toBe(403);
  });

  test("isTrustedRemoteIp", () => {
    expect(isTrustedRemoteIp("127.0.0.1")).toBe(true);
    expect(isTrustedRemoteIp("::1")).toBe(true);
    expect(isTrustedRemoteIp("::ffff:10.1.2.3")).toBe(true);
    expect(isTrustedRemoteIp("172.16.255.254")).toBe(true);
    expect(isTrustedRemoteIp("192.168.0.1")).toBe(true);
    expect(isTrustedRemoteIp("8.8.8.8")).toBe(false);
    expect(isTrustedRemoteIp("172.32.0.1")).toBe(false);
    expect(isTrustedRemoteIp("")).toBe(false);
  });
});

describe("SEC-06: resolveOpsConfig", () => {
  test("reads the security profile and config/ops", () => {
    const app = {
      security: { ops: { exposeMetrics: "public" } },
      config: (key: string) => (key === "ops" ? { token: "t1", allowCidrs: ["10.9.0.0/16", 42] } : {}),
    };
    const cfg = resolveOpsConfig(app);
    expect(cfg.exposeMetrics).toBe("public");
    expect(cfg.opsToken).toBe("t1");
    expect(cfg.allowCidrs).toEqual(["10.9.0.0/16"]);
  });

  test("falls back to internal without an app", () => {
    expect(resolveOpsConfig(undefined).exposeMetrics).toBe("internal");
  });
});
