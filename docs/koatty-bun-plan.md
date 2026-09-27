# koatty-bun 完整方案

> 状态：评审修订稿 v3（正文基于 v2，经就地修订）  
> 日期：2026-05-10（v3 修订：2026-09-27）  
> 作者：richenlin；v3 评审修订  
> 修订：基于代码库实际结构 + Bun 1.3.x API + 兼容性评估报告优化；v3 基于 Bun 1.3.14 实测
>
> ⚠️ **本方案已被整合到** [`koatty-bun-tc39-integrated-plan.md`](./koatty-bun-tc39-integrated-plan.md) **v2.0**。  
> 整合方案在路线图、ADR、风险登记上**优先于本文档**。  
> **阅读规则**：下面的"v3 评审勘误与补充"优先于正文。§3、§4.2、§5.2 方案 B、§5.3～§5.7 的 `BunXxxServer` 重写**降级为参考资料，v4.0 不实施**。

---

## v3 评审勘误与补充（优先于正文）

> 实测环境：macOS arm64，Bun 1.3.14，Node v22.23.1。证据编号与整合方案 v2.0 §0.2 一致。

### A. 总体结论

1. **v4.0 的 Bun 适配 = 复用现有服务器 + 小修补 + 测试**。不新增 `BunHttpServer` / `BunHttpsServer` / `BunHttp2Server` / `BunWsServer`，不写 Request ↔ IncomingMessage 桥接，不新建必需的 `koatty-bun` 入口包，也不设各组件的 `bun` 分支与 dist-tag。
   - 依据：Koa 通过 `node:http` 在 Bun 上运行良好（E-15）；Bun 上的 `node:http2` 能协商出 h2（E-12）；`ws` 的 noServer 升级在 Bun 上可用（E-13）。
2. **Bun 不绑定装饰器模式**。legacy（本方案 §7.3 原模板的做法）与 TC39 在 Bun 上都可用（E-09），分别对应整合方案的 C4 与 C3。
3. **性能目标改为实测驱动**。同机实测 Bun+Koa 只比 Node 22+Koa 快约 6%，原生 `Bun.serve` hello-world 快约 11%（E-15）。原 §10.1 的 ">2x" 等目标和 §5.2 的 "约 2.5x" 没有依据。

### B. 正文错误与修正

| # | 位置 | 问题 | 修正 |
|---|-----|------|------|
| 1 | §5.1 http2 "TLS + ALPN 自动协商 h2" | `Bun.serve` 开 TLS 后只协商 HTTP/1.1（`curl --http2` 实测为 `1.1`） | Bun 下直接使用现有 `Http2Server`（`node:http2`，实测为 `2`） |
| 2 | §5.5 `BunHttp2Server`、§5.6 `BunHttp3Server`（基于 `Bun.serve`） | 前提同上，不成立 | §5.6 改为降级到现有 `Http2Server` |
| 3 | §4.3.3 "Bun 不支持 `process.execArgv`" | Bun 支持（E-14） | 删除条件保护；R8 关闭 |
| 4 | §4.1 / §4.4 Loader、Config 用 `Bun.file()` 加速 | Loader 用 `globby` 扫描后直接 `require(p)`（`koatty-loader/src/index.ts:54,95`），并不读取文件内容；Config 同理，"快 ~2x"不适用 | 删除 |
| 5 | §4.2 各组件 `bun` 分支 + `bun` dist-tag | 与整合方案 ADR-014 冲突；多分支维护成本高，且会让用户依赖树分裂 | 作废 |
| 6 | §5.2 方案 B mock | 至少 5 处功能缺陷：① Koa 通过 `res.statusCode = x` 直接赋值设置状态码，而 `getResponse()` 读的是闭包变量 `statusCode`，所以状态码永远是 200；② `on('data')` 与 `on('end')` 各调用一次 `pipeTo`，第二次会因为流已被锁定而失败；③ 没有实现 `pipe`、`readable`、`unpipe` 等 raw-body / co-body 依赖的接口；④ 整个响应缓冲进 `Blob`，流式响应与 SSE 失效；⑤ `headersSent` 永远为 `false` | 方案 B 作废。将来如要做原生路径，按整合方案 ADR-020 第 3 步另行立项 |
| 7 | §5.2 方案 A "约 10~15% 性能损耗" | 没有测量依据；E-15 显示 Koa-on-Bun 反而比 Node 快约 6% | 删除该数字 |
| 8 | §5.7 `BunWsServer` / `BunWsAdapter` 重写 | 现有 `ws` + `noServer` 在 Bun 上可用（E-13） | 复用现有 `WsServer`；原生 WS 只在实测显示明显收益时再考虑 |
| 9 | §7.3 模板 `"build": "bun build src/App.ts --outdir dist --target bun"` | Koatty 的 Loader 在运行时按目录扫描并 `require` 组件。打包成单文件后，控制器与服务不再以独立文件存在，扫描不到，应用会"启动成功但没有路由" | 构建用 `tsc`（TS7），保留目录结构；开发用 `bun src/App.ts`；生产用 `bun dist/App.js` |
| 10 | §7.3 模板依赖 `koatty-bun` | 整合方案 v2.0 不再要求单独的入口包 | 依赖 `koatty` |
| 11 | §7.3 / §8.3 最低版本 `bun >= 1.1.0` | 本次只验证了 1.3.14；1.1 的 `node:http2`、`ws` 行为未验证 | 最低版本定为 `>=1.3.0`，CI 使用 `1.3.x` 与 `latest` |
| 12 | §8.3 CI `bun test ... --grep "Bun"` | `bun test` 没有 `--grep`，对应参数是 `-t` / `--test-name-pattern` | 改用 `-t` |
| 13 | §8.3 CI `bun install --frozen-lockfile` | 仓库根目录同时存在 `pnpm-lock.yaml`、`bun.lock`、`package-lock.json`，三者很容易不同步 | 依赖安装统一用 pnpm（唯一的锁文件来源），Bun 只作为运行时；清理多余的锁文件（另行处理） |
| 14 | §8.3 "Verify decorator metadata" 用 `bun test` 跑 `koatty-container` 测试 | 现有测试是 ts-jest 风格，大量使用 `jest.mock`，`bun test` 的兼容程度未知 | Phase 0 先评估；在此之前，用 Bun 运行 dist 上的协议冒烟测试与 compat-probe |
| 15 | §10.1 性能目标、§10.4 决策门 | 见 A.3 | 以整合方案 v2.0 §8 为准 |
| 16 | §9 R4 "Decorator Metadata 行为变化" | reflect-metadata 是纯 JS，E-09 实测正常 | 降为"低"，改为 CI 固化 |

### C. 正文遗漏的风险与测试项

| 项 | 说明 | 处理 |
|----|------|------|
| Bun 转译器忽略 `useDefineForClassFields: false`（E-10） | 在 Bun 下直接运行源码时，**未装饰**的 `x!: T` 字段会成为值为 `undefined` 的自有属性，遮住原型值。带 legacy 装饰器的字段不受影响 | 依赖 `overridePrototypeValue` 兜底（仅对 IOC 创建的实例有效）；C3/C4 的 fixture 同时覆盖"源码运行"与"dist 运行" |
| Bun 的 `ws` 客户端垫片忽略 `origin` 选项（E-13） | 服务端能正确收到 Origin（用 curl 发送时显示 `http://evil.test`），但在 Bun 下写的 WS 测试客户端发不出 Origin，会让 Origin 校验的测试**假通过或假失败** | Bun 下的 WS 测试通过 `headers: { Origin }` 或 Node 客户端发送 Origin |
| 优雅关闭 | Bun 的 `node:http` 对 keep-alive 连接、`closeAllConnections` 的行为需要实测 | 加入 Phase 0 |
| OTel auto-instrumentation | 依赖 require 钩子，Bun 下默认关闭。**但 `koatty-trace` 自己创建的中间件 Span 不依赖 auto-instrumentation**，服务端 Span 不受影响；缺失的只是出站 HTTP 与 DB 客户端的 Span | §6 的范围据此收窄 |
| gRPC | grpc-js 构建在 `node:http2` 之上；Unary / Server Streaming / Bidi Streaming 需要逐一实测 | 加入 Phase 0，结果回填整合方案 §6.1 |
| Loader 在开发模式下 `require('.ts')` | Bun 原生支持，需要实测 `globby` 扫描 + `require` 路径 | 加入 Phase 0 |

### D. v4.0 实际工作清单（取代正文 §3、§4、§5、§13 的任务）

| 任务 | 包 | 工作量 |
|------|---|-------|
| `detectRuntime()` + `app.runtime` + 启动诊断日志 | koatty-core / koatty | 1 人天 |
| `checkRuntime()` 识别 Bun（≥ 1.3.0）；`engines.bun` | koatty-core | 0.5 人天 |
| HTTP/3 在 Bun 下降级到 `Http2Server` 并告警 | koatty-serve | 1 人天 |
| `koatty-trace` 在 Bun 下关闭 auto-instrumentation 并告警 | koatty-trace | 1 人天 |
| Phase 0 实测失败项的修补（按根因逐个处理） | 按需 | 5 人天（预留） |
| 协议集成测试在 Bun 下运行（HTTP / HTTPS / HTTP2 / WS / gRPC / GraphQL） | koatty-serve | 4 人天 |
| 优雅关闭测试 | koatty-serve | 1.5 人天 |
| `examples/bun-legacy`（C4）与 `examples/bun-tc39`（C3） | examples | 2 人天 |
| CLI `--runtime bun`（与装饰器模式相互独立） | koatty-ai | 1 人天 |

合计约 17 人天（v2 估算约 7 周）。

### E. 修订后的 Bun 模板要点

```jsonc
// package.json.hbs（v3）
{
  "scripts": {
    "dev":   "bun --watch src/App.ts",
    "build": "tsc -p tsconfig.json",          // 保留目录结构，Loader 才能扫描到组件
    "start": "bun dist/App.js",
    "test":  "bun test"                        // 仅用于应用自身测试
  },
  "engines": { "bun": ">=1.3.0" },
  "dependencies": { "koatty": "^4.0.0", "reflect-metadata": "^0.2.2", "tslib": "^2.8.0" },
  "devDependencies": { "@types/bun": "^1.3.0", "typescript": "^5.9.0 || ^6.0.0 || ^7.0.0" }
}
```

