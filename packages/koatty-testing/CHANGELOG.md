# koatty_testing

## Unreleased — Phase E audit fixes (2026-09-29)

- Wait for listener readiness/error in createTestApp.start; restore environment in finally even when stop fails, without repeated restoration.
- Add lifecycle regression coverage and correct examples to use an undecorated test app and createHttpTest(wrapper.app).
- Migration: docs/migration/phase-e-ai-dev-experience.md. No publication performed.


## 4.0.1

### Patch Changes

- Phase E（AI-Ready 开发体验，路线图 §8）：`koatty_cli@5.0.0` 发布内容。
  - **E-1 应用清单 `koatty manifest`**：静态采集器（`src/manifest`）+ CLI 命令，输出 components / routes / dtos / aspects / `config.keys` / `security.profile` / koatty 版本 / decoratorMode / protocols。**只输出配置键名，绝不输出配置取值**；纯静态分析（ts-morph），不启动应用、不监听端口、无网络。回归测试：`tests/regression/E-01.manifest.test.ts`。
  - **E-2 MCP 形态的 CLI（`koatty mcp`）**：stdio 传输的 MCP server，7 个工具（`koatty_manifest` / `koatty_routes` / `koatty_explain_component` / `koatty_plan` / `koatty_apply` / `koatty_test` / `koatty_docs`）。
    - 只读优先：除写类 `koatty_apply` 和执行类 `koatty_test` 外使用 `readOnlyHint`；`koatty_apply` 必须携带 `koatty_plan` 的 SHA-256 哈希，`dryRun` 默认 `true`。
    - 路径一律经 `resolveInside()`；`koatty_test` 只运行 `test/` / `tests/` 下的测试文件并带超时；不提供任意 shell 工具。
    - 依赖 `@modelcontextprotocol/sdk`（仅 `koatty_cli`）。回归测试：`tests/regression/E-02.mcp.test.ts`。
  - **E-3 面向 AI 的项目文档**：`koatty new` 模板新增 `AGENTS.md`、`.cursor/rules/koatty.mdc`、`llms.txt`。回归测试：`tests/regression/E-04.test-skeleton-and-docs.test.ts`。
  - **E-4 测试即规格**：生成器为每个模块追加 `test/<module>.test.ts` 骨架；模板项目新增 `jest.config.js`（ts-jest）与 `test/smoke.test.ts`。`koatty_testing` 补齐自身测试（QA-05）与 jest 配置（8 例）。
  - **COR-16**：`ChangeSet.save()` 同时接受目录与 `*.json` 文件路径，修复 `koatty apply --changeset .koatty/changesets/<id>.json` 的 `EISDIR` 失败。回归测试：`tests/regression/COR-16.changeset-save.test.ts`。

  迁移方式见 `docs/migration/phase-e-ai-dev-experience.md`。

## Unreleased — QA-05 / Phase E（测试即规格）

### Patch Changes

- 补齐包自身测试（QA-05，路线图 §8 E-4 前置项）：新增 `jest.config.js`（ts-jest）与 `test/` 下的 8 个用例，覆盖：
  - `mockBean` / `resetContainer` / `clearAll` 的注入、覆盖与清理语义（`test/mockBean.test.ts`）；
  - `createHttpTest` 基于 `app.callback()` 的 supertest 用法，含状态码与请求体（`test/httpTest.test.ts`）；
  - 公开导出面（`createTestApp` / `createHttpTest` / `mockBean` / `resetContainer` / `clearAll`，`test/exports.test.ts`）。
- `pnpm test` 之前是 `jest --passWithNoTests`（无配置、无用例）；现在会真实运行这些用例。
- 无公开 API 变更。

## 4.0.0

### Patch Changes

- Updated dependencies
  - koatty_core@2.5.0
  - koatty@4.3.4

## 3.0.0

### Patch Changes

- Updated dependencies
  - koatty_core@2.4.0
  - koatty@4.3.3
  - koatty_container@4.0.0

## 2.0.2

### Patch Changes

- koatty@4.3.2

## 2.0.1

### Patch Changes

- Phase A（基线修复与 CI 可信）收口：修复让 `pnpm lint` / CI lint job 失败的配置与格式问题。
  - `koatty_cli`：按 prettier 重新格式化 `apply` 命令的 `--yes` 选项（`npx eslint --fix`，无行为变化）；
  - `koatty_graphql`、`koatty_loader`：`@typescript-eslint/ban-types` 已在 @typescript-eslint v8 中移除，配置仍引用该规则会让每次 lint 直接报
    `Definition for rule '@typescript-eslint/ban-types' was not found`；改用后继规则 `@typescript-eslint/no-unsafe-function-type`；
  - `koatty_loader`：为刻意的 ES5/6 动态 `require()` 补充 `eslint-disable`；
  - `koatty_testing`：补充缺失的 `.eslintrc.js`（此前 eslint 以 exit=2 报 `couldn't find a configuration file`）。

  修复后 `pnpm lint` 由 4 个包失败恢复为 21/21 通过；`pnpm build` 23/23、`pnpm security:baseline` PASS 6 / FAIL 0。详见 `docs/reports/test-baseline-2026-09.md` §七。
  - koatty@4.3.1

## 2.0.0

### Patch Changes

- Updated dependencies
  - koatty@4.3.0
  - koatty_core@2.3.0
  - koatty_container@3.0.0
  - koatty_lib@1.6.0

## 1.1.0

### Minor Changes

- build
- build

### Patch Changes

- Updated dependencies
- Updated dependencies
  - koatty_core@2.2.0
  - koatty@4.2.0
  - koatty_container@3.0.0
  - koatty_lib@1.5.0

## 1.0.1

### Patch Changes

- build
- Updated dependencies
  - koatty_core@2.1.10
  - koatty@4.1.15
  - koatty_container@2.0.10
  - koatty_lib@1.4.10

## 1.0.1

### Patch Changes

- build
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - koatty@4.1.15
  - koatty_container@2.0.9
  - koatty_core@2.1.10
  - koatty_lib@1.4.9
