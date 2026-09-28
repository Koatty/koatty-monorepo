# Phase A/B 独立审计（2026-09-28）

审计对象：`docs/koatty-hardening-and-ai-evolution-plan.md`，当前主仓 HEAD `5740654` 及其子包工作树。开始时 `git status --short` 为空。当前历史已经包含 Phase C / `koatty@4.4.0`；本报告只对 A/B 要求作验收判断，不将 Phase C 的提交或既有“全部关闭”说明作为证明。

**结论：Phase A 的主要测试门禁有效；Phase B 不通过，不应宣称 SEC-01～SEC-15 全部关闭。** 本次确认 15 项问题，其中 9 项 P1、6 项 P2。源码修复尚未进行。本次新增内容只有审计报告、独立复现脚本与证据；没有修改版本、提交、推送或发布。

> 后续修复见 [Phase A/B 审计修复记录](./phase-ab-remediation-2026-09-28.md)。下文保留修复前的历史结论及复现证据。

## 验证结果与边界

| 检查 | 本次实际结果 |
|---|---|
| `node scripts/doctor.js --assert-submodules` | 通过，检查 17 个子模块 |
| `pnpm turbo run test --force --concurrency=2` | exit 0；46 个构建/测试任务全部成功，0 缓存命中；Jest 2971 passed / 48 skipped / 0 failed |
| `pnpm turbo run lint --force --concurrency=2` | exit 0；24 个任务成功，存在 warning |
| 负向门禁 | 临时在 koatty-lib 加入 `expect(1).toBe(2)`；执行 `pnpm turbo run test --force --filter=koatty_lib` 得到 exit 1、`Failed: koatty_lib#test`；临时用例已删除 |
| `pnpm security:baseline` | exit 0；PASS 6 / FAIL 0 / SKIP 5，但存在下述假阳性 |
| 上传真实 HTTP 探测 | 一个文件 200，默认保留 `.html`；11 个文件 413，响应完成后等待 1 秒仍遗留一个临时文件 |
| 其他独立探测 | 直接加载当前 TS 源码，实际执行沙箱、DTO、日志器、XML、AOP、Origin 判定等；GraphQL 装配探测仅替换控制器元数据入口，保留真实 LoadRouter/SetRouter 和缺依赖行为 |

环境为 macOS、Node `v22.23.1`、pnpm `9.15.4`。这不是 GitHub Linux/Node 20 CI 的远端实跑，也不是 npm 已发布 tarball 的验收。真实 DB、全套 TC39 编译矩阵、TLS 握手和完整 GraphQL/WS 客户端端到端未在本次验证。对已有 48 个 skip 不作“已验证”解释。koatty_graphql、koatty_testing 的测试任务仍显示 `No tests found`。

[执行摘要](./phase-ab-audit-2026-09-28/verification.txt)包含逐包计数。可从仓库根运行以下复现；它们输出**当前缺陷行为**，不是通过/失败门禁，不应因 exit 0 就称修复通过：

```bash
node docs/audits/phase-ab-audit-2026-09-28/probe-core.cjs
node docs/audits/phase-ab-audit-2026-09-28/probe-protocol.cjs
node docs/audits/phase-ab-audit-2026-09-28/probe-upload.cjs
node docs/audits/phase-ab-audit-2026-09-28/probe-aop.cjs
```

脚本使用已有 node_modules/构建依赖，文件写入在自身创建的临时目录内，正常结束时清理；上传脚本仅监听本机回环临时端口。`probe-protocol` 的 GraphQL 片段压力最高只到 20 层。

## 已确认的问题（按修复优先级）

### AB-01 · P1 · CLI 悬空符号链接绕过沙箱（B-10 / SEC-10）

位置：`packages/koatty-ai/src/utils/sandbox.ts:29`，调用链 `apply.ts → resolveInside → FileOperator.writeFile`。

`existsSync()` 对悬空 symlink 返回 false；循环上溯到项目目录后，`realpath` 校验的只是项目目录，最终却返回原始符号链接路径。`writeFileSync` 随后跟随该链接，在根目录外创建文件。复现：项目内 `link.txt` 指向相邻 outside 目录中尚不存在的 `new.txt`，`resolveInside` 放行，外部文件被写入 `AUDIT`。无需并发替换路径。

