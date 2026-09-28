# Phase E 迁移指南：AI-Ready 开发体验（`koatty_cli@5.0.0`）

适用版本：`koatty_cli` 4.2.x → 5.0.0（`koatty_testing` 4.0.0 → 4.0.1）。
方案来源：`docs/koatty-hardening-and-ai-evolution-plan.md` §8（Phase E）。

本次为 **major**：CLI 新增 MCP 入口与清单命令，`koatty new` 模板新增文件，生成器产物多一个测试骨架。无既有命令被移除。2026-09-29 审计修复收紧 MCP 参数校验与计划签发约束，并调整新生成 DTO 的文件布局。

---

## 1. `koatty mcp`（新增，E-2）

```bash
koatty mcp [--root <path>]        # stdio 传输，供 Cursor / Claude Code 接入
```

- **stdout 是协议通道**：任何诊断输出都在 stderr。如果你把 `koatty mcp` 包在自有包装脚本里，**不要**往 stdout 打印日志，否则会破坏 MCP 帧。
- 暴露 7 个工具：`koatty_manifest`、`koatty_routes`、`koatty_explain_component`、`koatty_plan`、`koatty_apply`、`koatty_test`、`koatty_docs`。
- **写操作需要两步**：先 `koatty_plan` 拿到 `hash` 与 `changeset`，再在同一 MCP 会话内把两者原样交给 `koatty_apply`。计划有效期 10 分钟，每会话保留最多 32 个；真正 apply 后即消费，重新连接、过期、文件被修改或需要重试时重新 plan。任何改动（包括路径或内容的一个字符）都会因哈希不匹配被拒绝；`koatty_apply` 默认 `dryRun: true`，必须显式传 `dryRun: false` 才会落盘。
- **路径一律限制在 `--root` 内**：`../outside.txt` 之类的变更集会被拒绝（哈希校验 + `resolveInside()` 双重拦截）。
- **`koatty_test` 不是 shell**：只接受项目内 `test/` 或 `tests/` 下的 `*.test.*` / `*.spec.*`，默认 60s 超时（上限 600s）。需要其它命令请自行在终端执行。
- 新增依赖：`ajv`（清单及工具输入验证）、`@modelcontextprotocol/sdk`（只由 `koatty_cli` 依赖）。若你的环境禁止新增依赖，请固定旧版本或自行 fork MCP 入口。

Cursor 侧配置示例（`.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "koatty": { "command": "/absolute/project/node_modules/.bin/koatty", "args": ["mcp", "--root", "/absolute/project"] }
  }
}
```

## 2. `koatty manifest`（E-1）

```bash
koatty manifest [--root <path>] [--out .koatty/manifest.json] [--format json|md] [--protocols http,grpc] [--validate]
```

- 纯静态分析（ts-morph）：**不启动应用**，因此看不到只有运行时才知道的信息（`@Autowired` 实际解析结果、请求作用域实例、真实依赖图）。需要运行时真相请用 `createTestApp()` 自行取值。
- **安全契约**：输出只包含配置**键名**（`config.keys`）、配置类型/schema 与安全**画像名**（`security.profile`），永远不包含配置取值。若你扩展了采集器，请保持这条不变量，`--validate` 与回归测试会守护它。
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

- 模块测试用 `jest.spyOn(Model, 'findAndCount')` 校验分页行为，不连接数据库；不要用实例属性 mock 静态 Model 调用。
- Create/Update/Query DTO 分别生成到同名文件，符合 Loader 的类名/文件名要求。更新脚本中的旧 `<Module>Dto.ts` 路径和固定变更数量断言；已有应用不会自动重写。
- DTO 转换字段使用既有 `@IsDefined()`，属性约束从 `class-validator` 导入；Controller 继续使用 `@Validated({ types: [...] })`，直接返回结果，查询参数用既有 `@Get()`。没有新增框架装饰器。
- 生成模块会声明 `typeorm`、`class-validator`、`koatty_validation` 依赖；模型连接/数据库驱动仍由应用配置。新项目 CLI 依赖为 `^5.0.0`。
- 单独的 `koatty controller` / `koatty service` 也附带测试骨架，保留已存在测试。
- 新生成的 API 文档脚本复用 manifest JSON Schema 输出 OpenAPI 3.1，不再另装 Typia 编译器。已有 doc 脚本和已声明依赖不会自动删除。

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

