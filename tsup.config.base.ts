import type { Options } from "tsup";

/**
 * Shared tsup configuration for all koatty packages.
 * Each package can extend this and override as needed.
 */
export const baseConfig: Options = {
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  // DTS generation is handled by tsc + api-extractor pipeline
  dts: false,
  // Skip bundling dependencies - they should be externalized
  skipNodeModulesBundle: true,
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".js" : ".mjs",
    };
  },
  banner: ({ format }) => ({
    js: `${format === "esm" ? 'import { createRequire as __koattyCreateRequire } from "node:module";\nimport { fileURLToPath as __koattyFileURLToPath } from "node:url";\nimport { dirname as __koattyDirname } from "node:path";\nconst require = __koattyCreateRequire(import.meta.url);\nconst __filename = __koattyFileURLToPath(import.meta.url);\nconst __dirname = __koattyDirname(__filename);\n' : ""}/*!
* @Author: richen
* @Date: ${new Date().toISOString().replace("T", " ").slice(0, 19)}
* @License: BSD (3-Clause)
* @Copyright (c) - <richenlin(at)gmail.com>
* @HomePage: https://koatty.org/
*/`,
  }),
};
