# Changelog

## 1.5.0

### Minor Changes

- f0e9278: Close Phase C audit findings: await singleton initialization and reverse disposal, make shutdown idempotent and drain responses complete, handle real gRPC deadlines and stream termination, bound lock renewal with cooperative cancellation, await scheduler drain, validate JSON Schema and explicit security profiles, isolate Redis native leases/transactions, and preserve cached types with single flight.

  Redis transactions now return an explicit isolated handle; native connections must be released. Untyped legacy cache entries are treated as misses. JSON Schema requires optional peer ajv 8. See docs/migration/phase-c-audit-remediation.md before release. Linux/Redis CI and independent package consumption remain release gates.

### Patch Changes

- f0e9278: Phase A–D 审计修复，未发布：

  - 容器注册表、类标识、实例注入与 AOP 解析均按容器隔离；注入不再写入共享原型。同名构造函数的元数据缓存不再串用。
  - `app.container` 与 Core ALS 贯通；请求结束释放对应容器的请求实例。组件实例和事件处理器使用所属应用。
  - 注册期构造路由 handler；控制器、参数元数据、中间件和 RouterFactory 使用应用容器。关闭一个应用不会清理另一应用的路由。
  - 扫描目录、每个模块与缓存条目均以 realpath 校验根目录边界；越界路径直接拒绝，不再回退扫描整个项目。
  - Bootstrap 自动创建应用独立容器，Loader/Router/注入链路使用 app.container；扫描同时处理默认导出与具名导出。
  - SSE 复用普通路由和 streamSSE；现有 middleware 与 Around/run 承担鉴权、限流和方法包装。
  - HTTPS/HTTP2 证书热更新及失败回退。
  - Serve 使用连接追踪器，HTTP/3 移至独立实验包 koatty_http3；移除核心 QUIC 依赖及模拟监听。
  - 生产构建可用既有 manifest 命令生成 runtime 清单；启动前逐文件校验路径与 SHA256。
  - 修复独立安装缺失运行时/公开类型依赖，以及原生 Node ESM 入口加载错误。
  - Config 复用既有双模式装饰器适配器，支持 TC39 字段初始化与应用隔离。

  移除 Http3Server 等核心导出和入站池语义属于破坏性变更，因此 koatty 与 koatty_serve 必须按 major 发布，不能沿用原计划的 4.5.0 minor。koatty_http3 是首次发布包，按发布工具的新包流程单独处理；最终版本需与主包依赖同步。

  迁移：docs/migration/phase-d-router-hotpath.md。D-5 实现及 D-7 清单已补齐；性能门槛、Linux CI 与部署验收仍未关闭。此文件不代表验收通过，不自动应用版本或发布。

- Updated dependencies [f0e9278]
- Updated dependencies [f0e9278]
- Updated dependencies [f0e9278]
- Updated dependencies [f0e9278]
  - koatty_core@2.7.0
  - koatty_container@4.1.0
  - koatty_lib@1.6.1
  - koatty_loader@2.1.0
  - koatty_logger@3.1.2

## Unreleased — Phase A–D completion

- 配置加载可复用 runtime 清单；Config 通过现有容器适配器支持 Legacy/TC39，并保持实例所属应用的配置隔离。

本轮尚未发布；验收边界见根目录 `docs/audits/phase-ad-completion-2026-09-28.md`。

## Unreleased (Phase A–D remediation)

- Config 注入以实例 app 为配置来源，修复多应用读取默认 IOC 配置；新增独立应用配置回归。
- 迁移：`docs/migration/phase-d-router-hotpath.md`。

## 1.4.3

### Patch Changes

- Updated dependencies
  - koatty_core@2.5.0

## 1.4.2

### Patch Changes

- Updated dependencies
  - koatty_core@2.4.0
  - koatty_logger@3.1.0
  - koatty_container@4.0.0

## 1.4.1

### Patch Changes

- Updated dependencies
  - koatty_loader@2.0.1

## 1.4.0

### Minor Changes

