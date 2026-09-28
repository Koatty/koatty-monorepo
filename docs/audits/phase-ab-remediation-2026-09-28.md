# Phase A/B 审计修复记录（2026-09-28）

对应 [独立审计](./phase-ab-audit-2026-09-28.md) 的 AB-01～AB-15。本记录描述当前工作树，不代表 npm 已发布版本，也不覆盖 Phase C 全部验收。

## 修复对账

| 条目 | 已实现的修复 | 正式回归/验收 |
|---|---|---|
| AB-01 | 沙箱用 `lstat` 检查所有路径段，拒绝已有及悬空符号链接；写入前复查，叶子文件用 `O_NOFOLLOW` 打开 | CLI `AB.cli-writes.spec.ts` |
| AB-02 | `.gitignore`、协议配置、备份、删除使用统一边界；apply 预检附带写入；备份排他创建，无扩展名文件也使用绝对备份路径 | CLI 同上 |
| AB-03 | logging 精确匹配 query/error/warn/schema/migration 等级；无列名的顶层位置参数默认全部遮蔽 | TypeORM `AB.logging-policy.test.ts`，原 logger/SEC-11 用例 |
| AB-04 | 业务收到清洗后的 DTO；plain object 的多余键保留到校验器执行拒绝/剥离；支持显式 partial；Expose 可加入白名单 | Validation `AB.dto-boundary.test.ts`、`AB.compiled-validated.test.ts`，真实 HTTP DTO 验收 |
| AB-05 | LoadRouter 记录错误后继续向上抛出；声明可选 peer `graphql-query-complexity ^2.0.0`，调用实际导出的 createComplexityRule/simpleEstimator | Router `AB.graphql-bootstrap.test.ts`（模拟依赖缺失），真实复杂度拒绝和正常查询 |
| AB-06 | 片段深度记忆化；遍历节点预算和片段栈上限，避免 DAG 重复指数展开 | Router `AB.graphql-depth.test.ts` 使用访问次数断言，不用耗时阈值 |
| AB-07 | 通过 formidable 公开 stream adapter 跟踪每个开始写入的文件，失败/响应结束后关闭并清理，覆盖错误后才创建的流 | Router `AB.payload-boundary.test.ts`：真实 HTTP 超数量、超大小、中断；基线断言目录持续为空 |
| AB-08 | 完整 Origin 协议/主机/有效端口匹配；通配仅匹配一个标签；升级链路接入配置限流；修复构造与 Start 重复绑定监听器 | Serve `AB.ops-origin.test.ts`，真实 WS 正常握手/错协议/错域名/限流 |
| AB-09 | Around 的 proceed、log 回退共享同一次业务执行 Promise；业务失败保留原失败 | Container `AB.around-once.test.ts`、`AB.compiled-decorators.test.ts` |
| AB-10 | XML 先执行 XMLValidator，再解析；非法 XML 映射 400 | Router `AB.payload-boundary.test.ts` |
| AB-11 | 上游统一默认 keepExtensions=false | Router 同上，通过真实 bodyParser 验证上传文件不保留 `.html` |
| AB-12 | 每请求生成解析选项，清除陈旧 length；并发调用共享在途 Promise | Router 同上，固定长度→chunked→gzip，及同请求并发 |
| AB-13 | health/ready 详情单独使用 token 鉴权；metrics 仍保持内网或 token 策略 | Serve `AB.ops-origin.test.ts`、SEC-06 |
| AB-14 | 冻结所有嵌套分区，并导出 DeepReadonly 画像类型 | Core `AB.profile-immutable.test.ts` |
| AB-15 | 基线自建 strict 生产画像 HTTP/GraphQL/WS/TLS fixture；真实结果、精确状态码、正向对照；必测项不得 SKIP，任何失败非零退出 | `pnpm security:baseline` |

DTO 校验完整性检查还修复了旧装饰器工厂丢失单个约束参数的问题（例如 `@Gte(3)`），并让旧异步测试等待其 Promise。复杂参数已由闭包捕获的 IsEmail 等包装器改用简单装饰器工厂，保留自定义错误消息。原测试中期待吞掉 GraphQL 启动错误、保留原始 SQL 位置参数、私网免 token 查看详情的断言已按新契约更新。

Legacy 与 TC39 两种模式的新增验证使用 TypeScript 实际 emit 后执行，覆盖 Before 拒绝、显式 log、After result、Around 不重复执行及同步 Validated 参数清洗/必填拒绝；没有把手工构造 context 称为完整编译验证。

