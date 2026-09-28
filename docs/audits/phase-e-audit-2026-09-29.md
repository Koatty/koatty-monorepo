# Phase E 全面审计（2026-09-29）

**结论：不通过完整验收，暂不建议发布 Phase E。** 现有测试全部通过，但真实 stdio MCP、生成代码编译、测试应用生命周期验证暴露了 5 项 P1、5 项 P2 问题。E-1/E-2/E-3/E-4 有实现，不能据此认定交付闭环成立。

本次只审计，没有修改实现、版本号或已勾选的计划项，也没有发布。审计针对当前工作区（包含先前 A～D 的实现），并非干净的已发布版本。新增内容仅为本报告及同名目录中的复现脚本、输出；原有子模块未跟踪文件保留。

## 范围与验证结果

逐项对照方案 §8、Phase E 实施状态、完成报告和迁移说明，检查 CLI 命令、静态清单、MCP 服务端、生成器/模板、测试辅助包以及相关回归测试。

| 验证 | 本次结果 | 能说明什么 |
|---|---|---|
| `pnpm --filter koatty_cli build` | 通过 | 当前 CLI 源码可编译 |
| `pnpm --filter koatty_cli exec jest --runInBand` | 36 suites / 177 tests 通过 | 现有 CLI 回归通过 |
| `pnpm --filter koatty_cli lint` | 0 errors / 36 warnings | 非零警告不作为本次发布阻断项 |
| `pnpm --filter koatty_testing build` | 通过 | JS/类型产物构建通过 |
| `pnpm --filter koatty_testing test` | 3 suites / 8 tests 通过，lint 通过 | 现有辅助包回归通过 |
| SDK Client → stdio → 实际 CLI 子进程 | 握手和 7 工具枚举成功；复现 E-A01～04 | 超出原内存传输测试的实际协议证据 |
| 默认模板 + 实际 GeneratorPipeline → TypeScript | 编译失败 | 生成产物不能直接作为可工作的项目交付 |
| 实际 Koatty/createTestApp 生命周期 | 复现 start 过早返回、stop 失败后环境残留 | 不是仅检查 exports 的测试 |
| 实际 Jest 超时测试 | 约 1509ms 返回，标记 timedOut；后续等待未发现超时后写入 | 本场景超时有效，不声称已覆盖所有进程树情况 |
| `npm pack --dry-run --ignore-scripts`（CLI，独立临时 cache） | CLI/MCP/manifest 产物及 AGENTS、隐藏 Cursor 规则、llms、测试模板均在发布文件列表中 | 发布文件选择检查通过；尚未隔离安装，也没有发布 |

未执行 Cursor 内完整人工确认流程、全新在线安装、npm 发布或 Phase A～D 全量回归。真实 stdio 验证不能替代 Cursor 的端到端验收。

## 审计发现

### E-A01 · P1：apply 不要求服务端实际签发过 plan

**定位：** `packages/koatty-ai/src/mcp/tools.ts:265`、`:298`、`:315`，`src/mcp/server.ts:27`。

`koatty_plan` 计算 SHA-256 后直接返回，服务端不保存计划。`koatty_apply` 只比较客户端提交的 changeset 与同一次请求提交的 hash；客户端可自行计算两者。

**复现：** 新 stdio 会话不调用 plan，直接提交 create `unplanned.txt` 的自造变更集和自行计算的哈希，`dryRun:false`，文件成功写入。原 E-02 测试所谓重算哈希场景，并未将篡改后的变更集配上其实际重算哈希，无法证明签发约束。

**影响：** “只能应用已预览 plan、防止 plan 后篡改”的承诺不成立。此问题不等同于突破根目录限制，也不等同于绕过 IDE 自身的人工确认。

**修复验收：** 服务端将已签发计划绑定会话、项目根和内容，使用计划记录或可验证的服务端签名；拒绝未签发、内容变化、跨根/跨会话计划，并在写入前检查文件是否已经变化。确认 UI 仍由客户端负责，不能用普通哈希代替授权。

### E-A02 · P1：docs 子路径符号链接能够读取项目外内容

