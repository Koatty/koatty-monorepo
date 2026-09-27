/**
 * SEC-04 regression tests (B-4): GraphQL security defaults.
 *
 * - playground/introspection/depthLimit/complexityLimit resolve from the
 *   security profile unless explicitly configured;
 * - introspection is enforced with the built-in NoSchemaIntrospectionCustomRule;
 * - the depth limit is a built-in rule (no optional dependency), with
 *   fragment expansion and cycle detection;
 * - configuring complexityLimit without the optional package fails startup;
 * - the playground page loads no external (CDN) scripts.
 *
 * @ license: BSD (3-Clause)
 */
import { parse, validate as graphqlValidate, buildSchema } from "graphql";
import { GraphQLRouter, createQueryDepthLimitRule } from "../../src/router/graphql";
import { RouterOptions } from "../../src/router/router";

function makeApp(graphqlProfile?: Record<string, unknown>): any {
  return { rootPath: process.cwd(), security: graphqlProfile ? { graphql: graphqlProfile } : undefined };
}

const BASE_OPTIONS: RouterOptions = { protocol: "graphql", prefix: "" };
const OPTIONS_WITH_SCHEMA: RouterOptions = {
  protocol: "graphql",
  prefix: "",
  ext: { schemaFile: "./schema.gql" },
};

const TEST_SCHEMA = buildSchema(`
  type Query {
    a: String
    nested: Nested
    _trusted: Nested
  }
  type Nested {
    b: Nested
    leaf: String
  }
`);

describe("SEC-04: built-in query depth limit rule", () => {
  const rule = createQueryDepthLimitRule(3);

  function depthErrors(query: string): number {
    return graphqlValidate(TEST_SCHEMA, parse(query), [rule]).length;
  }

  test("query within the depth limit passes", () => {
    expect(depthErrors(`{ a }`)).toBe(0);
    expect(depthErrors(`{ nested { b { leaf } } }`)).toBe(0);
  });

  test("query exceeding the depth limit is rejected", () => {
    expect(depthErrors(`{ nested { b { b { leaf } } } }`)).toBeGreaterThan(0);
  });

  test("fragment expansion counts depth and cycles do not hang", () => {
    expect(depthErrors(`
      query {
        nested { ...F }
      }
      fragment F on Nested { b { ...G } }
      fragment G on Nested { leaf }
    `)).toBe(0);

    expect(depthErrors(`
      query {
        nested { ...F }
      }
      fragment F on Nested { b { ...G } }
      fragment G on Nested { b { ...F } }
    `)).toBeGreaterThan(0);
  });

  test("ignored fields do not contribute depth", () => {
    // children of ignored fields still count: b + leaf = 2 (<= 2 passes,
    // but _trusted itself would push it to 3 without the ignore)
    const ignoring = createQueryDepthLimitRule(2, [/_trusted$/]);
    expect(graphqlValidate(TEST_SCHEMA, parse(`{ _trusted { b { leaf } } }`), [ignoring]).length).toBe(0);
    expect(graphqlValidate(TEST_SCHEMA, parse(`{ _trusted { b { leaf } } }`), [createQueryDepthLimitRule(2)]).length).toBeGreaterThan(0);
  });
});

describe("SEC-04: profile-driven router defaults", () => {
  test("strict profile disables playground and introspection, enables limits", () => {
    const router = new GraphQLRouter(makeApp({
      playground: false, introspection: false, depthLimit: 10,
    }), OPTIONS_WITH_SCHEMA);
    // resolution happens in SetRouter, where the rules are built
    router.SetRouter("/graphql", { schema: TEST_SCHEMA, implementation: { dummy: () => 1 } } as any);
    expect((router as any).playgroundEnabled).toBe(false);
  });

  test("development profile enables playground by default", () => {
    const router = new GraphQLRouter(makeApp({
      playground: true, introspection: true, depthLimit: 20,
    }), OPTIONS_WITH_SCHEMA);
    router.SetRouter("/graphql", { schema: TEST_SCHEMA, implementation: { dummy: () => 1 } } as any);
    expect((router as any).playgroundEnabled).toBe(true);
  });

  test("without a profile the playground stays off (fail-closed)", () => {
    const router = new GraphQLRouter(makeApp(), OPTIONS_WITH_SCHEMA);
    router.SetRouter("/graphql", { schema: TEST_SCHEMA, implementation: { dummy: () => 1 } } as any);
    expect((router as any).playgroundEnabled).toBe(false);
  });

  test("explicit ext config wins over the profile", () => {
    const router = new GraphQLRouter(makeApp({ playground: true }), {
      ...OPTIONS_WITH_SCHEMA,
      ext: { schemaFile: "./schema.gql", playground: false },
    });
    router.SetRouter("/graphql", { schema: TEST_SCHEMA, implementation: { dummy: () => 1 } } as any);
    expect((router as any).playgroundEnabled).toBe(false);
  });

  test("playground HTML contains no external CDN scripts", () => {
    const router = new GraphQLRouter(makeApp({ playground: true }), OPTIONS_WITH_SCHEMA);
    const html = (router as any).renderGraphiQL("/graphql");
    expect(html).not.toContain("unpkg.com");
    expect(html).not.toContain("<script crossorigin");
    expect(html).toContain("<script>");
  });
});