应使用 `lstat` 辨别悬空链接，检查每一级路径；无法确定安全边界时拒绝，不能把任意 realpath 错误当成“新项目”。所有实际写入须使用同一安全策略，必要时拒绝符号链接并采用不跟随链接的文件操作。现有 SEC-10 用例仅覆盖可解析的符号链接。

### AB-02 · P1 · apply 的附带 .gitignore 写入未受沙箱约束（B-10 / SEC-10）

位置：`packages/koatty-ai/src/cli/commands/apply.ts:148`、`packages/koatty-ai/src/utils/gitignore.ts:12`。

修改已有文件产生备份后，apply 调用 `ensureBackupInGitignore(process.cwd())`。这个 helper 直接读写 `.gitignore`，没有 `resolveInside`。项目内 `.gitignore` 如果指向项目外的已有文件，该文件会被追加备份忽略规则。独立探测已复现外部文件由 `outside` 变为包含 `*.bak.*` 的内容。即使修好 AB-01，合法变更集仍能走到这条越界写入路径。

应统一校验变更文件、备份目标、`.gitignore`、协议配置补丁等全部写入目标；不能只校验 changeset.path。

### AB-03 · P1 · TypeORM “仅错误日志”不生效，位置参数仍泄露（B-12 / SEC-11）

位置：`packages/koatty-typeorm/src/logger.ts:105`、`:78`、`:120`。

默认 `logging: ['error']` 已修改，但 `KLogger.logQuery` 只判断数组的真值。TypeORM 驱动直接调用自定义 logger，例如已安装的 `SqliteQueryRunner.query`；不会替自定义 logger 过滤级别。实测 `new KLogger({logging:['error']}).logQuery(...)` 仍调用 Info。

同时 `sanitizeLogParams` 仅能识别对象键，实际 SQL 常见的位置参数 `['audit-secret']` 原样保留。实测输出 `INSERT INTO users(password) VALUES (?) [ 'audit-secret' ]`；错误和慢查询分支也存在该问题。

应按 TypeORM logging 布尔值/`all`/级别数组精确过滤，并明确位置参数的安全策略（默认不记录，或有可靠映射时脱敏）。必须用真实的 SQL + 位置参数形态验证，而不是仅测试 `{password: ...}` 对象。

### AB-04 · P1 · DTO 清洗结果没有进入业务方法（B-3 / SEC-03）

位置：`packages/koatty-validation/src/decorators.ts:255`、`:281`。

`checkValidated` 清洗的是新建 `validationTarget`，返回的 `validatedArgs` 却仍是原始 args；`@Validated(false)` 忽略返回结果并将原始 args 交给业务方法。在 standard/development 的 whitelist=true、forbidNonWhitelisted=false 下，输入 `{name:'x',admin:true}` 的验证副本已经删除 admin，业务仍收到 admin=true。脚本实际构造装饰器并调用方法复现。

应让业务调用使用清洗后的参数数组，并统一各调用路径。strict 拒绝多余字段的路径不能替代此测试；不能把本问题扩大表述为“所有 strict DTO 都可绕过”。此外方案要求的 `@Validated({partial:false})` 未实现，现有签名仍只接受 boolean。

### AB-05 · P1 · GraphQL 缺少复杂度依赖时启动链路吞错（B-4 / SEC-04）

位置：`packages/koatty-router/src/router/graphql.ts:203`、`:458`；`packages/koatty-router/package.json`。

三种画像的 complexityLimit 都为正数，但 router 没有声明方案要求的 `graphql-query-complexity` optional peer，当前安装中也没有该依赖。SetRouter 会抛错，外层 LoadRouter 却只 `Logger.Error` 然后成功返回。实测使用 strict 画像调用 LoadRouter，结果为 fulfilled 且 `ListRouter().size === 0`，缺依赖只出现在日志里。实际含义是 GraphQL 路由缺失却继续启动，并非成功启用了复杂度保护。

应补依赖声明、验证真实依赖版本的导出与调用参数，并让配置/安全规则加载失败沿 LoadRouter 向启动入口传播。现有 SEC-04b 只测试 SetRouter 抛错，漏掉真正启动路径。错误提示里的“unset complexityLimit”也不准确：未设置后还会继承画像值，显式禁用应是 0。

### AB-06 · P1 · GraphQL 深度规则可被重复 fragment 放大为指数开销（B-4 / SEC-04）

位置：`packages/koatty-router/src/router/graphql.ts:78`。

