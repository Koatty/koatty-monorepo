/**
 * SEC-07 + SEC-15 regression tests (B-7): request ID validation and
 * structured access logging.
 *
 * - external request IDs must match /^[A-Za-z0-9._:-]{1,128}$/;
 * - invalid IDs are discarded and replaced, never logged;
 * - query-string IDs are opt-in (requestIdFromQuery, default false);
 * - the topology `service` header is only trusted when
 *   opentelemetryConf.trustServiceHeader is enabled;
 * - access logs are structured objects, not hand-built JSON strings.
 *
 * @ license: BSD (3-Clause)
 */
import { getRequestId, acceptExternalId, REQUEST_ID_RE, SERVICE_NAME_RE } from "../../src/utils/utils";
import { buildRequestLogData } from "../../src/handler/base";
import { TraceOptions } from "../../src/trace/itrace";

function mockCtx(overrides: Record<string, any> = {}): any {
  return {
    protocol: "http",
    headers: {},
    query: {},
    getMetaData: () => [],
    method: "GET",
    status: 200,
    startTime: Date.now() - 5,
    requestId: "generated-id",
    originalPath: "/foo",
    ...overrides,
  };
}

const BASE_OPTIONS: TraceOptions = {
  requestIdHeaderName: "x-request-id",
  requestIdName: "requestId",
};

describe("SEC-07: request ID validation", () => {
  test("valid external IDs are accepted", () => {
    const ctx = mockCtx({ headers: { "x-request-id": "abc-123_XYZ.42:9" } });
    expect(getRequestId(ctx, BASE_OPTIONS)).toBe("abc-123_XYZ.42:9");
  });

  test.each([
    ["newline injection", "abc\nEVIL"],
    ["carriage return", "abc\rEVIL"],
    ["quote", 'abc"evil'],
    ["brace injection", "abc${evil}"],
    ["too long", "a".repeat(129)],
    ["unicode", "请求id"],
  ])("invalid external ID (%s) is discarded and replaced", (_name, bad) => {
    const ctx = mockCtx({ headers: { "x-request-id": bad } });
    const id = getRequestId(ctx, BASE_OPTIONS);
    expect(id).not.toBe(bad);
    expect(REQUEST_ID_RE.test(id)).toBe(true);
  });

  test("array headers use the first entry and still validate", () => {
    const ctx = mockCtx({ headers: { "x-request-id": ["good-id", "ignored"] } });
    expect(getRequestId(ctx, BASE_OPTIONS)).toBe("good-id");
    const bad = mockCtx({ headers: { "x-request-id": ["bad\rid", "ignored"] } });
    expect(REQUEST_ID_RE.test(getRequestId(bad, BASE_OPTIONS))).toBe(true);
  });

  test("query string is NOT used by default", () => {
    const ctx = mockCtx({ headers: {}, query: { requestId: "from-query" } });
    const id = getRequestId(ctx, BASE_OPTIONS);
    expect(id).not.toBe("from-query");
  });

  test("query string is used when requestIdFromQuery is enabled", () => {
    const ctx = mockCtx({ headers: {}, query: { requestId: "from-query" } });
    expect(getRequestId(ctx, { ...BASE_OPTIONS, requestIdFromQuery: true }))
      .toBe("from-query");
  });

  test("grpc metadata IDs are validated too", () => {
    const ctx = mockCtx({
      protocol: "grpc",
      getMetaData: (key: string) => (key === "requestId" ? "grpc\nbad" : []),
    });
    const id = getRequestId(ctx, BASE_OPTIONS);
    expect(REQUEST_ID_RE.test(id)).toBe(true);
  });

  test("acceptExternalId helper", () => {
    expect(acceptExternalId("ok.id_1:2")).toBe("ok.id_1:2");
    expect(acceptExternalId(undefined)).toBeUndefined();
    expect(acceptExternalId(42)).toBeUndefined();
    expect(acceptExternalId("bad id")).toBeUndefined();
  });
});

describe("SEC-07: structured access log", () => {
  test("buildRequestLogData returns a data object (no interpolated JSON string)", () => {
    const ctx = mockCtx({ method: "POST", status: 201, requestId: "rid-1" });
    const data = buildRequestLogData(ctx);
    expect(typeof data).toBe("object");
    expect(data.action).toBe("POST");
    expect(data.status).toBe(201);
    expect(data.requestId).toBe("rid-1");
    expect(data.path).toBe("/foo");
    expect(data.duration).toBeGreaterThanOrEqual(0);
  });

  test("buildRequestLogData accepts an explicit status override", () => {
    const ctx = mockCtx({ status: 0 });
    const data = buildRequestLogData(ctx, "OK");
    expect(data.status).toBe("OK");
  });
});

describe("SEC-15: topology service header", () => {
  // trace middleware topology recording is covered indirectly: the trust
  // gate lives in trace.ts and only accepts SERVICE_NAME_RE-matching values
  // when trustServiceHeader is enabled; here we pin the shared pattern.
  test("SERVICE_NAME_RE rejects injection payloads", () => {
    expect(SERVICE_NAME_RE.test("order-service.v2")).toBe(true);
    expect(SERVICE_NAME_RE.test("a".repeat(128))).toBe(true);
    expect(SERVICE_NAME_RE.test("a".repeat(129))).toBe(false);
    expect(SERVICE_NAME_RE.test("evil\nservice")).toBe(false);
    expect(SERVICE_NAME_RE.test("service;drop")).toBe(false);
  });
});

test('P2 actual trace middleware trusts service headers only after explicit opt-in', async () => {
  const { Trace } = await import('../../src/trace/trace');
  const { HandlerFactory } = await import('../../src/handler/factory');
  const { TopologyAnalyzer } = await import('../../src/opentelemetry/topology');
  const recordServiceDependency = jest.fn();
  const topology = jest.spyOn(TopologyAnalyzer, 'getInstance').mockReturnValue({ recordServiceDependency } as any);
  const handler = jest.spyOn(HandlerFactory, 'getHandler').mockReturnValue({ handle: async () => undefined } as any);
  try {
    for (const [trust, header, expected] of [[false, 'caller', 'unknown'], [true, 'caller', 'caller'], [true, 'bad\nheader', 'unknown']] as const) {
      const middleware = Trace({ enableTrace: false, opentelemetryConf: { enableTopology: true, trustServiceHeader: trust } } as any, { name: 'app', once: jest.fn(), server: { status: 200 } } as any);
      await middleware(mockCtx({ protocol: 'http', headers: { service: header }, req: { method: 'GET' }, set: jest.fn() }), async () => undefined);
      expect(recordServiceDependency).toHaveBeenLastCalledWith('app', expected);
    }
  } finally { topology.mockRestore(); handler.mockRestore(); }
});
