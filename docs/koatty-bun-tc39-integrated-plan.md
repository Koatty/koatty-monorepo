# Koatty Bun + TC39 + TypeScript 7 整合实施方案

> 版本：v2.0  
> 日期：2026-09-27  
> 关联文档：[`koatty-bun-plan.md`](./koatty-bun-plan.md) v3 · [`tc39-decorator-migration-plan.md`](./tc39-decorator-migration-plan.md) v3.0 · [`koatty-hardening-and-ai-evolution-plan.md`](./koatty-hardening-and-ai-evolution-plan.md)  
> 状态：评审修订稿（v1.1 的核心前提经实测证伪，本版重写）  
> 优先级：**本文档 > 两份专题方案**。专题方案中与本文冲突的内容，以本文为准。

---

## 0. v2.0 评审结论（必读）

### 0.1 结论

1. **v1.1 的核心约束"Bun ⟹ 强制 TC39"不成立，予以撤销。** 装饰器模式由**编译器**决定（tsc / Bun 转译器 / SWC 的配置），与**运行时**无关。Bun 1.3.14 直接运行 TS 源码时完整支持 `experimentalDecorators` + `emitDecoratorMetadata` + `reflect-metadata`（证据 E-09）。把两个正交维度绑定，只会人为抬高存量项目迁移到 Bun 的门槛：原来必须先做完 12 周的 TC39 迁移，实际上零改动即可切换。
2. **Bun 适配的主体工作量远小于 v1.1 估计。** 现有基于 `node:http` / `node:http2` / `ws` 的实现可在 Bun 上直接运行（E-12、E-13）。无需重写 `BunHttpServer` / `BunWsServer` 等 5 个服务器，也不需要 Bun Request ↔ IncomingMessage 的 mock 桥接。
3. **性能收益被严重高估。** 同机实测：Koa hello-world 在 Bun 上比 Node 22 快约 6%，原生 `Bun.serve` 也只快约 11%（E-15）。v1.1 的 "C3 ≥ 2.5× C1" 验收门没有依据，已删除。"Legacy 每请求反射"的说法也不属实：路由在启动期已完成参数元数据预编译，所以 TC39 并不会带来运行时性能收益。
4. **TC39 迁移存在 v1.1 未识别的硬约束**：
   - Node 22 与 Bun 1.3 都没有原生的 `Symbol.metadata`，必须加 polyfill（E-02）；
   - `context.metadata` 是**普通对象**，并且通过原型链继承父类的元数据，直接改写继承来的数组会污染父类（E-03）；
   - **构造函数不能被装饰**，`@Inject(A, B)` 写在 constructor 上会报 TS1206（E-04）；
   - TC39 下被装饰的字段**总会**成为实例上值为 `undefined` 的自有属性，会遮住"注入到原型"的依赖（E-11）。现在全靠 `overridePrototypeValue` 兜底，这必须升级为显式契约。
5. **TypeScript 7.0 可以支持，但必须采用双编译器工具链。** TS 7.0.2 仍支持 legacy 装饰器，但不再提供经典 JS 编译 API。`ts-jest`（peer `<7`）、`typescript-eslint`（peer `<6.1.0`）、`api-extractor`（内置 5.9.3）、`ts-node` 都无法直接使用 TS7。另外 TS7 默认开启 `strict`，并移除了 `target: ES5` 和 `moduleResolution: node10`（E-05～E-08）。

### 0.2 实测证据

环境：macOS arm64；Node v22.23.1；Bun 1.3.14；typescript@7.0.2 / 6.0.3 / 5.9；实验目录 `/tmp/kr`（复现脚本见附录 A）。

| ID | 结论 | 关键输出 |
|----|------|---------|
| E-01 | TS 7.0.2 编译 legacy 装饰器 + `emitDecoratorMetadata` 无错误，`design:*` 正常生成 | `tsc --experimentalDecorators --emitDecoratorMetadata` 0 error |
| E-02 | Node 22 与 Bun 1.3 均无 `Symbol.metadata`。不加 polyfill 时，TS 生成的代码会把 `context.metadata` 置为 `undefined` | `typeof Symbol.metadata` → `undefined`（两端）；`class-decorate metadata=undefined` |
| E-03 | 加 `Symbol.metadata ??= Symbol.for("Symbol.metadata")` 后两端都可用。子类 metadata 的原型指向父类 metadata；对继承来的数组直接 `push` 会污染父类 | `parent.tags ['P','C']`（被污染）；先复制再写后 `parent.own ['p']` / `child.own ['p','c']` |
| E-04 | 构造函数装饰器不合法 | `TS1206: Decorators are not valid here.` |
| E-05 | 方法装饰器返回类型声明为 `Function` 报错 | `TS1270: ... 'Function' is not assignable to type 'void \| (() => void)'` |
| E-06 | TS7 移除 ES5 target 与 node10 解析 | `TS5108: Option 'target=ES5' has been removed`；`moduleResolution=node10` 同 |
| E-07 | TS7 的 npm 包只导出 `.` 与 `./unstable/*`，没有经典 `ts.createProgram` 等 API；依赖旧 API 的工具不兼容 | ts-jest 29.4.14 peer `>=4.3 <7`；@typescript-eslint/typescript-estree 8.70.1 peer `>=4.8.4 <6.1.0`；api-extractor 7.59.2 内置 `typescript 5.9.3`；typescript@6.0.3 已发布 |
| E-08 | 仓库用 TS7 类型检查时的新增错误来自默认 `strict`（`@sinclair/typebox` 的 TS2321，以及 koatty-router 的 `RouterConstructor`、GraphQL `formatError` 两处真实类型问题） | 已在上一轮评审中复现 |
| E-09 | Bun 1.3.14 直接运行 TS 源码时，legacy 装饰器、`design:type`、`design:paramtypes`、`reflect-metadata` 均正常 | `bun-legacy/` 实验 |
| E-10 | Bun 转译器**忽略** `useDefineForClassFields: false`：**不带装饰器**的 `x!: T` 字段会成为实例上值为 `undefined` 的自有属性（tsc 不会生成该字段）。带 legacy 装饰器的字段与 tsc 行为一致 | tsc→Node：`injected-on-prototype`；Bun 源码：`undefined`；带装饰器字段 Bun：`repo ok` |
| E-11 | TC39 模式下被装饰的字段一定成为自有属性（规范语义，与 `useDefineForClassFields` 无关，Node 与 Bun 一致），会遮住原型上的注入值 | `own field exists; value=undefined`（tsc×2 + Bun） |
| E-12 | `Bun.serve` 开 TLS 只协商 HTTP/1.1；Bun 上的 `node:http2` 能协商出 h2 | `curl --http2`：`1.1` vs `2` |
| E-13 | `ws` 库的 `noServer` + `handleUpgrade` 在 Bun 上可用，服务端能收到 `Origin`；但 Bun 自带的 `ws` 客户端垫片会忽略 `origin` 选项 | Node 客户端 `origin=http://a.test`；Bun 客户端 `origin=undefined`；curl 发 Origin 时 Bun 服务端 `http://evil.test`；Bun 客户端改用 `headers: { Origin }` 时服务端能收到 |
| E-14 | Bun 有 `process.execArgv`；Node 原生类型剥离无法运行任何装饰器源码 | `node strip.ts` → `SyntaxError at @D` |
| E-15 | 同机 hello-world（autocannon `-c100 -d8 -w4`）：Node22+Koa 42.5k req/s（p99 4ms）；Bun+Koa 45.0k（p99 4ms，约 +6%）；原生 `Bun.serve` 47.4k（p99 2ms，约 +11%） | 客户端与服务端同机，结果受客户端上限影响，只能说明量级 |

### 0.3 v1.1 → v2.0 变更摘要

| 类别 | 条目 |
|------|------|
| **撤销** | 核心定位"Bun 分支 = TC39 纯净分支"；ADR-011（Bun 强制 TC39）；ADR-015（启动期拒绝 legacy 与参数装饰器）；§2.3"废除 Bun-Legacy"；`BunRuntimeAdapter` 硬编码 `tc39`；`koatty-bun` 作为 Bun 下的必需入口；Plan B mock 桥接；`BunHttp2Server` 通过 "ALPN 自动协商"；5 个 `BunXxxServer` 重写；Loader/Config 的 `Bun.file()` 加速；性能门 "C3 ≥ 2.5× C1" |
| **修订** | ADR-010（RuntimeAdapter 缩小职责，`detect()` 永不抛错）；ADR-012（逐次调用判定模式，禁止运行时读 tsconfig）；ADR-013（关闭：reflect-metadata 是纯 JS，已实测通过）；ADR-016（构造注入替代方案改为可编译的形态）；兼容矩阵恢复为四组合 C1–C4；路线图与工作量 |
| **新增** | ADR-017 TypeScript 7 双工具链；ADR-018 `Symbol.metadata` polyfill 与元数据写入规范；ADR-019 TC39 字段注入语义契约；ADR-020 Bun 协议层"复用优先、原生按实测启用"；ADR-021 性能声明必须实测；与加固方案（ADR-107）的排期协调；附录 A 复现实验；附录 F v1.1 勘误表 |

