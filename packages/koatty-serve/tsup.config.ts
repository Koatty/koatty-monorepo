import { defineConfig } from "tsup";
import { baseConfig } from "../../tsup.config.base";

export default defineConfig({
  ...baseConfig,
  splitting: true,
  entry: ["src/index.ts", "src/internal.ts"],
});