- Phase B security hardening (koatty-hardening-and-ai-evolution-plan.md, ADR-101/102/103). Fail-closed defaults with a `security.legacyDefaults: true` rollback switch; see docs/migration/4.3.0.md for the full migration guide.

  Highlights:

  - SecurityProfile (strict/standard/development) exposed read-only as `app.security`, with a startup summary and per-item WARN when rolling back
  - body parsing failures return 400/413/415 instead of silently producing `{}`; body size limit follows the security profile (1mb in production)
  - DTO validation whitelist on by default (strict profile rejects unknown fields); `__proto__`/`constructor` keys never reach DTO instances
  - AOP aspect failures abort the business method unless opted out via `{ onError: 'log' }` or `app.security.aop.onAspectError`
  - After/AfterEach aspects receive the business result via `options.result`
  - GraphQL: profile-driven playground/introspection/depth limits, built-in depth rule, optional complexity package fails startup when configured but missing, CDN-free GraphiQL
  - uploads: profile-driven maxFiles/maxFields/maxFieldsSize, keepExtensions defaults off, array-aware temp cleanup, new `safeFilename` export
  - ops endpoints: minimal liveness body, /ready 503 while draining, /metrics behind the exposeMetrics policy (loopback/RFC1918/allowCidrs/token), Prometheus bound to 127.0.0.1, rateLimit middleware wired (default off)
  - request IDs validated (`[A-Za-z0-9._:-]{1,128}`), query fallback disabled, structured access logs, topology service header opt-in
  - WebSocket: profile maxPayload, perMessageDeflate off, Origin check, connection limits, error-message redaction, slow-consumer guard, timer cleanup on destroy
  - TLS minVersion TLSv1.2 by default; TypeORM production logs errors only with sensitive-parameter redaction; Swagger disabled in production by default
  - defect fixes: escapeHtml (&-escaping, valid entities), ReDoS-safe isNumberString, plugin run() executes once, bootstrap failures propagate, Redis default port 6379, gRPC ListServices, koatty_cli bin (CJS build), RedLocker.resetInstance, config() write loss, CLI sandbox + `apply` dry-run by default

### Patch Changes

- Updated dependencies
  - koatty_core@2.3.0
  - koatty_container@3.0.0
  - koatty_lib@1.6.0
  - koatty_loader@2.0.0
  - koatty_logger@3.0.0

## 1.3.0

### Minor Changes

- build
- build

### Patch Changes

- Updated dependencies
- Updated dependencies
  - koatty_core@2.2.0
  - koatty_container@3.0.0
  - koatty_lib@1.5.0
  - koatty_loader@2.0.0
  - koatty_logger@3.0.0

## 1.2.20

### Patch Changes

- build
- Updated dependencies
  - koatty_core@2.1.10
  - koatty_container@2.0.10
  - koatty_lib@1.4.10
  - koatty_loader@1.1.10
  - koatty_logger@2.8.6

## 1.2.19

### Patch Changes

- Updated dependencies
  - koatty_container@2.0.8
  - koatty_core@2.1.9

## 1.2.18

### Patch Changes

- Updated dependencies
  - koatty_container@2.0.7
  - koatty_core@2.1.8

## 1.2.17

### Patch Changes

- Updated dependencies
  - koatty_lib@1.4.8
  - koatty_container@2.0.6
  - koatty_core@2.1.7
  - koatty_loader@1.1.8
  - koatty_logger@2.8.4

## 1.2.16

### Patch Changes

- Updated dependencies
  - koatty_container@2.0.6
  - koatty_core@2.1.6

## 1.2.15

### Patch Changes

- Updated dependencies
  - koatty_container@2.0.5
  - koatty_lib@1.4.7
  - koatty_loader@1.1.7
  - koatty_logger@2.8.3
  - koatty_core@2.1.5

## 1.2.14

### Patch Changes

- Updated dependencies
  - koatty_loader@1.1.6

## 1.2.13

### Patch Changes

- Updated dependencies
  - koatty_logger@2.8.2
  - koatty_container@2.0.4
  - koatty_core@2.1.4

## 1.2.12

### Patch Changes

- Updated dependencies
- Updated dependencies
  - koatty_container@2.0.3
  - koatty_core@2.1.3