---

## 1. 目标与非目标

### 1.1 目标

1. **TS 7.0 支持**：框架自身用 TS 7.0.x 构建与类型检查；用户项目用 TS 5.9 / 6.0 / 7.0 编译均可工作。
2. **Bun 支持**：Koatty 应用可在 Bun ≥ 1.3 上运行，legacy 与 TC39 两种装饰器模式均可。
3. **TC39 装饰器双模式**：所有框架装饰器同时支持 legacy 与 TC39 调用约定，并提供参数装饰器的替代写法。
4. **零破坏**：v3.x 的 C1 项目升级后不改代码行为一致；把运行时切到 Bun 也不需要改代码（E-10 的一种边界情况除外，见 §4.3）。

### 1.2 非目标

- 不重写 Koa，也不做 Koa → Fetch API 的 mock 桥接。
- 不在 v4 周期内移除 `reflect-metadata` 或 legacy 模式。
- 不承诺 Bun 下的 HTTP/3（Bun 没有 QUIC）。
- 不为 Bun 单独维护分支或 dist-tag（沿用 ADR-014 的否定结论）。

---

## 2. 整体架构：三个正交维度

### 2.1 维度定义

```
D0 编译器     tsc 7.0 / tsc 5.9–6.0 / Bun 内置转译器 / SWC
D1 装饰器模式 legacy (experimentalDecorators + emitDecoratorMetadata) | tc39
D2 运行时     Node ≥ 20 | Bun ≥ 1.3
D3 注入风格   由 D1 决定：legacy 可用参数装饰器；tc39 使用 DTO + 字段注入 + 类级依赖声明
```

- **D1 由 D0 的配置决定，与 D2 无关**，框架无法也不应在运行时"强制"D1。
- **D1 在同一个编译单元内是确定的**，但一个进程中可能同时存在两种模式：用户应用是 TC39，第三方插件是按 legacy 预编译的。所以框架必须**逐次调用**判定模式（ADR-012），不能全局只判定一次。
- **D0 的差异需要单独关注**：Bun 转译器与 tsc 在字段语义上不一致（E-10），Node 原生类型剥离不能运行装饰器（E-14），esbuild/tsx 不支持 `emitDecoratorMetadata`。因此 C1/C4 的开发期运行方式有限制（§6.3）。

### 2.2 支持组合

| 编号 | D1 | D2 | 注入风格 | 定位 | 支持期 |
|------|----|----|---------|------|-------|
| **C1** | legacy | Node | 参数装饰器 + 字段注入 | 现有项目、稳定生产 | v3.x + v4.x（默认） |
| **C2** | tc39 | Node | DTO + 字段注入 + 类级依赖声明 | Node 新项目 | v4.x（推荐）+ v5.x（默认） |
| **C3** | tc39 | Bun | 同 C2 | Bun 新项目 | v4.x（推荐）+ v5.x（默认） |
| **C4** | legacy | Bun | 同 C1 | 存量项目零改动切到 Bun | v4.x（支持，beta 起） |

迁移路径**不设先后顺序**：C1→C4 只换运行时；C1→C2 只迁装饰器；C2→C3 与 C4→C3 都只需一步。

> **为什么恢复 C4**：v1.1 的四条废除理由都不成立。① "对齐标准"不是技术约束。② "维护成本爆炸"：装饰器双模式代码与运行时无关，C4 与 C1 走完全相同的代码路径，唯一新增的是一个 CI job。③ "用户多数已了解 TC39"没有数据支撑。④ "DTO 是 Bun 性能最优路径"与 E-15 以及路由启动期预编译的事实不符。

### 2.3 包结构

```
packages/
├── koatty/            # 入口不变；Bootstrap 调用 RuntimeAdapter.detect()
├── koatty-core/       # RuntimeAdapter 接口 + Node/Bun 两个实现；Component 装饰器双模式
├── koatty-container/  # Symbol.metadata polyfill；元数据写入工具；字段注入契约；类级依赖声明
├── koatty-router/     # 映射与参数装饰器双模式；@Payload；DTO 提取器预编译
├── koatty-validation/ # @Validated(Dto)；setExpose TC39 路径
├── koatty-serve/      # 不新增 BunXxxServer；只在 HTTP/3 上加 Bun 降级分支，WS 做兼容修补
├── koatty-trace/      # Bun 下关闭 auto-instrumentation，只保留框架自有 Span
└── koatty-swagger/    # @ApiProperty({ type }) 在 TC39 下必填
```

**不再新增 `koatty-bun` 包作为必需入口。** 理由有二：`BunRuntimeAdapter` 只有几十行，应放在 `koatty-core`；强制用户改 import 会让预编译的 dist 在 Bun 下直接失败（v1.1 的 `detect()` 会抛错）。如果将来要做 `Bun.serve` 原生服务器（ADR-020 第 3 步），再以可选包 `koatty-bun-native` 的形式提供。

### 2.4 运行时分发

```
[应用入口]  import { ExecBootStrap } from "koatty"      ← Node 与 Bun 相同
     │
     ▼
[koatty-container 顶部 side-effect]  Symbol.metadata polyfill（ADR-018）
     │   任何装饰过的类被求值之前执行
     ▼
[Bootstrap]  app.runtime = RuntimeAdapter.detect()  ← 只识别运行时，不涉及装饰器模式
     │
     ▼
[装饰器求值]  compat.ts 按"本次调用的实参形态"分派 legacy / tc39（ADR-012）
     │           两条分支都写入同一个 MetadataStore（统一抽象）
     ▼
[Loader / IOC]  只读 MetadataStore，不关心模式；混用冲突在此处报错
     ▼
[koatty-serve]  Node / Bun 使用相同实现：node:http(s) / node:http2 / ws / grpc-js
                只有 HTTP/3 在 Bun 下降级（ADR-020）
```

---

## 3. 关键设计决策（ADR）

> 编号延续 ADR-001～016；加固方案使用 ADR-101 起，不冲突。

### ADR-009：以 compat 层为统一基础（保留）

所有双模式装饰器**必须**通过 `koatty-container/src/decorator/compat.ts` 的 `createDualClassDecorator` / `createDualMethodDecorator` / `createDualFieldDecorator`（或 `Container.createDecorator`，`container.ts:923`）实现，禁止各包自行嗅探实参。

**v2.0 补充**：
- 两条分支都必须写入同一个 `MetadataStore` 抽象。上层（Loader、Router、Validation）只读 `MetadataStore`，**不直接**读 `Reflect.getMetadata` 或 `context.metadata`。这样上层代码与 D1 解耦，未来移除 reflect-metadata 时只需改一处。
- 方法装饰器的 TC39 分支返回类型必须是 `void | ((this: This, ...args: Args) => Return)`，不得声明为 `Function`（E-05）。

### ADR-010：Bootstrap 与 RuntimeAdapter（修订）

**决策**：不建 `BunBootstrap`；在 `Bootstrap` 中注入 `app.runtime`。

**v2.0 修订**：
1. `RuntimeAdapter` **不再持有 `decoratorMode`**，因为模式不是运行时属性。
2. `RuntimeAdapter.detect()` **永不抛错**。在 Bun 下直接返回 `BunRuntimeAdapter`（位于 `koatty-core`），不依赖任何 side-effect 注册。
3. 接口只保留**确有差异**的能力，去掉 `readFile` / `resolveModule` / `loadTlsMaterial`：Bun 完全兼容 `node:fs` 与 `require`，抽象这几项没有收益。

```typescript
// packages/koatty-core/src/runtime/adapter.ts
export interface RuntimeAdapter {
  readonly name: "node" | "bun";
  readonly version: string;
  /** 协议能力探测，只用于降级决策与诊断输出 */
  readonly capabilities: {
    http3: boolean;               // Bun: false
    otelAutoInstrumentation: boolean; // Bun: false（依赖 require 钩子，默认关闭）
  };
}

export function detectRuntime(): RuntimeAdapter {
  const bun = (globalThis as { Bun?: { version: string } }).Bun;
  if (bun) {
    return { name: "bun", version: bun.version,
      capabilities: { http3: false, otelAutoInstrumentation: false } };
  }
  return { name: "node", version: process.versions.node,
    capabilities: { http3: true, otelAutoInstrumentation: true } };
}
```

