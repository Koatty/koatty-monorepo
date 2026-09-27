# 测试基线报告（2026-09）

> 关联：[`koatty-hardening-and-ai-evolution-plan.md`](../koatty-hardening-and-ai-evolution-plan.md) §Phase A（A-2 全量普查）
> 方法：对全部 24 个包运行 `npx jest --ci`，对失败用例逐条回到源码核实，归类为 **real-bug**（源码缺陷）/ **stale-test**（测试与实现漂移）/ **env-dependent**（环境依赖）。
> **最终状态：全部 24 个包 `jest --ci` 0 失败**（基线共约 250 个失败：4 个真缺陷簇 + 约 230 个测试漂移，全部关闭；允许的 skip 均有明确理由）。

## 一、总体统计（基线 → 最终）

| 包 | 基线失败 | real-bug | stale-test | 最终 |
|---|---|---|---|---|
| koatty-config | 3 | COR-08 未实现 | 0 | **12/12 绿** |
| koatty-core | 51 + 1 杀进程 | config() 写丢失 ×23；Fatal 异步退出杀进程 | 26（circuit-breaker 11、ctx 8、protocol 3、config 断言 4） | **305 通过 / 0 失败** |
| koatty-router | 58 | 1（ListServices，实为 koatty-proto 缺陷） | 57 | **361/361 绿** |
| koatty-schedule | 67 | RedLocker.resetInstance ×3 | 64 | **140/140 绿** |
| koatty-trace | 15 | catcher 崩溃 ×4 | 11 | **130/130 绿** |
| koatty-typeorm | 18 | 0 | 17 | **89 通过 / 0 失败**（20 skip 为 DB 集成套件） |
| koatty-ai | 9 | 7（CJS/ESM 构建） | 2 | **147/147 绿** |
| koatty-container | 5 | 0 | 5 | **353/353 绿** |
| koatty-lib / serve / validation / swagger / store / proto / logger / exception / cacheable / serverless / loader / graphql / koatty / testing / doc | 全绿或无测试 | — | — | 全绿（serve 783 通过 / 24 skip） |

**漂移根因分布（已全部对齐）**：
- koatty-lib `export * as Helper` 打包形态使 `jest.mock` automock 失效 → 改手动 factory mock（schedule、router、typeorm）；
- `jest.mock("koatty_container")` automock 下 `createDecorator` 返回 undefined → mock 提供 createDualMethodDecorator 透传（schedule、schedule 装饰器测试）；
- FastPath → strategy-extractor 架构更替 → 删除引用已删 API 的用例、补 strategy-extractor 新用例（router 24 个）；
- 接口演进：payload 扁平格式 + `FILE_KEY`、`NewRouter` 返回 `{router, factory}`、`app.once(AppEvent.appStop)`、SpanManager.addSpanEvent、错误信息中译英、`getInsByClass` 改为返回 undefined、`useDefineForClassFields:false` 下字段初始化器触发原型 setter（container 的 `declare` 字段改造）。

## 二、已修复的源码缺陷（全部关闭）

| 缺陷 | 位置 | 修复 |
|---|---|---|
| 配置 Schema 校验未实现（COR-08） | `koatty-config/src/config.ts` | `LoadConfigs` 接入 validator；`parseEnv` 支持内嵌插值与 `${VAR:-default}`；strict 画像下未定义变量启动失败；LoadConfigs 深拷贝加载结果避免污染模块导出 |
| AOP 切面异常放行（SEC-01） | `koatty-container/src/processor/aop_processor.ts` | Before/After/Around 默认抛出；`{ onError: 'log' }` 或 `app.security.aop.onAspectError` 回退；After 经 `options.result` 取返回值 |
| 请求体解析失败静默 `{}`（SEC-02） | `koatty-router/src/payload/parser/*` | 400/413/415 fail-closed；`onParseError: 'empty'` 保留旧行为 |
| `escapeHtml` 错误实体、不转义 `&`（SEC-09/16） | `koatty-lib/src/lib.ts` | 单遍替换含 `&`；逆函数有序还原并兼容历史 `&quote;` |
| `isNumberString` ReDoS（SEC-17） | `koatty-lib/src/lib.ts` | 实测二次复杂度；重写为等价无回溯正则（穷举+模糊 0 不一致） |
| 插件 `run()` 执行两次（COR-01） | `koatty-core/src/ComponentManager.ts` | 删除 load 阶段直调；appReady 自动绑定；注册幂等 |
| 启动失败被吞 / Fatal 杀测试进程（COR-02） | `packages/koatty/src/core/Bootstrap.ts`、`Decorator.ts` | UT/主动调用抛出；装饰器路径 `.catch` → Fatal 退出 |
| Redis 默认端口 3306（COR-09） | `koatty-store/src/store/redis.ts` | → 6379 |
| `ListServices` 恒为空 | `koatty-proto/src/proto.ts` | 识别 grpc-js 函数型服务定义 |
| catcher 无守卫崩溃（404→500） | `koatty-trace/src/trace/catcher.ts` | `getInsByClass` 前守卫 |
| koatty_cli bin 启动即崩 | `koatty-ai/tsconfig.json` | dist 改为 commonjs 输出 |
| `RedLocker.resetInstance` 失效 | `koatty-schedule/src/locker/redlock.ts` | 特性检测 `setExistingInstance`；记录注册并在 reset 时失效，强制下次直接构造 |
| koatty-core `config()` 写丢失 | `koatty-core/src/Application.ts` | `_configs` 缺失时持久化 seed（一次性，规避 `Helper.define` 不可重定义） |
| `Logger.Fatal` 异步 exit 逃逸 | `koatty-core/test/app.test.ts` | 测试用 fake timers 隔离（生产双重退出问题记录在案，Phase C 处理） |
| `/health` 泄露运行时详情、`/metrics` 公开（SEC-06） | `koatty-serve/src/middleware/healthCheck.ts` 等 | 最小存活响应；详情/指标需授权（socket.remoteAddress + RFC1918/loopback/allowCidrs/token，不信任 X-Forwarded-For）；`exposeMetrics` 策略；Prometheus 默认绑定 127.0.0.1 |
| WS 无 Origin 校验/无上限/回显错误（SEC-08） | `koatty-serve/src/server/ws.ts` | 画像化 maxPayload、perMessageDeflate 默认关、升级时 Origin 白名单（403）、连接上限（503）、错误脱敏、慢消费者关闭 |
| WS 心跳定时器泄漏（COR-14） | `koatty-serve/src/pools/ws.ts` | destroy 清理并 unref |
| TLS 无 minVersion、TLSv1.1 计为部分安全（SEC-12） | `koatty-serve/src/server/https.ts`、`pools/https.ts` | 画像默认 TLSv1.2；TLSv1.1 不再得分 |
| TypeORM 全量 SQL 入日志（SEC-11） | `koatty-typeorm/src/index.ts`、`logger.ts` | 生产默认 `['error']`；参数敏感键脱敏 |
| Swagger 生产默认开放（SEC-14） | `koatty-swagger/src/index.ts` | `enabled` 默认非生产开启；生产显式开启时 WARN |
| GraphQL playground 强制开、introspection 无效、深度/复杂度依赖可选包静默降级（SEC-04） | `koatty-router/src/router/graphql.ts` | 画像化默认；内置深度限制（含 fragment 展开/环检测）；`NoSchemaIntrospectionCustomRule`；复杂度缺包启动失败；GraphiQL 无 CDN 脚本 |