规则只有当前递归栈的环检测，没有缓存已求得的 fragment 深度。构造无环 DAG：每个 F_i 重复展开两次 F_(i+1)，末层只有同一标量字段。实际字段深度为 1，合法重复选择可合并，但深度规则遍历约 2^n 次。

同次运行 n=10/15/20 的输入分别只有 415/615/815 字节，耗时约 2/14/198ms，全部无深度错误。这是规则本身的同步 CPU 放大；当前复杂度规则之后的校验不能消除前面已经消耗的时间。没有向任何外部服务发送压力流量。

应基于 fragment 图记忆化深度结果、保留环检测，并限制访问节点预算/及时中断。增加无环共享片段的测试，不能只测 fragment 环。

### AB-07 · P1 · 超量上传 413 后仍有临时文件残留（B-5 / SEC-05）

位置：`packages/koatty-router/src/payload/parser/multipart.ts:105`、`:117`。

清理只遍历 formidable parse 回调给出的完成文件列表。真实 HTTP 上传 11 个文件，返回 413，但响应结束 1 秒后仍剩 1 个临时文件；重复探测均出现。已安装 formidable 在 fileBegin 触发 maxFiles 错误后仍存在打开当前文件的时序，该文件不一定进入回调的 files，框架当前没有覆盖它。

应跟踪所有开始创建的文件（包含半写/失败文件），在流终止、文件句柄关闭后完成幂等清理。回归必须断言临时目录最终为空，覆盖超数量、超大小和断开连接。现有测试只断言 413，或手动对成功结果调用 deleteFiles，因此没有证明失败路径清理。

### AB-08 · P1 · WS Origin 白名单丢失协议并放宽端口（B-8 / SEC-08）

位置：`packages/koatty-serve/src/server/ws.ts:168`、`:183`。

白名单配置 `https://app.example.com:8443` 时，实际 Origin 判定不仅接受该来源，也接受 `http://app.example.com:8443` 和 `http://app.example.com`。原因是仅比较 URL.host，忽略 scheme，随后又允许删除配置端口来比较。不同 scheme/port 是不同 origin，用户声明的白名单被静默扩大。

应规范化并比较完整 origin（三元组：协议、主机、有效端口）；通配仅作用于显式允许的主机标签。新增同主机不同 scheme/port 的拒绝用例。另：升级链路有连接数量检查，但没有接入方案要求的升级限流。

### AB-09 · P1 · Around 的 log 回退会重复执行业务（B-1 / SEC-01、ADR-103）

位置：`packages/koatty-container/src/processor/aop_processor.ts:421`、`:430`。

当 Around 已经 `await proceed()` 完成业务，然后自身抛错，若该切面 `onError:'log'` 或启用画像兼容回退，catch 之后再次调用 originalMethod。实测一次方法调用令业务计数从 0 变为 2，返回第二次结果。支付/写入等副作用可能重复。默认 throw 分支不受这一复现影响。

应跟踪 proceed 的执行状态/结果，不允许回退重入；业务本身抛错也不能被当作切面失败而重跑。需要覆盖 proceed 前失败、proceed 后失败以及业务失败三种情况，两个装饰器模式均验证。

### AB-10 · P2 · 畸形 XML 被当作正常请求接受（B-2 / SEC-02）

位置：`packages/koatty-router/src/payload/parser/xml.ts:45`。

`XMLParser.parse(str)` 默认并不执行完整合法性校验。输入 `<root><a>1</root>` 未闭合 a，当前返回 `{root:{a:1}}`，catch 不触发。这与方案“解析失败返回 400”的 XML 要求不一致。

应先运行 XMLValidator，或启用解析器的校验入口，再映射为不含原文的 400。现有 XML 安全用例只验证正常输入。

### AB-11 · P2 · 上传扩展名默认值在上游合并时被覆盖（B-5 / SEC-05）

位置：`packages/koatty-router/src/payload/payload_cache.ts:73`、`parser/multipart.ts:90`。

multipart 内部默认逻辑本身是 false，但统一 defaultOptions 仍设置 `keepExtensions:true`。真实 bodyParser → multipart 链路中，一个名为 attack.html 的上传生成的临时文件仍以 `.html` 结尾。

应修正统一默认值，并验证 payload/bodyParser 入口。当前“defaults to false”的测试传入 BASE_OPTS，里面已经显式写了 `keepExtensions:false`，实际测的是显式配置。

