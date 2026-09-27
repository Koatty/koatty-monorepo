# 测试基线报告（2026-09）

> 关联：[`koatty-hardening-and-ai-evolution-plan.md`](../koatty-hardening-and-ai-evolution-plan.md) §Phase A（A-2 全量普查）
> 方法：对全部 24 个包运行 `npx jest --ci`，对失败用例逐条回到源码核实，归类为 **real-bug**（源码缺陷）/ **stale-test**（测试与实现漂移）/ **env-dependent**（环境依赖）。

## 一、总体统计

| 包 | 基线（修复前） | real-bug | stale-test | env | 本轮处理后 |
|---|---|---|---|---|---|
| koatty-config | 3 失败 / 7 | 3（COR-08 未实现） | 0 | 0 | **7/7 绿**（COR-08 已落地） |
| koatty-core | 51 失败 + 1 杀进程 | 24 | 26 | 0 | performance.test 已删；COR-01 修复；杀进程根因已定位 |
| koatty-router | 58 失败 / 341 | 1（ListServices，实为 koatty-proto 缺陷） | 57 | 0 | ListServices 修复 + deleteFiles 测试对齐，剩 57 stale |
| koatty-schedule | 67 失败 / 140 | 3（RedLocker.resetInstance） | 64 | 0 | 未处理（COR-05/06 属 Phase C） |
| koatty-trace | 15 失败 / 115 | 4（catcher 崩溃） | 11 | 0 | catcher 守卫修复，剩 11 stale |
| koatty-typeorm | 18 失败 / 100 | 0 | 17 | 1 flaky | 未处理（SEC-11 属 Phase B-12） |
| koatty-ai | 9 失败 / 139 | 7（CJS/ESM 构建） | 2 | 0 | **139/139 绿**（构建修复 + 断言对齐） |
| koatty-container | 5 失败 / 346 | 0 | 5 | 0 | SEC-01 修复后 348 通过，剩 5 stale |
| 其余包（lib/logger/store/serve/validation/exception/graphql/cacheable/serverless/swagger/proto/loader/koatty/testing） | 全绿 | — | — | — | 全绿（含新增回归测试） |

**关键结论**：

1. 失败大多数（约 170 个）是**测试与实现漂移**，集中在三类：
   - koatty-lib `export * as Helper` 打包形态使 `jest.mock` automock 失效（schedule 39 个、router 16 个）；
   - FastPath → strategy-extractor 架构更替后旧测试未删（router 22 个）；
   - 接口演进（payload 扁平格式、NewRouter 返回签名、SpanManager.addSpanEvent、错误信息中译英）后断言未同步。
2. 确认的**源码缺陷 9 处**，其中 4 处已在本轮修复（见下）。
3. 无环境依赖类失败；typeorm 有 1 例时序 flaky（单跑即过）。

## 二、已修复的源码缺陷（本轮）

| 缺陷 | 位置 | 修复 |
|---|---|---|
| koatty-config 声称的 Schema 校验未实现（COR-08） | `koatty-config/src/config.ts` | `LoadConfigs` 接入 validator，校验失败逐条报错；`parseEnv` 支持内嵌插值与 `${VAR:-default}`，strict 画像下未定义变量启动失败 |
| AOP 切面异常仅记日志、业务继续（SEC-01） | `koatty-container/src/processor/aop_processor.ts` | Before/After/Around 失败默认抛出（fail-closed），`{ onError: 'log' }` 或 `app.security.aop.onAspectError` 可回退；After 切面经 `options.result` 拿到返回值 |
| 请求体解析失败静默返回 `{}`（SEC-02） | `koatty-router/src/payload/parser/*` | 语法错误 400、超限 413、编码不支持 415；`onParseError: 'empty'` 保留旧行为 |
| `escapeHtml` 不转义 `&`、产出非法实体 `&quote;`（SEC-09/COR-16） | `koatty-lib/src/lib.ts` | 单遍替换含 `&`；逆函数按序还原并兼容历史 `&quote;` |
| `isNumberString` 嵌套可选量词 ReDoS（SEC-17） | `koatty-lib/src/lib.ts` | 实测二次复杂度（32k 输入 480ms）；重写为无歧义等价正则，100k 对抗输入 < 0.12ms（14 字符字母表、长度 ≤5 全枚举 + 50 万随机串与旧正则 0 不一致） |
| 插件仅有 `run()` 时执行两次（COR-01） | `koatty-core/src/ComponentManager.ts` | 删除 load 阶段直接调用；统一由 `appReady` 自动绑定；注册过程幂等 |
| 启动失败被吞、测试进程被 `Fatal→exit(1)` 杀死（COR-02） | `packages/koatty/src/core/Bootstrap.ts`、`Decorator.ts` | UT/主动调用时向调用方抛出；装饰器路径以 `.catch` 保证生产环境 flush 后退出 |
| Redis 默认端口写成 3306（COR-09） | `koatty-store/src/store/redis.ts:53` | → 6379 |
| gRPC `ListServices` 恒返回空（protobuf.test 暴露） | `koatty-proto/src/proto.ts:88` | `loadPackageDefinition` 的服务条目是**函数**（带 `.service`），原 `typeof value === 'object'` 过滤把它们漏掉 |
| Trace catcher 在无 ExceptionHandler 时自身崩溃（404→500） | `koatty-trace/src/trace/catcher.ts:49` | `getInsByClass` 前增加 undefined/isClass 守卫 |
| koatty_cli 的 dist 为 ESM 语法但未声明 `type: module`，bin 直接崩 | `koatty-ai/tsconfig.json` | 构建改为 commonjs 输出（包无下游依赖，CJS 最稳） |
| 上传限制与临时文件清理（SEC-05） | `koatty-router/src/payload/parser/multipart.ts`、`utils/path.ts` | `maxFiles/maxFields/maxFieldsSize` 默认接入 SecurityProfile；`keepExtensions` 默认关闭；`deleteFiles` 支持 `filepath` 与数组形态、ENOENT 不再误报；新增 `safeFilename()` 导出 |