**定位：** `packages/koatty-ai/src/mcp/tools.ts:390`，尤其 `:397`、`:408`、`:422`。

只有最外层 docs/README/llms 路径调用 `resolveInside`；递归使用会跟随符号链接的 `statSync`，随后直接读取文件。

**复现：** 临时项目内 `docs/linked.txt` 指向同一临时工作区、项目外的 `outside.txt`。调用 `koatty_docs` 返回 `E_AUDIT_OUTSIDE_SENTINEL`，并将来源显示为项目内的 `docs/linked.txt`。

**影响：** 项目根边界在文档读取链路失效。测试只使用自己创建的假数据，未访问真实机密。

**修复验收：** 对每一个递归目录和最终文件执行根边界/符号链接检查，读取阶段继续保持同一约束；增加目录链接、文件链接及嵌套链接回归。

### E-A03 · P1：apply 参数验证不完整，报错前已经写入并截空旧文件

**定位：** `packages/koatty-ai/src/mcp/tools.ts:298`、`:325`、`:335`；`src/utils/sandbox.ts:42`。

输入 schema 只是工具描述，实际请求链没有严格执行它。`parseChangeSet` 不检查 content 类型；`Boolean(args.dryRun)` 将数字 0 当成写入许可。逐文件写入没有在开始前完成全部内容校验。底层先截断文件，再尝试写入传入内容。

**复现：** 第一个 change 创建 `partial.txt`，第二个 change 修改已有文件但 content 是对象。工具返回错误，前一个文件已创建，旧文件从 `KEEP_THIS_VALUE` 变成空字符串。另一个请求传 `dryRun:0`，同样发生写入。

**影响：** 无效请求产生真实副作用；用户收到失败结果时工作区已经改变。存在备份不代表本次操作完整回滚，也不能避免旧文件被截空。

**修复验收：** 严格验证完整参数和每一个 change 后才执行写入；仅接受真正的 boolean；无效 content 不得触碰任何目标。再覆盖中途 I/O 失败的回滚/明确恢复机制及并发修改冲突。

### E-A04 · P1：manifest 将动态 profile 表达式原文作为配置输出

**定位：** `packages/koatty-ai/src/manifest/index.ts:462`、`:479`、`:492`。

读取 profile 时取 initializer 的源码文本，并简单去除引号；既没有只接受允许的静态 profile 值，也没有将动态配置标记为未解析。

**复现：** `profile: process.env.PROFILE || 'E_AUDIT_FAKE_SECRET'` 输出为 `process.env.PROFILE || E_AUDIT_FAKE_SECRET`，`validateManifest()` 返回空错误数组。

**影响：** 配置中的表达式字面值可进入 JSON/Markdown/MCP 输出，违反“配置只输出键名/schema，动态配置标记未解析”的要求。这里是假密钥哨兵，不是发现了真实凭据泄露。

**修复验收：** 只输出已识别的静态 profile 枚举；动态值只保留不携带表达式内容的未解析说明。不要通过执行配置文件来补全信息。

### E-A05 · P1：生成的模块不符合实际框架 API，无法编译

**定位：** `packages/koatty-ai/templates/modules/controller/controller.hbs:1`、`:26`，`modules/dto/dto.hbs:1`，`modules/model/model.hbs`，`project/default/AGENTS.md.hbs:33`。

使用真实默认 package/tsconfig 模板和 GeneratorPipeline 生成最小 article 模块，连接当前工作区框架依赖后执行 TypeScript 编译，得到：

- `koatty` 没有导出模板导入的 `Query`；生成类未声明或继承 `ok`，却多处调用 `this.ok()`。
- `koatty_validation` 没有导出模板导入的 `IsString`、`IsNumber`、`MinLength` 等多个名称；这是模板与实际校验 API 不一致。
- 默认 strict 编译下，Service 注入字段、Controller 注入字段、Model 字段缺少明确赋值声明。
- 生成 Model 导入 TypeORM，但默认依赖及本次生成后的 package.json 未补齐它。由此产生的部分 Model 静态方法错误属于依赖缺失的连带结果，不重复计为独立缺陷。