### AB-12 · P2 · 缓存的解析配置被请求长度污染（B-2 / B-0）

位置：`packages/koatty-router/src/payload/payload.ts:211`，`payload_cache.ts:getMergedOptions`。

getMergedOptions 返回共享缓存对象；parseBody 将当前 Content-Length 写入 options.length，却在下一个 chunked/压缩请求没有清空旧长度。实测先解析 `{"a":1}`，随后发送无 Content-Length、带 chunked 标记的合法 `{"a":123}`，第二次返回 400。原来的吞错改成 fail-closed 后，这种跨请求污染成为可见错误。

应只缓存不可变的静态配置，length、画像派生值等每请求单独生成；补“有长度 → 无长度/压缩”的顺序与并发测试。bodyCache 也只缓存完成值，不足以保证注释声称的并发单次解析，后续应一并核对。

### AB-13 · P2 · 详细健康信息以私网地址替代 token 鉴权（B-6 / SEC-06）

位置：`packages/koatty-serve/src/middleware/healthCheck.ts:99`、`:121`。

方案区分 metrics 的“内网或 token”和健康详情的“需 token”。当前两者共用 isAuthorized：即使配置 opsToken，来自 `10.0.0.1` 且没有 Authorization 的请求，在 detailed=true 时仍收到 uptime、memory、cpu。实测得到 200 和四个顶层字段；错误 token 同样会退回私网放行。`/ready` 的 detailed checks 也没有 token 检查。

应拆分 metrics 来源策略与详情 token 策略，健康详情必须验证 token。默认 detailed=false 时仍为最小响应，这部分已正确。

### AB-14 · P2 · SecurityProfile 仅浅冻结（B-0 / ADR-102）

位置：`packages/koatty-core/src/security/profile.ts:232`。

`Object.freeze(profile)` 只冻结顶层。实测 strict profile 的 `p.validation.whitelist=false` 成功，之后所有读取者看到 false；各嵌套安全字段同理。启动日志记录的策略可能与实际不同。

应冻结每个嵌套分区，并用 DeepReadonly 类类型表达约束。当前只断言 Object.isFrozen(profile) 和顶层替换失败，不包含内部属性。

### AB-15 · P2 · 安全基线存在假阳性且跳过关键验收（§12.2 / Phase B 验收门）

位置：`scripts/security-baseline.ts:155` 起。

- DTO 检查仅以 status<500 判通过；200 原样保留多余字段、404 未命中接口也会被当成“已剥离/拒绝”。
- 请求 ID 仅检查响应 body 不含恶意值，不检查生成的新 ID、响应 header 或日志；声明了超长 evil2 却没有发送。
- 上传检查把 400 也当作目标 413，通过后不检查临时目录；AB-07 因而漏检。
- WS 检查无条件 SKIP；TLS 即使提供 https external-url 仍 SKIP；GraphQL 在 404 时直接 SKIP。不是仅补一个参数就能完成这些验收。
- EXTERNAL_URL 不会改变探测端的来源 IP；不能仅凭改目标地址就证明“外网来源”。
- 2MB 写入循环没有总字节计数，write 返回 false 后注册 drain 又立即 end；不是可靠的固定 2MB 请求实现。

应建立明确的专用验收 fixture：有效 DTO 路由、开启 GraphQL/WS/TLS；分别验证业务实际收到的 DTO、新 request ID、真实握手结果与临时文件清理。必测项 SKIP 应令发布验收失败。当前 PASS 6 / SKIP 5 不等于附录 B 全通过，原方案该验收门本来就仍未勾选。

## 方案逐项对账

