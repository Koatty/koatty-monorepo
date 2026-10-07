# koatty_cli / koatty_AI 双工具拆分迁移指南

## 2026-10-07 实施更新（优先于下方历史记录）

两个 submodule 已登记：koatty_cli → https://github.com/Koatty/koatty-cli.git（新建），koatty_ai → https://github.com/Koatty/koatty-ai.git。AI 已加入 workspace，单向依赖 CLI 公开 API；构建和测试不再映射兄弟仓库源码。

代码已按用户要求提交并推送：CLI `41cdc09`，AI `b3857e7`。AI 通过保留双方父提交的迁移合并承接旧 CLI 历史，未强制推送；旧 CLI 历史也完整保留在新 koatty-cli 仓库。主仓库 gitlink 指向上述远端提交。npm 尚未发布。

- `koatty-ai plan` 默认无磁盘写入且不返回持久化 planId。跨进程应用须显式 `--savePlan`，再 `apply --planId … --yes`。MCP 客户端在同一连接内 plan/apply。
- 使用 `koatty new demo --offline --no-skill` 后，再 `koatty-ai skill --root ./demo --yes` 安装新版 Skill。省略 `--yes` 只预览。旧项目同路径已有不同 Skill 时拒绝覆盖，应先人工核对并迁移旧资源；传统 CLI 默认仍附带旧 Skill。
- HTTP reference 模式要求可静态确认的框架 Service 注册、类名对应文件、公开实例方法与兼容 DTO 参数。不再接受不可调用的桩引用；不支持路径参数/通配路由，需 Agent 按框架资料显式实现绑定。
- JSON DTO 表示对象，日期表示 ISO8601 字符串；不支持的字段属性直接报错。CRUD recipe 只暴露目前可验证的基础字段组合，复杂业务由外部 Agent 完成。
- 框架检查为静态辅助：动态路由等不确定实现仍需实际运行验证；同 major 的 API 索引匹配不等于该小版本一定有该 API。
- 发布前须先发布携带新 API 的 CLI，并将 AI 的 CLI 依赖下界更新为该实际版本。当前版本号尚未变更；本地 tarball 验收不证明 npm registry 已发布。

验收脚本：`node scripts/regression/koatty-tools-package.cjs`，先构建受影响包。它安装本地框架与工具 tarball、外部 npm 依赖，禁用安装脚本；不使用工具 workspace 链接，不代表真实外部 Agent 评测。

## 2026-10-01 历史迁移记录


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
