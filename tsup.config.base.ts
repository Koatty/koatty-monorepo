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
  banner: {
    js: `/*!
* @Author: richen
* @Date: ${new Date().toISOString().replace("T", " ").slice(0, 19)}
* @License: BSD (3-Clause)
* @Copyright (c) - <richenlin(at)gmail.com>
* @HomePage: https://koatty.org/
*/`,
  },
};
