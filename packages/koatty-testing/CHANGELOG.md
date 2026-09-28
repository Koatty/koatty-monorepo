# koatty_testing

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