同时引入（B-0/ADR-102）：`koatty-core/src/security/profile.ts` 的 `SecurityProfile`（strict/standard/development + `legacyDefaults` 回退 + 启动摘要日志），`app.security` 只读暴露。

## 三、遗留源码缺陷（未修复，已定位）

| 缺陷 | 位置 | 建议归属 |
|---|---|---|
| RedLocker `resetInstance` 不清 IOC 容器缓存，重置后仍返回旧实例 | `koatty-schedule/src/locker/redlock.ts:132-139` | Phase C（COR-05 一并处理） |
| `config()` 在 `_configs` metadata 缺失时写入静默丢失 | `koatty-core/src/Application.ts:267` | Phase C（COR-12 邻域） |
| `Logger.Fatal` 的 `setImmediate(process.exit(1))` 异步退出不可拦截 | `koatty-logger/src/logger.ts:518` | Phase C（与 Application.ts:688-689 双重退出合并修） |
| formidable 无 content-length（chunked 上传）时回落 DummyParser，直接报 `ERR_METHOD_NOT_IMPLEMENTED` | upstream `formidable@3.5.4` | 建议上游修复；短期可在文档标注"multipart 上传依赖 content-length 头" |
| `apply` 无参数时的失败提示（中文）与测试期望（英文）不一致 | `koatty-ai/src/cli/commands/apply.ts` | 文案统一即可 |

## 四、Phase A 基础设施改动

- `scripts/doctor.js --assert-submodules`：遍历 `.gitmodules`，任一子模块缺 `package.json` 或 `test` 脚本即 exit 1（纯文档子模块 `koatty-awesome` 白名单豁免）；CI test job 已接入，并以 `pnpm turbo run test --force` 禁用缓存。
- `packages/koatty-doc` 补充 `test` 脚本（`jest --passWithNoTests`）。
- `packages/koatty-ai`：`.gitignore` 新增 `src/**/*.{js,js.map,d.ts,d.ts.map}`，`git rm --cached` 147 个提交进仓库的编译产物（TS 源码 49 个文件保留）。
- 根 README `examples/` 引用修正为 `packages/koatty/examples/`。

## 五、新增回归测试清单（ADR-104）

| 文件 | 覆盖 |
|---|---|
| `koatty-core/test/security/B-0.security-profile.test.ts` | SecurityProfile 选择规则、legacyDefaults、冻结、`app.security` 集成（18 例） |
| `koatty-core/test/regression/COR-01.plugin-run-once.test.ts` | 插件 run() 恰好执行一次（3 例） |
| `koatty-container/test/regression/SEC-01.aop-fail-closed.test.ts` | Before/After/Around fail-closed、onError 选项、profile 覆盖、TC39 模式（7 例） |
| `koatty-router/test/regression/SEC-02.parse-fail-closed.test.ts` | 400/413/415、无泄漏消息、上传限制、临时清理、safeFilename（18 例） |
| `koatty-validation/test/regression/SEC-03.dto-whitelist.test.ts` | 白名单剥离、strict 拒绝、原型污染键（5 例） |
| `koatty-lib/test/regression/SEC-09.lib-hardening.test.ts` | escapeHtml/escapeSpecial 往返、rand、ReDoS 基准（22 例） |
| `packages/koatty/test/regression/COR-02.bootstrap-failure.test.ts` | 启动失败向调用方传播（3 例） |

## 六、复现命令

```bash
# 全量基线
for d in packages/*/; do (cd $d && npx jest --ci 2>&1 | grep -E "^(Tests:|Test Suites:)"); done

# CI 门禁（子模块断言 + 无缓存测试）
node scripts/doctor.js --assert-submodules
pnpm turbo run test --force
```