```jsonc
// tsconfig.json.hbs（v3；{{#if tc39}} 分支关闭 experimentalDecorators 与 emitDecoratorMetadata）
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,   // Bun 转译器会忽略（E-10），但 tsc 构建依赖它
    "strict": true,                      // 新项目可以开启；TS7 下这也是默认值
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["bun"]
  },
  "include": ["src/**/*"]
}
```

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [整体架构](#2-整体架构)
3. [Phase 1 — packages/koatty-bun](#3-phase-1--packageskoatty-bun)
4. [Phase 2 — 各组件 bun 分支](#4-phase-2--各组件-bun-分支)
5. [Phase 3 — 协议服务器适配详解](#5-phase-3--协议服务器适配详解)
6. [Phase 4 — 可观测性适配](#6-phase-4--可观测性适配)
7. [Phase 5 — koatty-ai 适配](#7-phase-5--koatty-ai-适配)
8. [Phase 6 — Monorepo 基础设施](#8-phase-6--monorepo-基础设施)
9. [风险登记与缓解措施](#9-风险登记与缓解措施)
10. [性能基准测试计划](#10-性能基准测试计划)
11. [测试策略](#11-测试策略)
12. [开发工作流与调试指南](#12-开发工作流与调试指南)
13. [实施顺序与优先级](#13-实施顺序与优先级)
14. [技术决策记录](#14-技术决策记录)

---

## 1. 背景与目标

### 1.1 背景

koatty 框架核心依赖链：

```
koatty
  └── koatty_core  (继承 Koa，基于 Node.js http 模块)
  └── koatty_serve (Node.js http/https/http2/http3/grpc/ws 实现)
```

Bun runtime 的 HTTP 服务器使用 Web 标准 `fetch` API（`Request / Response`），与 Node.js 的 `IncomingMessage / ServerResponse` 事件模型完全不同，无法直接运行。

**关键事实**（基于 `bun-compatibility-assessment-2026-04-16.md`）：

- 24 个包中 8 个（33%）无需修改
- 10 个（42%）需少量适配
- 4 个（17%）需重大改造
- 2 个（8%）存在阻断风险（`koatty_trace` OpenTelemetry、`koatty_serve` HTTP/3）

### 1.2 目标

1. 创建 `koatty-bun` 子项目——koatty 框架在 Bun runtime 下的适配版本
2. 各核心组件如需 Bun 适配，在独立仓库创建 `bun` 分支
3. `koatty-ai` 脚手架新增 `--runtime bun` 参数，生成的项目依赖来自 `bun` 分支的组件版本
4. **新增**：提供 koatty_trace 在 Bun 下的可观测性降级方案

### 1.3 设计原则

- **用户 0 改动**：应用代码只需将 `import from 'koatty'` 替换为 `import from 'koatty-bun'`
- **渐进落地**：P0 协议（HTTP/WS）优先，HTTP/3 降级处理，gRPC 兼容运行
- **接口稳定**：所有 Bun 服务器类继承 `BaseServer<T, S>`，实现全部抽象方法
- **可回退**：任何 Bun 适配均不破坏 Node.js 原有实现，用户可随时切回

### 1.4 范围边界

| 包含 | 不包含 |
|------|--------|
| HTTP/HTTPS/HTTP2/WS/WSS 原生 Bun 服务器 | HTTP/3 原生实现（降级到 HTTP/2） |
| gRPC 经 Node compat 层运行 | gRPC Bun 原生实现 |
| OpenTelemetry 手动 Instrumentation | OpenTelemetry Auto-Instrumentation |
| Koa 中间件链兼容运行 | Koa 替代方案 |

---

## 2. 整体架构

> **v3**：本章的"`koatty-bun` 入口包 + `koatty_serve/bun` 分支 + `BunXxxServer` 继承体系"已作废。v4.0 的架构是：用户照常 `import "koatty"`；`Bootstrap` 调用 `detectRuntime()`；`koatty-serve` 在 Node 与 Bun 下使用同一套 `node:http(s)` / `node:http2` / `ws` / `grpc-js` 实现，只有 HTTP/3 在 Bun 下降级。详见整合方案 v2.0 §2.4。

### 2.1 用户视角

```typescript
// Node.js 项目（不变）
import { Koatty, Controller, Service } from 'koatty';

// Bun 项目（仅替换入口包）
import { Koatty, Controller, Service } from 'koatty-bun';
```

### 2.2 包依赖关系

```
koatty-bun (新包, packages/koatty-bun)
  ├── re-exports: koatty (所有装饰器、DI、AOP 等)
  ├── overrides:  BunBootstrap (Bootstrap 的 Bun 感知版)
  ├── depends on: koatty_serve@bun   ← bun 分支版本
  └── depends on: koatty_core@bun    ← bun 分支版本
         └── depends on: koatty_loader@bun
                          koatty_config@bun
                          (其余不变)
```

### 2.3 运行时分发（koatty_serve/bun 分支）

```
SingleProtocolServer.createServerInstance()
  │
  ├─ typeof Bun !== 'undefined' ?
  │    ├── http     → BunHttpServer      (Bun.serve fetch handler)
  │    ├── https    → BunHttpsServer     (Bun.serve + tls)
  │    ├── http2    → BunHttp2Server     (Bun.serve + tls, ALPN 自动 h2)
  │    ├── http3    → BunHttp3Server     (内部降级 → BunHttp2Server + warning)
  │    ├── ws/wss   → BunWsServer        (Bun.serve websocket handler)
  │    ├── grpc     → GrpcServer         (原实现，经 Node compat 层)
  │    └── graphql  → BunHttpServer      (底层复用 HTTP)
  │
  └─ Node.js 原有实现（不变）
       ├── http/graphql → HttpServer
       ├── https        → HttpsServer
       ├── http2        → Http2Server
       ├── http3        → Http3Server
       ├── ws/wss       → WsServer
       └── grpc         → GrpcServer
```

### 2.4 Bun 服务器类继承体系

```
BaseServer<T, S> (koatty_serve/src/server/base.ts)
  │
  ├── HttpServer<HttpServerOptions, http.Server>              ← 现有 Node.js
  ├── HttpsServer<HttpsServerOptions, https.Server>           ← 现有 Node.js
  ├── Http2Server<Http2ServerOptions, Http2SecureServer>       ← 现有 Node.js
  ├── Http3Server<Http3ServerOptions, ...>                     ← 现有 Node.js
  ├── WsServer<WebSocketServerOptions, WS.WebSocketServer>     ← 现有 Node.js
  ├── GrpcServer<GrpcServerOptions, gRPCServer>                ← 现有 Node.js (Bun 复用)
  │
  ├── BunHttpServer<HttpServerOptions, BunServer>              ← 新增 Bun
  ├── BunHttpsServer<HttpsServerOptions, BunServer>            ← 新增 Bun
  ├── BunHttp2Server<Http2ServerOptions, BunServer>            ← 新增 Bun
  ├── BunHttp3Server<Http3ServerOptions, BunServer>            ← 新增 Bun (降级)
  └── BunWsServer<WebSocketServerOptions, BunServer>           ← 新增 Bun
```

> **关键约束**：所有 Bun 服务器必须实现 `BaseServer` 的全部抽象方法，包括连接池管理、优雅关闭、配置热更新。

---

## 3. Phase 1 — packages/koatty-bun

> **v3：本章作废，保留作参考。** 不新建 `koatty-bun` 入口包，也不写 `BunBootstrap`（整合方案 ADR-010）。原因：① Bootstrap 逻辑与 Node 完全相同；② 如果强制用户改 import，已经预编译、`import "koatty"` 的 dist 在 Bun 下就无法直接运行；③ 运行时识别只需要几十行代码，放在 `koatty-core` 即可。

### 3.1 目录结构

```
packages/koatty-bun/
├── src/
│   ├── index.ts                    # 主入口：re-export koatty + 覆盖 Bun 专用实现
│   ├── bootstrap/
│   │   └── BunBootstrap.ts         # ExecBootStrap 的 Bun 感知版本
│   └── types.ts                    # Bun 特有类型扩展
├── package.json
├── tsconfig.json
└── README.md
```

### 3.2 `index.ts`

```typescript
// 复用 koatty 全部能力（DI、AOP、装饰器等）
export * from 'koatty';

// 覆盖 Bootstrap，提供 Bun 感知版本
export { ExecBootStrap, createApplication } from './bootstrap/BunBootstrap';
```

### 3.3 `BunBootstrap.ts`

对照现有 `packages/koatty/src/core/Bootstrap.ts` 的实际实现：

```typescript
import { Koatty, KoattyApplication } from 'koatty_core';
import { IOC } from 'koatty_container';
import { Loader } from 'koatty/core/Loader';
import { checkRuntime } from 'koatty/util/Helper';

/**
 * Bun 感知的 bootstrapApplication
 * 与原版逻辑一致，但在启动前检测 Bun 运行时
 */
async function bootstrapApplication(
  target: any,
  bootFunc?: (...args: any[]) => any,
  isInitiative = false,
): Promise<KoattyApplication> {
  const app = Reflect.construct(target, []) as KoattyApplication;

  // Bun 环境检测与版本校验（由 koatty_core/bun 分支的 checkRuntime 处理）
  checkRuntime();

  if (typeof Bun !== 'undefined') {
    app.env('RUNTIME', 'bun');
    app.env('RUNTIME_VERSION', Bun.version);
    console.log(`[koatty-bun] Running on Bun ${Bun.version}`);
  }

  // 以下与原 bootstrapApplication 逻辑完全一致
  Loader.initialize(app);
  if (bootFunc) {
    await bootFunc(app);
  }
  IOC.setApp(app);
  Loader.CheckAllComponents(app, target);
  await Loader.LoadAllComponents(app, target);
  app.markReady();

  return app;
}

/**
 * 执行引导（启动服务器监听）
 */
async function executeBootstrap(
  target: any,
  bootFunc?: (...args: any[]) => any,
  isInitiative = true,
): Promise<void> {
  const app = await bootstrapApplication(target, bootFunc, isInitiative);
  // 服务器层由 koatty_serve/bun 分支的运行时分发自动切换到 Bun 实现
  app.listen();
}

/**
 * ExecBootStrap 装饰器
 */
export function ExecBootStrap(bootFunc?: (...args: any[]) => any) {
  return (target: any) => {
    if (!(target.prototype instanceof Koatty)) {
      throw new Error(`class ${target.name} does not inherit from Koatty`);
    }
    return executeBootstrap(target, bootFunc, true);
  };
}

/**
 * 创建应用实例但不监听（用于 serverless / 测试场景）
 */
export async function createApplication(
  target: any,
  bootFunc?: (...args: any[]) => any,
): Promise<KoattyApplication> {
  return bootstrapApplication(target, bootFunc, false);
}
```

### 3.4 `types.ts`

```typescript
import type { Server as BunNativeServer } from 'bun';

/**
 * 扩展 NativeServer 类型以包含 Bun Server
 * koatty_core/bun 分支需在 IApplication.ts 中添加此类型
 */
export type BunServer = BunNativeServer;

/**
 * Bun 运行时检测
 */
export function isBunRuntime(): boolean {
  return typeof globalThis.Bun !== 'undefined';
}

/**
 * 获取 Bun 版本，非 Bun 环境返回 null
 */
export function getBunVersion(): string | null {
  return isBunRuntime() ? Bun.version : null;
}
```

### 3.5 `package.json`

```json
{
  "name": "koatty-bun",
  "version": "1.0.0",
  "description": "koatty loves bun — Koatty framework adaptation for Bun runtime",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types":   "./dist/index.d.ts",
      "import":  "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  },
  "engines": {
    "bun":  ">=1.1.0",
    "node": ">=18.0.0"
  },
  "keywords": ["koatty", "bun", "framework", "typescript"],
  "license": "BSD-3-Clause",
  "dependencies": {
    "koatty":          "workspace:*",
    "koatty_core":     "workspace:*",
    "koatty_serve":    "workspace:*"
  },
  "peerDependencies": {
    "bun-types": ">=1.1.0"
  },
  "peerDependenciesMeta": {
    "bun-types": { "optional": true }
  }
}
```

> **说明**：`koatty_core` 和 `koatty_serve` 在 monorepo 中使用 `workspace:*`；发布时锁定为各自 `bun` tag 版本（`koatty_serve@bun`）。

---

## 4. Phase 2 — 各组件 bun 分支

### 4.1 各组件适配优先级

| 组件 | 独立仓库 | bun 分支必要性 | 改动内容 |
|------|---------|--------------|---------|
| `koatty_serve` | github.com/Koatty/koatty_serve | **P0 必须** | ~~新增全部 BunXxxServer 实现~~ v3：复用现有服务器；只加 HTTP/3 在 Bun 下的降级，以及 Phase 0 发现问题的修补 |
| `koatty_core` | github.com/Koatty/koatty_core | **P0 必须** | `checkRuntime()` 支持 Bun、`detectRuntime()`。v3：由于复用 `node:*` 服务器，`NativeServer` 不需要扩展 `BunNativeServer` |
| `koatty_trace` | github.com/Koatty/koatty_trace | **P0 必须** | v3：Bun 下关闭 auto-instrumentation 并告警；框架自有 Span 不受影响 |
| `koatty_loader` | github.com/Koatty/koatty_loader | ~~P1~~ 验证 | ~~`Bun.file()` 加速~~ v3：Loader 只做 `globby` + `require`，不读文件内容；只需验证 Bun 下 `require('.ts')` |
| `koatty_config` | github.com/Koatty/koatty_config | ~~P1~~ 不需要 | ~~`Bun.file()` 加速~~ v3：删除 |
| `koatty_logger` | github.com/Koatty/koatty_logger | P2 | Bun console 彩色输出优化；验证 `winston-daily-rotate-file` 兼容性 |
| `koatty_router` | github.com/Koatty/koatty_router | P2 | 仅 `engines` 字段更新，路由逻辑无需改动 |
| `koatty_container` | — | **不需要** | 纯 TS IoC，无 Node.js API 依赖 |
| `koatty_lib` | — | **不需要** | 纯工具函数（`process.getuid/getgid` 已有条件判断） |
| `koatty_exception` | — | **不需要** | 纯错误处理 |
| `koatty_validation` | — | **不需要** | 纯参数验证 |
| `koatty_store` | — | **不需要** | `ioredis` + `lru-cache`，Bun 全兼容 |

### 4.2 bun 分支发布策略

> **v3：本节作废。** 不设 `bun` 分支与 dist-tag。Node 与 Bun 共用同一套版本（整合方案 ADR-014），运行时差异在代码内通过 `detectRuntime()` 分支处理。

各组件的 `bun` 分支发布到 npm 时使用 `bun` dist-tag：

```bash
# 在各组件仓库的 bun 分支上
npm publish --tag bun

# 安装时
npm install koatty_serve@bun
```

`koatty-bun` 的 `package.json` 在发布时锁定各依赖的 `bun` tag：

```json
{
  "dependencies": {
    "koatty_serve": "3.3.0-bun.1",
    "koatty_core":  "2.3.0-bun.1",
    "koatty_trace": "1.5.0-bun.1"
  }
}
```

### 4.3 koatty_core/bun 分支关键改动

#### 4.3.1 checkRuntime() 增加 Bun 支持

```typescript
// src/Utils.ts — checkRuntime()
export function checkRuntime() {
  // Bun runtime 跳过 Node.js 版本检查
  if (typeof Bun !== 'undefined') {
    const bunVersion = Bun.version;
    const minBun = '1.3.0';   // v3：只验证了 1.3.x
    if (semverLt(bunVersion, minBun)) {
      Logger.Fatal(`koatty requires Bun >= ${minBun}, current: ${bunVersion}`);
    }
    return;
  }
  // 原有 Node.js 版本检查逻辑不变
  // ...
}
```

#### 4.3.2 NativeServer 类型扩展

```typescript
// src/IApplication.ts — NativeServer 类型
import type { Server as BunNativeServer } from 'bun';

// 原有类型
type NodeNativeServer = Server | SecureServer | Http2SecureServer | gRPCServer | WebSocketServer;

// 扩展后类型：在 Bun 环境下接受 BunNativeServer
type NativeServer = NodeNativeServer | BunNativeServer;
```

> **注意**：需要在 `peerDependencies` 中添加 `bun-types`（optional），确保类型编译不报错。

#### 4.3.3 process.execArgv 兼容

> **v3：本节不需要。** Bun 1.3.14 提供 `process.execArgv`（E-14），现有代码无需修改。

```typescript
// （v2 原文，前提不成立）Bun 不支持 process.execArgv，需条件判断
const isDebugMode = typeof process.execArgv !== 'undefined'
  ? process.execArgv.some(arg => /--inspect|--debug/.test(arg))
  : false;
```

### 4.4 koatty_loader/bun 分支关键改动

> **v3：本节作废。** Loader 用 `globby.sync` 扫描后直接 `require(p)`（`koatty-loader/src/index.ts:54,95`），并不读取文件内容，下面的 `readFileContent` 没有调用方。Bun 下只需验证开发模式的 `require('.ts')`。

```typescript
// 用 Bun.file() 替换 fs.readFile，提升文件扫描性能
async function readFileContent(filePath: string): Promise<string> {
  if (typeof Bun !== 'undefined') {
    return await Bun.file(filePath).text();   // 比 fs.readFile 快 ~2x
  }
  return await fs.promises.readFile(filePath, 'utf-8');
}
```

---

## 5. Phase 3 — 协议服务器适配详解

### 5.1 Bun 能力矩阵（基于 Bun 1.3.x）

> **v3：本表按 Bun 1.3.14 实测重写。** "Koatty 采用"一列是 v4.0 的实现方式。

| 协议 | `Bun.serve` 原生 | Bun 的 `node:*` 兼容层 | Koatty v4.0 采用 | 依据 |
|------|----------------|-----------------|----------------|------|
| **http** | ✅ | ✅ `node:http` + Koa | 现有 `HttpServer` | E-15 |
| **https** | ✅ | ✅ `node:https` | 现有 `HttpsServer` | — |
| **http2** | ❌ **只协商 HTTP/1.1** | ✅ `node:http2`（h2） | 现有 `Http2Server` | E-12 |
| **http3** | ❌ | ❌ | 降级到 `Http2Server` + 告警 | 没有 QUIC |
| **ws** | ✅ `websocket` handler | ✅ `ws` + noServer 升级 | 现有 `WsServer` | E-13 |
| **wss** | ✅ | ✅ | 现有 `WsServer` + TLS | — |
| **grpc** | — | ⚠️ `@grpc/grpc-js`（基于 `node:http2`） | 现有 `GrpcServer`，三种流式模式待 Phase 0 实测 | — |
| **graphql** | — | ✅ | 走 HTTP | — |

---

### 5.2 Koa Bridge（所有 HTTP 协议的核心适配）

所有 HTTP 类协议（http/https/http2/graphql）都依赖此桥接层。

**文件**：`koatty_serve/bun branch: src/adapter/bun-koa-bridge.ts`

#### 方案 A — 直接使用 node:http compat（推荐，快速落地）

Bun 内置完整的 `node:http` 兼容实现。**核心思路**：不使用 `Bun.serve()` 的 fetch handler，而是直接调用 `http.createServer()` / `https.createServer()`，让 Koa 零改动运行在 Bun 的 Node compat 层上。

```typescript
// 方案 A：BunHttpServer 直接复用 Node.js 路径
// 此方案下 BunHttpServer 与 HttpServer 几乎相同，
// 区别仅在于构造函数添加 Bun 运行时提示

import { createServer, Server } from 'node:http';  // Bun 的 node:http 兼容实现
import { KoattyApplication, NativeServer } from 'koatty_core';
import { BaseServer } from './base';
import { HttpServerOptions } from '../config/config';

export class BunHttpServer extends BaseServer<HttpServerOptions, Server> {
  protected createProtocolServer(): void {
    if (typeof Bun !== 'undefined') {
      this.logger.info(`[BunHttpServer] Using Bun ${Bun.version} node:http compat layer`);
    }

    // 直接使用 node:http API — Koa 零改动
    this.server = createServer(async (req, res) => {
      try {
        await healthMiddleware(req, res, async () => {
          this.app.callback()(req, res);
        });
      } catch (error) {
        this.logger.error('Request handling error', {}, error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
      }
    });
  }
}
```

**优势**：工程量极小（~50 行差异），Koa 中间件链零适配，连接池/优雅关闭逻辑可完全复用 `HttpServer`。

**劣势**：无法利用 Bun 原生 `fetch` handler 的性能优势。~~（约 10~15% 性能损耗）~~ v3：这个数字没有测量依据。同机 hello-world 实测，Bun+Koa（`node:http`）为 45.0k req/s，原生 `Bun.serve`（不经过 Koa）为 47.4k req/s，差距约 5%；再加上 Koatty 完整中间件栈后，差距只会被进一步稀释。

> **v3 补充**：方案 A 不需要新建 `BunHttpServer` 类，现有 `HttpServer` 本身就是 `node:http` 实现，可以直接在 Bun 上运行。上面的示例代码只作说明，不必实施。

#### 方案 B — Bun.serve() 原生 + Request/Response 桥接（最优性能）

> **v3：作废（保留作反面参考）。** 下面的 mock 至少有 5 处功能缺陷，详见文首勘误 B.6。其中最严重的是：Koa 通过 `res.statusCode = code` 直接赋值设置状态码，而 `getResponse()` 读的是闭包变量 `statusCode`，所以除非调用 `writeHead`，所有响应都是 200。另外，整个响应被缓冲进 `Blob`，流式响应与 SSE 都会失效。"约 2.5x Node.js 吞吐"没有测量依据。

使用 `Bun.serve()` 的原生 `fetch` handler，手动将 Web 标准 `Request` 转换为 Node.js `IncomingMessage`，将 Koa 产出的响应转换回 Web 标准 `Response`。

```typescript
import type { Server as BunServer } from 'bun';

/**
 * 将 Bun Web Request 转换为 Node.js IncomingMessage 兼容对象
 */
function createNodeRequest(bunReq: Request): NodeIncomingMessageLike {
  const url = new URL(bunReq.url);
  return {
    method:  bunReq.method,
    url:     url.pathname + url.search,
    headers: Object.fromEntries(bunReq.headers.entries()),
    // body stream 适配
    on(event: string, handler: (...args: any[]) => void) {
      if (event === 'data') {
        bunReq.body?.pipeTo(new WritableStream({
          write(chunk) { handler(Buffer.from(chunk)); }
        }));
      }
      if (event === 'end') {
        bunReq.body?.pipeTo(new WritableStream({
          close() { handler(); }
        })).catch(() => handler());
        if (!bunReq.body) queueMicrotask(() => handler());
      }
    },
    socket: {
      remoteAddress: '0.0.0.0',  // Bun 无法直接获取，需从 server.requestIP(req) 获取
      remotePort:    0,
      encrypted:     url.protocol === 'https:',
    },
  } as any;
}

/**
 * 创建 Node.js ServerResponse mock，收集响应数据后构建 Web Response
 */
function createNodeResponse(): {
  res: NodeServerResponseLike;
  getResponse: () => Response;
} {
  let statusCode = 200;
  const headers = new Headers();
  const bodyChunks: Uint8Array[] = [];

  const res = {
    statusCode,
    setHeader(name: string, value: string) { headers.set(name, value); },
    getHeader(name: string) { return headers.get(name); },
    removeHeader(name: string) { headers.delete(name); },
    writeHead(code: number, hdrs?: Record<string, string>) {
      statusCode = code;
      if (hdrs) Object.entries(hdrs).forEach(([k, v]) => headers.set(k, v));
    },
    write(chunk: any) {
      bodyChunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      return true;
    },
    end(chunk?: any) {
      if (chunk) this.write(chunk);
      this.finished = true;
      // 触发 finish 事件
      this._finishCallbacks?.forEach((cb: () => void) => cb());
    },
    finished: false,
    headersSent: false,
    _finishCallbacks: [] as (() => void)[],
    on(event: string, cb: (...args: any[]) => void) {
      if (event === 'finish') this._finishCallbacks.push(cb);
      return this;
    },
  } as any;

  const getResponse = (): Response => {
    const body = bodyChunks.length > 0
      ? new Blob(bodyChunks)
      : null;
    return new Response(body, { status: statusCode, headers });
  };

  return { res, getResponse };
}

/**
 * Bun Request → Koa 中间件链 → Bun Response
 */
export async function bunKoaBridge(
  app: KoattyApplication,
  bunRequest: Request,
  server: BunServer,
): Promise<Response> {
  const req = createNodeRequest(bunRequest);
  const { res, getResponse } = createNodeResponse();

  // 注入 Bun 特有信息（如客户端 IP）
  const clientIP = server.requestIP(bunRequest);
  if (clientIP) {
    (req as any).socket.remoteAddress = clientIP.address;
    (req as any).socket.remotePort = clientIP.port;
  }

  await new Promise<void>((resolve, reject) => {
    res.on('finish', resolve);
    res.on('error', reject);
    try {
      app.callback()(req as any, res as any);
    } catch (e) {
      reject(e);
    }
  });

  return getResponse();
}
```

**优势**：利用 Bun 原生 HTTP 栈性能。~~（约 2.5x Node.js 吞吐）~~ v3：没有依据，实测见 E-15。

**劣势**：IncomingMessage/ServerResponse mock 约 400~600 行，需覆盖所有 Koa 使用的属性和方法；需要完整的集成测试验证边界情况。

> **落地建议**：Phase 1 使用方案 A 快速跑通；通过 benchmark 验证性能差距后（见第 10 章），决定是否迁移到方案 B。

---

### 5.3 HTTP → BunHttpServer（方案 B 实现）

**文件**：`src/server/bun-http.ts`

以下为方案 B 的完整实现（方案 A 见 5.2 节，结构更简单）。

```typescript
import type { Server as BunServer, Serve } from 'bun';
import { KoattyApplication, NativeServer } from 'koatty_core';
import { generateTraceId } from '../utils/logger';
import { BaseServer, ConfigChangeAnalysis } from './base';
import { ConfigHelper, HttpServerOptions, ListeningOptions } from '../config/config';
import { createHealthCheckMiddleware } from '../middleware/healthCheck';
import { bunKoaBridge } from '../adapter/bun-koa-bridge';

export class BunHttpServer extends BaseServer<HttpServerOptions, BunServer> {
  // Bun 内建连接管理，使用简化的请求计数器替代 Node.js 连接池
  private activeRequests = 0;
  private totalRequests = 0;

  constructor(app: KoattyApplication, options: HttpServerOptions) {
    super(app, options);
    this.options = ConfigHelper.createHttpConfig(options);
    this.initializeServer();
  }

  // ============= 实现 BaseServer 抽象方法 =============

  protected initializeConnectionPool(): void {
    // Bun 内部管理 HTTP 连接，不需要用户态连接池
    // 使用 activeRequests 计数器追踪请求数
    this.logger.debug('Bun manages connections internally, using request counter');
  }

  protected createProtocolServer(): void {
    const healthMiddleware = createHealthCheckMiddleware(this.options.health);

    this.server = Bun.serve({
      port:     this.options.port,
      hostname: this.options.hostname,

      fetch: async (req: Request, server: BunServer): Promise<Response> => {
        this.activeRequests++;
        this.totalRequests++;

        try {
          // 健康检查短路（Web 标准 Request → Response）
          const healthRes = await healthMiddleware.handleBunRequest?.(req);
          if (healthRes) return healthRes;

          return await bunKoaBridge(this.app, req, server);
        } catch (error) {
          this.logger.error('Request handling error', {}, error);
          return new Response(
            JSON.stringify({ error: 'Internal Server Error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        } finally {
          this.activeRequests--;
        }
      },

      // Bun 全局错误处理器
      error(error: Error): Response | Promise<Response> {
        console.error('[BunHttpServer] Unhandled error:', error);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
  }

  protected configureServerOptions(): void {
    // Bun.serve() 在创建时已配置完毕，无额外配置步骤
  }

  protected analyzeConfigChanges(
    changedKeys: (keyof HttpServerOptions)[],
    oldConfig: HttpServerOptions,
    newConfig: HttpServerOptions,
  ): ConfigChangeAnalysis {
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    if (changedKeys.some(key => criticalKeys.includes(key as keyof ListeningOptions))) {
      return {
        requiresRestart: true,
        changedKeys: changedKeys as string[],
        restartReason: 'Critical network configuration changed',
        canApplyRuntime: false,
      };
    }
    return {
      requiresRestart: false,
      changedKeys: changedKeys as string[],
      canApplyRuntime: true,
    };
  }

  protected onRuntimeConfigChange(
    _analysis: ConfigChangeAnalysis,
    _newConfig: Partial<HttpServerOptions>,
    traceId: string,
  ): void {
    this.logger.info('Bun HTTP server runtime config updated', { traceId });
  }

  protected extractRelevantConfig(config: HttpServerOptions) {
    return {
      hostname: config.hostname,
      port:     config.port,
      protocol: config.protocol,
    };
  }

  // ============= 优雅关闭（利用 Bun server.stop() API）=============

  protected async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Stopping acceptance of new connections', { traceId });
    // Bun server.stop() 默认会等待 in-flight 请求完成
    // 先标记状态，实际 stop 在 forceCloseRemainingConnections 中执行
    this.status = 0;
  }

  protected async waitForConnectionCompletion(timeout: number, traceId: string): Promise<void> {
    this.logger.info('Waiting for in-flight requests to complete', { traceId }, {
      activeRequests: this.activeRequests,
      timeout,
    });

    const startTime = Date.now();
    while (this.activeRequests > 0) {
      if (Date.now() - startTime >= timeout) {
        this.logger.warn('Request completion timeout', { traceId }, {
          remaining: this.activeRequests,
        });
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  protected async forceCloseRemainingConnections(traceId: string): Promise<void> {
    if (this.server) {
      if (this.activeRequests > 0) {
        // 强制关闭：server.stop(true) 立即终止所有连接
        this.logger.warn('Force stopping with active requests', { traceId }, {
          activeRequests: this.activeRequests,
        });
        await this.server.stop(true);
      } else {
        // 优雅关闭：等待 in-flight 请求完成
        await this.server.stop();
      }
    }
  }

  protected forceShutdown(traceId: string): void {
    this.logger.warn('Force shutdown initiated', { traceId });
    this.server?.stop(true);
    this.stopMonitoringAndCleanup(traceId);
  }

  // ============= KoattyServer 接口 =============

  Start(listenCallback?: () => void): any {
    this.startTime = Date.now();
    this.status = 200;

    const protocolUpper = this.options.protocol.toUpperCase();
    const serverUrl = `http://${this.options.hostname || '127.0.0.1'}:${this.options.port}/`;
    this.logger.info(`Server: ${protocolUpper} running at ${serverUrl}`, {});

    listenCallback?.();
    return this.server;
  }

  getStatus(): number {
    return this.status;
  }

  getNativeServer(): NativeServer {
    return this.server as any;
  }

  async destroy(): Promise<void> {
    const traceId = generateTraceId();
    this.logger.info('Destroying Bun HTTP server', { traceId });
    try {
      await this.gracefulShutdown();
    } catch (error) {
      this.logger.error('Error destroying server', { traceId }, error);
      throw error;
    }
  }
}
```

---

### 5.4 HTTPS → BunHttpsServer

**文件**：`src/server/bun-https.ts`

```typescript
import type { Server as BunServer } from 'bun';
import { BaseServer } from './base';
import { HttpsServerOptions } from '../config/config';
import { bunKoaBridge } from '../adapter/bun-koa-bridge';

export class BunHttpsServer extends BaseServer<HttpsServerOptions, BunServer> {

  protected createProtocolServer(): void {
    // Bun TLS 配置：推荐使用 Bun.file() 读取证书，性能最优
    const keyPath  = this.options.ssl?.key;
    const certPath = this.options.ssl?.cert;

    if (!keyPath || !certPath) {
      throw new Error('SSL key and cert paths are required for HTTPS');
    }

    this.server = Bun.serve({
      port:     this.options.port,
      hostname: this.options.hostname,

      tls: {
        key:  Bun.file(keyPath),    // Bun.file() 懒读取，比 fs.readFileSync 更高效
        cert: Bun.file(certPath),
        ca:   this.options.ssl?.ca ? Bun.file(this.options.ssl.ca) : undefined,
        passphrase:         this.options.ssl?.passphrase,
        rejectUnauthorized: this.options.ssl?.rejectUnauthorized ?? true,
      },

      fetch: async (req, server) => {
        this.activeRequests++;
        this.totalRequests++;
        try {
          return await bunKoaBridge(this.app, req, server);
        } catch (error) {
          this.logger.error('Request handling error', {}, error);
          return new Response('Internal Server Error', { status: 500 });
        } finally {
          this.activeRequests--;
        }
      },

      error(error: Error): Response {
        console.error('[BunHttpsServer] Unhandled error:', error);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
  }

  // ... 其余抽象方法实现与 BunHttpServer 结构一致，继承相同模式
}
```

---

### 5.5 HTTP/2 → BunHttp2Server

> **v3：本节前提错误，作废。** `Bun.serve({ tls })` 只协商 HTTP/1.1，不会走 h2（`curl --http2` 实测 `http_version=1.1`）。下面的实现会让 `protocol: "http2"` 的配置静默退化为 HTTPS/1.1。**Bun 下直接使用现有 `Http2Server`（`node:http2`）**，实测协商结果为 h2。

**文件**：`src/server/bun-http2.ts`

**关键差异**：~~Bun **不需要显式开启 HTTP/2**。配置了 TLS 后，Bun 通过 ALPN 自动协商 `h2 / http/1.1`，底层实现与 `BunHttpsServer` 相同，仅 protocol 标识不同。~~

```typescript
export class BunHttp2Server extends BaseServer<Http2ServerOptions, BunServer> {

  protected createProtocolServer(): void {
    // Bun TLS 服务器自动支持 HTTP/2（ALPN h2），无需额外配置
    // 实现与 BunHttpsServer 相同
    this.server = Bun.serve({
      port:     this.options.port,
      hostname: this.options.hostname,
      tls:      this.buildTlsOptions(),
      fetch:    async (req, server) => {
        this.activeRequests++;
        try {
          return await bunKoaBridge(this.app, req, server);
        } finally {
          this.activeRequests--;
        }
      },
      error: (error) => {
        this.logger.error('Unhandled error', {}, error);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
    // 此 server 同时支持 HTTP/1.1 + HTTP/2（由客户端 ALPN 决定）
  }

  private buildTlsOptions() {
    const keyPath  = this.options.ssl?.key;
    const certPath = this.options.ssl?.cert;
    if (!keyPath || !certPath) {
      throw new Error('TLS key and cert are required for HTTP/2');
    }
    return {
      key:  Bun.file(keyPath),
      cert: Bun.file(certPath),
      ca:   this.options.ssl?.ca ? Bun.file(this.options.ssl.ca) : undefined,
    };
  }
}
```

---

### 5.6 HTTP/3 → BunHttp3Server（降级）

**文件**：`src/server/bun-http3.ts`

Bun 不支持 HTTP/3/QUIC，提供带警告的降级实现。

> **v3**：降级目标改为现有的 `Http2Server`（`node:http2`），不要用下面基于 `Bun.serve` 的实现，否则会退化到 HTTP/1.1（见 §5.5 v3 说明）。实现方式：`serve.ts` 工厂在 `protocol === "http3" && !app.runtime.capabilities.http3` 时创建 `Http2Server`，并输出一次告警。

```typescript
export class BunHttp3Server extends BaseServer<Http3ServerOptions, BunServer> {

  protected createProtocolServer(): void {
    this.logger.warn(
      '[BunHttp3Server] HTTP/3 (QUIC) is not supported by Bun ' +
      `${typeof Bun !== 'undefined' ? Bun.version : 'unknown'}. ` +
      'Automatically falling back to HTTP/2 (TLS). ' +
      'Track upstream: https://github.com/oven-sh/bun/issues/887'
    );

    // HTTP/3 配置必然包含 TLS，直接复用 HTTP/2 实现
    this.server = Bun.serve({
      port:     this.options.port,
      hostname: this.options.hostname,
      tls:      this.buildTlsOptions(),
      fetch:    async (req, server) => {
        this.activeRequests++;
        try {
          return await bunKoaBridge(this.app, req, server);
        } finally {
          this.activeRequests--;
        }
      },
      error: (error) => {
        this.logger.error('Unhandled error', {}, error);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
  }

  private buildTlsOptions() {
    const keyPath  = this.options.ssl?.key;
    const certPath = this.options.ssl?.cert;
    if (!keyPath || !certPath) {
      throw new Error('TLS key and cert are required');
    }
    return {
      key:  Bun.file(keyPath),
      cert: Bun.file(certPath),
      ca:   this.options.ssl?.ca ? Bun.file(this.options.ssl.ca) : undefined,
    };
  }
}
```

---

### 5.7 WebSocket/WSS → BunWsServer（架构变化最大）

> **v3：v4.0 不实施。** 现有 `WsServer`（`ws` 库 + `node:http` 的 `upgrade` 事件 + `noServer` 模式）在 Bun 1.3.14 上可用（E-13），服务端能正确收到 `Origin` 请求头。本节的原生重写只有在"客户端与服务端分离"的压测显示消息吞吐有显著提升（≥ 30%）时才考虑，并且必须保持与现有 `WsServer` 相同的 Origin 校验、消息大小限制和心跳语义（参见加固方案 SEC 系列）。
>
> **测试注意**：Bun 自带的 `ws` 客户端垫片会忽略 `new WebSocket(url, { origin })` 中的 `origin` 选项。在 Bun 下编写 Origin 校验测试时，必须通过 `headers: { Origin: ... }` 发送，或改用 Node 客户端或 curl。

**文件**：`src/server/bun-ws.ts`

**核心架构差异**：

| | 现有 WsServer（Node.js） | BunWsServer |
|--|--|--|
| 底层 | `ws` 库 + 独立 HTTP server | Bun.serve() 内建 WebSocket |
| 端口 | WS 与 HTTP 可分离 | **必须共享同一端口** |
| 升级 | HTTP server 发出 `upgrade` 事件 | `fetch` handler 中调用 `server.upgrade(req)` |
| 消息 | EventEmitter（`ws.on('message', ...)`) | 回调函数（`websocket.message(ws, msg)`） |
| 发布/订阅 | 需手动实现 | Bun 内建 `ws.subscribe()`/`server.publish()` |

```typescript
import type { Server as BunServer, ServerWebSocket } from 'bun';
import { EventEmitter } from 'node:events';
import { KoattyApplication, NativeServer } from 'koatty_core';
import { generateTraceId } from '../utils/logger';
import { BaseServer, ConfigChangeAnalysis } from './base';
import { ConfigHelper, ListeningOptions, WebSocketServerOptions } from '../config/config';
import { bunKoaBridge } from '../adapter/bun-koa-bridge';

// WebSocket 连接元数据
interface WsConnectionData {
  connectionId: string;
  url: string;
  headers: Record<string, string>;
  connectedAt: number;
}

export class BunWsServer extends BaseServer<WebSocketServerOptions, BunServer> {
  private activeWsConnections = new Map<string, ServerWebSocket<WsConnectionData>>();
  private activeRequests = 0;

  constructor(app: KoattyApplication, options: WebSocketServerOptions) {
    super(app, options);
    this.options = ConfigHelper.createWebSocketConfig(options);
    this.initializeServer();
  }

  protected initializeConnectionPool(): void {
    // Bun 内部管理 WebSocket 连接
    this.logger.debug('Bun manages WebSocket connections internally');
  }

  protected createProtocolServer(): void {
    const isSecure = this.options.protocol === 'wss';

    this.server = Bun.serve({
      port:     this.options.port,
      hostname: this.options.hostname,
      tls:      isSecure ? this.buildTlsOptions() : undefined,

      // HTTP 请求走 Koa；WebSocket 握手在此触发升级
      fetch: async (req: Request, server: BunServer): Promise<Response | undefined> => {
        if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
          const connectionId = generateTraceId();
          const upgraded = server.upgrade(req, {
            data: {
              connectionId,
              url:         req.url,
              headers:     Object.fromEntries(req.headers.entries()),
              connectedAt: Date.now(),
            } satisfies WsConnectionData,
          });
          if (upgraded) return undefined; // 已升级，Bun 不需要返回 Response
          return new Response('WebSocket upgrade failed', { status: 400 });
        }

        // 普通 HTTP 请求走 Koa 中间件链
        this.activeRequests++;
        try {
          return await bunKoaBridge(this.app, req, server);
        } finally {
          this.activeRequests--;
        }
      },

      // Bun 原生 WebSocket 处理器
      websocket: {
        maxPayloadLength: this.options.wsOptions?.maxPayload as number ?? 16 * 1024 * 1024,
        idleTimeout:      120,

        open: (ws: ServerWebSocket<WsConnectionData>) => {
          this.activeWsConnections.set(ws.data.connectionId, ws);
          this.logger.debug('WebSocket connected', {}, {
            connectionId: ws.data.connectionId,
            total: this.activeWsConnections.size,
          });

          // 将 Bun ServerWebSocket 适配为 koatty 需要的接口
          const adapted = new BunWsAdapter(ws);
          (this.app as any).emit('connection', adapted, {
            url: ws.data.url,
            headers: ws.data.headers,
          });
        },

        message: (ws: ServerWebSocket<WsConnectionData>, message: string | Buffer) => {
          const adapted = new BunWsAdapter(ws);
          this.handleWsMessage(adapted, message, ws.data);
        },

        close: (ws: ServerWebSocket<WsConnectionData>, code: number, reason: string) => {
          this.activeWsConnections.delete(ws.data.connectionId);
          this.logger.debug('WebSocket disconnected', {}, {
            connectionId: ws.data.connectionId,
            code,
            reason,
            remaining: this.activeWsConnections.size,
          });
        },

        drain: (_ws: ServerWebSocket<WsConnectionData>) => {
          // 背压释放，可恢复发送
        },
      },

      error: (error: Error) => {
        this.logger.error('Server error', {}, error);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
  }

  /**
   * 处理 WebSocket 消息，通过 app.callback('ws') 走中间件链
   */
  private handleWsMessage(
    adapted: BunWsAdapter,
    message: string | Buffer,
    data: WsConnectionData,
  ): void {
    // 构建伪 req/res 对象，与现有 WsServer 的 message handler 行为一致
    const pseudoReq: any = {
      method: 'MESSAGE',
      url: '/',
      headers: data.headers,
      socket: adapted,
      websocket: adapted,
      wsData: message,
      wsConnectionId: data.connectionId,
    };

    const pseudoRes: any = {
      writeHead: () => {},
      setHeader: () => {},
      end: (responseData?: any) => {
        if (responseData != null) {
          try {
            adapted.send(typeof responseData === 'string'
              ? responseData
              : JSON.stringify(responseData));
          } catch (error) {
            this.logger.error('Error sending WS response', {}, error);
          }
        }
      },
      websocket: adapted,
      finished: false,
    };

    const wsHandler = this.app.callback('ws');
    wsHandler(pseudoReq, pseudoRes).catch((error: Error) => {
      this.logger.error('WS message handling error', {}, {
        connectionId: data.connectionId,
        error: error.message,
      });
    });
  }

  // ... 其余抽象方法实现与 BunHttpServer 结构一致

  protected configureServerOptions(): void { /* Bun 在创建时配置完毕 */ }

  protected analyzeConfigChanges(
    changedKeys: (keyof WebSocketServerOptions)[],
    _oldConfig: WebSocketServerOptions,
    _newConfig: WebSocketServerOptions,
  ): ConfigChangeAnalysis {
    const criticalKeys: (keyof ListeningOptions)[] = ['hostname', 'port', 'protocol'];
    if (changedKeys.some(key => criticalKeys.includes(key as keyof ListeningOptions))) {
      return {
        requiresRestart: true,
        changedKeys: changedKeys as string[],
        restartReason: 'Critical network configuration changed',
        canApplyRuntime: false,
      };
    }
    return { requiresRestart: false, changedKeys: changedKeys as string[], canApplyRuntime: true };
  }

  protected onRuntimeConfigChange(
    _analysis: ConfigChangeAnalysis,
    _newConfig: Partial<WebSocketServerOptions>,
    traceId: string,
  ): void {
    this.logger.info('Bun WS runtime config updated', { traceId });
  }

  protected extractRelevantConfig(config: WebSocketServerOptions) {
    return {
      hostname: config.hostname,
      port: config.port,
      protocol: config.protocol,
      isSecure: config.protocol === 'wss',
    };
  }

  protected async stopAcceptingNewConnections(traceId: string): Promise<void> {
    this.logger.info('Stopping new connections', { traceId });
    this.status = 0;
  }

  protected async waitForConnectionCompletion(timeout: number, traceId: string): Promise<void> {
    const startTime = Date.now();
    while (this.activeWsConnections.size > 0 || this.activeRequests > 0) {
      if (Date.now() - startTime >= timeout) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  protected async forceCloseRemainingConnections(traceId: string): Promise<void> {
    // 关闭所有活跃 WebSocket 连接
    for (const [id, ws] of this.activeWsConnections) {
      try {
        ws.close(1001, 'Server shutting down');
      } catch { /* ignore */ }
    }
    this.activeWsConnections.clear();

    // 停止 Bun server
    if (this.server) {
      await this.server.stop(this.activeRequests > 0);
    }
  }

  protected forceShutdown(traceId: string): void {
    for (const [_, ws] of this.activeWsConnections) {
      try { ws.close(1001, 'Forced shutdown'); } catch { /* ignore */ }
    }
    this.activeWsConnections.clear();
    this.server?.stop(true);
    this.stopMonitoringAndCleanup(traceId);
  }

  protected getActiveConnectionCount(): number {
    return this.activeWsConnections.size + this.activeRequests;
  }

  Start(listenCallback?: () => void): any {
    this.startTime = Date.now();
    this.status = 200;

    const proto = this.options.protocol.toUpperCase();
    const urlProto = this.options.protocol === 'wss' ? 'wss' : 'ws';
    const url = `${urlProto}://${this.options.hostname || '127.0.0.1'}:${this.options.port}/`;
    this.logger.info(`Server: ${proto} running at ${url}`, {});

    listenCallback?.();
    return this.server;
  }

  getStatus(): number { return this.status; }
  getNativeServer(): NativeServer { return this.server as any; }

  async destroy(): Promise<void> {
    const traceId = generateTraceId();
    try { await this.gracefulShutdown(); }
    catch (error) { this.logger.error('Destroy error', { traceId }, error); throw error; }
  }

  private buildTlsOptions() {
    const keyPath  = this.options.ssl?.key;
    const certPath = this.options.ssl?.cert;
    if (!keyPath || !certPath) throw new Error('TLS key and cert required for WSS');
    return {
      key:  Bun.file(keyPath),
      cert: Bun.file(certPath),
      ca:   this.options.ssl?.ca ? Bun.file(this.options.ssl.ca) : undefined,
    };
  }
}
```

**BunWsAdapter**（保证上层路由代码无需修改）：

```typescript
// src/adapter/bun-ws-adapter.ts
import type { ServerWebSocket } from 'bun';
import { EventEmitter } from 'node:events';

/**
 * 将 Bun ServerWebSocket 适配为 koatty_router 需要的接口
 * 关键：需要实现 EventEmitter 接口，因为 koatty_router 的 WS 路由
 * 依赖 ws.on('message', ...) 模式
 */
export class BunWsAdapter extends EventEmitter {
  constructor(private readonly ws: ServerWebSocket<any>) {
    super();
  }

  send(data: string | Buffer | ArrayBuffer): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  get remoteAddress(): string {
    return this.ws.remoteAddress;
  }

  /**
   * 订阅 Bun 内建的 pub/sub topic
   */
  subscribe(topic: string): void {
    this.ws.subscribe(topic);
  }

  /**
   * 退订 Bun 内建的 pub/sub topic
   */
  unsubscribe(topic: string): void {
    this.ws.unsubscribe(topic);
  }

  /**
   * 发布消息到 topic（利用 Bun 内建 pub/sub，比手动广播高效）
   */
  publish(topic: string, data: string | Buffer): void {
    this.ws.publish(topic, data);
  }

  /**
   * 获取底层 Bun ServerWebSocket 实例
   */
  get raw(): ServerWebSocket<any> {
    return this.ws;
  }
}
```

> **为什么继承 EventEmitter**：现有 `koatty_router` 的 WebSocket 路由处理使用 `ws.on('message', handler)` 模式（基于 `ws` 库的 EventEmitter 接口）。Bun 的 `ServerWebSocket` 不使用 EventEmitter，事件通过 `websocket` handler 的回调函数处理。`BunWsAdapter` 继承 `EventEmitter` 桥接两种模式，在 `BunWsServer.websocket.message` 回调中手动 `emit('message', data)` 触发上层监听器。

---

### 5.8 gRPC → 兼容运行

**文件**：`src/server/grpc.ts`（在 bun 分支中修改现有文件）

`@grpc/grpc-js` 是纯 JS 实现（无原生 C++ 扩展），经 Bun 的 `node:net / node:tls / node:http2` 兼容层可运行，**现有 GrpcServer 代码无需重写**，仅增加 Bun 运行时提示和兼容性守卫：

```typescript
protected createProtocolServer(): void {
  if (typeof Bun !== 'undefined') {
    this.logger.warn(
      '[GrpcServer] Running @grpc/grpc-js on Bun via Node.js compat layer. ' +
      'Functional compatibility is maintained but performance may differ from Node.js.'
    );

    // 在 Bun 下禁用不稳定的功能
    if (this.options.ext?.enableBidiStreaming) {
      this.logger.warn(
        '[GrpcServer] Bidirectional streaming on Bun may be unstable. ' +
        'Recommend using Unary/ServerStreaming only, or running gRPC on Node.js.'
      );
    }
  }
  // 以下与现有 GrpcServer 完全相同
  this.server = new Server(this.buildChannelOptions());
}
```

> **已知限制**（来自兼容性评估）：
> - `@grpc/grpc-js` 内部依赖 `node:net`、`node:tls`、`node:http2`，Bun compat 层已支持
> - 双向流（Bidirectional Streaming）是最高风险场景
> - ALB/Envoy 代理后可能出现 Protocol Error
> - **验收条件**：CI 中 Bun 环境下 Unary + ServerStreaming 测试通过

---

### 5.9 serve.ts 工厂更新（运行时分发）

```typescript
// src/server/serve.ts — createServerInstance() 增加 Bun 分支
private createServerInstance(protocolType: string, options: ListeningOptions): any {

  if (typeof Bun !== 'undefined') {
    // 延迟导入，避免 Node.js 环境加载 Bun 类型报错
    const { BunHttpServer }  = require('./bun-http');
    const { BunHttpsServer } = require('./bun-https');
    const { BunHttp2Server } = require('./bun-http2');
    const { BunHttp3Server } = require('./bun-http3');
    const { BunWsServer }    = require('./bun-ws');

    const bunServerMap: Record<string, any> = {
      http:    BunHttpServer,
      https:   BunHttpsServer,
      http2:   BunHttp2Server,
      http3:   BunHttp3Server,   // 内部降级到 http2 + warning
      ws:      BunWsServer,
      wss:     BunWsServer,
      graphql: BunHttpServer,    // GraphQL 底层是 HTTP
      grpc:    GrpcServer,       // 保持原实现，经 Node compat 层运行
    };
    const BunServerClass = bunServerMap[protocolType] ?? BunHttpServer;
    return new BunServerClass(this.app, options);
  }

  // Node.js 原有映射（不变）
  const serverMap: Record<string, any> = {
    grpc:    GrpcServer,
    ws:      WsServer,
    wss:     WsServer,
    https:   KoattyHttpsServer,
    http2:   Http2Server,
    http3:   Http3Server,
    http:    KoattyHttpServer,
    graphql: KoattyHttpServer,
  };
  return new (serverMap[protocolType] ?? KoattyHttpServer)(this.app, options);
}
```

> **注意**：使用 `require()` 延迟导入 Bun 服务器类，确保在 Node.js 环境下不会因缺少 `bun` 类型而报错。各 Bun 服务器文件顶部的 `import type` 仅用于类型检查，不产生运行时依赖。

---

## 6. Phase 4 — 可观测性适配

> **背景**（来自兼容性评估 风险 1）：`koatty_trace` 深度依赖 OpenTelemetry Node.js SDK，`@opentelemetry/sdk-node` 官方不支持 Bun，auto-instrumentation 依赖 Node.js `--require` 预加载和 CJS 模块拦截。

### 6.1 影响范围

| 功能 | Node.js | Bun |
|------|---------|-----|
| Auto-Instrumentation（Koa/HTTP/gRPC） | ✅ | ❌ 不可用 |
| 手动 Span 创建 | ✅ | ✅ 可用 |
| Prometheus 指标导出 | ✅ | ⚠️ 需验证 |
| OTLP Trace 导出 | ✅ | ⚠️ 需验证 |
| Console 导出 | ✅ | ✅ 可用 |

### 6.2 Bun 可观测性方案

**策略**：在 `koatty_trace/bun` 分支中，用 Programmatic SDK 初始化替代 Auto-Instrumentation。

```typescript
// koatty_trace/bun: src/BunTraceSetup.ts

import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { KoaInstrumentation } from '@opentelemetry/instrumentation-koa';

/**
 * Bun 环境下的 OpenTelemetry 手动初始化
 * 替代 auto-instrumentation 的 --require 预加载机制
 */
export function initBunTracing(options: {
  serviceName: string;
  otlpEndpoint?: string;
  prometheusPort?: number;
  enableKoaInstrumentation?: boolean;
}) {
  const resource = new Resource({
    'service.name': options.serviceName,
    'runtime.name': 'bun',
    'runtime.version': typeof Bun !== 'undefined' ? Bun.version : 'unknown',
  });

  // 手动配置 instrumentations（不使用 auto-instrumentations-node）
  const instrumentations = [];
  if (options.enableKoaInstrumentation) {
    // KoaInstrumentation 需要在 Bun 下手动注册，
    // 而非通过 --require 自动 monkey-patch
    instrumentations.push(new KoaInstrumentation());
  }

  const sdk = new NodeSDK({
    resource,
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: options.otlpEndpoint || 'http://localhost:4318/v1/traces',
      })
    ),
    instrumentations,
    // 关键：不使用 --preload 或 auto-detection
  });

  sdk.start();

  // 注册 Bun 进程退出钩子
  if (typeof Bun !== 'undefined') {
    process.on('SIGTERM', async () => {
      await sdk.shutdown();
      process.exit(0);
    });
  }

  return sdk;
}
```

### 6.3 降级告警

在 Bun 环境下，`koatty_trace` 应在启动时输出明确的能力降级告警：

```typescript
if (typeof Bun !== 'undefined') {
  logger.warn(
    '[koatty_trace] Running on Bun runtime. The following features are degraded:\n' +
    '  - Auto-instrumentation: DISABLED (using manual instrumentation)\n' +
    '  - HTTP auto-tracing: DISABLED (use manual span creation)\n' +
    '  - gRPC auto-tracing: DISABLED\n' +
    'See: https://koatty.org/docs/bun-observability for details.'
  );
}
```

### 6.4 验收标准

1. 手动创建的 Span 能正确导出到 OTLP Collector
2. Prometheus `/metrics` 端点可正常访问（通过 `SingleProtocolServer.getMetrics()`）
3. `KoaInstrumentation` 手动注册后，请求链路中可见 Koa 中间件 Span
4. 服务启动时有明确的功能降级日志

---

## 7. Phase 5 — koatty-ai 适配

### 7.1 新增 `--runtime bun` 参数

```bash
koatty new my-app --runtime bun
# 简写
koatty new my-app -r bun
```

`src/cli/commands/new.ts` 改动：

```typescript
program
  .command('new <project-name>')
  .option('-r, --runtime <runtime>', '目标运行时 (node|bun)', 'node')
  .action(async (projectName, options) => {
    const runtime = options.runtime?.toLowerCase() ?? 'node';
    if (!['node', 'bun'].includes(runtime)) {
      console.error(`不支持的 runtime: ${runtime}，可选 node|bun`);
      process.exit(1);
    }
    const templateType = runtime === 'bun' ? 'project-bun' : 'project';
    // 后续使用 templateType 加载模板
  });
```

### 7.2 TemplateManager 新增 bun 模板仓库

`src/services/TemplateManager.ts` 改动：

```typescript
private static readonly TEMPLATE_REPOS = {
  // 现有模板（不变）
  project: {
    github: 'https://github.com/koatty/koatty-ai-template-project.git',
    gitee:  'https://gitee.com/koatty/koatty-ai-template-project.git',
  },
  modules: { /* ... */ },
  component: { /* ... */ },

  // 新增 Bun 项目模板
  'project-bun': {
    github: 'https://github.com/koatty/koatty-ai-template-project-bun.git',
    gitee:  'https://gitee.com/koatty/koatty-ai-template-project-bun.git',
  },
};
```

### 7.3 Bun 项目模板内容

**新建仓库**：`koatty/koatty-ai-template-project-bun`

```
koatty-ai-template-project-bun/
├── package.json.hbs
├── bunfig.toml.hbs
├── tsconfig.json.hbs
├── README.md.hbs
├── src/
│   ├── App.ts.hbs
│   ├── config/
│   │   └── config.ts.hbs
│   ├── controller/
│   │   └── HomeController.ts.hbs
│   └── service/
│       └── TestService.ts.hbs
└── test/
    └── App.test.ts.hbs
```

**`package.json.hbs`** 关键差异：

```json
{
  "name": "{{projectName}}",
  "version": "1.0.0",
  "description": "application created by koatty (bun runtime)",
  "main": "src/App.ts",
  "scripts": {
    "dev":   "bun run --watch src/App.ts",
    "start": "bun run src/App.ts",
    "build": "bun build src/App.ts --outdir dist --target bun",
    "test":  "bun test"
  },
  "engines": {
    "bun": ">=1.1.0"
  },
  "license": "BSD-3-Clause",
  "dependencies": {
    "koatty-bun": "^1.0.0",
    "reflect-metadata": "^0.2.0",
    "tslib": "^2.6.0"
  },
  "devDependencies": {
    "bun-types":   ">=1.1.0",
    "@types/node": "^22.0.0"
  }
}
```

> **v3 修正**：上面的 `package.json` 与下面的 `tsconfig.json` 以文首勘误 E 为准。主要变化：① `build` 不能用 `bun build` 打单文件，否则 Loader 扫描不到组件，改用 `tsc`；② 依赖 `koatty` 而不是 `koatty-bun`；③ `engines.bun >= 1.3.0`；④ `bun-types` 改为 `@types/bun`；⑤ 装饰器模式由 CLI 的 `--decorators legacy|tc39` 选择，与运行时无关。
>
> **与 Node 模板的关键区别**：
> - ~~依赖 `koatty-bun` 替代 `koatty`~~（v3：两者都依赖 `koatty`）
> - 无 `tsx`、`ts-jest`、`cross-env`（Bun 原生支持 TS 和测试）
> - 无 `rimraf`（`bun build` 无需预清理）
> - scripts 使用 `bun run` 替代 `npm run`

**`bunfig.toml.hbs`**：

```toml
# Bun 配置文件
[install]
# 包管理镜像（可选）
# registry = "https://registry.npmmirror.com"

[test]
# 测试超时（毫秒）
timeout = 5000

[run]
# 启动时自动加载环境变量
# bun run 会自动读取 .env 文件
```

**`tsconfig.json.hbs`**：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

---

## 8. Phase 6 — Monorepo 基础设施

### 8.1 pnpm-workspace.yaml

无需修改，`packages/*` 通配符已包含 `packages/koatty-bun`。

### 8.2 turbo.json 构建依赖图

现有 `turbo.json` 已使用 `^build` 依赖链，`koatty-bun` 依赖 `koatty`、`koatty_core`、`koatty_serve`，turbo 会自动按拓扑顺序构建，无需额外配置。

### 8.3 CI — Bun 测试矩阵

> **v3**：CI 以整合方案 v2.0 附录 D 为准。下面的 YAML 有三处问题：① `bun test` 没有 `--grep` 参数，对应的是 `-t` / `--test-name-pattern`；② 依赖安装应统一用 pnpm，仓库同时存在三份锁文件，`bun install --frozen-lockfile` 容易与 pnpm 的结果不一致；③ 最低版本应为 `1.3.x`。另外，现有测试基于 ts-jest，能否直接用 `bun test` 运行需要在 Phase 0 评估。

`.github/workflows/ci.yml` 新增（在现有 `lint` / `test` / `build` 三个 job 基础上添加）：

```yaml
jobs:
  # ... 现有 lint, test, build jobs ...

  test-bun:
    name: Test on Bun
    runs-on: ubuntu-latest
    strategy:
      matrix:
        bun-version: [latest, '1.1.0']  # 测试最低支持版本 + 最新版
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ matrix.bun-version }}

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build koatty-bun and dependencies
        run: bun run build --filter=koatty-bun...

      - name: Test koatty-bun
        run: bun test packages/koatty-bun

      - name: Test koatty_serve (Bun servers)
        run: bun test packages/koatty-serve --grep "Bun"

      - name: Test gRPC compatibility on Bun
        run: bun test packages/koatty-serve --grep "gRPC.*Bun"
        continue-on-error: true  # gRPC 在 Bun 上有已知风险

      - name: Verify decorator metadata
        run: bun test packages/koatty-container --grep "reflect-metadata"

  benchmark-bun:
    name: Performance Benchmark
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    needs: [test-bun]
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: bun install
      - name: Run comparative benchmark
        run: |
          # Node.js baseline
          node benchmarks/http-throughput.js > /tmp/node-results.json
          # Bun
          bun benchmarks/http-throughput.js > /tmp/bun-results.json
          # Compare
          bun benchmarks/compare.ts /tmp/node-results.json /tmp/bun-results.json
```

### 8.4 Changeset 配置

`koatty-bun` 自动参与 changeset 版本管理，无需额外配置。

---

## 9. 风险登记与缓解措施

基于 `bun-compatibility-assessment-2026-04-16.md` 识别的风险，结合本方案的架构设计：

| ID | 风险 | 级别 | 影响 | 缓解措施 | 状态 |
|----|------|------|------|---------|------|
| R1 | OpenTelemetry auto-instrumentation 不兼容 | ~~**关键**~~ **中**（v3） | ~~丢失自动链路追踪、指标采集~~ v3：只缺出站 HTTP/DB 的 Span；框架中间件 Span 与指标不受影响 | Bun 下关闭 auto 并告警；出站调用手动埋点 | 方案已设计 |
| R2 | gRPC 双向流不稳定 | **高** | 生产 gRPC 服务可能异常 | gRPC 不重写；Phase 0 实测三种流式模式；不稳定就把 Bun 下的 gRPC 标注为 beta | 待实测 |
| R3 | HTTP/3 (QUIC) 不可用 | ~~**高**~~ **低**（v3） | HTTP/3 协议无法使用 | 降级到**现有 `Http2Server`**（v3：不是基于 `Bun.serve` 的实现） | 方案已设计 |
| R4 | Decorator Metadata 行为变化 | ~~**中**~~ **低**（v3） | IoC 容器注入异常 | v3：E-09 实测正常；CI 固化 compat-probe | 已验证 |
| R5 | `ws` 库与 Bun 原生 WS 的接口差异 | ~~**中**~~ 不适用（v3） | — | v3：继续使用 `ws` 库，不引入 Bun 原生 WS | 关闭 |
| R6 | BunKoaBridge 方案 B 的 mock 完整性 | 不适用（v3） | — | v3：方案 B 作废 | 关闭 |
| R7 | `winston-daily-rotate-file` 文件轮转兼容性 | **低** | 日志文件轮转异常 | Phase 0 验证；降级为 winston 基础 file transport | 待验证 |
| R8 | `process.execArgv` Bun 兼容性 | 不适用（v3） | — | v3：Bun 支持 | 关闭 |
| R9（v3） | Bun 转译器忽略 `useDefineForClassFields: false`（E-10） | **中** | 未装饰字段遮住原型值 | `overridePrototypeValue` 兜底 + 源码运行与 dist 运行两套 fixture | 待实施 |
| R10（v3） | Bun 的 `ws` 客户端忽略 `origin` 选项（E-13） | **中** | Origin 校验测试假通过或假失败 | Bun 下的测试用 `headers: { Origin }`（已实测可用） | 待实施 |
| R11（v3） | `bun build` 打包导致 Loader 扫描不到组件 | **高** | 应用启动但没有路由与服务 | 模板用 `tsc` 构建；`koatty doctor` 检测单文件 bundle | 待实施 |
| R12（v3） | 优雅关闭行为差异 | **中** | 发布时连接被强制中断 | Phase 0 实测 + 专项用例 | 待实测 |

### 回退策略

若 Bun 适配在某个阶段遇到阻断性问题：

1. ~~**包级回退**：`koatty-bun` 的 `package.json` 将依赖切回 Node.js 版本（去掉 `@bun` dist-tag）~~（v3：不再有单独的包和 dist-tag）
2. **用户级回退**（v3）：同一份 dist 改用 `node dist/App.js` 启动，应用代码与依赖都不用改
3. **功能级回退**：特定协议（如 gRPC）可配置为仅在 Node.js 下启用；或在文档中把该协议在 Bun 下标注为 beta

---

## 10. 性能基准测试计划

### 10.1 测试目标

> **v3：下表中的倍数目标作废。** 同机实测（autocannon `-c100 -d8 -w4`，hello-world）结果：Node 22 + Koa 为 42.5k req/s（p99 4ms）；Bun 1.3.14 + Koa（`node:http`）为 45.0k req/s（p99 4ms）；原生 `Bun.serve` 为 47.4k req/s（p99 2ms）。客户端与服务端在同一台机器上，结果只能说明量级。倍数目标改为"不退化"门禁，以整合方案 v2.0 §8 为准：C4 相对 C1、C3 相对 C2 在任一场景退化超过 5% 就要调查；原生 `Bun.serve` 原型在完整中间件栈下提升 ≥ 30%，才立项原生路径。

| 场景 | 目标指标（v2，已作废） | 基准（Node.js） |
|------|---------|----------------|
| HTTP QPS（hello world） | > 2x Node.js | `HttpServer` 当前值 |
| HTTP QPS（Koa 中间件链 5 层） | > 1.5x Node.js | `HttpServer` + middleware |
| HTTP 延迟 P99 | < Node.js P99 | `HttpServer` P99 |
| WebSocket 连接数 | >= Node.js | `WsServer` 当前值 |
| WebSocket 消息吞吐 | > 1.5x Node.js | `WsServer` 当前值 |
| 启动时间 | < 0.5x Node.js | `koatty` 冷启动时间 |
| 内存占用（idle） | < Node.js | `koatty` 空闲内存 |

### 10.2 测试工具

- **HTTP**：[bombardier](https://github.com/codesenberg/bombardier) 或 `wrk`
- **WebSocket**：[websocat](https://github.com/vi/websocat) + 自定义压测脚本
- **对比框架**：同时测试 `koatty` (Node) vs `koatty-bun` (Bun)

### 10.3 测试矩阵

> **v3**：GitHub Actions 的 2 vCPU 共享机器上，压测客户端与服务端会争抢 CPU，数据噪声大，只适合做回归趋势，不适合给出绝对结论。发布前的基准要在独立机器上运行，客户端与服务端分离或绑定到不同 CPU 核，每个场景 3 轮取中位数。

```
环境：
  - 硬件：GitHub Actions ubuntu-latest (2 vCPU, 7GB RAM)
  - Node.js: v22 LTS
  - Bun: latest stable

场景：
  1. bare HTTP (无中间件)
  2. 5 层 Koa 中间件 (logger, auth, validation, handler, error)
  3. JSON 序列化 (1KB / 10KB / 100KB payload)
  4. WebSocket echo (10/100/1000 并发连接)
  5. 冷启动时间 (time to first request)

关键对比：
  - 方案 A (node:http compat) vs 方案 B (Bun.serve native)
  - 方案 A vs 原生 Node.js HttpServer
```

### 10.4 决策门限

| 对比 | 条件 | 决策 |
|------|------|------|
| 方案 A vs Node.js | 性能差距 < 5% | 保持方案 A（工程简单） |
| 方案 A vs Node.js | 性能差距 5-15% | 根据用户反馈决定 |
| 方案 A vs Node.js | 性能差距 > 15% | 迁移到方案 B |
| 方案 B vs 方案 A | 方案 B 提升 < 10% | 不值得迁移 |
| 方案 B vs 方案 A | 方案 B 提升 >= 10% | 迁移到方案 B |

---

## 11. 测试策略

### 11.1 测试层次

| 层次 | 覆盖范围 | 工具 | 运行环境 |
|------|---------|------|---------|
| 单元测试 | 各 BunXxxServer 类、BunKoaBridge、BunWsAdapter | `bun:test` | Bun |
| 集成测试 | 服务器启动/停止、HTTP 请求响应、WS 连接 | `bun:test` + fetch | Bun |
| E2E 测试 | 完整 koatty-bun 应用启动、路由、中间件 | `bun:test` + supertest | Bun |
| 兼容测试 | gRPC Unary/Streaming、reflect-metadata、winston | `bun:test` | Bun |
| 对比测试 | 同一测试用例在 Node.js 和 Bun 下运行 | jest + `bun:test` | Both |

### 11.2 关键测试用例

```typescript
// packages/koatty-serve/test/bun-http.test.ts
import { describe, test, expect } from 'bun:test';

describe('BunHttpServer', () => {
  test('should start and respond to HTTP requests', async () => {
    // 创建 BunHttpServer，发送 fetch 请求，验证响应
  });

  test('should handle concurrent requests', async () => {
    // 发送 100 个并发请求，验证全部成功
  });

  test('should graceful shutdown with in-flight requests', async () => {
    // 发送长请求，触发 shutdown，验证请求完成后才停止
  });

  test('should force shutdown when timeout', async () => {
    // 发送不结束的请求，触发 shutdown(timeout=100ms)，验证强制终止
  });
});

describe('BunWsServer', () => {
  test('should upgrade HTTP to WebSocket', async () => {
    // 发送 WS 连接请求，验证升级成功
  });

  test('should route messages through Koa middleware chain', async () => {
    // 发送 WS 消息，验证经过中间件处理
  });

  test('should handle HTTP and WS on same port', async () => {
    // 同一端口同时发送 HTTP 和 WS 请求
  });
});

describe('BunKoaBridge', () => {
  test('should correctly convert Request to IncomingMessage', async () => {
    // 验证 headers、method、url、body 正确转换
  });

  test('should correctly convert Koa response to Response', async () => {
    // 验证 status、headers、body 正确转换
  });

  test('should handle streaming body', async () => {
    // 验证大 body 的流式传输
  });
});
```

### 11.3 验收标准

- [ ] 所有 Bun 服务器单元测试通过
- [ ] HTTP E2E 测试覆盖率 > 80%
- [ ] WebSocket E2E 测试覆盖率 > 70%
- [ ] gRPC Unary + ServerStreaming 测试通过（Bun 环境）
- [ ] reflect-metadata 装饰器测试通过
- [ ] 优雅关闭测试通过（正常 + 超时 + 强制）
- [ ] 性能基准测试完成并记录

---

## 12. 开发工作流与调试指南

### 12.1 本地开发

```bash
# 1. 克隆 monorepo
git clone --recursive https://github.com/Koatty/koatty-monorepo.git
cd koatty-monorepo

# 2. 安装依赖（pnpm 用于 monorepo 管理）
pnpm install

# 3. 构建基础依赖
pnpm -r build --filter=koatty_core --filter=koatty_serve --filter=koatty

# 4. 开发 koatty-bun（使用 Bun 运行测试）
cd packages/koatty-bun
bun test --watch

# 5. 开发 Bun 服务器（在 koatty-serve 中）
cd packages/koatty-serve
bun test --watch --grep "Bun"
```

### 12.2 调试

```bash
# Bun 调试（支持 Chrome DevTools）
bun --inspect src/App.ts

# 然后在 Chrome 打开 chrome://inspect 连接调试器

# 环境变量调试日志
KOATTY_LOG_LEVEL=debug bun run src/App.ts
```

### 12.3 快速验证

创建最小测试应用验证 Bun 适配是否工作：

```typescript
// examples/bun-hello/App.ts
import { Koatty, Controller, GetMapping, ExecBootStrap } from 'koatty-bun';

@Controller('/')
class HomeController {
  @GetMapping('/')
  index() {
    return 'Hello from koatty-bun!';
  }
}

@ExecBootStrap()
class App extends Koatty {}
```

```bash
cd examples/bun-hello
bun run App.ts
# 访问 http://localhost:3000/ 验证
```

---

## 13. 实施顺序与优先级

> **v3：本章的周计划、MVP 与里程碑已被文首勘误 D（约 17 人天）与整合方案 v2.0 §5.5（Phase 2，3 周 1 人，与 TC39 Phase 1 并行）取代。** 修订后的里程碑：
>
> | 里程碑 | 交付物 | 验收标准 |
> |-------|-------|---------|
> | M1 | Phase 0 实测报告 | 整合方案 §6.1 中没有"待实测"项 |
> | M2 | C4 可运行 | `examples/bun-legacy` 不改代码在 Bun 上运行，HTTP / HTTPS / HTTP2(h2) / WS 集成测试通过 |
> | M3 | 降级与观测 | HTTP/3 → `Http2Server` 降级告警；trace 降级告警；优雅关闭用例通过 |
> | M4 | C3 可运行 | `examples/bun-tc39` 在 TC39 Phase 1 完成后通过 |
> | M5 | 发布 | 与 `koatty@4.0.0` 同版本发布，**不**另设 `koatty-bun` 包或 dist-tag |

### 阶段划分（v2 原文，仅供参考）

```
Week 1-2: 跑通最小可用版本（MVP）
  ├── koatty_core/bun: checkRuntime() + engines + NativeServer 类型扩展
  ├── koatty_serve/bun: BunHttpServer (方案A, node:http compat)
  ├── packages/koatty-bun: 框架搭建 + BunBootstrap
  └── 基础集成测试 + examples/bun-hello 验证

Week 3: WebSocket + HTTPS/HTTP2
  ├── koatty_serve/bun: BunWsServer + BunWsAdapter
  ├── koatty_serve/bun: BunHttpsServer + BunHttp2Server
  ├── koatty_serve/bun: BunHttp3Server (降级实现)
  └── WebSocket 集成测试

Week 4: 可观测性 + gRPC 验证
  ├── koatty_trace/bun: 手动 Instrumentation 方案（Phase 4）
  ├── gRPC 兼容性集成测试（Unary + ServerStreaming）
  └── reflect-metadata 稳定性测试

Week 5: 性能 + 优化
  ├── 性能基准测试（方案 A vs Node.js）
  ├── 根据结果决定是否开发方案 B (BunKoaBridge 原生版)
  ├── koatty_loader/bun: Bun.file() 优化
  └── koatty_config/bun: Bun.file() 优化

Week 6: koatty-ai + 模板
  ├── koatty-ai: --runtime bun 参数
  ├── koatty-ai: TemplateManager 新增 project-bun
  └── 新建 koatty-ai-template-project-bun 模板仓库

Week 7: CI + 文档 + 发布
  ├── CI Bun 测试矩阵 + benchmark job
  ├── npm 发布（bun dist-tag）
  └── README + 迁移指南 + API 文档
```

### 最小可用版本（MVP）交付物

完成以下即可支持最常见的 HTTP/WebSocket 场景：

1. `koatty_core/bun` — `checkRuntime()` + `NativeServer` 类型
2. `BunHttpServer` (方案 A, node:http compat)
3. `BunWsServer` + `BunWsAdapter`
4. `packages/koatty-bun` 入口包 + `BunBootstrap`
5. 基础测试通过 + examples/bun-hello 可运行

### 里程碑

| 里程碑 | 时间 | 交付物 | 验收标准 |
|--------|------|--------|---------|
| M1: MVP | Week 2 | HTTP + 入口包 | `bun run examples/bun-hello/App.ts` 成功响应 |
| M2: 全协议 | Week 3 | WS/HTTPS/HTTP2 | 各协议集成测试通过 |
| M3: 可观测 | Week 4 | Trace + gRPC | 手动 Span 可导出；gRPC Unary 测试通过 |
| M4: 优化 | Week 5 | 性能报告 + 方案决策 | benchmark 报告输出；方案 A/B 决策完成 |
| M5: 工具链 | Week 6 | koatty-ai + 模板 | `koatty new test-app -r bun` 成功 |
| M6: 发布 | Week 7 | npm 发布 | `npm install koatty-bun` 可用 |

---

## 14. 技术决策记录

> **v3 状态汇总**（详见整合方案 v2.0 附录 E）：
>
> | ADR | v3 状态 | 说明 |
> |-----|--------|------|
> | 001 | 保留并简化 | 不新建 `BunHttpServer`，直接复用现有 `HttpServer`；"损耗 > 15% 就迁移方案 B"改为整合方案 ADR-020 的 ≥ 30% 立项门槛 |
> | 002 | 撤销 | 不新建 `koatty-bun` 入口包 |
> | 003 | 保留，修订实现 | 降级目标为现有 `Http2Server`（`node:http2`），不是 `Bun.serve` |
> | 004 | 撤销 | 继续用 `ws` + `node:http` upgrade，HTTP 与 WS 端口配置语义与 Node 一致 |
> | 005 | 保留 | Bidi Streaming 的状态以 Phase 0 实测为准 |
> | 006 | 修订 | 框架自有 Span 不受影响，只关闭 auto-instrumentation；不强制 `initBunTracing()` |
> | 007 | 撤销 | 继续使用现有服务器及其连接管理 |
> | 008 | 撤销 | 不引入 `BunWsAdapter` |

### ADR-001：BunKoaBridge 初版使用方案 A（Node compat 层）

**决策**：Phase 1 使用 Bun 内建 `node:http` compat 层，直接 `createServer()` 运行 Koa。  
**理由**：工程量最小，Koa 零改动运行，连接池/优雅关闭逻辑可完全复用 `HttpServer`。  
**后续**：通过 benchmark 对比方案 A vs 方案 B vs 原生 Node.js，若方案 A 性能损耗 > 15% 则迁移方案 B。

### ADR-002：koatty-bun 作为 meta-adapter 包而非 fork

**决策**：`koatty-bun` 通过 re-export 复用 `koatty` 全部能力，仅覆盖 Bootstrap 和服务器层。  
**理由**：维护单一代码库，装饰器/DI/AOP 等核心逻辑无需复制。  
**权衡**：用户需替换 import 来源，但应用代码 0 改动。

### ADR-003：HTTP/3 降级而非报错

**决策**：Bun 下 `http3` 协议自动降级到 HTTP/2，打印 warning，不抛出错误。  
**理由**：避免现有配置了 http3 的应用在切换到 Bun 后直接崩溃；降级行为有完整日志。  
**后续**：待 Bun 支持 HTTP/3 后，替换 `BunHttp3Server.createProtocolServer()` 内部实现。

### ADR-004：BunWsServer 共享端口设计

**决策**：`BunWsServer` 的 HTTP 和 WebSocket 共享同一个 `Bun.serve()` 实例（同端口）。  
**理由**：这是 Bun 的强制约束，无法绕过。  
**影响**：当 WebSocket 和 HTTP 配置不同端口时，koatty-bun 会忽略分离端口配置并打印 warning。应在文档中明确说明此限制。

### ADR-005：gRPC 不重写，经 Node compat 层运行

**决策**：`@grpc/grpc-js` 代码保持不变，在 Bun 上通过 Node.js compat 层运行。  
**理由**：grpc-js 是纯 JS 实现，Bun 的 `node:net/tls/http2` 已支持；重写成本高且收益不确定。  
**验收条件**：在 CI 中加入 Bun 环境下的 gRPC 端对端测试，覆盖 Unary/ServerStreaming 场景。Bidirectional Streaming 标注为实验性。

### ADR-006：可观测性使用手动 Instrumentation

**决策**：在 Bun 下不使用 OpenTelemetry auto-instrumentation，改用 Programmatic SDK 初始化 + 手动 instrument。  
**理由**：`@opentelemetry/sdk-node` 官方不支持 Bun；auto-instrumentation 依赖 `--require` 预加载和 CJS monkey-patching，Bun 不兼容。  
**影响**：用户在 Bun 环境下需手动配置 tracing（`initBunTracing()`），自动链路追踪不可用。启动时输出明确的功能降级告警。

### ADR-007：Bun 服务器使用请求计数器替代用户态连接池

**决策**：Bun 服务器类（`BunHttpServer` 等）不创建 `ConnectionPoolManager` 实例，改用 `activeRequests` 计数器追踪活跃请求。  
**理由**：Bun 内部管理 HTTP 连接（使用 Zig 实现的高性能连接池），用户态连接池是冗余且可能冲突的。`BaseServer` 的连接池为 `protected` 且 `optional`（`?`），允许子类不初始化。  
**影响**：`getConnectionStats()` 返回基于请求计数的简化统计；Prometheus 指标中无连接级别详情，但有请求级别指标。

### ADR-008：BunWsAdapter 继承 EventEmitter

**决策**：`BunWsAdapter` 继承 Node.js `EventEmitter`，桥接 Bun 回调式 WebSocket 与 koatty_router 的事件式接口。  
**理由**：`koatty_router` 的 WS 路由处理代码使用 `ws.on('message', handler)` 模式（基于 `ws` 库接口），Bun 的 `ServerWebSocket` 使用回调函数而非 EventEmitter。`BunWsAdapter` 在中间做适配，使上层路由代码无需修改。  
**权衡**：引入了一层间接调用开销，但 WebSocket 消息处理本身不是性能瓶颈。

---

## 文档历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v2 | 2026-05-10 | 基于代码库结构和兼容性评估完善 |
| **v3** | **2026-09-27** | **评审修订**（基于 Bun 1.3.14 实测）：新增文首"v3 评审勘误与补充"（16 项正文错误、6 项遗漏的风险与测试项、修订后的工作清单与模板）。v4.0 改为"复用现有服务器 + 修补 + 测试"；作废 `koatty-bun` 入口包、`bun` 分支与 dist-tag、方案 B 桥接（至少 5 处功能缺陷）、基于 `Bun.serve` 的 HTTP/2（实际只协商 HTTP/1.1）、`BunWsServer` 重写、Loader/Config 的 `Bun.file()` 加速；修正 `process.execArgv`、模板 `bun build` 打包导致组件扫描失败、CI 参数（`--grep` → `-t`）与锁文件问题；性能目标改为实测驱动的"不退化"门禁；风险表新增 R9～R12 |

*本文档随实施进展持续更新。上次修订：2026-09-27 v3*
