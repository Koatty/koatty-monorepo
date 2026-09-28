# Changelog

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