### ADR-011：模板与 CLI 的模式选择（替换 v1.1 "Bun 强制 TC39"）

**决策**：`koatty new` 使用 `--runtime node|bun`（默认 node）与 `--decorators legacy|tc39`（默认 v4.x 为 legacy，v5.x 为 tc39）两个**独立**参数，四种组合都能生成可运行的项目。
- 模板只维护**一套**源码，以 Handlebars 条件区分装饰器写法与 `tsconfig`。运行时差异只体现在 `package.json` scripts 与 `engines` 上。
- Bun 模板的 `tsconfig` 显式写 `"useDefineForClassFields": false`。即使 Bun 转译器忽略它（E-10），tsc 构建与类型检查也依赖它。
- 生成代码**不得**依赖原型上的非装饰字段值（例如控制器里未装饰的 `app!: App`），因为这类值在 Bun 源码运行时会被自有属性遮住（E-10）。框架提供的基类通过 `overridePrototypeValue` 兜底，但模板不能把这个兜底当作写法依据（见 ADR-019）。

### ADR-012：装饰器模式判定（替换）

**决策**：
1. **逐次调用判定**：由 `compat.ts` 的 `isTC39Context(arg)` 根据**本次调用的实参形态**判定（第二个参数是否为带 `kind` 字段的 context 对象）。这是唯一可靠的依据，因为同一进程可能加载不同模式编译的代码。
2. **禁止在运行时读取 tsconfig**：dist 包里没有 tsconfig；tsconfig 可能用 `extends` 链或项目引用；Bun 与 SWC 可能用其他配置；一个进程中可能混有多个编译单元。原方案 B §11.10.4 与 v1.1 ADR-012/015 中的 `tryReadTsconfig()` 全部作废。
3. **类级冲突检测**：同一个类如果同时收到 legacy 与 TC39 两种形态的装饰器调用（例如继承链跨越了两个编译单元），`MetadataStore` 在首次读取该类时抛出 `MixedDecoratorModeError`，并给出类名与两种来源。
4. **按需诊断**：不设全局 `decoratorMode`。`koatty doctor` 会静态读取项目 tsconfig（此时 tsconfig 确实可读），并结合 `MetadataStore` 的统计输出"本应用 legacy 类 N 个、TC39 类 M 个"。

### ADR-013：reflect-metadata 在 Bun 下的兼容性（关闭）

reflect-metadata 是纯 JS 实现，不依赖运行时特性。E-09 已实测 Bun 1.3.14 的基础存取、继承链以及 `design:*` 均正常。本 ADR 不再作为 Phase 0 的阻断项；Phase 0 只需在 CI 中固化 E-09 的测试（附录 C）。

### ADR-014：版本号（保留）

不为 Bun 设 dist-tag 或分支版本。v4.0.0 同时支持 C1–C4。`engines` 增加 `"bun": ">=1.3.0"`（npm 会忽略未知的 engine 字段，但 Bun 与文档工具可读取）。

### ADR-015：Bun 启动期拒绝 legacy（撤销）

**撤销理由**：前提不成立（E-09）。其中三项检测也都有技术问题：读 tsconfig 不可靠（见 ADR-012）；探测 `design:*` 会误伤 legacy 预编译的依赖；扫描参数装饰器毫无必要，因为 TC39 编译单元里写参数装饰器根本通不过编译。

**替代**：启动时输出一行诊断，例如 `[koatty] runtime=bun 1.3.14 decorators: legacy=42 tc39=0`，并按 ADR-012 第 3 条检测混用冲突。

### ADR-016：参数装饰器替代契约（修订）

保留"DTO + 属性装饰器 + `@Payload` 永久支持"的承诺，并修正其中无法编译的部分：

| 原用法 | v2.0 替代 | 形态 |
|-------|----------|------|
| `@Get('page') page: number`（方法参数） | DTO 字段 `@Get({ name: 'page', type: Number }) page: number` | 字段装饰器 |
| `@RequestBody() body: T` | DTO 类不写数据源装饰器，由协议推断（§4.6） | 隐式 |
| `@Valid(...)`（方法参数） | DTO 字段验证装饰器 | 字段装饰器 |
| `constructor(@Inject() dep: T)` | **不能**把 `@Inject` 写在 constructor 上（E-04）。改用：① 字段注入 `@Autowired(() => T)`（推荐）；② 类级声明 `@Service({ inject: [() => A, () => B] })`，按顺序作为构造参数传入 | 字段 / 类装饰器 |

