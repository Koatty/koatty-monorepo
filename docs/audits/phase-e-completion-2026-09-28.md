# Phase E 完成记录（2026-09-28）

范围：`docs/koatty-hardening-and-ai-evolution-plan.md` §8（Phase E：AI-Ready 开发体验，E-1…E-4 + COR-16）与发布 `koatty_cli@5.0.0`（major）/ `koatty_testing@4.0.1`（patch）。

本记录只陈述本轮实际执行过的命令与结果；未执行的验收项在第 3 节列出，不得据此宣称通过。

## 1. 交付与验证

| 任务 | 交付物 | 验证（本轮实测） | 结果 |
|---|---|---|---|
| E-1 应用清单 | `packages/koatty-ai/src/manifest/`、`src/cli/commands/manifest.ts`（已在 `src/cli/index.ts` 注册） | `cd packages/koatty-ai && npx jest tests/regression/E-01.manifest.test.ts` | 5 例通过 |
| E-2 MCP CLI | `packages/koatty-ai/src/mcp/`、`src/cli/commands/mcp.ts` | `npx jest tests/regression/E-02.mcp.test.ts` | 10 例通过（真实 MCP 协议 + 内存传输） |
| E-3 AI 文档 | `koatty new` 模板 `AGENTS.md` / `.cursor/rules/koatty.mdc` / `llms.txt`；仓库根 `AGENTS.md` | `npx jest tests/regression/E-04.test-skeleton-and-docs.test.ts` | 通过 |
| E-4 测试即规格 | 生成器 `test/<module>.test.ts` 骨架；模板 `jest.config.js` + `test/smoke.test.ts`；`koatty_testing` 自身测试（QA-05） | 同上；`cd packages/koatty-testing && npx jest` | 3 suites / 8 例通过 |
| COR-16 | `ChangeSet.save()` 接受目录与 `*.json` 文件路径 | `npx jest tests/regression/COR-16.changeset-save.test.ts` | 通过 |
| 全量 | — | `cd packages/koatty-ai && npx tsc --noEmit && npx jest` | 类型干净；36 suites / 177 tests 全绿 |

`koatty manifest` 的安全不变量有独立断言：`E-01.manifest.test.ts` 校验输出 JSON 中不出现 fixture 的配置取值（只出现键名与安全画像名）。

## 2. 版本与发布材料

- `.changeset/phase-e-ai-dev-experience.md`（`koatty_cli: major`、`koatty_testing: patch`）已通过 `pnpm changeset:version:no-commit` 应用：
  - `packages/koatty-ai/package.json` 4.2.2 → 5.0.0，`CHANGELOG.md` 新增 `## 5.0.0`；
  - `packages/koatty-testing/package.json` 4.0.0 → 4.0.1，`CHANGELOG.md` 新增 `## 4.0.1`。
- 迁移说明：`docs/migration/phase-e-ai-dev-experience.md`（含 `koatty mcp`、`koatty manifest`、模板新增文件、生成器产物 +1、COR-16 的迁移动作）。
- Phase C/D 的 changeset（`.changeset/phase-c-audit-remediation.md`、`.changeset/phase-d-architecture-and-performance.md`）保持**待审**，本轮未应用版本号。
- **未执行**：`pnpm release`（即 `changeset publish`）。npm 发布需要 registry 凭据与网络，且会对 registry 产生不可逆副作用，本轮未执行。

## 3. 未关闭的验收边界（不得据此宣称通过）

- §8 验收门第 2 条（在 Cursor 中接入 `koatty mcp` 并完成一个端到端任务）**未执行**：仓库内只有真实 MCP 协议 + 内存传输的回归测试，不能替代 IDE 内人工验收。
- `koatty manifest` 是静态分析（ts-morph）：不反映 `@Autowired` 实际解析结果、请求作用域实例与真实依赖图；清单不得当作运行时注册清单使用（生产可执行清单走 D-7 的 `--runtime-dir` + 启动前校验）。
- 本轮未执行 `pnpm build` 全量重建、`pnpm lint`、`pnpm security:baseline`，也未在 Linux/Redis CI 上复跑；这些仍需在发布流水线中执行。

## 4. 工作区记录：changeset 文件被消费与回滚（诚实项）

本轮首次执行 `pnpm changeset:version:no-commit` 时，发布工具**消费了 `.changeset/` 下全部 changeset 文件**（该目录 `.changeset/*.md` 被 `.gitignore` 忽略，未纳入版本控制），后果是：

1. Phase C、D、E 三个 changeset 文件被删除；
2. 23 个包（含 submodule）的 `package.json` `version` 与内部依赖范围被改写；
3. 每个包的 `CHANGELOG.md` 顶部被插入对应版本段落。

处理方式：

- 回滚：以上生成内容被抓取后逐包回滚（版本号、依赖范围、CHANGELOG 顶部段落），23/23 个包的 `version` 经脚本与 `git show HEAD:package.json` 比对一致；`koatty_http3` 回滚为 0.1.0（该包由 `workspace:*` 依赖自动 patch，未在任何 changeset 中显式列出）。
- 重建：`.changeset/phase-c-audit-remediation.md` 与 `.changeset/phase-d-architecture-and-performance.md` 依据回滚前抓取的生成段落重建——包清单与 bump 级别取自生成段落的 `### Major/Minor/Patch Changes` 分组，正文为该 changeset 摘要原文（每份 changeset 的摘要在各包中一致，已校验为单一变体）；排版（空行）可能与原文件略有差异，等待 Phase C/D 复审时确认。
- 发布：仅在 `.changeset/` 中保留 `phase-e-ai-dev-experience.md` 时执行一次 `changeset version`，因此本轮只有 `koatty_cli` 与 `koatty_testing` 的版本被应用。

复核命令（可重跑）：

```bash
# 所有包版本应与各自 HEAD 一致（除本轮 Phase E 发布的 2 个包）
git status --short -- 'packages/*/package.json'
git -C packages/koatty-ai diff -- package.json
```