## 验证证据

本地最终结果：全量构建/测试 46/46 任务成功，Jest 3018 passed / 48 skipped / 0 failed（比审计基线新增 47 个通过用例）；lint 24/24 成功，保留 warning；doctor 通过；包含 TypeScript 检查的生产安全基线 PASS 14 / FAIL 0 / SKIP 0。临时将一个 DTO 验收期望改错后得到 PASS 13 / FAIL 1 / SKIP 0 和 exit 1，确认门禁不会吞掉失败，临时副本已删除。

最终执行结果见 [verification.txt](./phase-ab-remediation-2026-09-28/verification.txt)。初始审计回归先执行并确认断言失败，再修复；补充的双模式、partial、限流与无扩展名备份用例随后加入。不能把每一个后加用例都描述为已独立演示红→绿。

专用 fixture 使用真实框架服务和解析/验证/GraphQL 组件，监听本机随机端口，自签证书只用于该临时测试。它按 Koatty 的 middleware 契约完成响应序列化，不伪造业务结果。源码加载的 GraphQLRouter 和 request ID helper、workspace dist 消费及缺依赖模拟均在脚本/测试中明确可见。

“外网来源 + 伪造 XFF”是合成 socket.remoteAddress 的组件测试；其余协议项通过回环真实网络执行。没有把本机回环测试称为外部代理部署验收。

## 配置与兼容性

- GraphQL 应用启用 complexityLimit 时必须安装 `graphql-query-complexity@^2.0.0`；缺失时启动失败。应用明确设为 0 才禁用复杂度限制，不能为了通过测试隐式关闭它。
- `@Validated(false)` 默认完整校验；部分更新使用 `@Validated({ async: false, partial: true })`。路由异步方式使用 `@Validated({ partial: true })`。TC39 同步模式不提供 design:paramtypes，应显式传 `{ async: false, types: [UserDto] }`。手动 `ClassValidator.valid(..., false)` 为兼容保留旧 partial 默认，可传第四参数 `{partial:false}`。
- `@Expose()` / 历史别名 `@IsDefined()` 保留字段，不额外赋予必填语义；必填需校验装饰器。
- 完整 WS 白名单如 `https://app.example.com:8443` 仅匹配该 origin。历史 host-only 配置仍有主机匹配语义，建议使用完整 URL。限流配置 `ws.rateLimit = { enabled: true, max: 100, windowMs: 60000 }`，统计实际 socket 地址，拒绝返回 503；默认不开启。
- 健康详情要求正确 Bearer token，即使请求来自私网。TypeORM 顶层位置参数不再原样输出；命名对象继续按敏感键递归脱敏。
- CLI 不再写入项目内的符号链接目标；备份重名拒绝覆盖。路径复查和叶子 `O_NOFOLLOW` 不等同于操作系统级目录隔离，未宣称能防御有目录写权限的并发攻击者在系统调用间替换祖先目录。

## 发布与剩余验收

需发布新版本后，下游使用者才能获得这些修复。本次不改版本号、不提交、不推送、不发布。

已准备 [Changeset 草案](./phase-ab-remediation-2026-09-28/release-changeset.md)，列出 7 个直接修改包的 patch；最终依赖包升级范围以 Changesets 计算为准。维护者手动操作：

1. 完成 Linux / Node 20 CI，并确认子模块源码修改、新测试及主仓引用都纳入版本管理。
2. 将草案复制为 `.changeset/phase-ab-audit-remediation.md`，检查 `pnpm exec changeset status`；仓库忽略 `.changeset/*.md`，若要提交需显式纳入。
3. 使用 `pnpm changeset:version:no-commit` 更新版本并审阅结果。它不会调用本仓自动提交子模块的包装器。
4. 完成发布 tarball / 独立消费项目验证及 `koatty new` 新项目生产验收，再由维护者手动发布。`pnpm release` 包含构建、workspace 版本处理、npm publish、子模块提交/推送，不能作为纯预览命令。

本轮修复不将以下原审计边界冒充已完成：远端 Linux / Node 20 CI、真实数据库、独立 npm tarball 消费、生成新项目全链路、外部网络/代理部署、全部装饰器 API 的完整双模式矩阵、新增行覆盖率 ≥80% 的 CI 差异门禁及性能基准迁移。它们与 AB-01～AB-15 的具体缺陷修复分别记录；方案的“新生成项目”验收门保持未勾选。