- 公开 API 不变；`start()` 等待框架监听回调，监听错误会拒绝；`stop()` 即使底层失败也恢复环境变量，且只恢复一次。
- 测试类不要添加会自动启动的 `@Bootstrap()`，也不要导入生产自动启动入口。先编译项目，再用独立 Koatty 子类设置 rootPath/appPath，调用 `createTestApp`；请求客户端使用 `createHttpTest(wrapper.app)`，afterAll 必须 stop。
- `env` 仍作用于进程，不用于并行测试互相冲突的环境配置；它不是实例级配置隔离 API。
- `mockBean(identifier, mock)` 依然只按**名字**拦截 `Container.get`（类名字符串）；`resetContainer()` 清空 mock，`clearAll()` 额外恢复 `Container.prototype.get` 原始实现。

## 7. 验收证据（本仓库）

```bash
cd packages/koatty-ai && npx jest                       # CLI 全量回归
cd packages/koatty-ai && npx tsc --noEmit               # 类型干净
cd packages/koatty-testing && pnpm test                 # lint + 辅助包回归
cd packages/koatty-ai && node dist/cli/index.js mcp     # 启动实际 stdio 服务；并不等于 Cursor 人工验收
```

端到端（真实 CLI，临时目录）：

```bash
koatty new demo --dir /tmp/demo
cd /tmp/demo
koatty g:m user --fields '{"id":{"name":"id","type":"number","primary":true}}'
koatty apply --changeset .koatty/changesets/<id>.json --yes
ls test/user.test.ts                                    # 骨架落在磁盘上
```


## 8. 审计修复后的安全与清单契约

- apply 先完整验证参数，再验证所有文件前像，最后暂存及逐文件替换。可处理的 I/O 失败会回滚已提交文件；回滚失败会保留 `.koatty-apply-*/recovery.json` 和原文件备份并返回恢复位置。它不是断电/进程被杀情况下的多文件原子事务；残留暂存目录需核对后恢复，不要直接丢弃。
- 只接受 boolean 类型的 dryRun；0/null/字符串不再容错。未签发计划即使自算哈希正确也拒绝。
- docs、静态源文件和配置读取拒绝项目根内的符号链接；外部 tsconfig 继承无法安全解析时标记 unresolved。
- `koatty_test` 是代码执行工具，readOnlyHint/idempotentHint 均为 false；测试及 Jest 配置可产生副作用，根目录路径检查不是进程级权限沙箱。
- 清单新增 `schemaVersion:1`、`collectionMode:static`、`unresolved`；DTO 在原字段摘要外新增 `schema`。配置的 `schemaSource:declaration` 表示读取 C-6 调用处的静态 schema，`inferred` 只表示配置类型推断。schema 默认值不输出；无法静态理解的类型、配置、路由必须检查 unresolved，不能将 `--validate` 通过理解为运行期完整性证明。
- 当前类型转换覆盖基础/联合/数组/嵌套 DTO 及常用现有装饰器约束；自定义验证器、继承和复杂动态类型明确标为未解析，不执行用户模块来补全。

修复验证与剩余发布门见 `docs/audits/phase-e-remediation-2026-09-29.md`。版本未在本次操作发布。

### 生成后 HTTP 联调补充修复（koatty_router）

DTO 校验失败使用现有 Exception 返回 HTTP 400；基础设施异常保持服务器错误。`(id: number, dto: UpdateDto)` 等混合参数不再误走只处理第一个 DTO 的快捷路径。更新路由包后验证合法 POST/PUT、非法 DTO 的 400 响应，以及模型方法未被非法请求调用。该联调使用模型 spy，不代表数据库驱动/连接验收。
