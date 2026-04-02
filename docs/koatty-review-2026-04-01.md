# Koatty Framework 评审与优化报告

**报告日期**: 2026-04-01  
**评审范围**: koatty-monorepo 全部 21 个 packages + koatty-ai (CLI 工具) + koatty_swagger (OpenAPI)  
**评审目标**: 先进性 · 高性能 · 易用性 · 智能化  
**参考对象**: NestJS v10、Midway v3、Egg.js v3、Fastify v5、Hono v4

---

## 目录

1. [框架概览](#1-框架概览)
2. [架构评估](#2-架构评估)
3. [行业对标分析](#3-行业对标分析)
4. [遗留问题跟踪（2026-03-12 评审）](#4-遗留问题跟踪)
5. [本次新发现问题](#5-本次新发现问题)
6. [性能分析](#6-性能分析)
7. [易用性与开发体验](#7-易用性与开发体验)
8. [先进性与智能化差距](#8-先进性与智能化差距)
9. [优化建议](#9-优化建议)
10. [优先级路线图](#10-优先级路线图)

---

## 1. 框架概览

Koatty 是一个基于 Koa 扩展的 TypeScript 全栈 Web 框架，采用 IoC/DI 容器、装饰器驱动路由、多协议服务器、事件驱动启动序列等现代企业级特性，面向 Node.js 18+ 环境。

### 包清单

| 包 | 职责 | 类型 |
|---|---|---|
| `koatty` | 主框架入口，Bootstrap 引导 | 核心 |
| `koatty-core` | Application 基类、接口定义、生命周期 | 核心 |
| `koatty-container` | IoC/DI 容器，AOP，懒加载代理 | 核心 |
| `koatty-router` | HTTP/gRPC/WebSocket/GraphQL 路由 | 核心 |
| `koatty-serve` | 服务器创建（HTTP/HTTPS/HTTP2/HTTP3/gRPC/WS） | 核心 |
| `koatty-trace` | 链路追踪、OpenTelemetry、Prometheus 指标 | 核心 |
| `koatty-exception` | 异常基类、全局异常处理器 | 核心 |
| `koatty-config` | 配置加载，环境变量注入 | 核心 |
| `koatty-loader` | 模块扫描加载器 | 核心 |
| `koatty-logger` | 日志库（Winston），批量写入，脱敏 | 核心 |
| `koatty-validation` | 参数校验，class-validator 集成 | 扩展 |
| `koatty-cacheable` | 缓存装饰器，多后端支持 | 扩展 |
| `koatty-store` | Redis/Memory 存储抽象 | 扩展 |
| `koatty-schedule` | 分布式定时任务，RedLock | 扩展 |
| `koatty-typeorm` | TypeORM 集成 | 扩展 |
| `koatty-proto` | Protocol Buffers 定义 | 扩展 |
| `koatty-graphql` | GraphQL 支持 | 扩展 |
| `koatty-doc` | 文档工具 | 扩展 |
| `koatty-serverless` | Serverless 适配 | 扩展 |
| `koatty-lib` | 工具函数库 | 基础 |
| `koatty-awesome` | 生态收录 | 文档 |
| `koatty-ai` (koatty_cli) | 智能脚手架与代码生成 CLI | **独立工具** |

---

## 2. 架构评估

### 2.1 架构优势

**1. 多协议统一抽象（行业领先）**  
支持 HTTP/HTTPS/HTTP2/HTTP3/gRPC/WebSocket/GraphQL 统一在 `KoattyContext` 抽象下，且单应用可同时监听多协议（通过 `protocol: ['http', 'grpc']` 配置）。这在同类框架中属于最完整的多协议支持，NestJS 需要混合应用模式才能实现类似效果，Midway 也类似。

**2. 事件驱动启动序列（设计清晰）**  
`AppEventArr` 定义了明确的 11 步启动顺序：`appBoot → loadConfigure → loadComponent → loadPlugin → loadMiddleware → loadService → loadController → loadRouter → loadServe → appReady → appStart`。组件通过 `@OnEvent` 装饰器解耦，架构干净。

**3. IoC 容器功能完善**  
- 循环依赖检测（`CircularDepDetector`）
- 懒加载 Proxy（惰性实例化）
- 生命周期管理（`LifecycleManager`）
- 批量注册（`BatchRegistrar`）
- 性能监控（`PerformanceManager`）
- 元数据缓存（`MetadataCache`，LRU）
- AOP 支持（环绕/前置/后置）
- 属性注入（`@Autowired`、`@Config`、`@Values`）

**4. 原生 OpenTelemetry 集成**  
`koatty-trace` 原生集成 OpenTelemetry SDK、SpanManager、拓扑分析（`TopologyAnalyzer`）、Prometheus 指标导出，无需外部插件。这比 NestJS 的手动集成方式先进。

**5. 安全意识良好**  
- 原型链污染检测（`isPrototypePollution`）
- 日志注入防护（`sanitizeInput`，过滤控制字符）
- 日志脱敏（`sensFields`，Set 结构高效查找）
- 日志路径遍历检测（`validateLogPath`，base dir 边界检查）
- 配置的 `${ENV_VAR}` 解析避免直接暴露

**6. 批量日志写入**  
Logger 实现了缓冲区批量写入（`batchConfig`），可大幅降低 I/O 开销；同时 `setImmediate` 确保异步不阻塞主线程。

**7. AsyncLocalStorage 请求上下文**  
`ctxStorage: AsyncLocalStorage` 保证请求上下文在异步调用链中传播，为调试和链路追踪奠定基础。

### 2.2 架构不足

**1. 基于 Koa 的性能上限**  
Koa 是一个优秀但不是最高性能的框架底座。Fastify v5 的吞吐量通常是 Koa 的 2~3 倍（基准测试：Koa ~80k req/s vs Fastify ~190k req/s，取决于硬件）。Koatty 在 Koa 之上再加一层抽象，性能损耗进一步叠加。这不一定是问题（企业应用瓶颈通常在数据库而非框架），但值得记录。

**2. 装饰器元数据依赖 `reflect-metadata`**  
仍依赖旧版 TC39 Stage 3 装饰器提案（`experimentalDecorators: true`），而非 ECMAScript 2023 正式装饰器标准。NestJS v10 和 Midway v4 已在规划迁移路径。这会带来未来兼容性风险。

**3. 配置系统深度限制为 2 级**  
`Application.config()` 仅支持最多 2 级路径（如 `database.host`），3 级以上静默截断并打印警告。这是一个刻意的设计限制，但文档中未明确说明，容易踩坑。现代框架（如 NestJS `ConfigService`）支持任意深度。

**4. `any` 类型过度使用**  
核心接口中 `KoattyServer.options: any`、`KoattyRouter.options: any`、`KoattyRouter.router: any` 完全放弃了类型安全。`getMiddlewareStats()` 内部 `const stats: any = {}` 也不必要，已有具体的返回类型声明却未在实现中使用。

---

## 3. 行业对标分析

### 3.1 特性对比矩阵

| 特性 | Koatty | NestJS v10 | Midway v3 | Egg.js v3 | 备注 |
|------|:------:|:----------:|:---------:|:---------:|------|
| TypeScript 原生 | ✅ | ✅ | ✅ | 部分 | |
| IoC/DI 容器 | ✅ | ✅ | ✅ | ❌ | |
| 装饰器路由 | ✅ | ✅ | ✅ | 插件 | |
| AOP 支持 | ✅ | 部分 | ✅ | ❌ | |
| 多协议（HTTP+gRPC+WS） | ✅ | 混合模式 | ✅ | ❌ | Koatty 最简洁 |
| HTTP/2 原生 | ✅ | 手动 | ✅ | ❌ | |
| HTTP/3 (QUIC) | ✅ | ❌ | ❌ | ❌ | **Koatty 领先** |
| GraphQL | ✅ | ✅ | ✅ | 插件 | |
| OpenTelemetry 内置 | ✅ | 手动 | 插件 | ❌ | **Koatty 领先** |
| Prometheus 内置 | ✅ | 手动 | 手动 | ❌ | **Koatty 领先** |
| 分布式锁 (RedLock) | ✅ | ❌ | ❌ | 插件 | **Koatty 独有** |
| Serverless 支持 | ✅ | ✅ | ✅ | ✅ | |
| 配置加密 | ❌ | ❌ | ✅ | ✅ | 差距 |
| 热重载 (HMR) | ❌ | ✅ | ✅ | ❌ | 差距 |
| OpenAPI/Swagger | ⚠️ (koatty_swagger, 早期) | ✅ | ✅ | ✅ | 已有基础，需完善 |
| CLI 脚手架 | ✅ (koatty_cli) | ✅ | ✅ | ✅ | koatty-ai 已覆盖 |
| AI 代码生成 | ✅ (koatty_cli) | ❌ | ❌ | ❌ | **Koatty 独有领先** |
| SQL→代码生成 | ✅ (koatty_cli) | ❌ | ❌ | ❌ | **Koatty 独有领先** |
| 健康检查端点 | ❌ | ✅ | ✅ | 插件 | 差距 |
| 内置限流 | ❌ | 插件 | 插件 | 插件 | 差距 |
| 内置熔断器 | ❌ | ❌ | ❌ | ❌ | 行业共同缺失 |
| 数据库验证（class-validator） | ✅ | ✅ | ✅ | 插件 | |
| 中文场景校验器 | ✅ | ❌ | 部分 | 插件 | **Koatty 独有优势** |
| i18n 国际化 | ❌ | ✅ | ✅ | ✅ | 差距 |
| SSE (Server-Sent Events) | ❌ | 手动 | 手动 | 手动 | 行业共同缺失 |
| 测试工具集成 | 部分 | ✅ | ✅ | ✅ | 差距 |
| 文档网站 | 基础 | 完整 | 完整 | 完整 | 差距 |

### 3.2 差异化竞争优势

Koatty 相较于同类框架最显著的差异化能力：

1. **HTTP/3 (QUIC) 支持** — 在主流 Node.js 框架中几乎唯一内置支持 HTTP/3 的框架
2. **原生 OpenTelemetry + Prometheus** — 无需第三方插件即可获得企业级可观测性
3. **分布式 RedLock** — 内置分布式定时任务锁，降低了分布式系统搭建门槛
4. **多协议统一 Context** — 单一 API 处理 HTTP/gRPC/WebSocket，显著降低多协议系统的认知负担
5. **中文场景专项校验器** — 身份证号、手机号、车牌号等本地化校验，适合国内业务
6. **AI 驱动 CLI（koatty_cli v6）** — `koatty ai spec` 自然语言生成规范、`sql2yml`、AI 错误诊断，在主流 Node.js 框架中独一无二
7. **Plan/Apply 工作流** — CLI 的 `koatty plan → apply → remove` 模式类似 Terraform，比 NestJS CLI 的直接生成更安全、可预览、可回滚

### 3.3 koatty_cli (koatty-ai) 深度评审

`koatty_cli v6.0.0` 是框架的独立配套工具，功能已超越同类框架 CLI：

#### 亮点

| 功能 | 评价 |
|------|------|
| `koatty new` 多模板 | 支持 project / middleware / plugin / serverless，覆盖全场景 |
| `koatty add` 交互式 CRUD | Spec YAML 驱动，支持 REST/gRPC/WebSocket/GraphQL，可复用 |
| `koatty plan` 预览 diff | 彩色 diff + 备份机制，安全可逆，NestJS CLI 无此特性 |
| `koatty ai spec` | 本地模式（模式推断）+ AI 模式（OpenAI 兼容），智能化领先 |
| `koatty sql2yml` | 从 DDL 反向工程生成模块，大幅降低已有数据库接入成本 |
| `koatty ai diagnose` | 错误日志/源码分析 + 修复建议，开发效率工具 |
| `koatty sls` | 多云 Serverless 部署（AWS/阿里云/腾讯云）一站式管理 |
| Shell 补全 | Bash/Zsh/Fish 均支持 |
| i18n 自动检测 | 系统语言自动切换中英文 |
| 架构设计 | EventBus + DI + Pipeline + ChangeSet，扩展性强 |

#### 待改进点

1. **未纳入 monorepo 管理** — `koatty-ai` 是独立仓库，未作为 monorepo 的一个 package，版本与框架主版本缺乏联动机制，存在 CLI 生成的代码与框架 API 不同步的风险
2. **模板与框架 API 硬编码解耦** — CLI 中的 Handlebars 模板直接使用 `koatty` 装饰器名称（如 `@GetMapping`），若框架 API 变化需手动同步模板，建议建立版本约束机制（如 `koatty_cli@6` 对应 `koatty@4.x`）
3. **`koatty ai diagnose --file`** — 分析源文件功能潜力大，但若与框架本身的类型信息（IoC 容器、路由注册表）结合，诊断精度会更高
4. **生成代码的测试覆盖** — `--with-test` 选项生成测试文件，但生成的测试是否使用框架最新的 `createApplication()` + `supertest` 最佳实践，需要验证

### 3.4 koatty_swagger 深度评审

`koatty_swagger v1.0.0` 是独立的 OpenAPI 3.0 文档生成扩展，提供装饰器驱动的 Swagger 文档。

#### 已实现能力

| 能力 | 状态 |
|------|------|
| `@ApiOperation` — HTTP 方法/路径/摘要 | ✅ |
| `@ApiParam` — query/path/header/cookie/body 参数 | ✅ |
| `@ApiResponse` — 响应定义 | ✅ |
| `@ApiModel` / `@ApiProperty` — Schema 组件 | ✅ |
| `@ApiHeader` — Header 定义（含安全方案） | ✅ |
| OAuth2 / Bearer / ApiKey 安全方案 | ✅ |
| Swagger UI 内嵌服务 | ✅ |
| OpenAPI JSON 文件导出 | ✅ |
| 继承模型 (`allOf` + `$ref`) | ✅ |

#### 存在的问题（需修复后才可生产使用）

**SW-1（High）`openapi: '3.0.0'` 与 `oas31` 类型定义不匹配**

```ts
// index.ts:70
const doc: OpenAPIObject = {
  openapi: '3.0.0',  // 声明的是 3.0 格式
  // ...
};
// 但 import { OpenAPIObject } from 'openapi3-ts/oas31';  ← 3.1 类型
```

OpenAPI 3.0 与 3.1 有结构差异（如 `nullable` vs `type: ['string', 'null']`），混用会导致生成的 spec 通不过 `swagger-parser` 校验。应统一为 3.1（`openapi: '3.1.0'`）或将类型导入改为 `openapi3-ts/oas30`。

**SW-2（High）`generateOpenAPIDoc` 每次请求都重新计算**

```ts
// index.ts:88 — 每次 GET /swagger.json 触发
ctx.body = generateOpenAPIDoc(config);
```

文档内容不依赖请求参数，应在中间件初始化时缓存一次，`/swagger.json` 接口直接返回缓存，避免每次反射遍历所有 Controller。

**SW-3（High）`writeFileSync` 同步阻塞主线程**

```ts
// index.ts:56-58
if (opt.jsonPath) {
  writeFileSync(opt.jsonPath, JSON.stringify(doc, null, 2));
}
```

`KoattySwagger()` 在中间件工厂函数中同步写文件，在框架启动时阻塞事件循环。改用 `writeFile`（异步）或仅在 `--export` CLI 模式下写文件。

**SW-4（High）`ApiResponse` 未检查 `options` 是否为 undefined**

```ts
// decorators/response.ts:38
[options.contentType]: {  // 若 options 为 undefined，此处 throw TypeError
```

`options` 参数是可选的，未提供时直接访问 `options.contentType` 会崩溃。需加 `options = options ?? {}` 空值保护。

**SW-5（Medium）`ComponentGenerator` 静态可变状态导致并发/重复调用问题**

```ts
private static visitedDTOs = new Set<Function>();
private static schemas: Record<string, SchemaObject> = {};
```

类级静态属性在多次调用 `generate()` 时可能产生状态污染。`resetState()` 虽有清理，但若并发调用则存在竞态。应改为实例方法。

**SW-6（Medium）路由装饰器与 Swagger 装饰器完全分离**

框架的路由装饰器（`@GetMapping`/`@PostMapping` 等）与 Swagger 的 `@ApiOperation` 完全独立，开发者需为同一路由添加两组装饰器，存在信息重复和不一致风险。理想设计是从路由元数据自动提取路径/方法，Swagger 装饰器只补充文档描述信息。

**SW-7（Low）`engines.node: ">12.0.0"` 未与 monorepo 对齐**

monorepo 要求 `>=18.0.0`，该包的 `package.json` 仍声明 `>12.0.0`，不一致。

**SW-8（Low）`peerDependencies` 使用 `workspace:*` 无法 npm 发布**

```json
"peerDependencies": {
  "koatty": "workspace:*",  // 无法发布到 npm registry
}
```

发布前需将 `workspace:*` 替换为实际版本范围（如 `^4.0.0`）。

**SW-9（Low）README 近乎空白**

仅有一行说明，无使用示例、装饰器 API 参考或安装说明。

### 3.5 需要补齐的核心差距

按重要性排序：

1. **koatty_swagger 完善并纳入 monorepo** — 已有基础框架，修复上述问题后可成为正式的 `koatty-swagger` 包
2. **Swagger 装饰器与路由装饰器联动** — 避免双重标注，提升 DX
3. **健康检查端点** — 生产环境容器化部署必须（Kubernetes liveness/readiness probe）
4. **配置加密** — 生产环境密钥管理的基本需求
5. **koatty_cli + koatty_swagger 全部纳入 monorepo** — 确保版本联动和 API 一致性

---

## 4. 遗留问题跟踪

> 来源：`docs/code-review-2026-03-12.md`，本次审查确认状态

### P1 级问题（修复状态）

| ID | 问题描述 | 代码位置 | 状态 |
|----|---------|---------|------|
| **P1-1** | `listen()` 中重复调用 `bindProcessEvent(this, 'appStop')` 两次 | `koatty-core/src/Application.ts:425-431` | ❌ **未修复** |
| **P1-2** | `captureError()` 调用 `process.removeAllListeners()` 移除所有第三方监听器 | `koatty-core/src/Application.ts:665-688` | ❌ **未修复** |
| **P1-3** | `global.__KOATTY_IOC__` 全局单例污染命名空间 | `koatty-container/src/container/container.ts:918-925` | ❌ **未修复** |
| **P1-4** | `defaultOptions` 硬编码 `username: "test", password: "test"` | `koatty-typeorm/src/index.ts:47-54` | ❌ **未修复** |
| **P1-5** | `callback()` 中 `reqHandler` 被 push 进持久化 `middlewareStacks`，导致内存泄漏 | `koatty-core/src/Application.ts:607-609` | ❌ **未修复** |

**所有 5 个 P1 问题均未修复**，需要立即处理。

### P2 级问题（修复状态）

| ID | 问题描述 | 状态 |
|----|---------|------|
| P2-1 | `any` 类型滥用 | ❌ 未修复，有增无减 |
| P2-2 | `errors[0].constraints` 无空值保护 | ❌ 未修复 (`rule.ts:101`) |
| P2-3 | `storeCache.store = null` 类型不一致 | ❌ 未修复 |
| P2-4 | 用户组件启用逻辑过于宽松（`||` 应为 `&&`） | ❌ 未修复 |
| P2-5 | `LogLevelObj[level]` falsy 值误判 | ❌ 未修复 |
| P2-6 | `LoadRouter` 错误被静默吞掉 | ✅ **已修复**（RouterComponent 有完整 try-catch+throw） |
| P2-7 | 实例清除后重新注入绕过生命周期 | 待确认 |
| P2-8 | 多协议端口自动分配无警告 | ❌ 未修复 |
| P2-9 | monorepo 根 `tsconfig.json` references 不完整 | ❌ 未修复 |
| P2-10 | 内存缓存事务未实现 | ❌ 未修复 |
| P2-11 | retry 默认对所有错误重试 | ❌ 未修复（`trace.ts` 默认 `conditions: undefined`） |

---

## 5. 本次新发现问题

### N-1（High）`contextPrototypes` Map 声明但未使用

```
koatty-core/src/Application.ts:70
```

```ts
private contextPrototypes: Map<string, any> = new Map();
```

`contextPrototypes` 只声明，从未在任何方法中读写，是死代码。每个 `Koatty` 实例会为其分配一个空 Map。

**建议**: 删除此属性，或实现其设计意图（Protocol-specific context prototype caching）。

---

### N-2（High）`KoattyTypeORM` 监听了不存在的事件 `'Stop'`

```
koatty-typeorm/src/index.ts:123
```

```ts
app.on('Stop', async () => {
  if (conn.isInitialized) {
    await conn.destroy();
  }
});
```

应用生命周期事件枚举为 `AppEvent.appStop`（字符串值 `"appStop"`），而这里监听的是 `'Stop'`，拼写错误导致**数据库连接永远不会在应用停止时关闭**，产生资源泄漏。

**建议**: 改为 `app.once(AppEvent.appStop, async () => { ... })`。

---

### N-3（High）`LogLevelObj` 使用 `warning` 而非 Winston 标准 `warn`

```
koatty-logger/src/logger.ts:18-23
```

```ts
const LogLevelObj: any = {
  "debug": 7,
  "info": 6,
  "warning": 4,   // Winston 标准是 "warn"，不是 "warning"
  "error": 3
};
```

Winston 的内置级别是 `warn`，而此处使用的是非标准的 `warning`。当调用 `logger.warning(...)` 时，Winston 内部不会映射到正确的传输处理器，可能导致日志丢失或分级错误。同时 `printLog` 中调用 `this.logger[level](sanitizedArgs)` 时，`level = "warning"` 会导致调用 `winston_logger.warning()` 而非 `winston_logger.warn()`。

**建议**: 将 `LogLevelObj` 中的 `"warning"` 改为 `"warn"`，同时更新 `LogLevelType` 类型定义和 `Warn()` 方法内部调用。

---

### N-4（Medium）`callback()` 注释与代码矛盾

```
koatty-core/src/Application.ts:86-95 (注释), :607-609 (实现)
```

注释声明：
```
Handlers with reqHandler parameter are NOT cached (dynamic registration).
```

但实现仍然将 `reqHandler` push 进持久化的 `protocolMiddleware` 数组（即 P1-5）。注释已更新但代码逻辑未修复，形成误导性注释。

---

### N-5（Medium）`Logger.Log()` 中 `LogLevelObj[name]` 同样有 falsy bug

```
koatty-logger/src/logger.ts:548
```

```ts
if (LogLevelObj[name]) {
  level = name;
```

与 P2-5 相同，若未来添加数值为 `0` 的级别会导致误判。此处与 P2-5 是同一根因的两处表现。

---

### N-6（Medium）`createContext` 返回 `any`，丢失类型安全

```
koatty-core/src/Application.ts:406
koatty-core/src/IApplication.ts:148
```

`createContext` 的签名和实现均返回 `any`，但方法文档注释说明返回 `KoattyContext`。调用方在获取 context 后无法获得类型提示。

**建议**: 将返回类型改为 `KoattyContext`，在实现中也相应调整。

---

### N-7（Medium）`koatty-validation` 验证缓存键可能碰撞

```
koatty-validation/src/performance-cache.ts
```

验证结果缓存的键由验证器名称 + 值序列化构成，但对于原始类型（字符串、数字）等值不同但序列化相同的情况存在碰撞风险。例如数字 `1` 和字符串 `"1"` 可能在某些序列化策略下产生相同的缓存键。

---

### N-8（Medium）`ServeComponent.run()` 空方法为噪声代码

```
koatty-serve/src/ServeComponent.ts:84-87
```

```ts
// @OnEvent(AppEvent.appReady)
async run(_app: KoattyApplication): Promise<void> {
  // ...
}
```

已注释的 `@OnEvent` 装饰器和空的 `run()` 方法体，是无效代码。ComponentManager 会尝试检测此方法（`implementsPluginInterface`），产生不必要的运行时检查。

---

### N-9（Low）`koatty-trace` 中 Span 创建后无显式 end

```
koatty-trace/src/trace/trace.ts:314-317
```

```ts
spanManager.createSpan(tracer, ctx, serviceName);
// Note: Span cleanup is handled by SpanManager.destroy() on app stop
```

Span 在请求结束时没有被 `span.end()` 调用，而是依赖 `SpanManager.destroy()` 在应用停止时统一清理。这意味着：
- 每个请求的 Span 持续时间记录不准确（无结束时间戳）
- 内存中累积的活跃 Span 直到应用停止才释放

**建议**: 在 `handleRequest` 的请求完成回调中调用 `span.end()`，而不是依赖应用停止时的批量清理。

---

### N-10（Low）`tsconfig.json` 根配置 `references` 不完整（P2-9 延伸）

```
/tsconfig.json:references
```

仅包含 5 个包，21 个包中 16 个未被引用。Turborepo 本身管理构建顺序，但 TypeScript Project References 的跨包类型检查和 IDE 导航（"Go to Definition" 跨包）仍依赖 `references` 配置。

---

### N-11（High）文档站 `koatty-doc` 内容严重滞后于框架现状

**位置**：`packages/koatty-doc/docs/`（submodule，已初始化）  
**站点**：Docsify，托管于 `koatty.org`

当前文档内容极度稀少，与框架实际能力存在巨大断层：

| 缺失内容 | 说明 |
|----------|------|
| 多协议使用指南 | HTTP2/HTTP3/gRPC/WebSocket/GraphQL 均无文档 |
| OpenTelemetry / Prometheus 配置 | `koatty-trace` 有大量配置项，全无说明 |
| `createApplication()` Serverless 模式 | 无文档，用户只能看源码 |
| `koatty_cli` (koatty-ai) 使用指南 | CLI 的 README 在独立仓库，文档站未收录 |
| `koatty_swagger` API 参考 | 装饰器用法无任何公开文档 |
| IoC 容器进阶（AOP/懒加载/批量注册） | 有实现无文档 |
| 分布式定时任务（RedLock） | `koatty-schedule` 无使用示例 |
| 配置系统（`@Config`、`${ENV}` 解析、2 级限制） | 关键限制未说明 |
| 错误处理（`@ExceptionHandler`、链路追踪集成） | 无说明 |
| 升级迁移指南（v3 → v4） | 无 CHANGELOG 或 Breaking Changes 说明 |

**根因**：`koatty_doc` 虽已作为 submodule 注册于 `packages/koatty-doc`，但：
1. 无 `package.json` — 未纳入 pnpm workspace，无法通过 `pnpm docs:serve` 本地预览
2. Docsify 依赖 CDN 加载（`unpkg.com`），离线环境无法使用
3. `docs/assets/` 仅有一张 `event.png`，无架构图、流程图
4. 最近提交停留在 2021 年末，框架自此已发生大量变更

---

### N-12（High）`koatty_swagger` README 近乎空白

**位置**：`/Volumes/ExternalSSD/Users/richen/Workspace/nodejs/koatty_swagger/README.md`

全部内容仅一行 `A better way to create Swagger Docs for Koatty`，无安装方式、使用示例、装饰器 API 参考、已知限制说明。用户无法无源码使用该包。

**最低所需文档内容**：
- 安装方式（`npm install koatty_swagger`）
- 注册中间件示例（`KoattySwagger({...}, app)`）
- 各装饰器速查表（`@ApiOperation` / `@ApiParam` / `@ApiResponse` / `@ApiModel` / `@ApiProperty` / `@ApiHeader`）
- 与 Koatty 框架版本对应关系

---

### N-13（Medium）`koatty-ai` 文档与框架文档站割裂

`koatty-ai` 有完整的 `README.md` 和 `docs/USAGE.md`（含中英文），但这些文档完全独立于 `koatty.org` 文档站，用户需要分别访问两个仓库才能获得完整信息。

---

### N-14（Medium）各 submodule 包均缺少 `CHANGELOG.md` 维护规范

现有 submodule 中，`koatty-ai` 有 `CHANGELOG.md`，其余多数包（`koatty-core`、`koatty-container`、`koatty-trace` 等）无版本变更记录，用户升级时无法了解 Breaking Changes。

---

## 6. 性能分析

### 6.1 现有优化

| 优化点 | 位置 | 评价 |
|--------|------|------|
| 组合中间件缓存 (`composedCallbackCache`) | `Application.ts:93-95` | ✅ 避免每次请求重新 compose |
| 元数据 LRU 缓存 | `container/metadata_store.ts` | ✅ 减少 Reflect 反射开销 |
| 依赖预分析 (`DependencyAnalyzer`) | `container/dependency_analyzer.ts` | ✅ 加速 DI 解析 |
| 懒加载 Proxy | `container/utils/lazy_proxy.ts` | ✅ 降低启动内存占用 |
| 批量日志写入 (`batchConfig`) | `logger/src/logger.ts` | ✅ 减少 I/O 系统调用 |
| 验证结果缓存 (`validationCache`) | `validation/src/performance-cache.ts` | ✅ 相同输入跳过重复校验 |
| `Object.create(staticExt)` 原型继承 | `trace/src/trace/trace.ts:330` | ✅ 减少每次请求的对象分配 |

### 6.2 性能风险点

**1. 中间件栈污染（P1-5）导致内存持续增长**

每次调用 `callback(protocol, reqHandler)` 都会向 `middlewareStacks` 中的数组 push 一个新函数，且该数组永不收缩。在高频调用场景（如每次 gRPC 请求调用一次 `callback`）下，内存泄漏非常显著。

**2. 事件监听器重复绑定（P1-1）**

`appStop` 处理器在应用启动时被绑定两次，所有注册到 `appStop` 的清理逻辑（关闭数据库连接、刷新日志等）将执行两次，可能引发竞态条件。

**3. `global.__KOATTY_IOC__`（P1-3）版本隔离失效**

在 pnpm monorepo 中多个子包可能同时存在不同版本的 `koatty-container`，通过 `global.__KOATTY_IOC__` 共享时，不同版本的类型检查完全失效，且难以调试。

**4. 日志异步写入存在数据丢失风险**

`writeLogAsync` 使用 `setImmediate` 确保异步，但在 `process.exit()` 之前的 `Logger.Fatal` 调用中，`setImmediate` 可能来不及执行（虽然 `Fatal` 中也尝试了先 `flushBatch`）。

**5. TopologyAnalyzer 单例无容量限制（潜在内存泄漏）**

```ts
// trace/src/opentelemetry/topology.ts
const topology = TopologyAnalyzer.getInstance();
topology.recordServiceDependency(app.name, serviceName);
```

`TopologyAnalyzer` 是全局单例，每个唯一服务依赖关系都被记录。如果服务名称来自请求头且未做白名单校验，攻击者可通过构造不同的 `service` 头导致内存无限增长。

---

## 7. 易用性与开发体验

### 7.1 现有亮点

- **`@OnEvent` 装饰器** 使组件生命周期绑定清晰，无需手动 `app.on()`
- **`@Autowired` 属性注入** 减少构造器参数列表
- **`@Config` 装饰器** 直接注入配置值到类属性
- **`createApplication()` API** 简化了 Serverless 和测试场景
- **`silent` 模式** 自动在单元测试环境禁用日志输出

### 7.2 易用性问题

**1. koatty_cli 未与 monorepo 版本联动**  
`koatty_cli v6.0.0`（`koatty-ai` 仓库）已是功能丰富的 CLI 工具，但未纳入 monorepo 管理，存在 CLI 生成代码与框架版本不同步的风险。例如，框架 API 变更后，CLI 模板需手动同步。

**2. 无 Swagger/OpenAPI 自动生成**  
`koatty-doc` 包存在但功能不透明。`koatty_cli` 已有 Spec YAML（包含字段类型、端点、DTO 等信息），可作为 OpenAPI 3.1 生成的理想基础，建议二者打通。

**3. 配置 2 级限制未文档化**  
`app.config('a.b.c')` 静默使用 `a.b` 并丢弃 `c`，这个限制未在任何文档中明确说明，用户发现时往往已经在生产环境踩坑。

**4. 错误信息质量参差不齐**  
部分错误信息为中文（`koatty-typeorm`），部分为英文（`koatty-container`），国际化不一致。`koatty_cli` 已内置 i18n（中/英文），建议框架本身的错误信息也统一为英文，与 CLI 的国际化机制对齐。

**5. 调试体验**  
没有内置的请求调试中间件（类似 Morgan/Koa-Logger），开发者需自行添加请求日志。

**6. 测试工具集成不足**  
没有提供测试工具包（如 `@koatty/testing`），不像 NestJS 的 `@nestjs/testing` 或 Midway 的 `@midwayjs/mock`，无法方便地 mock 组件、重置容器。`koatty_cli` 的 `--with-test` 生成的测试代码质量需要验证是否使用了最新 `createApplication()` 模式。

---

## 8. 先进性与智能化差距

### 8.1 先进性现状

Koatty 在以下方面已达到或超越行业水平：

| 能力 | 水平 |
|------|------|
| HTTP/3 支持 | 超前 |
| 原生 OpenTelemetry | 超前 |
| 多协议统一 Context | 同行业最优 |
| 分布式锁内置 | 行业领先 |
| 安全防护（注入/污染） | 良好 |
| AI 驱动 CLI（koatty_cli） | **行业领先**（NestJS/Midway 无 AI 代码生成） |
| Plan/Apply/Remove 工作流 | 行业领先（类 Terraform 风格） |
| SQL→模块代码生成 | 行业领先 |

### 8.2 先进性差距

**1. 装饰器标准（TC39 Stage 3 vs 正式版）**  
仍使用 TypeScript 旧版实验性装饰器（`"experimentalDecorators": true`），而 TypeScript 5.0+ 已支持 ECMAScript 官方装饰器。NestJS 和 Midway 正在迁移路径中。Koatty 应制定装饰器迁移计划。

**2. 缺少边缘计算支持**  
Hono 等新兴框架专为 Cloudflare Workers、Deno Deploy 等边缘运行时设计，Koatty 完全绑定 Node.js。未来可考虑轻量级适配层。

**3. 无内置 WebSocket 消息验证**  
WebSocket 处理器缺少消息体 Schema 校验，而 gRPC 有 protobuf 天然约束。

**4. 无内置速率限制 / 熔断器**  
生产级 API 的必备能力，目前需要外接中间件，不如 NestJS 的 `@nestjs/throttler` 方便。

### 8.3 智能化机会

`koatty_cli` 已内置 AI 能力，以下是进一步深化的方向：

**1. CLI Spec → OpenAPI 3.1 转换**  
`koatty_cli` 的 Spec YAML 已包含字段、端点、DTO 信息，距离 OpenAPI 3.1 格式只有一步之遥。建议在 `koatty plan` 中增加 `--openapi` 选项，直接生成可导入 Swagger UI 的规范文件。

**2. `koatty ai diagnose` 深化与框架集成**  
当前 `diagnose` 基于通用错误模式匹配，若与框架运行时数据结合（如 IoC 容器注册表、路由注册表），可提供更精准的诊断，如「找不到 UserService，IoC 容器中仅有 [ProductService, OrderService]，请检查 src/service/UserService.ts 是否有 `@Service()` 装饰器」。

**3. `koatty ai spec` 增量字段追加**  
当前已支持「首次执行生成规范，再次执行加载已有配置」，可进一步支持「从已有代码反向生成/更新 Spec YAML」，实现代码→规范的双向同步。

**4. 配置智能感知（LSP 插件）**  
通过 TypeScript Language Server Plugin，在编辑器中对 `app.config('key')` 提供自动补全（补全已定义的配置键）和类型检查，进一步提升 DX。

**5. `koatty ai test` — AI 测试用例生成**  
基于已有 Controller/Service 代码，AI 自动生成 Jest 测试用例，补充当前 `--with-test` 的基础框架生成能力。

---

## 9. 优化建议

### 9.1 紧急修复（影响正确性）

**Fix 1：修复 `listen()` 双重事件绑定**

```diff
// Application.ts:424-431
listen(listenCallback?: any) {
  // binding event "appStop"
  Logger.Log('Koatty', '', 'Bind App Stop event ...');
  bindProcessEvent(this, 'appStop');
-
- // binding event "appStop"
- Logger.Log('Koatty', '', 'Bind App Stop event ...');
- bindProcessEvent(this, 'appStop');
```

---

**Fix 2：修复 `callback()` 中间件栈污染**

```diff
// Application.ts:606-612
+ // Create a temporary copy to avoid polluting the persistent stack
+ const middlewareToCompose = reqHandler
+   ? [...protocolMiddleware, reqHandler]
+   : protocolMiddleware;
+
- if (reqHandler) {
-   protocolMiddleware.push(reqHandler);
- }
  
- const fn = koaCompose(middlewareToCompose as any);
+ const fn = koaCompose(middlewareToCompose as any);
```

---

**Fix 3：修复 `captureError()` 全局监听器替换**

```diff
// Application.ts:665-688
private captureError(): void {
  // koa error
  this.removeAllListeners('error');
  this.on('error', (err: Error) => {
    if (!isPrevent(err)) Logger.Error(err);
  });
  // warning
- process.removeAllListeners('warning');
  process.on('warning', Logger.Warn);
  // promise reject error
- process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason: Error) => {
+   // Only handle if not already prevented
    if (!isPrevent(reason)) Logger.Error(reason);
  });
  // uncaught exception
- process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', (err) => {
    if (err.message.includes('EADDRINUSE')) {
      Logger.Fatal(Helper.toString(err));
      process.exit(-1);
    }
    if (!isPrevent(err)) Logger.Error(err);
  });
}
```

同时添加去重保护，避免同一应用实例多次调用 `captureError`：

```ts
private _errorCaptured = false;
private captureError(): void {
  if (this._errorCaptured) return;
  this._errorCaptured = true;
  // ... 其余代码
}
```

---

**Fix 4：移除 `koatty-typeorm` 硬编码凭据**

```diff
// koatty-typeorm/src/index.ts:47-54
const defaultOptions: Partial<DataSourceOptions> = {
  type: "mysql",
  host: "127.0.0.1",
  port: 3306,
- username: "test",
- password: "test",
- database: "test",
  synchronize: false,
  logging: true,
  entities: [`${process.env.APP_PATH}/model/*`],
  timezone: "Z"
};
```

---

**Fix 5：修复 `KoattyTypeORM` 监听错误事件名**

```diff
// koatty-typeorm/src/index.ts:123
- app.on('Stop', async () => {
+ app.once(AppEvent.appStop, async () => {
```

---

**Fix 6：修复 Logger `warning` 非标准级别**

```diff
// koatty-logger/src/logger.ts:18-23
const LogLevelObj: any = {
  "debug": 7,
  "info": 6,
- "warning": 4,
+ "warn": 4,
  "error": 3
};
```

同步修改 `Warn()` 方法内部调用：
```diff
public Warn(...args: any[]) {
- return this.printLog("warning", "", args);
+ return this.printLog("warn", "", args);
}
```

---

**Fix 7：修复 `global.__KOATTY_IOC__`**

```diff
// container/src/container/container.ts:918-925
export const IOC: IContainer = (() => {
- if ((global as any).__KOATTY_IOC__) {
-   return (global as any).__KOATTY_IOC__;
- }
  const instance = Container.getInstance();
- (global as any).__KOATTY_IOC__ = instance;
  return instance;
})();
```

如需跨包版本兼容，改用 `Symbol.for`：
```ts
const KOATTY_IOC_KEY = Symbol.for('koatty.ioc.v2');
export const IOC: IContainer = (() => {
  if ((global as any)[KOATTY_IOC_KEY]) {
    return (global as any)[KOATTY_IOC_KEY];
  }
  const instance = Container.getInstance();
  (global as any)[KOATTY_IOC_KEY] = instance;
  return instance;
})();
```

---

### 9.2 中期优化（架构改进）

**Opt 1：补全 `app.config()` 任意深度支持**

当前 2 级限制是人为施加的，可通过递归路径解析支持任意深度：

```ts
private getConfig<T>(caches: any, name: string | undefined): T | null {
  if (!name) return caches as T;
  const keys = this.parseConfigPath(name);
  return keys.reduce((obj, key) => obj?.[key], caches) as T ?? null;
}
```

---

**Opt 2：健康检查内置中间件**

```ts
// 建议在 koatty-serve 中内置健康检查端点
@Component('HealthComponent', { scope: 'core', priority: 80 })
export class HealthComponent {
  @OnEvent(AppEvent.loadMiddleware)
  async registerHealth(app: KoattyApplication) {
    app.use(async (ctx, next) => {
      if (ctx.path === '/health') {
        ctx.status = app.isReady ? 200 : 503;
        ctx.body = { status: app.isReady ? 'ok' : 'starting', uptime: process.uptime() };
        return;
      }
      return next();
    });
  }
}
```

---

**Opt 3：Span 请求级别 end()**

```diff
// trace/src/trace/trace.ts - handleRequest 完成时
async function handleRequest(ctx, next, options, ext) {
  const startTime = performance.now();
  try {
    await next();
  } finally {
+   // End span with request completion
+   if (ext.spanManager && ctx._span) {
+     ctx._span.setStatus({ code: SpanStatusCode.OK });
+     ctx._span.end();
+   }
  }
}
```

---

**Opt 4：用户组件启用逻辑收紧**

```diff
// ComponentManager.ts:130-133
- shouldEnable = isInList || isEnabledInConfig;
+ shouldEnable = isInList && isEnabledInConfig;
```

---

**Opt 5：验证空值保护**

```diff
// validation/src/rule.ts:101
- throw new Error(Object.values(errors[0].constraints)[0]);
+ const constraints = errors[0].constraints ?? {};
+ const message = Object.values(constraints)[0] ?? 'Validation failed';
+ throw new Error(message);
```

---

**Opt 6：测试工具包**

创建 `koatty-testing` 包，提供：
- `createTestApp(AppClass)` — 初始化应用但不监听端口
- `mockBean(identifier, mock)` — 注入 mock 实现
- `resetContainer()` — 清理容器状态防止测试污染
- 基于 `supertest` 的 HTTP 测试辅助

---

### 9.3 长期规划（特性提升）

**Road 1：OpenAPI/Swagger 自动生成**

基于现有装饰器元数据（`@Get`/`@Post`/`@Body`/`@Param`/`@Query`/`@RequestBody` 等），通过 TypeScript Compiler API（`ts-morph`）在构建时静态分析，生成 OpenAPI 3.1 规范文件，无需运行时开销。

**Road 2：CLI 工具**

```
koatty new <project-name>
koatty generate controller <name>
koatty generate service <name>
koatty generate middleware <name>
koatty build
koatty start
```

**Road 3：内置限流中间件**

```ts
@Component('RateLimitComponent', { scope: 'core', priority: 90 })
export class RateLimitComponent {
  @OnEvent(AppEvent.loadMiddleware)
  async setup(app: KoattyApplication) {
    const opts = app.config(undefined, 'rateLimit');
    if (opts?.enabled) {
      app.use(createRateLimiter(opts));
    }
  }
}
```

**Road 4：配置加密支持**

类似 Midway 的 `crypt.json`，支持配置值 AES 加密，在加载时自动解密，避免敏感信息明文存储在版本库。

**Road 5：官方装饰器（TC39）迁移路径**

TypeScript 5.0+ 支持 Stage 3 标准装饰器，应制定 `experimentalDecorators → standard decorators` 迁移时间表，并提供 codemod 工具。

---

## 10. 优先级路线图

### Phase 1：缺陷修复（立即，1-2 周）

| 任务 | 优先级 | 影响 |
|------|--------|------|
| Fix 1: 双重 appStop 绑定 | P0 | 运行时行为错误 |
| Fix 2: 中间件栈污染 | P0 | 内存泄漏 |
| Fix 4: 硬编码凭据 | P0 | 安全风险 |
| Fix 5: TypeORM 事件名错误 | P0 | 资源泄漏 |
| Fix 6: Logger warning 级别 | P1 | 日志丢失 |
| Fix 3: 全局监听器替换 | P1 | 第三方兼容性 |
| Fix 7: global.__KOATTY_IOC__ | P1 | 版本隔离 |
| Opt 5: 验证空值保护 | P2 | 偶发崩溃 |

### Phase 2：质量提升（近期，1-3 月）

| 任务 | 说明 |
|------|------|
| Opt 4: 组件启用逻辑修正 | 避免意外自动加载 |
| Opt 3: Span 请求级别 end | 追踪数据准确性 |
| Opt 2: 健康检查端点 | 容器化部署必备 |
| 删除死代码（contextPrototypes, 空 run()） | 代码整洁 |
| 完善 tsconfig references | IDE 跨包导航 |
| P2-11: 重试条件收紧 | 避免无效重试 |
| P2-10: 内存缓存事务明确抛出 | 语义一致性 |

### Phase 3：功能增强（中期，3-6 月）

| 任务 | 说明 |
|------|------|
| Opt 1: config 任意深度 | 提升易用性 |
| Opt 6: 测试工具包 | 降低测试门槛 |
| **koatty_swagger 纳入 monorepo** | 见附录 B.2 迁移方案 |
| **koatty-ai 纳入 monorepo** | 见附录 B.1 迁移方案 |
| **koatty_doc 完善** | 见附录 B.3 文档站改善方案 |
| Road 1: koatty_swagger 完善至生产就绪 | 修复 SW-1~SW-9，补全 README |
| 配置文档化（2 级限制等） | 防止踩坑 |
| 错误信息语言统一（英文） | 国际化 |

### Phase 4：先进性提升（长期，6-12 月）

| 任务 | 说明 |
|------|------|
| Road 3: 内置限流 | 生产级必备 |
| Road 4: 配置加密 | 安全增强 |
| Road 5: 装饰器迁移 | 标准合规 |
| TopologyAnalyzer 容量限制 | 防止 DoS |
| i18n 基础支持 | 扩大用户群 |

---

## 附录 A：问题汇总索引

| ID | 优先级 | 类别 | 状态 | 文件 |
|----|--------|------|------|------|
| P1-1 | P0 | Bug | 未修复 | `koatty-core/Application.ts:425` |
| P1-2 | P1 | Bug | 未修复 | `koatty-core/Application.ts:665` |
| P1-3 | P1 | 架构 | 未修复 | `koatty-container/container.ts:918` |
| P1-4 | P0 | 安全 | 未修复 | `koatty-typeorm/index.ts:52` |
| P1-5 | P0 | Bug | 未修复 | `koatty-core/Application.ts:607` |
| P2-1 | P2 | 类型 | 未修复 | 多处 |
| P2-2 | P2 | Bug | 未修复 | `koatty-validation/rule.ts:101` |
| P2-3 | P2 | 类型 | 未修复 | `koatty-cacheable/store.ts:25` |
| P2-4 | P1 | 逻辑 | 未修复 | `koatty-core/ComponentManager.ts:132` |
| P2-5 | P2 | Bug | 未修复 | `koatty-logger/logger.ts:94` |
| P2-6 | — | Bug | ✅ 已修复 | `koatty-router/RouterComponent.ts` |
| P2-8 | P2 | 体验 | 未修复 | `koatty-serve/ServeComponent.ts:62` |
| P2-9 | P3 | 配置 | 未修复 | `tsconfig.json` |
| P2-10 | P2 | 实现 | 未修复 | `koatty-store/memory_cache.ts:1150` |
| P2-11 | P2 | 逻辑 | 未修复 | `koatty-trace/trace.ts:389` |
| N-1 | P2 | 代码 | 新发现 | `koatty-core/Application.ts:70` |
| N-2 | P0 | Bug | 新发现 | `koatty-typeorm/index.ts:123` |
| N-3 | P0 | Bug | 新发现 | `koatty-logger/logger.ts:22` |
| N-4 | P2 | 文档 | 新发现 | `koatty-core/Application.ts:86` |
| N-5 | P2 | Bug | 新发现 | `koatty-logger/logger.ts:548` |
| N-6 | P2 | 类型 | 新发现 | `koatty-core/Application.ts:406` |
| N-7 | P3 | 性能 | 新发现 | `koatty-validation/performance-cache.ts` |
| N-8 | P3 | 代码 | 新发现 | `koatty-serve/ServeComponent.ts:84` |
| N-9 | P2 | 追踪 | 新发现 | `koatty-trace/trace.ts:314` |
| N-10 | P3 | 配置 | 新发现 | `tsconfig.json:references` |
| N-11 | P1 | 文档 | 新发现 | `packages/koatty-doc/docs/` |
| N-12 | P1 | 文档 | 新发现 | `koatty_swagger/README.md` |
| N-13 | P2 | 文档 | 新发现 | `koatty-ai` 文档割裂 |
| N-14 | P2 | 文档 | 新发现 | 多包缺少 `CHANGELOG.md` |
| SW-1 | P1 | Bug | 新发现 | `koatty_swagger/src/index.ts:70` |
| SW-2 | P1 | 性能 | 新发现 | `koatty_swagger/src/index.ts:88` |
| SW-3 | P1 | Bug | 新发现 | `koatty_swagger/src/index.ts:56` |
| SW-4 | P1 | Bug | 新发现 | `koatty_swagger/src/decorators/response.ts:38` |
| SW-5 | P2 | 架构 | 新发现 | `koatty_swagger/src/swagger/components.ts` |
| SW-6 | P2 | 体验 | 新发现 | 路由/Swagger 装饰器双重标注 |
| SW-7 | P3 | 配置 | 新发现 | `koatty_swagger/package.json:engines` |
| SW-8 | P2 | 发布 | 新发现 | `koatty_swagger/package.json:peerDependencies` |
| SW-9 | P1 | 文档 | 新发现 | `koatty_swagger/README.md` |

---

---

## 附录 B：子模块迁移方案

> **操作前提**：本方案仅描述步骤，不在当前会话执行任何代码变更。  
> **目标**：将 `koatty-ai`、`koatty_swagger` 作为 git submodule 纳入 monorepo，路径分别为 `packages/koatty-ai` 和 `packages/koatty-swagger`。  
> **约定**：pnpm-workspace 已通配 `packages/*`，无需改动。

---

### B.1 迁移 `koatty_swagger` → `packages/koatty-swagger`

**Git 信息**

| 项 | 值 |
|---|---|
| 远程仓库 | `https://github.com/Koatty/koatty_swagger` |
| 目标路径 | `packages/koatty-swagger` |
| 包名 | `koatty_swagger` |

#### 第一步：注册 git submodule

```bash
# 在 monorepo 根目录执行
git submodule add https://github.com/Koatty/koatty_swagger.git packages/koatty-swagger
git submodule update --init --recursive packages/koatty-swagger
```

执行后 `.gitmodules` 自动追加：

```ini
[submodule "packages/koatty-swagger"]
    path = packages/koatty-swagger
    url = https://github.com/Koatty/koatty_swagger.git
```

#### 第二步：修改 `packages/koatty-swagger/package.json`

需要在**子模块自身仓库**中提交以下变更：

```jsonc
{
  // 1. engines 与 monorepo 对齐
  "engines": {
    "node": ">=18.0.0"    // 原为 ">12.0.0"
  },

  // 2. peerDependencies 中 workspace:* 替换为版本范围
  //    （npm publish 时 workspace: 协议不合法）
  "peerDependencies": {
    "koa": "^2.x.x",
    "koatty": "^4.0.0",        // 原为 "workspace:*"
    "koatty_lib": "^1.0.0"     // 原为 "workspace:*"
  },

  // 3. dependencies 中 workspace:* 保持，monorepo 内部正常解析
  "dependencies": {
    "koatty_lib": "workspace:*",  // 保持，由 pnpm monorepo 解析
    "koa-compose": "^4.1.0",
    "koa-mount": "^4.0.0",
    "openapi3-ts": "^4.4.0"
  }
}
```

> **注意**：`peerDependencies` 中使用版本范围、`dependencies` 中可继续使用 `workspace:*`，两者作用域不同，不冲突。

#### 第三步：处理子模块内的独立 lockfile

`koatty_swagger` 仓库根目录有 `pnpm-lock.yaml`，在 monorepo 中由根 lockfile 统一管理，子包无需保留自己的 lockfile：

```bash
# 在 packages/koatty-swagger 目录中
echo "pnpm-lock.yaml" >> .gitignore
git rm --cached pnpm-lock.yaml   # 从 git 追踪中移除（文件保留本地）
git commit -m "chore: remove standalone lockfile for monorepo integration"
```

#### 第四步：验证 pnpm 能正确解析

```bash
# 回到 monorepo 根目录
pnpm install
# 验证 koatty_swagger 的依赖被正确安装
pnpm --filter koatty_swagger build
```

#### 第五步：更新 monorepo 根 `README.md`

在「独立包 (submodules)」表格中增加一行：

```markdown
| `koatty_swagger` | OpenAPI 3.1 / Swagger UI 文档生成 |
```

#### 第六步：更新 `tsconfig.json` references（可选，IDE 跨包跳转）

```json
{
  "references": [
    // ... 现有 references ...
    { "path": "./packages/koatty-swagger" }
  ]
}
```

前提：`packages/koatty-swagger/tsconfig.json` 中需有 `"composite": true`。

---

### B.2 迁移 `koatty-ai` → `packages/koatty-ai`

**Git 信息**

| 项 | 值 |
|---|---|
| 远程仓库 | `https://github.com/koatty/koatty-ai` |
| 目标路径 | `packages/koatty-ai` |
| 包名 | `koatty_cli` |

#### 第一步：注册 git submodule

```bash
# 在 monorepo 根目录执行
git submodule add https://github.com/koatty/koatty-ai.git packages/koatty-ai
git submodule update --init --recursive packages/koatty-ai
```

执行后 `.gitmodules` 自动追加：

```ini
[submodule "packages/koatty-ai"]
    path = packages/koatty-ai
    url = https://github.com/koatty/koatty-ai.git
```

#### 第二步：处理子模块内的独立 lockfile

`koatty-ai` 仓库同时存在 `pnpm-lock.yaml` 和 `package-lock.json`，两者均需从 git 追踪移除：

```bash
# 在 packages/koatty-ai 目录中
echo "pnpm-lock.yaml" >> .gitignore
echo "package-lock.json" >> .gitignore
git rm --cached pnpm-lock.yaml package-lock.json
git commit -m "chore: remove standalone lockfiles for monorepo integration"
```

#### 第三步：验证构建命令与 Turborepo 兼容

`koatty-ai/package.json` 的构建命令为 `"build": "tsc"`（使用 `tsc`，非 `tsup`），与其他包不同。Turborepo 的 `build` task 是通用的，只要 `package.json` 有 `build` 脚本即可，**无需修改 `turbo.json`**。

验证：

```bash
pnpm install
pnpm --filter koatty_cli build
```

如构建正常，turbo pipeline 自动纳入。

#### 第四步：验证 `koatty-ai` 对框架包的依赖

`koatty-ai` 当前通过 npm 安装 `koatty`、`koatty_core` 等包（非 `workspace:*`），这在 monorepo 中有两种处理方式：

**方式 A（推荐，短期）**：保持 npm 依赖，开发时使用正式发布版本。简单稳定，适合 CLI 工具（本身不是框架运行时组件）。

**方式 B（长期）**：将依赖改为 `workspace:*`，与 monorepo 内的包直接联动，可在框架 API 变更时第一时间发现 CLI 模板不兼容。改动需在子模块仓库中提交。

建议先采用方式 A 完成迁移，稳定后再切换到方式 B。

#### 第五步：更新 monorepo 根 `README.md`

在「独立包 (submodules)」表格中增加一行：

```markdown
| `koatty_cli` | 智能脚手架与代码生成 CLI (koatty-ai) |
```

#### 第六步：turbo.json 新增 CLI 专用 task（可选）

CLI 有自身的端到端测试命令 `test:e2e`，可在 `turbo.json` 中增加对应 task：

```json
{
  "tasks": {
    "test:e2e": {
      "dependsOn": ["build"],
      "cache": false
    }
  }
}
```

---

### B.3 `koatty_doc` 文档站完善方案

> **当前状态**：`packages/koatty-doc` 已是已初始化的 git submodule，无需重新 `git submodule add`。  
> 本节聚焦于将其从「名存实亡的空壳」升级为「可用的官方文档站」。

**Git 信息**

| 项 | 值 |
|---|---|
| 远程仓库 | `https://github.com/Koatty/koatty_doc.git` |
| 当前路径 | `packages/koatty-doc`（已初始化） |
| 站点框架 | Docsify（CDN 加载） |
| 托管域名 | `koatty.org`（GitHub Pages，`CNAME` 已配置） |

---

#### 第一步：接入 pnpm workspace — 添加 `package.json`

`packages/koatty-doc` 无 `package.json`，pnpm 不将其视为 workspace 成员，无法通过 `pnpm --filter` 管理文档任务。在子模块仓库中新建：

```json
{
  "name": "koatty-doc",
  "version": "1.0.0",
  "description": "Official documentation site for Koatty framework",
  "private": true,
  "scripts": {
    "docs:serve": "npx docsify-cli serve docs --port 3100",
    "docs:preview": "npx serve docs --listen 3100"
  },
  "devDependencies": {
    "docsify-cli": "^4.4.4",
    "serve": "^14.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

添加后执行：

```bash
cd packages/koatty-doc
pnpm install      # 安装 docsify-cli
```

此后可在 monorepo 根目录通过以下命令本地预览：

```bash
pnpm --filter koatty-doc docs:serve
```

---

#### 第二步：迁移 Docsify 为本地依赖（告别 CDN）

当前 `docs/index.html` 从 `unpkg.com` 加载 Docsify，离线或网络受限时无法使用。修改为本地加载：

```diff
- <link rel="stylesheet" href="//unpkg.com/docsify/lib/themes/vue.css">
+ <link rel="stylesheet" href="//cdn.jsdelivr.net/npm/docsify@4/lib/themes/vue.css">

- <script src="//unpkg.com/docsify/lib/docsify.min.js"></script>
+ <script src="//cdn.jsdelivr.net/npm/docsify@4/lib/docsify.min.js"></script>
```

并在 `index.html` 中完善站点配置：

```js
window.$docsify = {
  name: 'Koatty',
  repo: 'https://github.com/koatty/koatty',
  loadSidebar: true,        // 启用侧边栏（_sidebar.md）
  loadNavbar: true,         // 启用顶部导航（_navbar.md）
  subMaxLevel: 3,
  search: {
    placeholder: '搜索文档',
    noData: '未找到结果',
  },
  plugins: []
}
```

---

#### 第三步：建立文档目录结构

在 `docs/` 下创建以下目录和文件（最小可用集）：

```
docs/
├── index.html          ← 已存在，完善配置
├── README.md           ← 首页（概览 + 快速开始）
├── _sidebar.md         ← 侧边栏导航（新建）
├── _navbar.md          ← 顶部导航（新建）
├── CNAME               ← 已存在
│
├── guide/              ← 使用指南（新建）
│   ├── getting-started.md    快速开始（5 分钟跑通示例）
│   ├── project-structure.md  项目结构说明
│   ├── ioc-container.md      IoC/DI 容器
│   ├── lifecycle.md          应用生命周期（11 步启动序列）
│   ├── middleware.md         中间件
│   ├── exception.md          异常处理
│   └── config.md             配置系统（重点说明 2 级限制）
│
├── protocols/          ← 多协议指南（新建）
│   ├── http.md               HTTP / HTTPS / HTTP2 / HTTP3
│   ├── grpc.md               gRPC
│   ├── websocket.md          WebSocket
│   └── graphql.md            GraphQL
│
├── extensions/         ← 扩展包（新建）
│   ├── trace.md              链路追踪 + Prometheus 指标
│   ├── validation.md         参数校验
│   ├── cacheable.md          缓存装饰器
│   ├── schedule.md           分布式定时任务（RedLock）
│   ├── typeorm.md            TypeORM 集成
│   ├── swagger.md            Swagger / OpenAPI
│   └── serverless.md         Serverless 部署
│
├── cli/                ← CLI 工具（引用 koatty-ai 文档）
│   └── overview.md           概览 + 链接至 koatty-ai 详细文档
│
├── migration/          ← 升级指南（新建）
│   └── v3-to-v4.md           v3 → v4 Breaking Changes
│
└── assets/
    ├── event.png         ← 已存在
    ├── architecture.png  ← 新增：整体架构图
    └── lifecycle.png     ← 新增：生命周期流程图
```

---

#### 第四步：编写 `_sidebar.md`（侧边栏导航）

```markdown
- **入门**
  - [概览](/)
  - [快速开始](guide/getting-started)
  - [项目结构](guide/project-structure)

- **核心概念**
  - [IoC 容器](guide/ioc-container)
  - [生命周期](guide/lifecycle)
  - [中间件](guide/middleware)
  - [异常处理](guide/exception)
  - [配置系统](guide/config)

- **多协议**
  - [HTTP / HTTP2 / HTTP3](protocols/http)
  - [gRPC](protocols/grpc)
  - [WebSocket](protocols/websocket)
  - [GraphQL](protocols/graphql)

- **扩展包**
  - [链路追踪](extensions/trace)
  - [参数校验](extensions/validation)
  - [缓存](extensions/cacheable)
  - [定时任务](extensions/schedule)
  - [TypeORM](extensions/typeorm)
  - [Swagger](extensions/swagger)
  - [Serverless](extensions/serverless)

- **CLI 工具**
  - [koatty_cli 概览](cli/overview)

- **升级指南**
  - [v3 → v4](migration/v3-to-v4)
```

---

#### 第五步：更新 Turborepo 任务（可选）

在 `turbo.json` 中为文档任务添加 pipeline（若需要 CI 自动预览）：

```json
{
  "tasks": {
    "docs:serve": {
      "cache": false,
      "persistent": true
    }
  }
}
```

---

#### 第六步：优先补充的高价值页面

按读者需求排序，建议优先完成：

| 优先级 | 文件 | 理由 |
|--------|------|------|
| P0 | `guide/getting-started.md` | 新用户第一印象 |
| P0 | `guide/config.md` | 2 级限制等隐藏坑必须说明 |
| P1 | `guide/lifecycle.md` | 11 步启动序列是框架核心 |
| P1 | `protocols/http.md` | HTTP2/HTTP3 是差异化卖点 |
| P1 | `extensions/trace.md` | OpenTelemetry 配置项多，必须有文档 |
| P1 | `migration/v3-to-v4.md` | 避免升级踩坑 |
| P2 | `extensions/swagger.md` | 配合 koatty_swagger 发布 |
| P2 | `cli/overview.md` | 整合 koatty-ai 文档入口 |

---

#### 内容编写原则

1. **代码示例优先** — 每个特性至少提供一个可运行的最小示例
2. **明确说明限制** — 如 `config()` 的 2 级限制、`@ExceptionHandler` 必须继承 `Exception` 等隐性约束
3. **版本标注** — 每个特性标注最低支持版本（`since v4.0.0`）
4. **与 koatty_cli 联动** — 在每个模块页面底部加「使用 CLI 快速生成」的 tip，链接到 `cli/overview.md`

---

### B.4 迁移后整体验证检查列表

三个组件均处理完成后，在 monorepo 根目录执行以下检查：

```bash
# 1. 确认 submodule 注册正确
git submodule status

# 期望输出包含（无 - 前缀表示已初始化）：
#  <hash> packages/koatty-ai (v6.0.0)
#  <hash> packages/koatty-swagger (heads/main)
#  <hash> packages/koatty-doc (heads/master)   ← 已存在，应已显示

# 2. 全量安装（含新增 koatty-doc 的 devDependencies）
pnpm install

# 3. 全量构建（验证依赖顺序正确）
pnpm build

# 4. 各自独立构建/预览验证
pnpm --filter koatty_cli build
pnpm --filter koatty_swagger build
pnpm --filter koatty-doc docs:serve   # 浏览器访问 http://localhost:3100 验证文档站

# 5. 各自测试
pnpm --filter koatty_cli test:unit
pnpm --filter koatty_swagger test

# 6. 清理
pnpm clean
```

---

### B.5 迁移注意事项

| 事项 | 说明 |
|------|------|
| submodule 提交锁定 | monorepo 跟踪的是子模块的**特定 commit**，子模块更新后需在 monorepo 执行 `git submodule update --remote packages/koatty-ai` 并提交新的 submodule 引用 |
| CI/CD 拉取 | CI 流水线需加 `git submodule update --init --recursive` 或在 `git clone` 时加 `--recurse-submodules` |
| 发布解耦 | CLI 和 Swagger 包的版本发布仍在各自仓库独立管理，monorepo 的 Changesets 不介入这两个 submodule |
| `peerDependencies` 版本对齐 | `koatty_swagger` 发布 npm 时，需将 `koatty` peer dep 版本范围与当前框架主版本保持一致 |
| `.koattysrc` 文件 | `koatty-ai` 根目录有 `.koattysrc`（CLI 项目标记文件），在 monorepo 中不会产生冲突，保留即可 |

---

*报告生成：2026-04-01 | 评审者：OpenCode Analysis Engine*