E-3 新增的 AGENTS 模板还明确指示 AI 使用 `this.ok(data)`，进一步传播错误用法。E-4 测试模板仅检查可实例化和方法存在；其注释 `mockBean(Model)` 与真实 `mockBean(identifier, mock): void` 不符，属性假模型也拦截不了 Service 内直接调用的 `Model.findAndCount()`。

**修复验收：** 以当前已有装饰器和响应/校验 API 修正生成器及所有文档样例，不为兼容错误模板增加新同义 API。全新生成项目完成安装、编译、启动、DTO 校验 POST 请求和有效行为测试；不能仅断言输出文本包含某个名称。

### E-A06 · P2：新项目模板依赖范围排除了本次 CLI 5.0.0

**定位：** `packages/koatty-ai/templates/project/default/package.json.hbs:20`；`packages/koatty-ai/package.json:3`。

模板仍依赖 `koatty_cli:^4.3.0`，而此次开发的本地版本是 5.0.0。该 semver 范围不包含 5.0.0；用户使用新 CLI 创建项目后，项目内安装得到的本地 CLI 不保证具有本次 E 阶段功能，默认 build 又依赖 manifest 命令。

**修复验收：** 统一模板、迁移文档、实际发布版本的依赖契约，并用打包后的产物做隔离安装验证。本项依据本地版本和 semver 范围，不假设 npm 当前版本状态。

### E-A07 · P2：静态清单遗漏已有 API，并把错误默认值表示为确定事实

**定位：** `packages/koatty-ai/src/manifest/index.ts:117`、`:258`、`:267`、`:312`、`:337`、`:363`、`:388`、`:424`、`:431`。

静态源码夹具复现：

- 正常 `src/config` 配置未被配置采集路径读取：config.keys 为空，显式 ws 配置仍得到默认 http。
- `@Controller('/users', {protocol:'ws'})` 的路由输出硬编码 http。
- 现有 `@RequestBody()` 未被参数集合识别，params 为空；`@Service('CustomService')` 被标成类名 UserService。
- `@Autowired` 属性依赖未采集，`@Around(AuditAspect)` 的实际使用关系未采集，依赖/切面解释返回空关系。
- 动态路径不能解析时回填 `/`，没有未解析项；装饰器模式只在 experimentalDecorators 显式 false 时判定 tc39，未处理省略、JSONC 和继承配置。

**影响：** manifest/routes/explain 三个工具共享这些错误信息，AI 会据此修改错误的协议、依赖或入参契约。静态分析允许不完整，但应区分“没有”与“无法推断”。

**修复验收：** 用实际框架装饰器、默认目录和 tsconfig 语义构造夹具，补齐可静态解析项，其他信息明确标记 unresolved；不要为了迁就采集器推广另一套装饰器名。

### E-A08 · P2：DTO/config JSON Schema 和实际 schema 验证尚未交付

**定位：** `packages/koatty-ai/src/manifest/index.ts:57`、`:82`、`:279`、`:492`；方案 §8 E-1、Phase E 验收门。

dtos 实际只有字段类型文本和装饰器名称列表，没有承诺的 JSON Schema；装饰器实参约束也被丢弃。config 只有 keys，没有 schema。`validateManifest` 是局部手写结构检查，未验证 DTO/schema/profile 等完整契约；部分畸形输入甚至会在 `.entries()` 或 `.startsWith()` 抛异常。它通过不等于“通过 JSON Schema 校验”。

**修复验收：** 明确并实现清单的版本化 schema、DTO/config schema 和验证器，增加嵌套 DTO、可选字段、集合、约束、未知项和畸形输入测试，再更新验收勾选。方案仍写基于运行时 class-validator 元数据提取，与“不执行应用”及现有校验方式需要统一；应从项目已支持的静态声明复用实现，不能把不支持的新装饰器体系作为完成条件。

### E-A09 · P2：createTestApp 生命周期没有提供可靠的就绪和清理语义

**定位：** `packages/koatty-testing/src/testApp.ts:82`、`:87`。

`start()` await 的 listen 返回值不是监听就绪 Promise。实际框架测试中，`await start()` 后 native server 的 listening 为 false，等待 listening 事件后才为 true。`stop()` 在 app.stop 抛错时直接退出，环境恢复没有 finally。

