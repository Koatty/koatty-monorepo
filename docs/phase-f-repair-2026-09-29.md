# Phase F 审计修复与验证（2026-09-29）

本次针对 `phase-f-audit-2026-09-29.md` 的 23 项发现修复源码、测试、示例和迁移文档。原审计报告保留为修复前历史，不能用其旧行号判断当前代码。没有提交、应用版本或发布；已有 koatty-ai 模板子模块修改保留。

## 逐项闭环

| 审计项 | 修复落点 | 验证 |
|---|---|---|
| F-A01 | MCP host.createServer；HTTP 连接/会话独立所有权与释放 | F-01.audit-boundaries：stateful/stateless 各两个真实 SDK HTTP 客户端，连续/并发调用 |
| F-A02 | AskController 使用 streamSSE；main.ts 真实 Koatty 入口 | F-05.reference-app：真实 socket 返回 200 SSE，断连后 <1 秒取消 |
| F-A03 | LLM 执行前校验本次显式 tools 白名单 | F-02.audit-boundaries：注册但未暴露的工具拒绝 |
| F-A04 | 每次尝试原子预留/结算，流式及纠正重试收费，故障 fail closed | F-02：共享计数并发、流式耗尽、纠正费用、计数器故障；token 估算边界见迁移 |
| F-A05 | 已输出 chunk 不透明重试 | F-02：半途失败不拼接第二次输出 |
| F-A06 | provider abort + iterator.return；SSE reader cancel/releaseLock | F-02：提前 break 清理测试 |
| F-A07 | strict 继承 app.security.name | F-01：destructive 无显式 strict 仍拒绝未审批调用 |
| F-A08 | discovery/resource/prompt/unscoped tool 统一认证 | F-01 HTTP；F-05 无凭据请求 401 |
| F-A09 | Origin 完整 origin 比较；adapter 继承 host 白名单 | F-01 不同 scheme/port 拒绝，真实受信请求成功 |
| F-A10 | 调用前及审批后检查 signal；审批等待响应取消 | F-01 已取消/审批中取消，F-02 invoker signal 透传 |
| F-A11 | UUID + 原子新建、终态 tombstone，ID 禁止重放 | F-03 相同 ID 更换参数也拒绝 |
| F-A12 | store CAS 状态机，回调实例更新/请求实例读取并消费；通知与截止时间分离 | F-03 双实例共享 KV、通知永久悬挂；真实 Redis/进程恢复待验收 |
| F-A13 | 仅 approved===true 放行 | F-03 恶形结果不执行业务 |
| F-A14 | Guard 递归检查；示例每轮出站检查/脱敏/限流，工具走组合 guard | F-03 真实 Container Around；F-05 live-loop 验证 provider 收到的内容 |
| F-A15 | 凭据键/嵌套/caller 脱敏；错误分类；sink 异常隔离 | F-03 敏感内容与异步 sink 失败 |
| F-A16 | 内容采集必须显式 masker；失败不回退原文 | F-04 配置拒绝与 masker 失败 |
| F-A17 | 有效请求缓存键；命中后 DTO 重验 | F-02 跨 DTO 缓存不能绕过验证 |
| F-A18 | 方法级 TC39 元数据提前写入且包装时复制 | F-01.schema-decorators：实际 TypeScript legacy/TC39 编译 × 三种作用域 × 装饰顺序 |
| F-A19 | validation 集中 runtime schema、纯 schema-rules；CLI/MCP/LLM 共用 | F-19 两包回归 + validation 全量 + E1/E6 兼容回归 |
| F-A20 | stream 传工具；streamWithTools 执行多轮，示例连接 host invoker | F-02 多轮统计/signal；F-05 真实 HTTP 只读工具结果回灌 |
| F-A21 | live chat/tool 生命周期；每次实际 provider 尝试遥测，实际模型/成本/失败，审批 hook | F-04 parent/duration/status；F-02 fallback；F-05 工具内部实际调用 LLM 验证 request→tool→chat parent ID |
| F-A22 | stdio identity 绑定专属 server | F-01 真实 SDK 协议 scope 调用 |
| F-A23 | 参考应用加入 workspace/default test/CI；main/build/start/compiled smoke；覆盖率门与诚实状态 | 本文下列实测；部署模板不再假称已验收 |

## 本次执行结果

环境：Node v22.23.1，使用已有依赖，未连接真实供应商。

| 检查 | 结果 | 模式 |
|---|---:|---|
| MCP F-01 | 34/34 | 内存协议 + 真实 loopback HTTP SDK |
| LLM F-02 | 31/31 | 脚本 provider / fetch / 原子 KV fixture |
| Guard F-03 | 26/26 | 真实容器 AOP + 内存共享 KV |
| Trace F-04 | 9/9 | OpenTelemetry 内存 exporter |
| 参考应用 F-05 | 13/13 | 真实 Koatty HTTP/socket + 内存 MCP + mock provider |
| Phase F 合计 | **113/113** | 初版 73 项之外补充 40 项 |
| validation 全量 | 212/212 | 含新增 schema 用例 |
| CLI E-01/E-06/F-19 | 15/15 | 静态 manifest/schema |
| 前置 SEC-01/02/03、ARCH-02/06 | 53/53 | container 13、core 3、router 37 |
| 安全基线 | 14 PASS / 0 FAIL / 0 SKIP | 包含真实 HTTP/WS/TLS |
| 编译产物启动 | 通过 | 子进程健康探针 + HTTP SSE + mock 工具循环 + SIGTERM |
| 构建/类型 | 通过 | MCP、LLM、Guard、Trace、validation、CLI、参考应用；示例 test:tsc |
| lint | 0 error | 六个涉及源码的框架/CLI 包，保留既有 warnings |

聚焦包行覆盖率：MCP **86.98%**（新增 statements/lines >=80 门）、LLM **90.79%**、Guard **93.19%**。这些不是全仓库或真实 provider 覆盖率。

已实际执行根命令 `pnpm test:phase-f` 和 `pnpm test:phase-f:compiled`。F-05 通过 workspace 进入默认 turbo test，CI 增加类型及编译产物启动检查。

## 明确保留的验收边界

- 未执行 Inspector、至少两个主流第三方客户端界面、远端 provider、真实 Redis/跨进程审批恢复、Docker/Kubernetes、p99 基准、隔离 tarball 消费和完整全仓测试。
- 预算默认 token 估算不等于供应商账单保证；中断无 usage 时保守保留预留量。
- 共享审批的自动测试证明 CAS 契约和跨实例决定传递，不声称任意 get/set store 或真实 Redis 已验收。示例内存订单/审批/限流限定单副本。
- 当前环境的 pnpm install 尝试因 store 路径/数据库权限未完成；未清空已有 node_modules。新增 workspace 使用已有依赖建立本地链接，lockfile 复用已有解析条目且逐项验证 manifest specifier 一致。干净安装仍需 CI 的 frozen-lockfile 验证。
- 构建生成的 API 文档和 dist 未纳入此次源码改动；新增 Changeset 尚未应用。子模块源码修改尚未提交，因此也没有更新主仓库 SHA 指针。

迁移入口：[phase-f-audit-fixes.md](migration/phase-f-audit-fixes.md)。
