/**
 * SEC-04 (B-4) companion: configuring `complexityLimit` without the optional
 * `graphql-query-complexity` package must fail startup (fail-closed), never
 * silently skip the rule. Isolated file so the virtual mock does not leak
 * into the other SEC-04 cases.
 *
 * @ license: BSD (3-Clause)
 */
jest.mock("graphql-query-complexity", () => {
  throw new Error("Cannot find module 'graphql-query-complexity'");
}, { virtual: true });

import { buildSchema } from "graphql";
import { GraphQLRouter } from "../../src/router/graphql";
import { RouterOptions } from "../../src/router/router";

function makeApp(): any {
  return { rootPath: process.cwd(), security: undefined };
}

const OPTIONS: RouterOptions = {
  protocol: "graphql",
  prefix: "",
  ext: { schemaFile: "./schema.gql", complexityLimit: 1000 },
};

const TEST_SCHEMA = buildSchema(`
  type Query { a: String }
`);

test("configured complexityLimit + missing package -> SetRouter throws", () => {
  const router = new GraphQLRouter(makeApp(), OPTIONS);
  const impl = { schema: TEST_SCHEMA, implementation: { dummy: () => 1 } } as any;
  expect(() => router.SetRouter("/graphql", impl)).toThrow(/graphql-query-complexity/);
});