## 三、已知遗留（记录在案）

- `Logger.Fatal` 的 `setImmediate(process.exit(1))` 与 `Application.captureError` 的同步 `exit(-1)` 双重退出设计（生产中后者先生效）；Phase C 停机重构时统一。
- formidable 上游缺陷：无 content-length 的 chunked multipart 上传会回落 DummyParser 报错（建议上游修复；常规请求均带 content-length）。
- `koatty-typeorm` test/advanced-decorator.test.ts:262 存在一个预先存在的语法错误（不影响 jest 运行，tsc 报告）。
- koatty-testing / koatty-graphql / koatty-doc 无实质测试（`--passWithNoTests`），QA-05 中列出。

## 四、Phase A/B 基础设施改动

- `scripts/doctor.js --assert-submodules`：子模块缺 `package.json` 或 `test` 脚本即 CI 失败；CI 使用 `turbo run test --force` 禁缓存。
- `packages/koatty-ai`：untrack 147 个编译产物（QA-03）；README examples 路径修正（QA-05）；`koatty-doc` 补 test 脚本。
- 新增 `SecurityProfile`（ADR-102）：strict/standard/development + `legacyDefaults` 回退 + `app.security` 只读暴露 + 启动摘要。

## 五、新增回归测试清单（ADR-104，共 100 例）

| 文件 | 覆盖 |
|---|---|
| `koatty-core/test/security/B-0.security-profile.test.ts` | 画像选择、legacyDefaults（含启动 WARN 逐项输出验证）、冻结、app.security（19） |
| `koatty-core/test/regression/COR-01.plugin-run-once.test.ts` | 插件 run() 恰好一次（3） |
| `koatty-container/test/regression/SEC-01.aop-fail-closed.test.ts` | AOP fail-closed、onError、profile、TC39（7） |
| `koatty-router/test/regression/SEC-02.parse-fail-closed.test.ts` | 400/413/415、上传限制、临时清理、safeFilename、画像化 body limit（21） |
| `koatty-router/test/regression/SEC-04.graphql-security.test.ts` + `SEC-04b` | 内置深度限制/环检测、introspection、playground 画像、复杂度缺包失败（11） |
| `koatty-validation/test/regression/SEC-03.dto-whitelist.test.ts` | 白名单、strict 拒绝、原型污染（5） |
| `koatty-lib/test/regression/SEC-09.lib-hardening.test.ts` | escapeHtml/unescapeHtml、rand、ReDoS 基准（22） |
| `packages/koatty/test/regression/COR-02.bootstrap-failure.test.ts` | 启动失败传播（3） |
| `koatty-trace/test/regression/SEC-07.request-id.test.ts` | 请求 ID 校验、结构化日志、service 头（15） |
| `koatty-ai/tests/regression/SEC-10.cli-sandbox.spec.ts` | resolveInside、symlink 逃逸、git clean 移除（8） |
| `koatty-serve/test/regression/SEC-06.ops-endpoints.test.ts` | 存活/就绪/指标策略、CIDR、token、XFF 不信任（16） |
| `koatty-serve/test/regression/SEC-08.ws-hardening.test.ts` | WS 默认值、Origin、连接上限、慢消费者、定时器清理（9） |
| `koatty-typeorm/test/regression/SEC-11.logging-defaults.test.ts` | 生产日志默认值、参数脱敏（9） |
| `koatty-swagger/test/regression/SEC-14.swagger-enabled.test.ts` | 生产默认关闭、显式开启告警（6） |

## 六、复现命令

```bash
# 全量测试
for d in packages/*/; do (cd $d && npx jest --ci 2>&1 | grep -E "^(Tests:|Test Suites:)"); done

# CI 门禁（子模块断言 + 无缓存测试）
node scripts/doctor.js --assert-submodules
pnpm turbo run test --force
```
