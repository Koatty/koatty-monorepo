# AI-first 框架实现与验收记录

2026-09-30。本轮修改已在本地提交，尚未应用版本、尚未发布。

## 设计选择

Koatty 已有应用级 DI、DTO、生命周期、MCP host、模型路由、预算、审批和追踪。本轮沿这些执行链扩展：CLI/MCP 共用开发操作；业务工具继续走 MCP host；可恢复 Agent 复用 LLM client 和业务工具权限，而不引入另一套权限或预算权威。

## 实现落点

| 能力 | 源码位置 |
|---|---|
| 结构化开发结果、依赖诊断、验证、签名计划、前像与写入事务 | `packages/koatty-ai/src/operations/` |
| 开发 MCP 适配、输出 schema、会话计划、框架文档检索 | `packages/koatty-ai/src/mcp/` |
| MCP 静态声明、动态 unresolved、分页筛选 | `packages/koatty-ai/src/manifest/mcp.ts`、`src/operations/inspect.ts` |
| MCP/Agent 项目与真实协议测试 | `packages/koatty-ai/recipes/mcp/`、`tests/regression/G-02.scaffold.test.ts` |
| 工具真实返回值的 outputSchema 验证 | `packages/koatty-mcp/src/server.ts` |
| 可选检查点 runner、本地原子 CAS store | `packages/koatty-llm/src/agent.ts`、`agent-file-store.ts` |
| 真实 Koatty 子类测试启动类型修复 | `packages/koatty-testing/src/testApp.ts` |
| 可分发 Agent Skill | `packages/koatty-ai/skills/koatty/` |

## 已执行验证

- `pnpm turbo run test --force --concurrency=2 -- --runInBand`：56/56 任务成功，无缓存命中，耗时 2m13s。CLI 43 套件 / 215 测试、MCP 4 / 42、LLM 4 / 43、testing 5 / 13 通过。core 4、serve 6、TypeORM 20 个测试跳过；不能据此声称所有平台和真实数据库全通过。
- `pnpm lint`：28/28 任务成功，0 error，仍有 warning；其中 16 个缓存命中。受影响包在本次源码上检查。
- `pnpm security:baseline`：14 PASS / 0 FAIL / 0 SKIP。
- `pnpm test:phase-f:compiled`：本地 mock provider + 真实 HTTP/SSE 的编译产物验收通过。
- `pnpm test:ai-development`：固定任务入口通过（CLI 10、MCP 1、LLM 6 个测试，外加真实进程崩溃实验）。
- `node scripts/regression/ai-agent-crash.cjs`：独立 worker 完成业务副作用后 SIGKILL；重新创建 store/runner，恢复为 unknown；以权威结果协调后完成，业务副作用计数保持 1。
- 新工程回归实际生成 MCP 与 Agent 工程，使用 workspace 安装依赖编译 TypeScript，执行 SDK client、真实 HTTP 鉴权、审批缺失拒绝和 Agent SSE；新增 null 请求体返回 400 的检查。
- Skill `quick_validate.py`、相对文档引用及已安装副本与源文件一致性检查通过。Skill 已安装到 Codex 默认目录，同时随 CLI 和新工程分发。
- CLI `npm pack --dry-run` 检查确认包含 Skill、参考文档、recipe 和编译后的 operation 文件；这是包内容检查，不是 npm 隔离安装验收。
- `doctor --assert-submodules` 确认 17 个子模块已检出且有测试脚本。主仓库、CLI 与嵌套 project 模板 `git diff --check` 通过。

## 使用与剩余边界

Agent 可使用 `$koatty`；核心文档按开发流程、框架约定、MCP/Agent 与验收渐进加载。已发布旧 CLI 必须通过 help/capabilities 检查支持情况，不能直接假定新命令存在。

默认安全写入行为、模板来源与输出验证有兼容变化，参见 [迁移指南](migration/phase-g-ai-development.md)。changeset 已记录，CLI 按 major 处理，但未应用版本。

这轮提供本地可用能力及固定任务回归，不是任意业务场景的一键生产部署。真实 provider、外部 MCP 客户端、npm 隔离依赖安装、跨主机 CAS/预算/审批后端及数据库仍需相应环境验收。持久化 runner 不包含后台调度和自动审批；本地 store 崩溃遗留锁需权威核对后恢复。Skill 明确说明这些限制。
