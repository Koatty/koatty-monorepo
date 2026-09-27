/**
 * B-0 SecurityProfile (ADR-102) regression tests.
 * @ license: BSD (3-Clause)
 */
import { DefaultLogger as Logger } from "koatty_logger";
import { Koatty } from "../../src/Application";
import {
  LEGACY_DEFAULTS,
  profileSummary,
  resolveProfile,
  resolveProfileName,
  SecurityConfigOptions,
} from "../../src/security/profile";

const ORIGINAL_ENV = { ...process.env };

afterAll(() => {
  process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;
  process.env.KOATTY_ENV = ORIGINAL_ENV.KOATTY_ENV;
});

describe("SecurityProfile - resolveProfileName", () => {
  test.each([
    ["production", "strict"],
    ["prod", "strict"],
    ["development", "development"],
    ["test", "development"],
    ["", "standard"],
    ["staging", "standard"],
  ])("env=%s -> %s", (env, expected) => {
    expect(resolveProfileName(env as string)).toBe(expected);
  });

  test("KOATTY_ENV takes precedence over NODE_ENV", () => {
    process.env.NODE_ENV = "production";
    process.env.KOATTY_ENV = "development";
    expect(resolveProfileName()).toBe("development");
    delete process.env.KOATTY_ENV;
    expect(resolveProfileName()).toBe("strict");
  });
});

describe("SecurityProfile - resolveProfile", () => {
  test("production resolves strict profile values", () => {
    const p = resolveProfile(null, "production");
    expect(p.name).toBe("strict");
    expect(p.payload.limit).toBe("1mb");
    expect(p.payload.onParseError).toBe("reject");
    expect(p.validation.whitelist).toBe(true);
    expect(p.validation.forbidNonWhitelisted).toBe(true);
    expect(p.aop.onAspectError).toBe("throw");
    expect(p.graphql.playground).toBe(false);
    expect(p.graphql.introspection).toBe(false);
    expect(p.ws.checkOrigin).toBe(true);
    expect(p.ws.maxPayload).toBe(1024 * 1024);
    expect(p.ops.exposeMetrics).toBe("internal");
    expect(p.tls.minVersion).toBe("TLSv1.2");
  });

  test("unset env resolves standard (never development by accident)", () => {
    const p = resolveProfile(null, "");
    expect(p.name).toBe("standard");
    expect(p.payload.limit).toBe("5mb");
    expect(p.validation.forbidNonWhitelisted).toBe(false);
  });

  test("explicit config profile wins over environment", () => {
    const p = resolveProfile({ profile: "development" }, "production");
    expect(p.name).toBe("development");
    expect(p.graphql.playground).toBe(true);
  });

  test("user overrides apply on top of profile", () => {
    const options: SecurityConfigOptions = {
      payload: { limit: "8mb" },
      aop: { onAspectError: "log" },
    };
    const p = resolveProfile(options, "production");
    expect(p.payload.limit).toBe("8mb");
    expect(p.aop.onAspectError).toBe("log");
    // untouched fields keep profile values
    expect(p.validation.whitelist).toBe(true);
  });

  test("legacyDefaults rolls tightened defaults back", () => {
    const p = resolveProfile({ legacyDefaults: true }, "production");
    expect(p.payload.limit).toBe("20mb");
    expect(p.payload.onParseError).toBe("empty");
    expect(p.validation.whitelist).toBe(false);
    expect(p.aop.onAspectError).toBe("log");
    expect(p.graphql.playground).toBe(true);
    expect(p.ws.maxPayload).toBe(0);
    expect(p.ops.exposeMetrics).toBe("public");
  });

  test("legacyDefaults covers every tightened item", () => {
    expect(LEGACY_DEFAULTS.length).toBeGreaterThanOrEqual(14);
    for (const item of LEGACY_DEFAULTS) {
      expect(item.reason.length).toBeGreaterThan(0);
    }
  });

  test("legacyDefaults can be overridden per-field afterwards", () => {
    const p = resolveProfile({ legacyDefaults: true, payload: { limit: "3mb" } }, "production");
    expect(p.payload.limit).toBe("3mb");
    expect(p.aop.onAspectError).toBe("log");
  });

  test("resolved profile is frozen (read-only)", () => {
    const p = resolveProfile(null, "production") as any;
    expect(Object.isFrozen(p)).toBe(true);
    expect(() => { "use strict"; p.payload = {}; }).toThrow();
  });

  test("legacyDefaults prints a startup WARN listing every reverted item", () => {
    const warnSpy = jest.spyOn(Logger, "Warn").mockImplementation(() => {});
    try {
      resolveProfile({ legacyDefaults: true }, "production");
      const messages = warnSpy.mock.calls.map((c) => c.join(" "));
      expect(messages.some((m) => m.includes("legacyDefaults is enabled"))).toBe(true);
      // one WARN line per reverted item + the removal notice
      expect(messages.filter((m) => m.trim().startsWith("- ")).length).toBeGreaterThanOrEqual(14);
      expect(messages.some((m) => m.includes("removed in koatty 5.0.0"))).toBe(true);
      // no WARN when legacyDefaults is off
      warnSpy.mockClear();
      resolveProfile(null, "production");
      expect(warnSpy.mock.calls.length).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("profileSummary contains key facts", () => {
    const summary = profileSummary(resolveProfile(null, "production"));
    expect(summary).toContain("profile=strict");
    expect(summary).toContain("payload.limit=1mb");
    expect(summary).toContain("graphql.playground=off");
  });
});

describe("SecurityProfile - Application integration", () => {
  test("app.security resolves lazily and is frozen", () => {
    process.env.NODE_ENV = "production";
    delete process.env.KOATTY_ENV;
    const app = new (class extends Koatty { })();
    const sec = app.security;
    expect(sec.name).toBe("strict");
    expect(app.security).toBe(sec);
    expect(Object.isFrozen(sec)).toBe(true);
  });

  test("config security overrides are respected", () => {
    process.env.NODE_ENV = "production";
    delete process.env.KOATTY_ENV;
    const app = new (class extends Koatty { })();
    app.setMetaData("_configs", { config: { security: { payload: { limit: "9mb" } } } });
    expect(app.security.payload.limit).toBe("9mb");
    expect(app.security.name).toBe("strict");
  });
});
