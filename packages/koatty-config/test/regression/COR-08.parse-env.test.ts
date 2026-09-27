/**
 * COR-08 regression tests: parseEnv interpolation semantics (C-6).
 * - embedded interpolation: "redis://${HOST}:${PORT}"
 * - default values: ${VAR:-default}
 * - strict profile: undefined variable without default fails startup
 */
import { LoadConfigs } from "../../src/index";

const LOAD_ARGS = ["./test/fixtures"] as string[];

describe("COR-08 parseEnv", () => {
    beforeAll(() => {
        process.env.NODE_ENV = "development";
        delete process.env.KOATTY_ENV;
        process.env.KOATTY_TEST_HOST = "db.internal";
        process.env.KOATTY_TEST_PORT = "6379";
        delete process.env.KOATTY_TEST_MISSING;
        delete process.env.KOATTY_TEST_UNDEFINED_VAR;
    });

    afterAll(() => {
        delete process.env.KOATTY_TEST_HOST;
        delete process.env.KOATTY_TEST_PORT;
        delete process.env.KOATTY_TEST_MISSING;
    });

    test("embedded interpolation composes values", () => {
        const res = LoadConfigs(LOAD_ARGS, "", undefined, ["*.test.ts", "test.ts"]);
        expect(res.envconfig.dsn).toBe("redis://db.internal:6379");
    });

    test("whole-string reference keeps legacy behavior", () => {
        const res = LoadConfigs(LOAD_ARGS, "", undefined, ["*.test.ts", "test.ts"]);
        expect(res.envconfig.whole).toBe("db.internal");
    });

    test("${VAR:-default} applies default when variable is missing", () => {
        const res = LoadConfigs(LOAD_ARGS, "", undefined, ["*.test.ts", "test.ts"]);
        expect(res.envconfig.fallback).toBe("fallback");
    });

    test("undefined variable without default -> empty string outside strict profile", () => {
        const res = LoadConfigs(LOAD_ARGS, "", undefined, ["*.test.ts", "test.ts"]);
        expect(res.envconfig.loose).toBe("");
    });

    test("strict profile: undefined variable without default throws", () => {
        process.env.NODE_ENV = "production";
        process.env.ff = "999"; // satisfy the other fixtures so the failure names our variable
        try {
            expect(() => LoadConfigs(LOAD_ARGS, "", undefined, ["*.test.ts", "test.ts"]))
                .toThrow(/KOATTY_TEST_UNDEFINED_VAR/);
        } finally {
            process.env.NODE_ENV = "development";
        }
    });
});