| 任务 | 判定 | 依据/剩余工作 |
|---|---|---|
| A-1 已知红灯 | 基本完成 | 全量测试通过；配置验证已经由后续代码实现。性能断言迁移至 benchmarks 尚未完成 |
| A-2 全量普查 | 已完成可复跑部分 | 本次得到 2971/48/0；已有报告的较早计数应区分历史时点 |
| A-3 CI 覆盖/负向验证 | 本地链路通过 | recursive checkout、doctor、force 已接入；当前负向实跑返回 1。未远程触发 CI |
| A-4 卫生/文档 | 主要要求通过 | CLI src 未跟踪 .js；examples 路径已修正。测试运行仍会生成本地工具缓存，不属于交付源码 |
| B-0 画像 | 部分完成 | 画像选择/覆盖/日志已实现；AB-14。legacyDefaults 并未包含 Swagger/TypeORM/Prometheus 的所有收紧项，需明确一键回退的实际边界 |
| B-1 AOP | 部分完成 | throw 与 After result 路径存在测试；log 回退有 AB-09；现有 TC39 只对 Before 手工模拟 context，不是全矩阵 |
| B-2 解析 | 部分完成 | JSON 400、raw-body 413/415 已实现；AB-10、AB-12 |
| B-3 DTO | 不通过 | AB-04；partial:false 缺失；strict 对普通对象的多余键可能在 plainToClass 期间先被丢弃，现有 strict 测试刻意用了实例，需对齐“拒绝”还是“剥离”的契约 |
| B-4 GraphQL | 不通过 | AB-05、AB-06；playground/introspection 开关与无 CDN 页面已实现 |
| B-5 上传 | 不通过 | AB-07、AB-11；deleteFiles 支持数组和 bytes helper 已实现 |
| B-6 运维端点 | 部分完成 | metrics 来源/token、Prometheus 回环默认、HTTP 家族限流接入存在；AB-13；真实外网/代理部署未验证 |
| B-7 ID/日志/拓扑 | 所查路径通过 | ID 格式约束、query 默认关闭、结构化日志、service header 显式信任已落地，回归通过 |
| B-8 WS | 不通过 | AB-08；maxPayload、错误脱敏、慢消费者关闭、定时器清理已存在；升级限流未接入 |
| B-9 lib | 所查路径通过 | HTML 实体、755、crypto.randomInt/randFast、数字串正则有实现与通过用例 |
| B-10 CLI | 不通过 | AB-01、AB-02；移除 git clean、默认 dry-run、参数数组调用已实现 |
| B-11 启动/插件/Redis | 所查路径通过 | run 单次、失败传播/退出、createApplication、6379 已落地，回归通过；不据此替 Phase C 验收 |
| B-12 默认值 | 部分完成 | TypeORM 有 AB-03；HTTPS minVersion、Swagger 生产开关、logger 默认敏感字段已存在 |
| §12.1 覆盖率/双模式 | 证据不足 | 收集 coverage 不等于“新增行≥80%”；未见 CI 的变更行阈值或完整 Legacy/TC39 编译运行矩阵 |
| §12.2 生产安全基线 | 不通过 | AB-15；没有用新生成项目完成全部探测 |

“所查路径通过”只表示本次源码与当前测试未发现阻塞问题，不是对该包所有安全性作保证。新增测试红→绿的历史顺序没有逐提交重演；不能依据文件名包含 SEC 就认定符合 ADR-104。

## 修复与发布建议

1. 先修 AB-01～AB-09，并为每项建立当前实现必失败的回归；修复 AB-10～AB-14 与相关配置契约。不要先通过回退 strict 或降低断言让门禁变绿。
2. 将复现转换为正式测试：优先验证真实装饰器调用、完整 LoadRouter 传播、真实 HTTP 上传及残留目录、完整 Origin、实际 logger 接收到的位置参数。双装饰器模式应有编译/执行证据。
3. 修复 AB-15 后，在 Node 20/Linux CI 与本地跑完整生产验收；依赖缺失场景要使进程失败，功能启用时要有正常请求作为对照。跑完整构建、lint、全量测试，再验 tarball/独立消费项目，避免 workspace 链接掩盖依赖声明遗漏。
4. **现在不建议发布当前代码来“完成 A/B”。** 修复验证完成后需要新版本，至少涉及 `koatty_cli`、`koatty_container`、`koatty_core`、`koatty_router`、`koatty_validation`、`koatty_serve`、`koatty_typeorm`；按依赖图更新 `koatty` 等入口包。使用 Changesets 确认最终变更集与实际版本，不复用已发布版本号。
5. 本次未查询 npm 最新版本，不能仅依据仓库的 4.4.0 发布记录断言注册表当前状态。最终发版由维护者手动执行；仓库 `pnpm release` 同时包含构建、workspace 版本处理、npm publish、子模块提交/推送，应在变更和子模块引用全部核对后运行。

完整原始执行日志保存在本机 `/tmp/koatty-audit-tests.log`、`/tmp/koatty-audit-lint.log`、`/tmp/koatty-audit-negative.log`、`/tmp/koatty-audit-baseline.log`；本报告同名目录保留了可迁移的复现脚本、复现输出及汇总。
