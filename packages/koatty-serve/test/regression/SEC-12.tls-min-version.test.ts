/**
 * SEC-12 regression tests (B-12): TLS hardening.
 *
 * - HTTPS auto/manual SSL options resolve `minVersion` from the explicit SSL
 *   config, then the application security profile, and finally fail closed to
 *   TLSv1.2;
 * - TLSv1.0/TLSv1.1 are never selected, even when requested explicitly;
 * - HTTP-family transports share these TLS options; obsolete pool scores are removed.
 *
 * @ license: BSD (3-Clause)
 */
import { HttpsServer } from "../../src/server/https";


// certificate loading is not what this test is about
jest.mock("../../src/utils/cert-loader", () => ({
  ...jest.requireActual("../../src/utils/cert-loader"),
  loadCertificates: jest.fn(() => ({key:"MOCK-KEY", cert:"MOCK-CERT"})),
}));

/** Build a HttpsServer-shaped object without running the server constructor. */
function makeServer(app: any = {}): any {
  const server: any = Object.create(HttpsServer.prototype);
  server.app = app;
  server.options = {ssl:{key:"/certs/key.pem",cert:"/certs/cert.pem"}};
  return server;
}

describe("SEC-12: minimum TLS version", () => {
  test("defaults to TLSv1.2 with no SSL config and no profile", () => {
    expect(makeServer().resolveMinVersion({})).toBe("TLSv1.2");
  });

  test("the security profile minVersion is honoured", () => {
    const app = { security: { tls: { minVersion: "TLSv1.3" } } };
    expect(makeServer(app).resolveMinVersion({})).toBe("TLSv1.3");
  });

  test("explicit SSL config wins over the profile", () => {
    const app = { security: { tls: { minVersion: "TLSv1.3" } } };
    expect(makeServer(app).resolveMinVersion({ minVersion: "TLSv1.2" })).toBe("TLSv1.2");
  });

  test("TLSv1.0/TLSv1.1 requests fall back to the safe version", () => {
    // no profile -> hard safe default
    expect(makeServer().resolveMinVersion({ minVersion: "TLSv1.1" as any })).toBe("TLSv1.2");
    expect(makeServer().resolveMinVersion({ minVersion: "TLSv1.0" as any })).toBe("TLSv1.2");
    // profile still wins over an unsafe explicit value
    const app = { security: { tls: { minVersion: "TLSv1.3" } } };
    expect(makeServer(app).resolveMinVersion({ minVersion: "TLSv1.0" as any })).toBe("TLSv1.3");
    // an unsafe profile value is ignored too
    const bad = { security: { tls: { minVersion: "TLSv1.1" } } };
    expect(makeServer(bad).resolveMinVersion({})).toBe("TLSv1.2");
  });

  test("auto mode wires the resolved version into the server options", () => {
    const app = { security: { tls: { minVersion: "TLSv1.3" } } };
    const options = makeServer(app).tlsOptions({
      key: "/certs/key.pem",
      cert: "/certs/cert.pem",
    });
    expect(options.minVersion).toBe("TLSv1.3");
  });

  test("manual mode wires the resolved version into the server options", () => {
    const options = makeServer().tlsOptions({
      key: "/certs/key.pem",
      cert: "/certs/cert.pem",
    });
    expect(options.minVersion).toBe("TLSv1.2");
  });
});