**TC39 参数装饰器提案**（[proposal-class-method-parameter-decorators](https://github.com/tc39/proposal-class-method-parameter-decorators)）截至本文仍在 Stage 1。本方案不承诺恢复时间，只承诺替代方案永不废弃。

### ADR-017：TypeScript 7 双工具链（新增）

**背景**：TS 7.0 是 Go 实现，npm 包只提供 `tsc` 二进制和 `typescript/unstable/*`（E-07）。

**决策**：

| 用途 | 编译器 | 说明 |
|------|-------|------|
| 构建（`tsc -b` 生成 JS + `.d.ts`）与 CI 类型检查 | **TypeScript 7.0.x** | 主编译器，速度收益最大 |
| `ts-jest`、`typescript-eslint`、`ts-node`、`api-extractor` | **TypeScript 6.0.x** | 这些工具依赖经典 API。TS 6.0.3 满足 ts-jest `<7` 与 typescript-estree `<6.1.0`。api-extractor 自带 5.9.3，可独立运行 |
| 生成代码（koatty-ai 使用 `ts-morph`） | ts-morph 内置的 TS | 不受影响 |

**落地方式（根 `package.json`）**：

```jsonc
{
  "devDependencies": {
    "typescript": "~6.0.3",                 // 供依赖经典 API 的工具解析 require("typescript")
    "typescript-7": "npm:typescript@~7.0.2" // 仅用于构建与类型检查
  },
  "scripts": {
    "typecheck": "node node_modules/typescript-7/bin/tsc -b --noEmit",
    "build:types": "node node_modules/typescript-7/bin/tsc -b"
  }
}
```

- 两个包都声明了名为 `tsc` 的 bin，**不要**依赖 `pnpm exec tsc`（名字冲突，最终指向哪个不确定），一律写明路径。
- TS7 通过 optionalDependencies 安装平台二进制（如 `@typescript/typescript-darwin-arm64`），CI 禁止使用 `--no-optional`。
- **测试转换器**：保留 ts-jest（配合 TS 6.0）作为默认，`isolatedModules: true` 以减少对类型检查的依赖。可选用 `@swc/jest` 提速：SWC 支持 legacy + `decoratorMetadata`，但它对 TC39 metadata 的支持需在 Phase 0 实测后再启用。
- **两套编译器的一致性**：CI 中用 TS7 做一次全量 `--noEmit`，再用 TS 6.0 做一次（ts-jest 实际使用的版本），两者都必须通过。

**tsconfig 调整（`tsconfig.base.json`）**：

| 选项 | 现状 | v4 要求 | 理由 |
|------|------|--------|------|
| `strict` | 未设置 | 显式 `false`，按包逐步开启 | TS7 默认 `true`（E-08），不显式关闭会让升级即报错 |
| `skipLibCheck` | 未设置 | `true` | 规避 `@sinclair/typebox@0.27` 的 TS2321（jest 29 的传递依赖）；长期方案是升级 jest 30 |
| `target` | ES2022 | 不变 | 不能用 ES5（TS5108） |
| `moduleResolution` | bundler | 不变 | 不能用 node10（TS5108） |
| `useDefineForClassFields` | false | 不变且必须保留 | legacy 模式下原型注入依赖它（ADR-019） |
| `importHelpers` | true | 不变；`tslib` ≥ 2.5（建议 2.8+） | TC39 装饰器依赖 `__esDecorate` / `__runInitializers`，这两个辅助函数从 tslib 2.5 开始提供 |

**用户项目**：CLI 模板默认生成 TS 5.9+ 均兼容的 tsconfig，并在 README 中说明 TS7 下测试与 lint 工具的限制。

### ADR-018：Symbol.metadata polyfill 与元数据写入规范（新增）

1. **polyfill**：`koatty-container` 入口第一行执行：
   ```typescript
   (Symbol as { metadata?: symbol }).metadata ??= Symbol.for("Symbol.metadata");
   ```
   - 使用 `Symbol.for` 而不是新建 `Symbol()`，这样多个副本（重复安装的 koatty_container、第三方库）得到的是同一个 symbol。
   - **求值顺序**：TS 生成的代码在**类定义求值时**读取 `Symbol.metadata`。所有导出装饰器的包（core、router、validation、swagger、serve 等）都必须在入口顶部 `import "koatty_container"`（或其中的 `polyfill` 子路径），确保只从 `koatty_validation` 导入装饰器的 DTO 文件也能先执行 polyfill。
   - 单测：polyfill 缺失时，TC39 装饰器必须抛出明确错误（`context.metadata is undefined; import "koatty_container" first`），不能静默丢失元数据。
2. **写入规范**：
   - `context.metadata` 是普通对象，**禁止**使用 `.set()` / `.get()`。
   - 键名一律使用模块私有的 `Symbol`（如 `const DTO_SOURCE = Symbol("koatty:dto-source")`），避免与其他库冲突。
   - **写前复制**：子类 metadata 的原型指向父类 metadata（E-03）。修改集合类值之前必须先判断 `Object.hasOwn(meta, KEY)`，没有自有值时复制一份再写：
     ```typescript
     function appendOwn<T>(meta: DecoratorMetadataObject, key: symbol, item: T): void {
       const own = Object.hasOwn(meta, key) ? (meta[key] as T[]) : [...((meta[key] as T[]) ?? [])];
       own.push(item);
       meta[key] = own;
     }
     ```
   - **在装饰时写入**：字段、方法元数据必须在装饰器函数体内写入 `context.metadata`，**不得**放进 `context.addInitializer`。字段装饰器的 initializer 要到每次实例化时才执行，启动期扫描会读不到（原方案 B §11.3.2 路径 2 的错误）。
   - 需要拿到类本身时（如 `IOC.saveClass`），在**类装饰器**中执行，或在类装饰器里用 `context.addInitializer`（类的 initializer 在类定义完成后执行一次）。

### ADR-019：TC39 字段注入语义契约（新增）

**事实**：
- legacy + `useDefineForClassFields: false`：被装饰且无初始值的字段不会生成代码，实例读取时会落到原型上，因此"注入到原型"可行。
- TC39：被装饰的字段总是成为自有属性，初始值为 `undefined`（E-11），会遮住原型。
- Koatty 当前把依赖定义到原型上（`autowired_processor.ts:189-216`、`values_processor.ts:59`），然后在实例化后由 `overridePrototypeValue`（`lifecycle_manager.ts:27`、`container.ts:475`）把原型值复制到值为 `undefined` 的自有属性上；延迟注入在 `appReady` 时再补写已有的单例（`autowired_processor.ts:321-329`）。**所以 TC39 模式能正确注入，完全依赖这条兜底路径。**

**决策**：
1. 把"只有 IOC 创建的实例才会完成注入"写入契约与文档。直接 `new Service()` 在 legacy 模式下能拿到原型注入，在 TC39 模式下拿不到，这是有意的行为差异。
2. TC39 分支下 `@Autowired` / `@Value` / `@Config` 装饰的字段**不允许**带初始值（`@Autowired() repo = null` 会让兜底失效）。装饰器检测到初始值不为 `undefined` 时抛错。实现方式是字段装饰器返回的 initializer 检查 `initialValue`。
3. `overridePrototypeValue` 从"工具函数"升级为**受测试保护的不变量**。新增 C2/C3 用例：单例、Prototype 作用域、延迟注入（循环依赖）、`Object.seal` 之后的补写、继承链上的注入。
4. 长期方案（v5，可选）：TC39 分支改为让字段装饰器返回 initializer，直接从容器解析；解析不到时返回惰性代理。这样就不再依赖原型。`accessor` 关键字方案（`@Autowired() accessor repo: Repo`）语义最干净，但需要用户改写法，只作为可选项评估。
5. Bun 源码运行时，未装饰字段也是自有属性（E-10）。框架代码中凡是依赖原型值的**未装饰**字段（例如用户控制器里的 `app!: App`）同样要靠 `overridePrototypeValue`，并纳入 C3/C4 用例。

### ADR-020：Bun 协议层"复用优先，原生按实测启用"（新增，替代方案 A 的 ADR-001/004/007/008 中与此冲突的部分）

| 协议 | Bun 下的实现 | 依据 |
|------|------------|------|
| HTTP / HTTPS | 现有 `HttpServer` / `HttpsServer`（`node:http(s)`） | E-15：Koa 在 Bun 上可运行，且不慢于 Node |
| HTTP/2 | 现有 `Http2Server`（`node:http2`） | E-12：`Bun.serve` 不支持 h2；`node:http2` 可用 |
| HTTP/3 | 降级到 HTTP/2 并告警（`capabilities.http3 === false`） | Bun 没有 QUIC |
| WS / WSS | 现有 `WsServer`（`ws` + `noServer`） | E-13 |
| gRPC | 现有 `GrpcServer`（`@grpc/grpc-js`，底层是 `node:http2`） | Phase 0 实测 Unary / Server Streaming / Bidi Streaming |
| GraphQL | 走 HTTP 协议 | 同 HTTP |

**分步**：
1. **v4.0**：只做上表的"复用 + 修补 + 测试"，不新增任何 `BunXxxServer`。
2. **v4.x**：Phase 0/5 的实测若发现某个协议在 Bun 下有功能缺陷，先向上游报 issue，再做**最小修补**。
3. **v4.x+（可选）**：只有当**同一台机器、客户端与服务端分离**的压测显示原生 `Bun.serve` 在 **Koatty 完整中间件栈**下有 ≥ 30% 的吞吐提升时，才启动可选包 `koatty-bun-native`。它的桥接必须支持流式请求与响应体（包括 SSE），不得把整个响应缓冲进 Blob。

### ADR-021：性能声明必须实测（新增）

- 文档与发布说明中的任何倍数，都必须附带：机器配置、客户端与服务端是否分离、工具与参数、原始数据链接。
- 决策门使用**相对阈值 + 回归阈值**（§8），不使用未经测量的绝对倍数。

---

## 4. 关键技术方案细节

### 4.1 compat 分派与 MetadataStore

```typescript
// koatty-container/src/decorator/compat.ts（示意，只修改方案，不在此提交代码）
export function isTC39Context(x: unknown): x is DecoratorContext {
  return typeof x === "object" && x !== null && "kind" in x && "metadata" in x;
}

export function createDualFieldDecorator(h: {
  legacy: (proto: object, key: string | symbol) => void;
  tc39: (ctx: ClassFieldDecoratorContext) => void | ((init: unknown) => unknown);
}) {
  return function (a: unknown, b: unknown): any {
    if (isTC39Context(b)) {
      if (b.metadata === undefined) throw new PolyfillMissingError();
      return h.tc39(b as ClassFieldDecoratorContext);
    }
    h.legacy(a as object, b as string | symbol);
  };
}
```

`MetadataStore` 的读取顺序：先读 `Class[Symbol.metadata]` 中的 Koatty 私有键（TC39），再读 `Reflect.getMetadata`（legacy）。两者都有值时抛 `MixedDecoratorModeError`（ADR-012 第 3 条）。

### 4.2 `@Autowired` 的类型参数

TC39 没有 `design:type`，类型必须显式给出：

```typescript
@Service()
class OrderService {
  @Autowired(() => UserRepository)   // 推荐：thunk 形式，避免循环 import 时的 TDZ
  private userRepo!: UserRepository;

  @Autowired("UserCache")            // 字符串标识
  private cache!: CacheService;
}
```

- `@Autowired(UserRepository)` 这种立即求值的写法也允许，但在循环 import 时，装饰器求值那一刻 `UserRepository` 可能还处于 TDZ（会抛 `ReferenceError`）或为 `undefined`。所以只要实参不是函数、字符串或类，就报错并提示改用 thunk。
- 区分 thunk 与类：类的 `Function.prototype.toString()` 以 `class` 开头；或者约定 thunk 必须是箭头函数（没有 `prototype`）。实现时两个条件同时校验。
- legacy 模式继续允许 `@Autowired()` 从 `design:type` 推断类型。
- 原 TC39 方案 §2.2 / §4.3 示例在装饰时就调用 `IOC.resolve`（该 API 不存在）解析依赖，不仅违背延迟解析，还会破坏循环依赖处理，作废。

### 4.3 构造注入的可编译替代

```typescript
// 方式 1（推荐）：字段注入，两种模式通用
@Service()
class UserService {
  @Autowired(() => UserRepository) private repo!: UserRepository;
}

// 方式 2：类级依赖声明（TC39 与 legacy 通用），用于需要不可变构造参数的场景
@Service({ inject: [() => UserRepository, () => LogService] })
class UserService {
  constructor(private readonly repo: UserRepository, private readonly log: LogService) {}
}
```

- `inject` 数组与构造参数按位置对应；数组长度与 `UserService.length` 不一致时，启动期告警（有默认参数时 `length` 不准，所以只告警不报错）。
- 构造注入不能用惰性代理打破循环依赖：发现环时报错，并提示改为字段注入。
- legacy 下 `constructor(@Inject() dep: T)` 继续可用，但标记 `@deprecated`。

### 4.4 DTO 参数装饰器（双用途：legacy 参数 + 两种模式下的字段）

`@Get` / `@Post` / `@Header` / `@PathVariable` / `@File` / `@RequestBody` / `@RequestParam` 按实参形态分派：

| 调用形态 | 判定 | 行为 |
|---------|-----|------|
| `(target, key, index: number)` | legacy 参数装饰器 | 与现状相同 |
| `(proto, key)`，其中 `key` 为 string/symbol | legacy 字段装饰器 | 写 `DTO_SOURCE`，类型可从 `design:type` 推断 |
| `(undefined, ctx)` 且 `ctx.kind === "field"` | TC39 字段装饰器 | **在装饰时**写 `ctx.metadata[DTO_SOURCE]`（写前复制），`type` 必填 |

```typescript
class UpdateUserDto {
  @PathVariable({ name: "id", type: Number }) @IsNotEmpty() id!: number;
  @Post({ name: "username", type: String }) @IsNotEmpty() username!: string;
  @Header({ name: "authorization", type: String }) token?: string;
}

@Controller("/users")
class UserController {
  @PutMapping("/:id")
  @Validated(UpdateUserDto)          // = @Payload(UpdateUserDto) + 校验
  async update(dto: UpdateUserDto) { /* ... */ }
}
```

- **提取器预编译在两种模式下都进行**，所以性能与 D1 无关。原方案"Legacy 每请求反射、TC39 零反射"的对比不成立：路由在启动期已经用 `injectParamMetaData` 预编译好参数元数据。
- `@Payload` / `@Validated(Dto)` 默认绑定第 0 个参数；如需绑定其他位置，写 `@Payload(Dto, { index: 1 })`。
- 纯请求体 DTO（没有写任何数据源装饰器）的推断规则：POST/PUT/PATCH 取 body；GET/DELETE 取 query；gRPC 与 WS 取消息体。

### 4.5 Symbol.metadata 相关的构建注意事项

- 构建产物中每个带 TC39 装饰器的类都会引用 `Symbol.metadata`，所以**先后顺序**问题同样存在于用户代码和第三方库：入口文件的第一条 import 必须是 `koatty`（模板保证这一点，`koatty doctor` 负责检查）。
- 采用 ESM 时，import 语句会被提升；只要 polyfill 位于依赖图中较早求值的模块里就有效。**不要**依赖"在 App.ts 顶部写一行赋值语句"，因为它晚于所有 import 求值。

### 4.6 Bun 下需要修补或验证的点

| 项 | 处理 |
|----|------|
| Bun 源码运行时未装饰字段成为自有属性（E-10） | ADR-019 第 5 条；C3/C4 用例覆盖 |
| `ws` 客户端垫片忽略 `origin`（E-13） | 只影响测试：在 Bun 下写的 WS 测试必须通过 `headers: { Origin }` 或 curl/Node 客户端发送 Origin；服务端 Origin 校验（加固方案 SEC 系列）在 Bun 下单独加用例 |
| 优雅关闭（`server.close` / `closeAllConnections` / `SIGTERM`） | Phase 0 实测；Bun 与 Node 对 keep-alive 连接的处理不同，需要单独用例 |
| `koatty-trace` auto-instrumentation | 依赖 `require` 钩子（require-in-the-middle），在 Bun 下默认关闭。Koatty 自身的中间件 Span 不依赖 auto-instrumentation，服务端 Span 不受影响；出站 HTTP/DB 调用的 Span 需要手动埋点，记为已知限制 |
| gRPC（grpc-js）三种流式模式 | Phase 0 实测，结果写入 §6 矩阵 |
| `winston-daily-rotate-file` 文件轮转 | Phase 0 实测 |
| Loader 的 `require(p)` 加载 `.ts`（开发模式） | Bun 原生支持，Phase 0 实测 |
| `bun build` 打成单文件 | Loader 在运行时按目录扫描并 `require` 组件（`koatty-loader/src/index.ts:54,95`），打包后组件不再是独立文件，应用会"启动成功但没有路由与服务"。**不支持**单文件打包；构建统一用 `tsc`，保留目录结构；`koatty doctor` 检测 bundle 产物并报错 |

### 4.7 开发期运行方式

| 组合 | 开发期运行 | 限制 |
|------|----------|------|
| C1 | `ts-node`（TS 6.0）或 `swc-node` | Node 原生类型剥离不能运行装饰器（E-14）；`tsx`/esbuild 不支持 `emitDecoratorMetadata`，C1 **不能**用 tsx |
| C2 | `tsx` / `swc-node` / `ts-node` | 必须能生成 metadata 辅助代码，Phase 0 验证 tsx 与 esbuild 的 TC39 metadata 支持 |
| C3 / C4 | `bun src/App.ts` | E-10 字段语义差异 |
| 所有组合（生产） | `tsc`（TS7）构建后，用 `node dist/App.js` 或 `bun dist/App.js` 运行 | — |

---

## 5. 实施路线图

### 5.1 与加固方案的协调

加固方案 ADR-107 规定：加固先于 TC39 的大面积改动。本方案遵从这一点：
- **Phase 0 可以与加固 Phase A/B 并行**：Phase 0 只做工具链与实验，不改装饰器源码。
- **Phase 1 的开工门禁**：加固 Phase A（测试基线全绿）已完成，且加固 Phase B 中涉及 `koatty-container`、`koatty-router` 的 PR 已合入。
- 加固 Phase D 中的容器重构与本方案 Phase 3 合并排期，由同一负责人主导（对应加固方案 R-02）。

### 5.2 总览

```
            加固 A/B ──────────┐
Phase 0  工具链 + 实验 ━━━━    │（与加固并行）
Phase 1  TC39 核心双模式       └─▶ ━━━━━━━━━━━━  (3 周, 2 人)
Phase 2  Bun 兼容（复用+修补）      ━━━━━━━━━━━━  (3 周, 1 人, 与 Phase 1 并行)
Phase 3  TC39 完整 + 注入契约                  ━━━━━━━━━━━━━━━━ (4 周, 2 人)
Phase 4  模板 / CLI / codemod                                  ━━━━━━━━ (2 周, 1 人)
Phase 5  矩阵测试 + 基准 + 发布                                        ━━━━━━━━ (2 周, 1.5 人)
```

从 Phase 1 开工算起约 11 周；Phase 0 另需约 1.5 周。

### 5.3 Phase 0：工具链与实验（1.5 周，1 人）

| 任务 | 产出 |
|------|------|
| 引入双编译器（ADR-017）：`typescript@~6.0.3` + 别名 `typescript-7`；新增 `typecheck` 脚本 | CI 中 TS7 与 TS6 的 `--noEmit` 均通过 |
| `tsconfig.base.json`：显式 `strict: false`、`skipLibCheck: true`；修复 E-08 中 koatty-router 的 2 处真实类型错误 | TS7 下全仓类型检查 0 error |
| 验证 api-extractor 能否处理 TS7 生成的 `.d.ts`；验证 tsup 的 cjs/esm 产物不受影响 | 报告 + 必要的配置调整 |
| 固化附录 A 的实验为可重复脚本（`scripts/compat-probe/`） | E-01～E-15 在 CI 中可复现 |
| 在 Bun 下运行**现有**测试集（具体方式由 Phase 0 确定：用 Bun 执行 jest，或用 `bun test` 对 dist 做协议冒烟） | 失败清单与根因分类 |
| Bun 下实测：gRPC 三种流式、优雅关闭、winston 轮转、Loader 加载 `.ts`、Prometheus 与 OTLP exporter | 填入 §6.1 矩阵 |
| 验证 SWC / esbuild（tsx）的 TC39 metadata 输出 | 决定 C2 的推荐开发工具 |

**门禁**：TS7 类型检查全绿；Bun 冒烟测试通过或所有失败项都已给出根因；§6.1 中每一项都没有"未知"。

### 5.4 Phase 1：TC39 核心双模式（3 周，2 人）

| 任务 | 包 | 工作量 |
|------|---|-------|
| Symbol.metadata polyfill、`PolyfillMissingError`、`appendOwn` 等写入工具（ADR-018） | container | 1 人天 |
| `MetadataStore` 统一读取 + 混用冲突检测（ADR-009/012） | container | 3 人天 |
| `Component.ts` 中 8 个类装饰器 + `OnEvent` 改为双模式 | core | 4 人天 |
| `mapping.ts` 中 `RequestMapping` 及 7 个派生装饰器改为双模式 | router | 2 人天 |
| `@Autowired(() => T)` / 字符串标识；带初始值时报错（ADR-019 第 2 条） | container | 2 人天 |
| 7 个参数装饰器改为三形态分派（§4.4），在装饰时写入 metadata | router | 5 人天 |
| `@Payload(Dto, { index? })` + `injectParamMetaData` 读取 DTO_SOURCE | router | 4 人天 |
| 双模式单测：每个装饰器都有 legacy 与 TC39 两套用例，TC39 用例用 TS7 编译 | 全部 | 4 人天 |

**门禁**：C1 回归 100%；C2 下 Component、映射、DTO 端到端通过；继承场景的元数据隔离用例通过（E-03）；polyfill 缺失用例能明确报错。

### 5.5 Phase 2：Bun 兼容（3 周，1 人，与 Phase 1 并行）

| 任务 | 工作量 |
|------|-------|
| `detectRuntime()` + `app.runtime` + 启动诊断日志（ADR-010/015） | 1 人天 |
| `checkRuntime()` 识别 Bun；`engines.bun` | 0.5 人天 |
| HTTP/3 在 Bun 下降级到 HTTP/2（复用 `Http2Server`） | 1 人天 |
| `koatty-trace` 在 Bun 下关闭 auto-instrumentation 并告警 | 1 人天 |
| 修复 Phase 0 发现的 Bun 失败项（按根因逐个处理） | 5 人天（预留） |
| C4 端到端样例 `examples/bun-legacy`：现有示例项目不改代码在 Bun 上运行 | 1 人天 |
| 协议集成测试在 Bun 下运行：HTTP / HTTPS / HTTP2 / WS / gRPC / GraphQL | 4 人天 |
| 优雅关闭用例（正常、超时、强制） | 1.5 人天 |

**门禁**：C4 全部集成测试通过；Bun 下 HTTP/2 协商结果为 h2；WS 的 Origin 校验在 Bun 下生效。

### 5.6 Phase 3：TC39 完整迁移 + 注入契约（4 周，2 人）

| 任务 | 包 | 工作量 |
|------|---|-------|
| `@Service({ inject })` 类级构造注入 + 构造参数环检测 | container | 4 人天 |
| ADR-019 不变量测试集（单例、Prototype 作用域、延迟注入、seal、继承） | container | 3 人天 |
| `@Value` / `@Config` TC39 分支对齐 ADR-019 | container | 1 人天 |
| `@Validated(Dto)` + 与 `@Payload` 的冲突规则 | validation | 3 人天 |
| `setExpose()` TC39 路径（从 `MetadataStore` 读类型） | validation | 2 人天 |
| Swagger 6 类装饰器双模式；`@ApiProperty({ type })` 在 TC39 下必填 | swagger | 6 人天 |
| AOP（`@Before` / `@After` / `@Around`）在 TC39 下的继承与 `addInitializer` 时序用例 | container | 2 人天 |
| C3 端到端样例 `examples/bun-tc39` | examples | 1 人天 |

**门禁**：C1–C4 全部通过；Swagger 在 legacy 与 TC39 下生成的 OpenAPI 文档逐字段一致（快照比对）。

### 5.7 Phase 4：模板 / CLI / codemod（2 周，1 人）

| 任务 | 工作量 |
|------|-------|
| `koatty new --runtime --decorators`，支持四种组合（ADR-011） | 3 人天 |
| 统一的模板源码 + 条件 tsconfig | 2 人天 |
| codemod `koatty migrate --to=tc39`：参数装饰器 → DTO；`@Autowired()` → `@Autowired(() => T)`；`constructor(@Inject())` → `@Service({ inject })` | 4 人天 |
| `koatty doctor`：编译器版本、tsconfig 关键项、装饰器模式统计、polyfill 顺序、依赖原型值的未装饰字段扫描 | 2 人天 |

### 5.8 Phase 5：矩阵测试 + 基准 + 发布（2 周，1.5 人）

| 任务 | 工作量 |
|------|-------|
| CI 矩阵：C1–C4 × 编译器（TS 5.9 / 6.0 / 7.0 编译用户侧 fixture） | 3 人天 |
| 基准测试（§8）：客户端与服务端分离，至少 3 轮取中位数 | 3 人天 |
| 迁移指南：C1→C2、C1→C4、C2→C3、TS5→TS7 | 3 人天 |
| Alpha → Beta → RC → Stable | 2 周（日历时间） |

### 5.9 资源估算

| 阶段 | 人周 |
|------|-----|
| Phase 0 | 1.5 |
| Phase 1 | 6 |
| Phase 2 | 3 |
| Phase 3 | 8 |
| Phase 4 | 2 |
| Phase 5 | 3 |
| **合计** | **≈ 23.5**（v1.1 为 29；节省主要来自 Bun 协议层不再重写） |

---

## 6. 兼容性矩阵

### 6.1 运行时能力（Phase 0 实测后回填）

| 能力 | Node 22/24 | Bun 1.3.14 | 依据 / 状态 |
|------|-----------|-----------|-----------|
| legacy 装饰器 + `design:*` + reflect-metadata | ✅ | ✅ | E-09 |
| TC39 装饰器 | ✅（需编译器降级转换） | ✅（Bun 转译器） | E-02 |
| `Symbol.metadata` 原生 | ❌ | ❌ | E-02，需要 polyfill |
| `useDefineForClassFields: false` 被遵守 | ✅（tsc） | ❌（源码运行时被忽略） | E-10 |
| `node:http` / `node:https` + Koa | ✅ | ✅ | E-15 |
| `node:http2`（h2） | ✅ | ✅ | E-12 |
| `Bun.serve` 支持 h2 | — | ❌ | E-12 |
| HTTP/3（QUIC） | ✅（`@matrixai/quic`） | ❌，降级 | ADR-020 |
| `ws` noServer 升级 | ✅ | ✅ | E-13 |
| `process.execArgv` | ✅ | ✅ | E-14 |
| gRPC Unary / Server Streaming / Bidi | ✅ | 待 Phase 0 | — |
| OTel auto-instrumentation | ✅ | ❌（默认关闭） | §4.6 |
| 优雅关闭 | ✅ | 待 Phase 0 | — |

### 6.2 编译器支持

| 编译器 | 构建框架 | 编译用户 C1/C4 | 编译用户 C2/C3 | 备注 |
|-------|---------|--------------|--------------|------|
| TypeScript 5.9 | — | ✅ | ✅ | 用户侧最低版本 |
| TypeScript 6.0 | 测试与 lint | ✅ | ✅ | ts-jest / typescript-eslint 的上限 |
| TypeScript 7.0 | ✅ 主构建 | ✅（E-01） | ✅ | 默认 strict；没有经典 API |
| Bun 转译器 | — | ✅ | ✅ | E-10 |
| SWC | 可选（测试） | ✅（decoratorMetadata） | 待 Phase 0 | — |
| esbuild / tsx | — | ❌（不支持 emitDecoratorMetadata） | 待 Phase 0 | — |

### 6.3 版本承诺

| Koatty | C1 | C2 | C3 | C4 |
|--------|----|----|----|----|
| v3.x | ✅ | ❌ | ❌ | ❌ |
| v4.x | ✅ 默认 | ✅ 推荐 | ✅ 推荐（Bun） | ✅ 支持 |
| v5.x | ⚠️ 维护（不再是默认） | ✅ 默认 | ✅ 默认 | ⚠️ 维护 |

v5.x 是否移除 legacy，要到 v5 规划时根据 TC39 参数装饰器提案的进展与社区使用数据决定。本方案不预设。

### 6.4 关键依赖

| 依赖 | 要求 | 备注 |
|------|-----|------|
| Node.js | ≥ 20（CI：22、24） | Node 18 已 EOL |
| Bun | ≥ 1.3.0（CI：1.3.x 最新） | — |
| TypeScript（框架构建） | 7.0.x + 6.0.x（工具） | ADR-017 |
| TypeScript（用户） | ≥ 5.9 | — |
| tslib | ≥ 2.5（建议 2.8+） | TC39 辅助函数 |
| reflect-metadata | ≥ 0.2.2 | legacy 必需；TC39 下由 `MetadataStore` 屏蔽 |
| jest | 29（短期）→ 30 | 升级到 30 可去掉 typebox 问题 |

---

## 7. 风险登记

| ID | 风险 | 级别 | 缓解 |
|----|------|-----|------|
| R1 | OTel auto-instrumentation 在 Bun 下不可用 | 中 | 框架自有 Span 不受影响；出站调用手动埋点（§4.6） |
| R2 | gRPC 流式在 Bun 下不稳定 | 高 | Phase 0 实测；不稳定就把 gRPC 在 Bun 下标注为 beta |
| R3 | HTTP/3 在 Bun 下不可用 | 低 | 降级 + 告警 |
| R4 | TC39 元数据继承污染（E-03） | 高 | ADR-018 写前复制 + 继承用例 |
| R5 | polyfill 求值顺序错误导致元数据静默丢失 | 高 | `PolyfillMissingError` 立即报错 + `koatty doctor` 检查 |
| R6 | TC39 字段遮住原型注入（E-11） | 高 | ADR-019 不变量测试；禁止带初始值 |
| R7 | Bun 源码运行时字段语义与 tsc 不一致（E-10） | 中 | ADR-019 第 5 条；模板不依赖原型上的未装饰字段 |
| R8 | TS7 工具链分裂导致"构建通过、测试失败" | 中 | ADR-017：CI 用两种编译器分别做类型检查 |
| R9 | TS7 默认 strict 让用户升级即报错 | 中 | 模板显式写 `strict`；迁移指南说明 |
| R10 | 混用两种装饰器模式的类出现 | 中 | ADR-012 第 3 条冲突检测 |
| R11 | `@Autowired(T)` 立即求值在循环 import 时遇到 TDZ | 中 | 推荐 thunk；非法实参报错 |
| R12 | 构造注入环 | 中 | 检测并提示改为字段注入 |
| R13 | 与加固方案改同一批文件产生冲突 | 高 | §5.1 门禁；同一负责人 |
| R14 | 性能宣传失实 | 中 | ADR-021 |
| R15 | Bun 上游行为变化（如开始遵守 `useDefineForClassFields`） | 低 | CI 固定 Bun 版本 + 每月跟进最新版 |
| R16 | WS 测试在 Bun 下漏掉 Origin 校验（E-13） | 中 | §4.6 测试规范 |
| R17 | 用户用 `bun build` 打包，导致组件扫描失败 | 高 | 模板用 `tsc` 构建；文档明确不支持；`koatty doctor` 检测 |
| R18 | 仓库同时存在 `pnpm-lock.yaml`、`bun.lock`、`package-lock.json`，依赖解析不一致 | 中 | CI 与开发统一用 pnpm；多余锁文件另行清理 |

**回退策略**：Bun 某个协议不达标时，只把该协议在 Bun 下标注为 beta，不阻塞 v4.0 发布。TC39 迁移受阻时，v4.0 先发布 C1 + C4（Bun 支持不依赖 TC39），C2/C3 放到 v4.1。**v1.1 中"TC39 受阻则推迟 Bun"的耦合从此消失。**

---

## 8. 性能基准与决策门

### 8.1 基线

E-15 的同机数据只能说明量级：Bun 运行 Koa 比 Node 22 快约 6%，原生 `Bun.serve` 快约 11%。Phase 5 必须按以下规范重测。

### 8.2 测试规范

- 客户端（`oha` / `bombardier` / `autocannon -w`）与服务端运行在**不同机器**，或把两者绑定到不同 CPU 核上（`taskset` 或容器 cpuset）。
- 场景：hello-world；Koatty 完整中间件栈（trace + 路由 + 校验 + 序列化）；DTO 提取 + 校验；1KB/10KB/100KB JSON；WS 消息往返；启动时间（200 个控制器，用 `hyperfine`）；空闲 RSS。
- 每个场景 3 轮，取中位数，并附原始数据。

### 8.3 决策门

| 对比 | 阈值 | 决策 |
|------|-----|------|
| C2 vs C1（任一场景） | 退化 > 5% | 阻塞发布，查根因 |
| C3 vs C2 / C4 vs C1 | 退化 > 5% | Bun 在该场景标注"不推荐"，并向上游报告 |
| 原生 `Bun.serve` 原型 vs C4（完整中间件栈） | 提升 ≥ 30% | 立项 `koatty-bun-native`（ADR-020 第 3 步） |
| 启动时间 C3 vs C1 | 仅记录 | 不作为门禁 |

---

## 9. 验收标准

### 9.1 TypeScript 7

- [ ] TS 7.0.x 下全仓 `tsc -b --noEmit` 0 error；TS 6.0 下同样 0 error
- [ ] 用 TS7 构建的产物通过全部测试；api-extractor 报告生成正常
- [ ] 用户侧 fixture 分别用 TS 5.9 / 6.0 / 7.0 编译 C1 与 C2 项目，全部通过

### 9.2 装饰器

- [ ] 全部框架装饰器提供 legacy + TC39 双模式，每个都有两套用例
- [ ] 继承场景元数据隔离（E-03）、polyfill 缺失报错、混用冲突报错这三类用例通过
- [ ] ADR-019 不变量测试集通过
- [ ] `@Service({ inject })`、`@Autowired(() => T)`、DTO 三形态分派通过
- [ ] Swagger legacy/TC39 快照一致

### 9.3 Bun

- [ ] C3、C4 的协议集成测试通过（HTTP / HTTPS / HTTP2(h2) / WS / gRPC 按 Phase 0 结论 / GraphQL）
- [ ] HTTP/3 降级告警正确
- [ ] 优雅关闭三种场景通过
- [ ] 现有示例项目不改代码在 Bun 上运行（C4）

### 9.4 整体

- [ ] v3.x 项目升级 v4 后不改代码行为一致（C1）
- [ ] CI 矩阵 C1–C4 × Node 22/24 × Bun 1.3 全绿
- [ ] 基准报告符合 §8.2，不存在触发 §8.3 阻塞条件的退化
- [ ] 迁移指南四条路径齐全；codemod 在官方示例上的自动迁移成功率 ≥ 95%

---

## 10. 与其他文档的关系

| 文档 | 角色 | 本版要求 |
|------|-----|---------|
| 本文档 | 决策与路线图的唯一来源 | — |
| `tc39-decorator-migration-plan.md` v3.0 | 装饰器实现细节 | 顶部"v3.0 勘误"优先于正文 |
| `koatty-bun-plan.md` v3 | Bun 协议细节与背景 | 顶部"v3 勘误"优先于正文；§5 服务器重写降为参考资料 |
| `koatty-hardening-and-ai-evolution-plan.md` | 加固与 AI 能力 | ADR-107 的排期约束对本方案生效 |

---

## 附录 A：复现实验

```bash
# 环境：Node 22.x、Bun 1.3.x
mkdir -p /tmp/kr && cd /tmp/kr

# E-02 / E-03：Symbol.metadata 与继承污染
node -e 'console.log(typeof Symbol.metadata)'; bun -e 'console.log(typeof Symbol.metadata)'
# meta.ts：先执行 polyfill，然后 Parent/Child 两个类各用 @Tag 往 metadata.tags 数组 push
#   结果 parent.tags 同时包含 "P" 与 "C"，说明父类被污染

# E-04 / E-05 / E-06：TS7 编译诊断
npx -p typescript@7.0.2 tsc --noEmit --target es2022 ctor.ts   # TS1206
npx -p typescript@7.0.2 tsc --noEmit --target es5 x.ts         # TS5108

# E-10：Bun 字段语义
# class Svc extends Base { dep!: string }，Base.prototype.dep = "x"
#   tsc(useDefine=false)→node 输出 "x"；bun 源码运行输出 undefined

# E-11：TC39 被装饰字段遮住原型
# class Svc { @Autowired() repo!: Repo }，把依赖定义到原型后 new Svc()
#   Object.hasOwn(s, "repo") === true，值为 undefined（tsc 与 Bun 结果相同）

# E-12：HTTP/2
curl -sk --http2 -o /dev/null -w '%{http_version}' https://127.0.0.1:19201/  # Bun.serve+TLS → 1.1
curl -sk --http2 -o /dev/null -w '%{http_version}' https://127.0.0.1:19202/  # node:http2 on Bun → 2

# E-15：基准
autocannon -c 100 -d 8 -w 4 -j http://127.0.0.1:PORT/x
```

Phase 0 把以上实验固化到 `scripts/compat-probe/`，作为 CI job 运行。

## 附录 B：ParameterDecorator 迁移清单

| # | 位置 | 装饰器 | 处理 |
|---|-----|-------|------|
| 1 | `koatty-container/decorator/autowired.ts:144` | `Inject` | legacy 保留并标记 `@deprecated`；TC39 下改用 `@Service({ inject })` 或字段注入 |
| 2 | `koatty-router/utils/inject.ts:612-618` | `injectParam` 工厂 | 支持三形态分派 |
| 3–9 | `koatty-router/params/params.ts:24/42/63/84/112/134/156` | `Header` `PathVariable` `Get` `Post` `File` `RequestBody` `RequestParam` | 三形态分派（§4.4） |
| 10 | `koatty-validation/decorators.ts:183` | `Valid` | legacy 保留；TC39 下改用 DTO 字段校验 |
| 11 | 别名 `Body` / `Param` | — | 跟随 `RequestBody` / `RequestParam` |

`design:*` 读取点（9 处）见专题方案 B §附录，全部改为经由 `MetadataStore` 读取。

## 附录 C：元数据兼容测试（替换 v1.1 §12.C 中无法运行的代码）

```typescript
// scripts/compat-probe/metadata.test.ts —— 分别用 TS7 编译后在 node 与 bun 下运行
import "koatty_container"; // 先执行 polyfill

const K = Symbol("k");

function ClassDeco(_: unknown, ctx: ClassDecoratorContext) {
  (ctx.metadata as Record<symbol, unknown>)[K] = "v";      // 普通对象，不是 Map
}
@ClassDeco class E {}

test("Symbol.metadata 可用", () => {
  expect((E as any)[Symbol.metadata][K]).toBe("v");
});

test("子类写入不污染父类", () => {
  const T = Symbol("tags");
  const tag = (v: string) => (_: unknown, ctx: ClassDecoratorContext) => {
    const m = ctx.metadata as Record<symbol, string[]>;
    m[T] = Object.hasOwn(m, T) ? m[T] : [...(m[T] ?? [])];
    m[T].push(v);
  };
  @tag("P") class P {}
  @tag("C") class C extends P {}
  expect((P as any)[Symbol.metadata][T]).toEqual(["P"]);
  expect((C as any)[Symbol.metadata][T]).toEqual(["P", "C"]);
});

test("字段元数据在装饰时写入，不需要实例化", () => {
  const F = Symbol("fields");
  const field = (_: undefined, ctx: ClassFieldDecoratorContext) => {
    const m = ctx.metadata as Record<symbol, string[]>;
    (m[F] = Object.hasOwn(m, F) ? m[F] : [...(m[F] ?? [])]).push(String(ctx.name));
  };
  class D { @field a!: string; }
  expect((D as any)[Symbol.metadata][F]).toEqual(["a"]);   // 没有 new D()
});

test("TC39 被装饰字段是自有属性（ADR-019 前提）", () => {
  const noop = (_: undefined, _ctx: ClassFieldDecoratorContext) => {};
  class S { @noop dep!: string; }
  (S.prototype as any).dep = "proto";
  expect(Object.hasOwn(new S(), "dep")).toBe(true);
});
```

## 附录 D：CI 矩阵

```yaml
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile        # 不能加 --no-optional（TS7 平台二进制）
      - run: node node_modules/typescript-7/bin/tsc -b --noEmit
      - run: node node_modules/typescript/bin/tsc -b --noEmit   # TS 6.0，与 ts-jest 一致

  matrix:
    needs: typecheck
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        combo: [c1, c2, c3, c4]
        include:
          - { combo: c1, runtime: node, decorators: legacy }
          - { combo: c2, runtime: node, decorators: tc39 }
          - { combo: c3, runtime: bun,  decorators: tc39 }
          - { combo: c4, runtime: bun,  decorators: legacy }
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - if: matrix.runtime == 'bun'
        uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3.x }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      # 框架测试：legacy 与 TC39 两套用例都跑，与 combo 无关
      - if: matrix.runtime == 'node' && matrix.combo == 'c1'
        run: pnpm test
      # 应用级 fixture：按组合使用对应的 tsconfig
      - run: pnpm --filter "./test-fixtures/${{ matrix.decorators }}" build
      - if: matrix.runtime == 'node'
        run: node test-fixtures/${{ matrix.decorators }}/dist/run-e2e.js
      - if: matrix.runtime == 'bun'
        run: |
          bun test-fixtures/${{ matrix.decorators }}/src/run-e2e.ts   # 源码运行（覆盖 E-10）
          bun test-fixtures/${{ matrix.decorators }}/dist/run-e2e.js  # dist 运行

  compat-probe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: bash scripts/compat-probe/run-all.sh   # 附录 A 的 E-01～E-14
```

## 附录 E：ADR 索引

| ADR | 状态（v2.0） | 标题 |
|-----|------------|------|
| 001 | 修订 → ADR-020 | BunKoaBridge 用方案 A：进一步简化为"直接复用 node:http 服务器" |
| 002 | 撤销 | koatty-bun 作为 meta-adapter 包 |
| 003 | 保留 | HTTP/3 降级而非报错 |
| 004 / 007 / 008 | 撤销 → ADR-020 | BunWsServer 共享端口、请求计数器、BunWsAdapter |
| 005 | 保留 | gRPC 不重写 |
| 006 | 修订 | 可观测性：Bun 下关闭 auto，框架 Span 不受影响 |
| 009 | 保留 + 补充 | compat 层 + MetadataStore |
| 010 | 修订 | RuntimeAdapter 只识别运行时，永不抛错 |
| 011 | 替换 | 模板与 CLI 的模式选择相互独立 |
| 012 | 替换 | 逐次调用判定模式，禁止运行时读 tsconfig |
| 013 | 关闭 | reflect-metadata 在 Bun 下兼容 |
| 014 | 保留 | 单一版本号 |
| 015 | 撤销 | Bun 启动期拒绝 legacy |
| 016 | 修订 | 参数装饰器替代契约（构造注入改为可编译形态） |
| 017 | 新增 | TypeScript 7 双工具链 |
| 018 | 新增 | Symbol.metadata polyfill 与写入规范 |
| 019 | 新增 | TC39 字段注入语义契约 |
| 020 | 新增 | Bun 协议层复用优先 |
| 021 | 新增 | 性能声明必须实测 |

## 附录 F：v1.1 勘误表

| v1.1 位置 | 问题 | v2.0 处理 |
|----------|------|---------|
| 核心定位、§2.1–2.3、ADR-011/015 | "Bun 只支持 TC39"与事实不符（E-09） | 撤销；§2.2 恢复 C4 |
| ADR-012、§6.1 `NodeRuntimeAdapter` | 运行时读 tsconfig 判定模式 | ADR-012 改为逐次调用判定 |
| §6.1 `BaseRuntimeAdapter.detect()` | 在 Bun 下没有 import koatty-bun 就抛错，导致预编译的 dist 无法在 Bun 上运行 | ADR-010：永不抛错 |
| §6.3 调用链、§12.C 用例 5 | `context.metadata.set(...)`：metadata 是普通对象 | ADR-018；附录 C |
| §6.4、§6.6.6 | 说 legacy "每请求反射"（实际在启动期预编译）；3×、2.5×、30–50% 等增益没有依据 | §4.4；ADR-021；§8 |
| §6.5 | Node 22 的 `Symbol.metadata` 标 ✅（实为 undefined）；说 Bun 下 reflect-metadata 有"边缘问题"（纯 JS，无此问题） | §6.1 |
| §6.6.4、ADR-016、§4.3 门禁、§12.B #1 | `@Inject(A, B)` 写在 constructor 上 → TS1206 | ADR-016 / §4.3 |
| §4.4 Track B | `BunHttp2Server`（ALPN 自动协商）：`Bun.serve` 不支持 h2（E-12） | ADR-020：复用 `node:http2` |
| §4.4、§5.1 | 5 个 BunXxxServer + mock 桥接 | ADR-020：不重写 |
| §4.5 Track B、§2.4 | Loader/Config 用 `Bun.file()` 加速：Loader 只是 `require`，不读文件内容 | 删除 |
| §4.7、§10.3 | "C3 ≥ 2.5× C1"验收门 | §8.3 |
| §5.1 | `examples/bun-hello-tc39` 同时标为 "C4" 和 "C3" | 统一为 `examples/bun-tc39`（C3）与 `examples/bun-legacy`（C4） |
| §7.3 | 只写"TypeScript ≥ 5.0"，没有覆盖 TS7 | ADR-017；§6.2 |
| §8.1 R8 | `process.execArgv` 在 Bun 下缺失（实际存在） | 删除 |
| 全文 | 没有与加固方案协调 | §5.1 |
| 全文 | 缺少 E-10 / E-11 字段语义与 E-03 元数据继承问题 | ADR-018 / ADR-019 |

---

## 文档历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-05-11 | 初稿：整合 koatty-bun-plan v2 与 tc39-decorator-migration-plan v2.2 |
| 1.1 | 2026-05-11 | 核心定位改为 Bun 强制 TC39；新增 ADR-015/016、§6.6；矩阵简化为三组合 |
| **2.0** | **2026-09-27** | **评审重写**：以 E-01～E-15 实测为依据，撤销"Bun ⟹ TC39"耦合，恢复 C4；新增 ADR-017～021（TS7 双工具链、polyfill 与写入规范、字段注入契约、Bun 协议层复用、性能实测）；Bun 协议层不再重写；删除没有依据的性能门；与加固方案协调排期；附录 F 列出 v1.1 勘误 |

---

**End of Document**
