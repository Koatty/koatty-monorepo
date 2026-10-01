# koatty_cli / koatty_AI 双工具拆分迁移指南

日期：2026-10-01。设计：[docs/koatty-cli-agent-development-design.md](../koatty-cli-agent-development-design.md)。

## 变更总览

1. **子模块目录重命名**：`packages/koatty-ai` → `packages/koatty_cli`。远端仍为 `github.com/koatty/koatty-ai.git`，npm 包名仍为 `koatty_cli`，bin 仍为 `koatty`/`kt`。主仓库 gitlink SHA 在本次迁移中**保持不变**；子模块内的新提交（公开 API、支持矩阵、http-action 原语）随发布流程推送后再 bump 指针——不要在推送前 bump，否则 CI recursive checkout 会报 "not our ref"。
2. **koatty_cli 新增公开程序 API**（库入口）：
   - `koatty_cli/generation` — `describeGeneration` / `renderComponent` / `renderModule` / `renderHttpActionApi` / `renderProject` / `preparePlan` / `checkPlan` / `applyPlan` / `savePlan` / `loadPlan` / `applySavedPlan`
   - `koatty_cli/project` — `describeProject` / `queryProjectSections` / `validateProjectManifest` / `diagnoseProject` / `verify` / `resolveInside` 及 manifest 类型
   - main 入口（`require('koatty_cli')`）改为只导出上述 API，**不再装配 commander**。此前依赖 main 入口触发 CLI 的用法属于破坏性使用，请改用 bin 或显式 API 入口。
3. **支持矩阵硬化（行为变更，写入前拒绝）**：
   - 模块生成器拒绝非空 `api.endpoints`（模板只输出固定 CRUD 面；此前被静默忽略）——`UNSUPPORTED_SPEC`；
   - `api.type` 仅支持 `rest|grpc|graphql`（websocket 走 `koatty controller <name> -t websocket`）——`UNSUPPORTED_SPEC`；
   - 主键固定为名为 `id` 的自增数字列——`UNSUPPORTED_SPEC`；
   - `specs/examples/user.yml`、`examples/user-management/user.yml` 已同步改为 `endpoints: []`。
4. **单文件命令新增机器通道**：`koatty controller|service|... <name> --json --dry-run` 输出 v1 envelope；与公开 API 同输入同输出。
5. **http-action 生成原语**（`koatty_cli/assets/templates/http-action`，由 `renderHttpActionApi` 驱动）：单动作 Controller + 字段驱动 DTO + Service 引用/新建；reference 模式验证服务与方法存在（`SERVICE_NOT_FOUND` / `SERVICE_METHOD_MISSING`），create 模式拒绝同名文件并生成显式失败占位。
6. **README 纠偏**：模板来源描述改为与实现一致（bundled 默认、显式 `--source cache`、显式下载、`--offline` 禁网）。
7. **新增 packages/koatty_ai**（独立 git 仓库，尚未注册为 submodule）：npm 包 `koatty_ai`，bin `koatty-ai`，通过 dependencies 单向依赖 `koatty_cli` 的公开生成 API。在确认远端仓库并接入 submodule 前，`pnpm-workspace.yaml` 用 `!packages/koatty_ai` 将其排除在 workspace 外；接入后删除该排除项。

## 需要行动的调用方

| 你是谁 | 行动 |
|---|---|
| 直接 `require('koatty_cli')`（期望 CLI 行为） | 改用 `koatty`/`kt` bin，或改用 `koatty_cli/generation` |
| spec 中写了自定义 `api.endpoints` | 删除该段（模板从未渲染过它们），用 http-action 原语或宿主编辑器补自定义动作 |
| 依赖"用户模板缓存优先于内置模板" | 该行为自 Phase G 起已改为 bundled 默认；显式 `--source cache` 才用缓存 |
| 脚本/CI 中硬编码 `packages/koatty-ai` 路径 | 改为 `packages/koatty_cli`（主仓库两个回归脚本已同步） |
| 想让外部 Agent 使用框架工具 | 安装（未来的）`koatty_ai`，或继续用现有 `koatty mcp` / `capabilities` / `doctor` / `verify`——这些入口在兼容版本内不会删除 |

## 兼容性承诺

- `koatty new`、单文件命令（人类输出）、`add`、`generate:module`、SQL 转换、plan/apply、manifest/mcp/capabilities/doctor/verify 全部保留。
- AI 专用入口向 `koatty_ai` 的迁移遵循"先发布对等能力、后移除旧入口"的顺序，在明确的 major 版本执行。
- 公开 API（`koatty_cli/generation`、`koatty_cli/project`）的类型与导出面按 SemVer 管理；契约由 `packages/koatty_cli/tests/regression/API-01.public-api.test.ts` 冻结。

## 发布顺序

1. 推送 koatty_cli 子模块 `main`（含公开 API 提交）；
2. Changesets 版本化并发布 `koatty_cli`；
3. 确认 `koatty_ai` 远端仓库并接入 submodule，将其 `dependencies.koatty_cli` 指向已发布版本后首次发布；
4. 更新主仓库两个 gitlink 指针。