**复现：** 真正创建测试应用，以明确调用 createApplication 的方式避免装饰器自动启动干扰；监听端口 0。注入受控的 stop 失败后，测试环境变量仍为 `fixture-only`；恢复原 stop 再清理后变量恢复。异常是测试注入，展示的是错误路径清理缺失，不声称正常 stop 必然失败。

**修复验收：** start 等待实际 ready/error；stop 的环境恢复放入可靠的 finally，测试覆盖正常启动/停止及异常路径。现有 8 例没有实际覆盖 createTestApp 生命周期，不能替代这些测试。

### E-A10 · P2：测试执行工具错误声明为只读、幂等

**定位：** `packages/koatty-ai/src/mcp/tools.ts:144`、`:352`。

工具通过 Jest 执行项目代码及配置，却声明 `readOnlyHint:true, idempotentHint:true`。本次真实 Jest 夹具确实写入 started.txt；执行测试显然不保证没有写文件或其他副作用。

**影响：** 依赖这些 hint 的客户端可能按只读工具展示或自动处理测试执行，和方案工具表中的“执行”分类不符。不能断言所有客户端都一定会跳过确认。

**修复验收：** 正确标注执行能力，避免只读/幂等承诺；文档同步说明测试代码的实际执行边界。普通超时场景本次通过，未将“子进程超时后继续运行”的猜测列为确认缺陷。

## 方案完成度与发布建议

| 计划项 | 本次判定 | 尚需闭环 |
|---|---|---|
| E-1 | 部分实现 | API/配置事实准确性、未解析标记、schema、安全值处理 |
| E-2 | 工具接线完成，安全验收不通过 | 计划签发绑定、完整写入校验、递归读边界、执行工具标注 |
| E-3 | 模板文件存在，内容仍有错误 | 与现有 API 对齐；项目模板 llms.txt 不等于框架文档站已上线索引 |
| E-4 | 有骨架和辅助包测试，尚未形成可执行规格 | 生成后编译/行为测试、正确 mock 示例、测试应用生命周期；当前 TestGenerator 由 ModuleGenerator 调用，不代表所有独立 Controller/Service 生成路径都补了测试 |
| COR-16 / 版本准备 | 本地 CLI 5.0.0、testing 4.0.1 | 本地构建通过不等于发布和全新安装通过 |
| Cursor 验收门 | 未验收 | 完成带 DTO 校验的 POST 接口任务，经过实际客户端确认和测试 |

建议先修复 E-A01～05，再完成 E-A06～10 及上述验收缺口，最后由用户手动发布。不要通过只降低方案目标或把普通结构校验改称 JSON Schema 校验来关闭问题。此前完成报告的测试计数仍然真实，但其“全部落地”结论应以本次反例重新评估。

## 复现与证据

脚本位于 `docs/audits/phase-e-audit-2026-09-29/`。它们依赖当前工作区已安装依赖及构建产物，所有副作用限于新建的临时夹具。复现断言描述当前缺陷，**不是修复后的通过门槛**。目录中的 JSON/log 是本次观察结果，含临时路径及假数据。

```sh
pnpm --filter koatty_cli build
pnpm --filter koatty_testing build
node docs/audits/phase-e-audit-2026-09-29/reproduce.cjs
node docs/audits/phase-e-audit-2026-09-29/generate-build.cjs
node docs/audits/phase-e-audit-2026-09-29/testing-lifecycle.cjs
node docs/audits/phase-e-audit-2026-09-29/test-runner.cjs
```

- `mcp-and-manifest.json`：真实 stdio 结果、静态清单和动态 profile 反例。
- `generated-build.json`：生成文件列表、依赖和 TypeScript 原始错误。
- `testing-lifecycle.log`：关注 `AUDIT_RESULT`；start 返回时 false、事件后 true、清理异常环境残留及最终恢复。
- `test-runner.log`：真实 Jest 超时结果和后续文件检查。
- `cli-tests.log` / `testing-tests.log`：现有测试通过的原始结果。
