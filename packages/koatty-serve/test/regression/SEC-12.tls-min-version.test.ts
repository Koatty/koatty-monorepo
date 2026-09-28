/**
 * SEC-12 regression tests (B-12): TLS hardening.
 *
 * - HTTPS auto/manual SSL options resolve `minVersion` from the explicit SSL
 *   config, then the application security profile, and finally fail closed to
 *   TLSv1.2;
 * - TLSv1.0/TLSv1.1 are never selected, even when requested explicitly;
 * - the HTTPS connection pool gives TLSv1.0/1.1 zero protocol points (the old
 *   "partially secure" score for TLSv1.1 is gone).
 *
 * @ license: BSD (3-Clause)
 */
import { HttpsServer } from "../../src/server/https";
import { HttpsConnectionPoolManager } from "../../src/pools/https";

// certificate loading is not what this test is about
jest.mock("../../src/utils/cert-loader", () => ({
  loadCertificate: jest.fn(() => "MOCK-PEM"),
}));

/** Build a HttpsServer-shaped object without running the server constructor. */
function makeServer(app: any = {}): any {
  const server: any = Object.create(HttpsServer.prototype);
  server.app = app;
  return server;
}

function makeTlsSocket(protocol: string, overrides: Record<string, any> = {}): any {
  return {
    authorized: false,
    destroyed: false,
    getProtocol: () => protocol,
    getCipher: () => ({ name: "ECDHE-RSA-AES256-GCM-SHA384" }),
    getPeerCertificate: () => ({}),
    ...overrides,
  };
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
    const options = makeServer(app).createAutoSSLOptions({
      key: "/certs/key.pem",
      cert: "/certs/cert.pem",
    });
    expect(options.minVersion).toBe("TLSv1.3");
  });

  test("manual mode wires the resolved version into the server options", () => {
    const options = makeServer().createManualSSLOptions({
      key: "/certs/key.pem",
      cert: "/certs/cert.pem",
    });
    expect(options.minVersion).toBe("TLSv1.2");
  });
});

describe("SEC-12: HTTPS pool protocol scoring", () => {
  let pool: HttpsConnectionPoolManager;

  afterEach(async () => {
    if (pool) {
      await pool.destroy();
    }
    pool = undefined as any;
  });

  test("TLSv1.0/1.1 earn no protocol points", () => {
    pool = new HttpsConnectionPoolManager({});
    const score = (protocol: string) =>
      (pool as any).calculateSecurityScore(makeTlsSocket(protocol));

    expect(score("TLSv1.3")).toBeGreaterThan(score("TLSv1.2"));
    expect(score("TLSv1.2")).toBeGreaterThan(score("TLSv1.1"));
    // no partial credit for any legacy protocol
    expect(score("TLSv1.1")).toBe(score("TLSv1.0"));
    expect(score("TLSv1.1")).toBe(score("SSLv3"));
  });

  test("authorized + modern TLS still scores best", () => {
    pool = new HttpsConnectionPoolManager({});
    const score = (protocol: string, authorized: boolean) =>
      (pool as any).calculateSecurityScore(makeTlsSocket(protocol, { authorized }));

    expect(score("TLSv1.3", true)).toBeGreaterThan(score("TLSv1.3", false));
  });
});
