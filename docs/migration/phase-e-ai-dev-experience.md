# Phase E 迁移指南：AI-Ready 开发体验（`koatty_cli@5.0.0`）

适用版本：`koatty_cli` 4.2.x → 5.0.0（`koatty_testing` 4.0.0 → 4.0.1）。
方案来源：`docs/koatty-hardening-and-ai-evolution-plan.md` §8（Phase E）。

本次为 **major**：CLI 新增 MCP 入口与清单命令，`koatty new` 模板新增文件，生成器产物多一个测试骨架。无既有命令被移除，也没有参数默认值被反转。

---

## 1. `koatty mcp`（新增，E-2）

```bash
koatty mcp [--root <path>]        # stdio 传输，供 Cursor / Claude Code 接入
```

- **stdout 是协议通道**：任何诊断输出都在 stderr。如果你把 `koatty mcp` 包在自有包装脚本里，**不要**往 stdout 打印日志，否则会破坏 MCP 帧。
- 暴露 7 个工具：`koatty_manifest`、`koatty_routes`、`koatty_explain_component`、`koatty_plan`、`koatty_apply`、`koatty_test`、`koatty_docs`。
- **写操作需要两步**：先 `koatty_plan` 拿到 `hash` 与 `changeset`，再把两者原样交给 `koatty_apply`。任何改动（包括路径或内容的一个字符）都会因哈希不匹配被拒绝；`koatty_apply` 默认 `dryRun: true`，必须显式传 `dryRun: false` 才会落盘。
- **路径一律限制在 `--root` 内**：`../outside.txt` 之类的变更集会被拒绝（哈希校验 + `resolveInside()` 双重拦截）。
- **`koatty_test` 不是 shell**：只接受项目内 `test/` 或 `tests/` 下的 `*.test.*` / `*.spec.*`，默认 60s 超时（上限 600s）。需要其它命令请自行在终端执行。
- 新增依赖：`@modelcontextprotocol/sdk`（只由 `koatty_cli` 依赖）。若你的环境禁止新增依赖，请固定旧版本或自行 fork MCP 入口。

Cursor 侧配置示例（`.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "koatty": { "command": "npx", "args": ["koatty", "mcp", "--root", "."] }
  }
}
```

## 2. `koatty manifest`（E-1）

```bash
koatty manifest [--root <path>] [--out .koatty/manifest.json] [--format json|md] [--protocols http,grpc] [--validate]
```

- 纯静态分析（ts-morph）：**不启动应用**，因此看不到只有运行时才知道的信息（`@Autowired` 实际解析结果、请求作用域实例、真实依赖图）。需要运行时真相请用 `createTestApp()` 自行取值。
- **安全契约**：输出只包含配置**键名**（`config.keys`）与安全**画像名**（`security.profile`），永远不包含配置取值。若你扩展了采集器，请保持这条不变量，`--validate` 与回归测试会守护它。
- 路由条目只输出 `middleware`（类级 Controller 装饰器 + 方法级 Mapping 选项），**不再重复输出 `guards` / `interceptors`**：同一批装饰器已在 `middleware` 与 `aspects` 中出现，避免同一事实有两份可能不一致的来源。若某个项目希望对外隐藏这些名称，使用 `--format md` 或在消费端裁剪。

## 3. `koatty new` 模板新增文件（E-3、E-4）

新建项目会多出以下文件（已有项目不会被自动添加，请手动复制并按需调整）：

| 文件 | 用途 |
|---|---|
| `AGENTS.md` | AI 编码助手约定：目录结构、常用命令、禁止事项（不要直接改全局 `IOC`、不要在 Controller 写业务逻辑等） |
| `.cursor/rules/koatty.mdc` | 同上内容的 Cursor 规则版本（`globs: src/**/*.ts`） |
| `llms.txt` | 项目级文档索引（llms.txt 约定） |
| `jest.config.js` | ts-jest 配置，`roots: test/`、`testMatch: **/*.test.ts` |
| `test/smoke.test.ts` | 可运行的冒烟测试，含 `createTestApp()` + `createHttpTest()` 示例（注释形式） |

已有项目启用测试的最短路径：

```bash
pnpm add -D jest ts-jest koatty_testing supertest @types/jest
# 复制模板的 jest.config.js，然后
npx jest test/your.test.ts
```

## 4. 生成器产物多一个测试骨架（E-4）

`koatty generate:module` / `g:m` / `koatty add ... --apply` 现在除 Controller/Service/Model/DTO 外，还会生成 `test/<module>.test.ts`：

- 骨架默认只断言服务可构造、CRUD 方法存在，**不会因为 IoC 尚未注入而变红**；
- 需要真实行为断言时，按骨架注释用 `mockBean` 或直接替换实例属性；
- 如果你的下游脚本用「变更数量」做校验，需要把期望值 +1（`ChangeSet` 里多一条 `create test/<module>.test.ts`）。

## 5. `ChangeSet.save()` 修复（COR-16）

`ChangeSet.save(target)` 以前只接受目录：CLI 传入的 `.koatty/changesets/<id>.json` 会被**创建成目录**（`.koatty/changesets/<id>.json/<id>.json`），随后 `koatty apply --changeset .koatty/changesets/<id>.json` 失败：

```
✖ Error applying changes: EISDIR: illegal operation on a directory, read
```

现在两种写法都支持：

- `save('.koatty/changesets')` → 写入 `.koatty/changesets/<id>.json`（返回值即真实文件路径）；
- `save('.koatty/changesets/<id>.json')` → 直接写入该文件。

**迁移动作**：如果此前为了绕开该问题而在 CI 里手工拼接路径，可以删掉这段兼容代码。已存在的错误目录（`.koatty/changesets/<id>.json/`）可以直接删除。

## 6. `koatty_testing` 4.0.1（QA-05）

- 新增包内测试与 `jest.config.js`；公开 API 不变。
- `mockBean(identifier, mock)` 依然只按**名字**拦截 `Container.get`（类名字符串）；`resetContainer()` 清空 mock，`clearAll()` 额外恢复 `Container.prototype.get` 原始实现。

## 7. 验收证据（本仓库）

```bash
cd packages/koatty-ai && npx jest                       # 36 suites / 177 tests
cd packages/koatty-ai && npx tsc --noEmit               # 类型干净
cd packages/koatty-testing && pnpm test                 # lint + 3 suites / 8 tests
cd packages/koatty-ai && node dist/cli/index.js mcp     # 真实 stdio 握手（IDE 场景）
```

端到端（真实 CLI，临时目录）：

```bash
koatty new demo --dir /tmp/demo
cd /tmp/demo
koatty g:m user --fields '{"id":{"name":"id","type":"number","primary":true}}'
koatty apply --changeset .koatty/changesets/<id>.json --yes
ls test/user.test.ts                                    # 骨架落在磁盘上
```