## 1.2.11

### Patch Changes

- patch version bump for koatty, koatty_cacheable, koatty_config, koatty_container, koatty_core, koatty_exception, koatty_graphql, koatty_lib, koatty_loader, koatty_logger, koatty_proto, koatty_router, koatty_schedule, koatty_serve, koatty_store, koatty_trace, koatty_typeorm, koatty_validation
- Updated dependencies
  - koatty_container@2.0.2
  - koatty_core@2.1.2
  - koatty_lib@1.4.6
  - koatty_loader@1.1.5
  - koatty_logger@2.4.2

## 1.2.10

### Patch Changes

- Updated dependencies
  - koatty_container@2.0.1
  - koatty_logger@2.4.1
  - koatty_core@2.1.1

## 1.2.9

### Patch Changes

- Updated dependencies
  - koatty_container@2.0.0
  - koatty_core@2.1.0
  - koatty_logger@2.4.0

## 1.2.8

### Patch Changes

- build
- Updated dependencies
  - koatty_container@1.17.4
  - koatty_core@2.0.14
  - koatty_lib@1.4.5
  - koatty_loader@1.1.4
  - koatty_logger@2.3.4

## 1.2.7

### Patch Changes

- build
- Updated dependencies
  - koatty_container@1.17.3
  - koatty_core@2.0.13
  - koatty_lib@1.4.4
  - koatty_loader@1.1.3
  - koatty_logger@2.3.3

## 1.2.6

### Patch Changes

- Updated dependencies
  - koatty_container@1.17.2
  - koatty_lib@1.4.3
  - koatty_loader@1.1.2
  - koatty_logger@2.3.2
  - koatty_core@2.0.12

## 1.2.5

### Patch Changes

- Updated dependencies
  - koatty_lib@1.4.2
  - koatty_container@1.17.1
  - koatty_core@2.0.11
  - koatty_loader@1.1.1
  - koatty_logger@2.3.1

## 1.2.4

### Patch Changes

- build
- Updated dependencies
  - koatty_core@2.0.10

## 1.2.3

### Patch Changes

- init
- Updated dependencies
  - koatty_core@2.0.9

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.2.2](https://github.com/Koatty/koatty_config/compare/v1.2.0...v1.2.2) (2025-06-02)

### [1.2.1](https://github.com/Koatty/koatty_config/compare/v1.2.0...v1.2.1) (2025-06-02)

## [1.2.0](https://github.com/Koatty/koatty_config/compare/v1.1.6...v1.2.0) (2024-11-06)

### [1.1.6](https://github.com/Koatty/koatty_config/compare/v1.1.5...v1.1.6) (2023-01-10)

### Bug Fixes

- upgrade deps ([fad2c13](https://github.com/Koatty/koatty_config/commit/fad2c1327ae5ebbc7a9c0fc424d1fa8c2f9528ad))

### [1.1.5](https://github.com/Koatty/koatty_config/compare/v1.1.2...v1.1.5) (2022-05-26)

### [1.1.2](https://github.com/Koatty/koatty_config/compare/v1.1.0...v1.1.2) (2022-02-18)

### Bug Fixes

- 修复配置获取无效的 bug ([8c36753](https://github.com/Koatty/koatty_config/commit/8c36753ef22c308d7be19d717e3f3001cc2fce93))

## [1.1.0](https://github.com/Koatty/koatty_config/compare/v1.0.8...v1.1.0) (2022-02-18)

### [1.0.8](https://github.com/Koatty/koatty_config/compare/v1.0.6...v1.0.8) (2022-02-16)

### [1.0.6](https://github.com/Koatty/koatty_config/compare/v1.0.4...v1.0.6) (2021-12-10)

### [1.0.4](https://github.com/Koatty/koatty_config/compare/v1.0.2...v1.0.4) (2021-12-01)

### 1.0.2 (2021-12-01)

### [1.0.2](https://github.com/Koatty/koatty_loader/compare/v1.0.0...v1.0.2) (2021-12-01)

## 1.0.0 (2021-12-01)
