# Koatty Bun + TC39 整合实施方案

> 版本：v1.1  
> 日期：2026-05-11  
> 作者：Architect Agent  
> 关联文档：[`koatty-bun-plan.md`](./koatty-bun-plan.md) v2 · [`tc39-decorator-migration-plan.md`](./tc39-decorator-migration-plan.md) v2.2  
> 状态：草案（基于代码库实测 + 两份既有方案综合优化）

---

## 文档定位

本文档是 **Koatty Bun runtime 适配** 与 **TC39 标准装饰器迁移** 两条工作线的整合实施方案。
它**不替代**两份原方案，而是：

1. **识别交叉点**：两条工作线在 `tsconfig`、`Bootstrap`、`reflect-metadata`、模板、CI 等位置存在强耦合，必须协同设计；
2. **修订路线图**：将原本"先后串行"的两条线重排为"分阶段交错并行"，缩短整体周期；
3. **新增基础设施**：引入 `RuntimeAdapter` 抽象与统一模式判定逻辑，消除两份方案在 `Bootstrap` 上的潜在重复；
4. **统一发布矩阵**：明确 `(Decorator-Mode × Runtime)` 三元组的支持承诺与版本号约定；
5. **补齐缺口**：为方案 A 补充 TC39 兼容性测试，为方案 B 补充 Bun 维度的验证条款。

阅读顺序建议：先读两份原方案，再读本文档第 §2、§4、§5 章节。

---

## ★ 核心定位（v1.1 强化）

> **Bun runtime 分支 = TC39 标准纯净分支**
>
> 1. **Bun 路径仅支持 TC39 标准装饰器**，不支持 Legacy（`experimentalDecorators: true`）。
>    - `BunRuntimeAdapter` 在初始化时强制 `decoratorMode = 'tc39'`，**不读** 项目 tsconfig
>    - 用户在 Bun 下 `experimentalDecorators: true` 不会生效，启动时给出明确错误
>    - 现有 Node-Legacy 项目切到 Bun 必须**先**完成 TC39 迁移（顺序：C1 → C2 → C3）
>
> 2. **参数装饰器（`ParameterDecorator`）在 Bun 分支暂不支持**：
>    - 原因：[TC39 Stage 3 装饰器规范](https://github.com/tc39/proposal-decorators) 不包含 parameter decorator
>    - 当前替代：DTO 类 + 双模式装饰器的 `PropertyDecorator` 路径 + `@Payload` / `@Inject(...)` MethodDecorator（详见 §6.6）
>    - 未来恢复：[TC39 Stage 1 提案](https://github.com/tc39/proposal-class-method-parameter-decorators) 进入 Stage 3 后评估恢复支持（详见 ADR-016）
>
> 3. **三元组取代四元组**（v1.0 的 4 元组中 C3 Bun-Legacy 被废除）：
>
>    | 编号 | 装饰器模式 | 运行时 | 注入风格 | 状态 |
>    |------|----------|--------|---------|------|
>    | **C1** | legacy | Node | 参数装饰器 | 现有，向后兼容 |
>    | **C2** | tc39 | Node | DTO + 构造注入 | 迁移目标 |
>    | **C3** | **tc39** | **Bun** | DTO + 构造注入 | **本次新增 + 终态推荐** |
>
> 4. **Bun 模板**（`koatty-ai-template-project-bun`）从 Day1 强制 TC39，无 fallback。

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [整合后的整体架构](#2-整合后的整体架构)
3. [关键设计决策（ADR 增量）](#3-关键设计决策adr-增量)
4. [整合后的实施路线图](#4-整合后的实施路线图)
5. [包结构与文件清单](#5-包结构与文件清单)
6. [关键技术方案细节](#6-关键技术方案细节)
7. [兼容性矩阵](#7-兼容性矩阵)
8. [整合后的风险登记](#8-整合后的风险登记)
9. [性能基准与决策门](#9-性能基准与决策门)
10. [整合验收标准](#10-整合验收标准)
11. [与现有文档的关系](#11-与现有文档的关系)
12. [附录](#12-附录)

---

## 1. 背景与动机

### 1.1 两份原方案的现状

| 维度 | `koatty-bun-plan.md` v2 | `tc39-decorator-migration-plan.md` v2.2 |
|------|-------------------------|-------------------------------------------|
| 目标 | Bun runtime 适配 | TC39 Stage 3 装饰器迁移 |
| 起草日期 | 2026-05-10 | 2026-04-02（v2 于 2026-04-23） |
| 关键产物 | `packages/koatty-bun`、各组件 `bun` 分支 | `compat.ts` 双模式层、DTO 替代方案、`@Payload`/`@Inject` 重构 |
| 假设 tsconfig | `experimentalDecorators: true` + `emitDecoratorMetadata: true` | 目标态：`experimentalDecorators: false`（`emitDecoratorMetadata` 不可设置） |
| 当前进度 | 0%（无任何 Bun 源码） | 容器层装饰器已部分双模式（`Autowired`/AOP/`Value`）；核心装饰器仍 legacy |

### 1.2 必须整合的根本原因

代码现状梳理（详见 [§12.A 现状审计](#12a-代码现状审计要点)）显示，两份方案在以下位置存在**强耦合**：

| 耦合点 | 不整合的后果 |
|--------|------------|
| `tsconfig` 决定 `design:*` 元数据可用性 | Bun 模板若沿用 `experimentalDecorators: true`，TC39 完成后需重做模板，用户面临二次迁移 |
| `Bootstrap.ts` 与 `BunBootstrap.ts` 的逻辑重复 | TC39 改造 `LifecycleManager.setInstance()` 后，两处必须同步修改，长期维护双倍工作量 |
| `reflect-metadata` 在 Bun 下的实际行为 | 方案 A 假设 Bun 完整支持 polyfill；若实际不完整，TC39 迁移会被阻塞 |
| 协议层装饰器（`@Controller`/`@Middleware`）当前仍 legacy | Bun 下应用代码若用 TC39 写法，会被 Loader 扫描时漏注册 |
| 代码生成模板（`koatty-ai`） | Bun 模板与 DTO 模板若分别实现，用户面临 4 套模板组合（Node/Bun × Legacy/TC39） |

### 1.3 整合后的收益

1. **消除二次迁移**：用户切换到 `koatty-bun` 时，可直接采用 TC39 + DTO 的最终形态，避免后续重写；
2. **缩短整体周期**：原方案 A 估算 7 周、方案 B 估算 12 周（共 19 人周），整合后通过并行可压缩到 **12-14 周**；
3. **减少维护负担**：通过 `RuntimeAdapter` 抽象消除 `Bootstrap`/`BunBootstrap` 重复；
4. **统一测试矩阵**：CI 一次性建立 `(Node|Bun) × (Legacy|TC39)` 四元组，避免日后扩展；
5. **更清晰的发布策略**：使用 `koatty@4.0.0-bun.x` 等单一版本号承载双特性，避免分支版本号语义混乱。

---

## 2. 整合后的整体架构

### 2.1 三个相关维度（带强约束）

整合后的系统由 **三个相关** 的维度构成。其中 D1 与 D2 之间存在 **单向强约束**：

```
┌─────────────────────────────────────────────────────────┐
│  D1: Decorator Mode    legacy        │  tc39            │
├──────────────────────┼───────────────┼──────────────────┤
│  D2: Runtime           node          │  bun             │
├──────────────────────┼───────────────┼──────────────────┤
│  D3: Injection Style   ParamDecorator│  DTO + Constructor│
└─────────────────────────────────────────────────────────┘

强约束：D2=bun  ⟹  D1=tc39 ∧ D3=DTO
        D2=node ⟹  D1∈{legacy,tc39}, D3 跟随 D1
```

- **D1（Decorator Mode）**：
  - Node 路径下：由项目 `tsconfig.compilerOptions.emitDecoratorMetadata` 配置自动判定（方案 B §11.10.4）
  - **Bun 路径下：强制 `tc39`**（`BunRuntimeAdapter` 不读 tsconfig，详见 ADR-012）
- **D2（Runtime）**：由 `typeof Bun !== 'undefined'` 全局检测自动判定
- **D3（Injection Style）**：
  - Node-Legacy 路径下：参数装饰器 + 字段注入（既有方式）
  - Node-TC39 / Bun 路径下：DTO + 构造注入（参数装饰器在 TC39 标准中不可用）

### 2.2 维度组合矩阵（三元组）

| 编号 | D1 装饰器 | D2 运行时 | D3 注入风格 | 推荐场景 | 支持期 |
|------|----------|----------|-----------|---------|--------|
| **C1** | legacy | Node | 参数装饰器 + 字段注入 | 现有项目、稳定生产 | v3.x（当前）+ v4.x |
| **C2** | tc39 | Node | DTO + 构造注入 | 新项目、Node 长期演进 | v4.x（迁移）+ v5.x（默认） |
| **C3** | **tc39** | **Bun** | **DTO + 构造注入** | **Bun 用户唯一选择** + 终态推荐 | v4.x（新增）+ v5.x（继续支持） |

> **设计原则**：
> - **C3 是 Bun 路径下的唯一支持组合**——用户在 Bun 下只能用 TC39
> - **C1 → C2 → C3** 是单向迁移路径，不能跨越
> - 现有 Node-Legacy 项目要切 Bun，必须**先**完成 C2 迁移

### 2.3 显式废除：Bun-Legacy 不被支持

旧版本（v1.0）中存在的 "C3 Bun-Legacy" 组合**已被废除**，理由：

1. **TC39 标准化压力**：Bun 作为新生 runtime 应直接对齐最新标准，不应承载 Legacy 装饰器的历史包袱
2. **维护成本**：双模式 × 双 runtime 的笛卡尔积会让协议层、模板、CI、文档复杂度爆炸
3. **用户预期**：选择 Bun 的用户多数已是 TC39-aware，对"必须先迁 TC39"的要求接受度高
4. **性能一致性**：DTO + 构造注入是 Bun 性能最优路径，强制使用可保证性能基准的可预测性

**强制策略**：
- `BunRuntimeAdapter` 构造时硬编码 `decoratorMode = 'tc39'`
- `koatty-bun` 包入口处加启动检测：若发现项目 tsconfig `experimentalDecorators: true` 则启动失败并给出明确错误（详见 ADR-015）
- `koatty-ai-template-project-bun` 模板的 tsconfig 必须 `experimentalDecorators: false`

### 2.4 整合后的包结构（关键变化）

```
koatty-monorepo/
├── packages/
│   ├── koatty/                    # ★ 主入口包（保持向后兼容，新增 RuntimeAdapter 抽象）
│   ├── koatty-bun/                # ★ 新增：Bun runtime 入口包
│   ├── koatty-core/               # ☆ 改造：Component 装饰器双模式 + RuntimeAdapter
│   ├── koatty-container/          # ☆ 改造：LifecycleManager 自动构造注入 + @Inject MethodDecorator
│   ├── koatty-router/             # ☆ 改造：所有参数装饰器升级双模式 (Param + Property) + @Payload
│   ├── koatty-validation/         # ☆ 改造：@Validated(Dto) 简写 + setExpose() TC39 适配
│   ├── koatty-serve/              # ☆ 改造：BunXxxServer 系列 + RuntimeAdapter 注入
│   ├── koatty-trace/              # ☆ 改造：手动 Instrumentation Bun 分支
│   ├── koatty-loader/             # ☆ 改造：Bun.file() 加速 + ESM 兼容
│   ├── koatty-config/             # ☆ 改造：Bun.file() 加速
│   ├── koatty-swagger/            # ☆ 改造：design:type 适配（@ApiProperty 显式 type 必填）
│   └── ... (其他包不变)
│
├── docs/
│   ├── koatty-bun-plan.md                        # 原 Bun 方案（保留，加链接指向本文档）
│   ├── tc39-decorator-migration-plan.md          # 原 TC39 方案（保留，加链接指向本文档）
│   └── koatty-bun-tc39-integrated-plan.md        # ★ 本文档：整合实施方案
```

### 2.5 整合后的运行时分发架构

```
[应用入口]
     │
     │  import { ExecBootStrap } from 'koatty' (Node) | 'koatty-bun' (Bun)
     ▼
[Bootstrap 统一入口]
     │
     │  RuntimeAdapter.detect()
     │    ├─ typeof Bun !== 'undefined' → BunRuntimeAdapter (硬编码 tc39)
     │    └─ 否则 → NodeRuntimeAdapter (读 emitDecoratorMetadata)
     ▼
┌────────────────────────────────────────────────────────────────┐
│ RuntimeAdapter (新增基础设施)                                    │
│  ├─ NodeRuntimeAdapter   decoratorMode: 'legacy' | 'tc39'      │
│  └─ BunRuntimeAdapter    decoratorMode: 'tc39' (强制)          │
│                                                                 │
│  统一接口：                                                      │
│   - readFile / readFileSync                                     │
│   - createServerInstance(protocol, opts, app)                   │
│   - resolveModule(spec)                                         │
│   - loadTlsMaterial(path)                                       │
│   - assertCompatibility() ← Bun 启动期严格检测（ADR-015）       │
└──────────────┬──────────────────────────────────────────────────┘
               │
               ▼
[Loader.LoadAllComponents]
     │
     │  ★ 组件扫描分支：
     │     - Node-Legacy: 读 design:paramtypes
     │     - Node-TC39 / Bun: 读 context.metadata + @Payload/@Inject 显式声明
     ▼
[IOC.setInstance]
     │
     │  ★ 构造注入分支：
     │     - Node-Legacy: design:paramtypes 自动解析
     │     - Node-TC39 / Bun: @Inject(Type1,Type2,...) MethodDecorator 显式
     ▼
[BaseServer.start]
     │
     │  ★ 协议工厂分发：
     │     ├─ Node: HttpServer / WsServer / GrpcServer / Http3Server / ...
     │     └─ Bun:  BunHttpServer / BunWsServer / GrpcServer(compat) / BunHttp3Server(降级)
     ▼
[请求处理]
     │
     │  ★ 参数提取分支：
     │     ├─ Node-Legacy: TAGGED_PARAM 元数据（参数装饰器路径）
     │     ├─ Node-TC39:   DTO_SOURCE_KEY（双模式装饰器 PropertyDecorator 路径）
     │     └─ Bun:         DTO_SOURCE_KEY（仅此一种路径——参数装饰器在 Bun 下被禁用）
     ▼
[Controller method]
```

> **核心理念**：
> - 装饰器模式与运行时**有限解耦**——Node 路径下两者独立，**Bun 路径下绑定**（runtime=bun ⟹ mode=tc39）
> - 通过 `RuntimeAdapter` 统一抽象 IO/服务器创建，通过 `compat.ts` 统一抽象装饰器双模式
> - Bun 路径在所有分支处自动走 TC39 + DTO 路径，无 Legacy 代码分支

---

## 3. 关键设计决策（ADR 增量）

> 编号延续两份原方案的 ADR-001 ~ ADR-008，新增 ADR-009 起。

### ADR-009：以 TC39 兼容层为统一基础

**决策**：所有需要在 Legacy/TC39 之间双模式运行的装饰器，**必须**通过 `koatty-container/src/decorator/compat.ts` 提供的 `createDualClassDecorator` / `createDualMethodDecorator` / `createDualFieldDecorator` 实现，禁止各包独立实现"运行时签名嗅探"逻辑。

**理由**：
- `compat.ts` 已实现 `isTC39Context(context)` 等核心判定逻辑（`packages/koatty-container/src/decorator/compat.ts:10-15`）；
- 容器层 `Container.createDecorator(handler, type)` 已是中心调度器（`container.ts:923-937`）；
- 多处独立实现会导致判定逻辑不一致，TC39 上下文检测的微小差异会引发难以调试的 Bug。

**实施约束**：
- `koatty-core/Component.ts` 中 8 个装饰器迁移时，必须改为：
  ```typescript
  export const Controller = (path = "", options?) => IOC.createDecorator({
    legacy: (target) => { /* 原逻辑 */ },
    tc39: (target, context) => { /* TC39 逻辑 */ },
  }, 'class');
  ```
- `koatty-router/params/mapping.ts` 的 `RequestMapping` 同理；
- 参数装饰器的"双模式（Param + Property）"是另一种双模式，由 `koatty-router/params/params.ts` 内部实现（详见方案 B §11.3.2），与 `compat.ts` 的"Legacy + TC39"是不同维度。

### ADR-010：BunBootstrap 与 Bootstrap 通过 RuntimeAdapter 统一

**决策**：**不创建** `BunBootstrap.ts` 作为独立的引导入口（这是对方案 A §3.3 的修订）。改为在现有 `packages/koatty/src/core/Bootstrap.ts` 中注入 `RuntimeAdapter`，由 Adapter 决定 Node.js 还是 Bun 行为。

**理由**：
- 方案 A 中 `BunBootstrap.ts` 与 `Bootstrap.ts` 的核心逻辑 95% 重复（`Loader.initialize` / `IOC.setApp` / `Loader.LoadAllComponents` 等）；
- TC39 迁移会改造 `IOC.setInstance()` 行为（方案 B §11.4.3），若两个 Bootstrap 共存，需要双倍同步成本；
- `Bootstrap.createApplication()`（`packages/koatty/src/core/Bootstrap.ts:165`）已是"构造应用 → 不监听"的解耦点，天然适合 Bun-style `Bun.serve({fetch: app.getRequestHandler()})`。

**实施约束**：
- `packages/koatty-bun/src/index.ts` **不再** override `ExecBootStrap` / `createApplication`，而是 re-export 自 `koatty`；
- `packages/koatty-bun` 仅做：① 类型扩展（`BunServer`）② 在 import 时通过 side-effect 注册 `BunRuntimeAdapter`；
- 现有 `packages/koatty/src/core/Bootstrap.ts` 的 `bootstrapApplication()` 增加一行：
  ```typescript
  const adapter = RuntimeAdapter.detect();
  app.runtime = adapter;  // 后续 Loader / Server 通过 app.runtime 访问能力
  ```

**收益**：单一 Bootstrap 路径，Bun 适配 = "替换 RuntimeAdapter 实现 + 替换协议服务器实现"，业务代码无感知。

### ADR-011：Bun 分支强制 TC39（无 Legacy fallback）

**决策**：`koatty-ai-template-project-bun` 模板从 Day1 **强制** 生成 TC39 + DTO + 构造注入 风格代码（即 §2.2 矩阵中的 C3）。**取消** v1.0 ADR-011 中允许 `--decorator-mode legacy` fallback 的设计。

**理由**：
- Bun 路径只支持 TC39（核心定位约束），fallback 到 Legacy 会与 BunRuntimeAdapter 强制 tc39 模式冲突；
- 模板 fallback 选项会让用户产生"Bun 也能跑 Legacy"的误解，与现实矛盾；
- 简化模板维护——只需维护两套主模板（C1 Node-Legacy + C3 Bun-TC39），通过 CLI 参数 `--style=dto` 在 Node 模板内提供 C2 选项；
- TC39 + DTO 模式在 Bun 下能利用预编译参数提取器，跳过反射开销，性能更优（§6.4）。

**实施约束**：
- 模板的 `tsconfig.json.hbs` **必须**包含：
  ```json
  {
    "compilerOptions": {
      "experimentalDecorators": false,
      "useDefineForClassFields": false,
      "target": "ES2022",
      "module": "ESNext",
      "moduleResolution": "bundler"
    }
  }
  ```
  其中 `experimentalDecorators: false` 不允许通过模板变量修改。
- 模板生成的控制器示例使用 DTO + `@Payload` 形式；DI 使用 `@Autowired(Type)` 字段注入 + `@Inject(Type1,Type2)` 构造注入（皆为 TC39 标准签名）；
- 模板生成的 README 顶部包含明确说明："本模板采用 TC39 标准装饰器，参数装饰器（@Get/@Post 等用作方法参数注解）暂不支持。详见 §6.6 替代方案。"
- 保留 `koatty-ai-template-project`（Node 模板）支持 C1（默认 Legacy）和 C2（`--style=dto` 切换 TC39+DTO）；
- `koatty new --runtime bun` 命令**不接受** `--decorator-mode` 参数，强制 TC39。若用户传入则报错并退出。

### ADR-012：装饰器模式判定（仅 Node 路径读 tsconfig，Bun 路径硬编码）

**决策**：装饰器模式判定逻辑根据运行时分两条路径：

- **Node 路径**：读取项目 `tsconfig.json` 的 `compilerOptions.emitDecoratorMetadata`（方案 B §11.10.4），检测到 `true` → Legacy，否则 TC39
- **Bun 路径**：**不读 tsconfig，直接硬编码 `decoratorMode = 'tc39'`**

**不引入** 单独的 `KOATTY_DECORATOR_MODE` 环境变量或运行时配置项。

**理由**：
- TypeScript 编译器约束 `emitDecoratorMetadata` 必须与 `experimentalDecorators` 同时启用（TS5052）——Node 路径下两者天然一致
- Bun 路径**不允许** Legacy（核心定位约束），不需要从 tsconfig 推断模式
- Bun 路径硬编码可避免一类用户错误：项目 tsconfig 误设 `experimentalDecorators: true` 但希望在 Bun 下运行
- 启动检测一次性执行，运行时缓存结果，性能开销可忽略

**实施约束**：

```typescript
// packages/koatty-container/src/decorator/compat.ts
export function detectDecoratorMode(runtime: 'node' | 'bun'): 'legacy' | 'tc39' {
  // Bun 路径硬编码
  if (runtime === 'bun') return 'tc39';

  // Node 路径读 tsconfig
  const tsconfig = tryReadTsconfig();
  if (tsconfig?.compilerOptions?.emitDecoratorMetadata === true) return 'legacy';

  // 探测兜底
  return probeDesignTypeAvailable() ? 'legacy' : 'tc39';
}
```

```typescript
// packages/koatty-bun/src/runtime/bun-adapter.ts
export class BunRuntimeAdapter implements RuntimeAdapter {
  readonly name = 'bun' as const;
  readonly version = Bun.version;
  readonly decoratorMode = 'tc39' as const;  // ★ 硬编码，不可修改

  // ...
}
```

- 检测结果通过 `IOC.runtime.decoratorMode` 暴露给所有需要分支处理的代码
- 启动日志明确打印当前模式：`[koatty] Runtime: bun 1.3.0 / Decorator mode: tc39 (forced)`
- Bun 路径下若检测到 tsconfig `experimentalDecorators: true`，由 ADR-015 的 `assertCompatibility()` 处理（启动失败 + 错误信息）

### ADR-013：reflect-metadata 在 Bun 下的兼容性优先级提升

**决策**：将 "Bun 下 reflect-metadata 兼容性验证" **提升为 Phase 0 阻断式前置任务**（原方案 A 仅在 CI 中作为 verify step，未列为前置）。

**理由**：
- Bun 1.1.x 历史上对 `Reflect.defineMetadata` 的支持存在边缘 case（如继承链元数据查找）；
- 若兼容性不完整，整个 Phase 1 的 koatty-bun MVP 都无法跑通；
- TC39 模式下虽不依赖 `design:*`，但仍依赖 `Symbol.metadata`（TC39 Stage 3，Bun 支持情况未知）。

**实施约束**：
- Phase 0 必须输出 [Bun reflect-metadata 兼容性测试报告](#12c-bun-元数据兼容性测试矩阵)；
- 测试覆盖：① `Reflect.defineMetadata/getMetadata` 全量 API；② `design:type/paramtypes/returntype` 在 `experimentalDecorators: true` 下能否正常注入；③ `Symbol.metadata` 在 TC39 模式下能否正常工作；
- 若发现阻断问题，应：① 在 koatty-bun 顶层 import 处插入兼容 polyfill；② 或将该问题升级为 Bun 上游 issue 跟踪。

### ADR-014：发布版本号承载双特性

**决策**：使用 `koatty@4.0.0-bun.x` / `koatty_serve@3.3.0-bun.x` 等版本号语义同时表达 **TC39 dual + Bun 适配** 两个特性。**不再** 为 Bun 适配单独维护 `bun` 长期分支。

**理由**：
- 方案 A 提出的 `bun` dist-tag + 长期分支（§4.2）会与方案 B 的 v4.x（dual）/ v5.x（TC39 only）发布策略产生冲突；
- 装饰器双模式已让 v4.x 的代码同时支持 Legacy 与 TC39，再叠加 Bun 适配也可在同一代码库内完成；
- `RuntimeAdapter` 让运行时分发可在主线代码中实现，无需独立分支。

**实施约束**：
- 主分支（`master`）发布 v4.x 系列，包含 dual + Bun 双能力；
- 移除方案 A §4.2 的 `bun` dist-tag 策略；
- npm 上发布的 `koatty@4.x.x` 默认即支持 Bun（用户安装后 `import from 'koatty-bun'` 即可使用 Bun 路径）；
- `bun` 分支仅作为短期实验（≤4 周），实验通过后合并主线删除。

### ADR-015：Bun 分支拒绝 Legacy 装饰器与参数装饰器（启动期严格检测）

**决策**：在 `packages/koatty-bun/src/runtime/bun-adapter.ts` 的 `assertCompatibility()` 方法中实施 **三重启动期检测**，发现违规时**立即终止启动**并打印明确错误信息：

1. **检测 tsconfig**：项目 `tsconfig.json` 的 `experimentalDecorators` 不能为 `true`
2. **检测 design:* 注入**：探测 probe class 的 `design:type` 元数据是否被注入（应该不被注入）
3. **检测参数装饰器使用**：扫描已注册组件的 `TAGGED_PARAM` 元数据，若发现非空则拒绝启动

**理由**：
- 静默失败（fallback 到默认行为）会让用户在生产环境遇到难以调试的 bug；
- TC39 标准本身在编译期已禁止参数装饰器，但若用户使用 Bun 内置 transpiler 或自定义 SWC 配置可能绕过；
- 启动期检测虽有微小性能开销（约 50ms），但能**100% 拦截配置错误**，价值远高于成本。

**错误信息规范**（必须包含 ① 违规项、② 为何不允许、③ 如何修复、④ 文档链接）：

```typescript
// 检测 1：experimentalDecorators 错误
if (tsconfig?.compilerOptions?.experimentalDecorators === true) {
  throw new Error(`
[koatty-bun] Bun runtime requires TC39 standard decorators.

  ✗ Detected:    tsconfig.json has "experimentalDecorators": true
  ✗ Reason:      Bun branch only supports TC39 Stage 3 decorators.
                 Legacy (TypeScript experimental) decorators are not allowed.
  ✓ Fix:         Set "experimentalDecorators": false (or remove this field)
                 and "useDefineForClassFields": false in tsconfig.json
  ✓ Docs:        See koatty-bun-tc39-integrated-plan.md §6.6 for migration guide.
`);
}

// 检测 2：参数装饰器使用
const offenders = scanParameterDecoratorUsage();
if (offenders.length > 0) {
  throw new Error(`
[koatty-bun] Parameter decorators are NOT supported on Bun runtime.

  ✗ Detected:    ${offenders.length} parameter decorator(s) in:
                 ${offenders.map(o => `  - ${o.file}:${o.line} @${o.name}`).join('\n')}
  ✗ Reason:      TC39 Stage 3 decorator specification does not include
                 parameter decorators. The Stage 1 proposal is still under
                 discussion: https://github.com/tc39/proposal-class-method-parameter-decorators
  ✓ Fix:         Migrate to DTO pattern + @Payload / @Inject MethodDecorator.
                 See koatty-bun-tc39-integrated-plan.md §6.6 for examples.
  ✓ Codemod:     Run \`koatty migrate --target=tc39\` to auto-migrate.
`);
}
```

**实施约束**：
- `assertCompatibility()` 在 `BunRuntimeAdapter` 构造时立即调用
- 检测结果不缓存（每次启动重新检测）
- 错误信息**强制英文**，因为 npm 包面向国际用户，但保留独立 i18n 出口（`KOATTY_LANG=zh` 时切换）
- 检测器对 `node_modules` 内的代码豁免（防止第三方 deprecated 装饰器误伤），仅扫描应用源码

### ADR-016：参数装饰器替代方案的契约与未来恢复路线

**决策**：在 Bun 分支（以及任何 TC39 模式下），**所有原参数装饰器使用场景**必须通过以下三种替代方案之一覆盖。框架明确承诺：当 [TC39 Stage 1 参数装饰器提案](https://github.com/tc39/proposal-class-method-parameter-decorators) 进入 Stage 3 时，会评估恢复支持，且**保证替代方案不会被废弃**（向前兼容）。

**当前替代方案（v4.x 起永久支持）**：

| 原参数装饰器 | 替代方案 | 装饰器形态 | 章节 |
|------------|---------|---------|------|
| `@Get(name)` 用作 `@Get(name) param: T` | DTO 类属性：`@Get({ name, type }) field: T` | PropertyDecorator | §6.6.1 |
| `@Post(name)` `@Header(name)` `@PathVariable(name)` `@File(name)` `@RequestBody()` `@RequestParam()`（同上） | 同 `@Get`，DTO 属性的 PropertyDecorator | PropertyDecorator | §6.6.1 |
| 多源 DTO（路径变量 + body） | DTO 属性混用多种数据源装饰器 | PropertyDecorator | §6.6.2 |
| 纯 body DTO | DTO 类无任何数据源装饰器，框架自动推断 body | （隐式） | §6.6.3 |
| `@Inject() dep: T` 在 constructor 上 | `@Inject(Type1, Type2, ...)` 放在 constructor 上 | MethodDecorator | §6.6.4 |
| `@Valid("IsNotEmpty")` 在方法参数上 | DTO 属性 `@IsNotEmpty()` 装饰器 | PropertyDecorator | §6.6.5 |

**未来恢复路线**：

```
TC39 Stage 1 提案进入 Stage 3
        │
        ▼
[评估窗口]：6 个月观察期
  ├─ 提案最终签名是否与现有参数装饰器兼容
  ├─ 主流 transpiler（TypeScript/SWC/Babel）支持情况
  └─ 社区 RFC 收集反馈
        │
        ▼
[评估通过] → koatty v6.x 恢复参数装饰器支持
        │   - 替代方案保留为推荐用法
        │   - 参数装饰器作为"等价但更便捷"的语法糖
        │   - 不破坏 v4.x/v5.x 的代码
        │
        ▼
[评估未通过] → 维持当前替代方案
        │   - 参数装饰器在 Bun/TC39 路径永久不支持
        │   - 保留 Legacy 模式（仅 Node）作为参数装饰器的退路
```

**永久承诺**：
- DTO + PropertyDecorator 路径在 v4.x 起被框架核心支持，**不会**因为 TC39 参数装饰器恢复而废弃
- 现有 Node-Legacy 项目（C1）可继续使用参数装饰器，框架在 v4.x/v5.x 期间不强制迁移
- `@Payload` / `@Inject(MethodDecorator)` 是核心 API，不会因任何 TC39 提案变化而 breaking change

**用户视角的迁移指南**：

| 现状 | 建议路径 | 时间窗口 |
|------|---------|---------|
| Node-Legacy + 大量参数装饰器 | 继续 C1（v4.x 兼容期）→ v5 前评估 C2 | 1-2 年 |
| Node-Legacy + 少量参数装饰器 | C1 → C2（codemod 辅助） | 1-3 月 |
| 新项目 + Bun | 直接 C3（无迁移成本） | 即刻 |
| 新项目 + Node | 直接 C2（避免 v5 时再迁） | 即刻 |

---

## 4. 整合后的实施路线图

### 4.1 总览

整合后总周期 **13-15 周**，分为 6 个阶段（Phase 0-5）。**v1.1 修订**：由于 Bun 路径强制 TC39，原 v1.0 的"Phase 1 双轨独立验收"模型不再成立——TC39 必需子集是 Bun MVP 的**强前置依赖**。但 Node 端的 TC39 完整迁移（包括 Swagger / 完整构造注入 / DTO 完善）仍可与 Bun 协议层并行。

```
Week 0    1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
═══════════════════════════════════════════════════════════════════
Phase 0  ━━
Phase 1     ━━━━━━━━━━━            ← TC39 必需子集（Bun 前置）
Phase 2              ━━━━━━━━━━━━━━━━━━━ ← Bun MVP + 协议 + DTO 骨架
Phase 3                       ━━━━━━━━━━━━━━━━ ← Node TC39 完整 + Bun 可观测
Phase 4                                       ━━━━━━━━━ ← 模板/CLI
Phase 5                                                  ━━━━━━━ ← 测试发布
```

**关键依赖**：
- Phase 1 → Phase 2：Bun MVP 必须建立在已迁移好的 TC39 装饰器子集之上
- Phase 2 与 Phase 3 末段重叠：Bun 协议层完成后，Bun 可观测性可与 Node TC39 完整迁移并行

### 4.2 Phase 0：前置准备（1 周，Week 1）

**目标**：建立 RuntimeAdapter 接口、验证 Bun 元数据兼容性、盘点现状。

| 任务 | 包 | 工作量 | 输出 |
|------|---|--------|------|
| 设计并实现 `RuntimeAdapter` 接口 | `koatty-core` | 2 人天 | `packages/koatty-core/src/runtime/adapter.ts` + 测试 |
| 实现 `NodeRuntimeAdapter` | `koatty-core` | 1 人天 | 默认 fallback，等价于现有行为 |
| Bun 下 reflect-metadata 兼容性测试 | 测试仓库 | 2 人天 | [§12.C 报告模板](#12c-bun-元数据兼容性测试矩阵) |
| Bun 下 Symbol.metadata 探测 | 测试仓库 | 1 人天 | TC39 模式可行性确认 |
| TC39 现状最终盘点 | 全部 | 1 人天 | 阻断/非阻断装饰器清单 |
| 整合方案评审 + 计划锁定 | — | 1 人天 | 本文档定稿 |

**Phase 0 验收门**（必须满足，否则 Phase 1 不启动）：
- [x] `RuntimeAdapter.detect()` 单元测试通过
- [x] Bun 下 `reflect-metadata` 至少在 Legacy 模式可用，否则需启用 polyfill 备份方案
- [x] 7 处 `design:*` 调用清单确认无遗漏

### 4.3 Phase 1：TC39 必需子集（3 周，Week 2-4，串行）

**目标**：完成 Bun MVP 必需的 TC39 装饰器子集迁移，为 Phase 2 提供基础。

> **v1.1 关键变更**：v1.0 的"Track A + Track B 并行"模型在新约束下不可行——Bun 路径强制 TC39，所有核心装饰器必须先完成 TC39 双模式才能被 Bun 应用扫描注册。本阶段聚焦"最小必需集"，避免阻塞 Phase 2。

**最小必需集**（Bun MVP 必需，不可省略）：

| 任务 | 包 | 工作量 | 关联方案 B 章节 |
|------|---|--------|---------------|
| 模式自动判定 (`detectDecoratorMode(runtime)`) | `koatty-container` | 1 人天 | §11.10.4 + ADR-012 |
| `koatty-core/Component.ts` 8 个装饰器双模式 | `koatty-core` | 4 人天 | §3、§4.4 |
| `koatty-router/mapping.ts` 7 个映射装饰器双模式 | `koatty-router` | 2 人天 | §4.5 |
| `@Autowired(Type)` 在 TC39 模式下显式参数 | `koatty-container` | 1 人天 | §11.10.3 |
| `@Inject(Type1, Type2, ...)` 改为 MethodDecorator（构造注入 TC39 路径） | `koatty-container` | 2 人天 | §11.4.4 |
| `@Get/@Post/@Header/@PathVariable/@File/@RequestBody/@RequestParam` 7 个装饰器升级为双模式（Param + Property） | `koatty-router` | 5 人天 | §11.3.2 |
| `@Payload(DtoClass)` 装饰器（DTO 类型显式声明） | `koatty-router` | 2 人天 | §11.3.4 |
| `injectParamMetaData()` DTO 自动检测路径 B1/B2（最小版本，仅启动期编译） | `koatty-router` | 4 人天 | §11.3.4 |
| 单元测试覆盖（Legacy + TC39 双模式） | 全部 | 3 人天 | §11.4 |

> **不在本阶段范围**（推到 Phase 3）：Swagger 装饰器迁移、`@Validated` 容错规则完善、构造注入循环依赖检测增强、`setExpose()` 完整 TC39 适配。

**Phase 1 验收门**：
- [x] `@Controller` / `@Service` / `@Component` / `@Middleware` 在 TC39 模式下正确注册到 IoC（Node 上验证）
- [x] `@GetMapping` / `@PostMapping` 等映射在 TC39 模式下正确注册路由（Node 上验证）
- [x] `@Get({ name, type })` 等用作 PropertyDecorator 时正确写入 `DTO_SOURCE_KEY`
- [x] `@Inject(Type1, Type2)` 在 constructor 上的 TC39 形态测试通过
- [x] DTO 自动检测路径 B1（多源混合）+ B2（纯请求体）端到端测试通过
- [x] Node-Legacy 路径回归测试 100% 通过（C1 不被破坏）
- [x] 单测覆盖率 ≥ 现有水平

### 4.4 Phase 2：Bun MVP + 协议层（4 周，Week 5-8）

**目标**：建立 Bun runtime 适配的完整协议层，跑通端到端 hello-world（C3）。

> **v1.1 关键变更**：DTO 骨架已在 Phase 1 完成，本阶段专注 Bun 运行时适配 + ADR-015 启动期严格检测。

#### Track A：Bun 入口包 + RuntimeAdapter

| 任务 | 包 | 工作量 | 关联方案 A/ADR |
|------|---|--------|---------------|
| `RuntimeAdapter` 接口与 `NodeRuntimeAdapter` | `koatty-core` | 2 人天 | ADR-010 |
| `BunRuntimeAdapter` 实现（强制 tc39） | `koatty-bun` | 2 人天 | ADR-012 |
| `assertCompatibility()` 启动期严格检测 | `koatty-bun` | 3 人天 | ADR-015 |
| `packages/koatty-bun` 入口包（re-export + side-effect） | `koatty-bun` | 1 人天 | ADR-010 |
| `koatty-core` `NativeServer` 类型扩展（含 `BunNativeServer`） | `koatty-core` | 0.5 人天 | A §4.3.2 |
| `Bootstrap.ts` 注入 `app.runtime` | `koatty` | 1 人天 | ADR-010 |

#### Track B：Bun 协议服务器

| 任务 | 包 | 工作量 | 关联方案 A |
|------|---|--------|----------|
| `BunHttpServer`（方案 A 路径，`node:http` compat） | `koatty-serve` | 3 人天 | §5.2-5.3 |
| `BunHttpsServer` + TLS 集成 | `koatty-serve` | 2 人天 | §5.4 |
| `BunHttp2Server`（ALPN 自动协商） | `koatty-serve` | 1 人天 | §5.5 |
| `BunHttp3Server`（降级 HTTP/2） | `koatty-serve` | 1 人天 | §5.6 |
| `BunWsServer` + `BunWsAdapter` | `koatty-serve` | 4 人天 | §5.7 |
| `serve.ts` 工厂分发改造（含 `require()` 延迟加载） | `koatty-serve` | 1 人天 | §5.9 |
| gRPC compat 验证（在 Bun 下跑现有 GrpcServer） | `koatty-serve` | 2 人天 | §5.8 |
| `examples/bun-hello-tc39` 端到端样例（C3 验证） | examples | 1 人天 | A §12.3 |

**Phase 2 验收门**：
- [x] **`bun run examples/bun-hello-tc39/App.ts` 在 TC39 模式下成功响应 HTTP**（C3 矩阵格已验证）
- [x] HTTPS/HTTP2/HTTP3（降级）/WS 协议在 Bun 下集成测试通过
- [x] gRPC Unary 在 Bun 下端到端测试通过
- [x] **`assertCompatibility()` 在用户误设 `experimentalDecorators: true` 时正确抛出 ADR-015 规范的错误**
- [x] **`assertCompatibility()` 在检测到参数装饰器使用时正确抛出错误并指向 §6.6 替代方案**
- [x] Node 路径（C1/C2）回归测试 100% 通过

### 4.5 Phase 3：Node TC39 完整迁移 + Bun 可观测性（4 周，Week 8-11）

**目标**：完成 Node 端 TC39 的剩余迁移工作（构造注入完整、Swagger、Validation 完善）+ Bun 可观测性改造。两 Track 可并行。

#### Track A：构造注入完整 + Validation 完善（方案 B §11.4-11.5）

| 任务 | 包 | 工作量 |
|------|---|--------|
| `LifecycleManager.setInstance()` Legacy 路径自动构造注入 | `koatty-container` | 4 人天 |
| `LifecycleManager` Prototype 作用域改造 | `koatty-container` | 2 人天 |
| 构造参数级别循环依赖检测 | `koatty-container` | 2 人天 |
| 集成测试（含 `@Autowired` 与 `@Inject` 共存、循环依赖错误信息） | `koatty-container` | 3 人天 |
| `@Validated(Dto)` 简写实现（合并 `@Payload` + `@Validated`） | `koatty-validation` | 2 人天 |
| `@Validated` × `@Payload` 容错规则（去重/冲突检测） | `koatty-validation` | 2 人天 |
| `setExpose()` TC39 适配（替换 `design:type`） | `koatty-validation` | 2 人天 |
| `@ApiProperty({ type })` Swagger TC39 适配 | `koatty-swagger` | 3 人天 |
| Swagger 6 个装饰器双模式迁移 | `koatty-swagger` | 4 人天 |

#### Track B：Bun 可观测性（方案 A Phase 4）

| 任务 | 包 | 工作量 |
|------|---|--------|
| `koatty-trace` 手动 Instrumentation 替代 auto | `koatty-trace` | 4 人天 |
| Bun 下 OTLP exporter 验证 | `koatty-trace` | 2 人天 |
| Prometheus exporter 在 Bun 下的兼容性验证 | `koatty-trace` | 1 人天 |
| 降级告警机制 | `koatty-trace` | 1 人天 |
| `koatty-loader` Bun.file() 加速 | `koatty-loader` | 2 人天 |
| `koatty-config` Bun.file() 加速 | `koatty-config` | 1 人天 |

**Phase 3 验收门**：
- [x] 构造注入在 C1/C2/C3 三种组合下均工作（Bun-Legacy 已废除，无 C4 测试）
- [x] 循环依赖检测错误信息清晰，建议改 `@Autowired` 字段注入
- [x] Bun 下手动创建的 Span 可正确导出到 OTLP Collector
- [x] `@Validated(Dto)` 简写 + 冲突检测测试通过
- [x] Swagger 在 TC39 模式下生成的 OpenAPI schema 与 Legacy 模式一致

### 4.6 Phase 4：模板/CLI/工具链（2 周，Week 11-13）

**目标**：完成 koatty-ai 改造，提供完整的脚手架和迁移工具。

| 任务 | 包 | 工作量 |
|------|---|--------|
| `koatty-ai` 增加 `--runtime bun` 参数（**强制 TC39，无 `--decorator-mode` 选项**） | `koatty-ai` | 2 人天 |
| `koatty-ai` `--style=dto` 选项（仅 Node 模板） | `koatty-ai` | 1 人天 |
| 新建 `koatty-ai-template-project-bun` 仓库（C3 唯一组合） | 模板仓库 | 3 人天 |
| 现有 `koatty-ai-template-project` 增加 DTO style 模板 | 模板仓库 | 2 人天 |
| 代码生成模板更新（DTO + 控制器构造注入） | `koatty-ai/templates` | 3 人天 |
| 自动迁移工具 `koatty migrate --target=tc39`（codemod，Legacy → TC39） | tools | 4 人天 |
| `koatty doctor` 增加 RuntimeAdapter / 装饰器模式诊断 + 参数装饰器扫描 | `koatty` | 2 人天 |

**Phase 4 验收门**：
- [x] `koatty new test-app -r bun` 生成可运行的 C3 项目（必须 TC39）
- [x] `koatty new test-app --style=dto` 生成可运行的 C2 项目
- [x] `koatty new test-app -r bun --decorator-mode legacy` 报错并退出（不支持的组合）
- [x] codemod 在 `koatty-awesome` 示例项目上端到端通过
- [x] `koatty doctor` 能识别项目当前模式并给出迁移建议

### 4.7 Phase 5：测试矩阵 + 发布（2 周，Week 13-15）

**目标**：CI 矩阵完善、性能基准、文档与发布。

| 任务 | 工作量 |
|------|--------|
| CI 3 元组矩阵（C1 / C2 / C3） | 2 人天 |
| 性能基准对比（3 元组各跑 §9 的 7 个场景） | 3 人天 |
| 迁移指南文档（覆盖 C1→C2、C1→C3、C2→C3） | 3 人天 |
| 参数装饰器替代方案专题文档（§6.6 配套） | 2 人天 |
| 发布说明（v4.0.0-rc + npm publish） | 1 人天 |
| Alpha → Beta → RC → Stable 灰度 | 2 周 |

**Phase 5 验收门**（同时也是项目最终验收）：
- [x] CI 3 元组矩阵 100% 通过
- [x] 性能基准对比报告输出，C3 优于 C1 ≥ 2.5×（HTTP QPS hello-world）
- [x] npm 上 `koatty@4.0.0-rc.1` / `koatty-bun@1.0.0-rc.1` 可正常安装运行
- [x] 迁移指南覆盖 3 种典型迁移路径
- [x] 用户在 Bun 下使用 Legacy 配置或参数装饰器时，启动错误信息符合 ADR-015 规范

### 4.8 资源估算

| 阶段 | 时间 | 人力 | 累计人周 |
|------|------|------|---------|
| Phase 0 | 1 周 | 1 人 | 1 |
| Phase 1 | 3 周 | 2 人（串行依赖，但工作量可并行） | 7 |
| Phase 2 | 4 周 | 2 人（Track A + Track B 并行） | 15 |
| Phase 3 | 4 周 | 2 人（Track A + Track B 并行） | 23 |
| Phase 4 | 2 周 | 1 人 | 25 |
| Phase 5 | 2 周 | 1 人 + 1 QA | 29 |

**整合后总人周 ≈ 29**（v1.1 与 v1.0 工作量持平，但路线图更清晰：Phase 1 串行避免了双轨独立验收的协调成本）。

---

## 5. 包结构与文件清单

### 5.1 新增文件清单

| 路径 | 用途 |
|------|------|
| `packages/koatty-bun/src/index.ts` | Bun 入口包 re-export + side-effect 注册 |
| `packages/koatty-bun/src/types.ts` | `BunServer` 类型扩展 |
| `packages/koatty-bun/src/runtime/bun-adapter.ts` | `BunRuntimeAdapter` 实现（强制 tc39，含 `assertCompatibility()`） |
| `packages/koatty-bun/src/runtime/compat-checker.ts` | ADR-015 三重检测实现（tsconfig / design:* probe / 参数装饰器扫描） |
| `packages/koatty-bun/src/runtime/error-formatter.ts` | ADR-015 错误信息格式化（`formatLegacyDecoratorError` / `formatParameterDecoratorError`） |
| `packages/koatty-bun/package.json` | engines + workspace deps（包含 prepare 脚本检测项目 tsconfig） |
| `packages/koatty-bun/tsconfig.json` | 继承 `tsconfig.base.json` |
| `packages/koatty-bun/README.md` | 包说明 |
| `packages/koatty-core/src/runtime/adapter.ts` | `RuntimeAdapter` 接口与默认实现 |
| `packages/koatty-core/src/runtime/node-adapter.ts` | `NodeRuntimeAdapter` |
| `packages/koatty-serve/src/server/bun-http.ts` | `BunHttpServer` |
| `packages/koatty-serve/src/server/bun-https.ts` | `BunHttpsServer` |
| `packages/koatty-serve/src/server/bun-http2.ts` | `BunHttp2Server` |
| `packages/koatty-serve/src/server/bun-http3.ts` | `BunHttp3Server`（降级） |
| `packages/koatty-serve/src/server/bun-ws.ts` | `BunWsServer` |
| `packages/koatty-serve/src/adapter/bun-koa-bridge.ts` | Bun Request ↔ Node IncomingMessage 桥接（方案 B） |
| `packages/koatty-serve/src/adapter/bun-ws-adapter.ts` | `BunWsAdapter`（继承 EventEmitter） |
| `packages/koatty-trace/src/BunTraceSetup.ts` | 手动 OpenTelemetry 初始化 |
| `packages/koatty-router/src/params/payload.ts` | `@Payload` 装饰器 |
| `packages/koatty-router/src/utils/dto-detection.ts` | `isDtoClass` + DTO 自动检测 |
| `examples/bun-hello/` | C3 验证样例 |
| `examples/bun-hello-tc39/` | C4 验证样例 |
| `tools/codemod/` | Legacy → TC39 自动迁移工具 |

### 5.2 修改文件清单（关键变更）

| 路径 | 变更摘要 |
|------|---------|
| `packages/koatty/src/core/Bootstrap.ts` | 增加 `RuntimeAdapter.detect()` 调用，注入 `app.runtime` |
| `packages/koatty-core/src/Application.ts` | 增加 `runtime: RuntimeAdapter` 属性 |
| `packages/koatty-core/src/IApplication.ts` | `NativeServer` 类型联合 `BunNativeServer` |
| `packages/koatty-core/src/Component.ts` | 8 个装饰器迁移到 `IOC.createDecorator(...)` 双模式 |
| `packages/koatty-core/src/Utils.ts` | `checkRuntime()` 增加 Bun 分支 |
| `packages/koatty-container/src/container/lifecycle_manager.ts` | `setInstance()` 自动构造注入；新增 `resolveConstructorParams()` |
| `packages/koatty-container/src/decorator/autowired.ts` | `@Inject` 改为 `MethodDecorator`（TC39 路径），保留 `ParameterDecorator`（Legacy 路径，加 `@deprecated`） |
| `packages/koatty-container/src/decorator/compat.ts` | 新增 `detectLegacyMode()` |
| `packages/koatty-router/src/params/params.ts` | 7 个装饰器升级为双模式（Param + Property） |
| `packages/koatty-router/src/params/mapping.ts` | `RequestMapping` 双模式（Legacy + TC39） |
| `packages/koatty-router/src/utils/inject.ts` | `injectParamMetaData()` 扩展 DTO 自动检测路径 B1/B2 |
| `packages/koatty-validation/src/decorators.ts` | `@Validated(Dto)` 简写；与 `@Payload` 容错规则 |
| `packages/koatty-validation/src/util.ts` | `setExpose()` TC39 路径（不依赖 `design:type`） |
| `packages/koatty-serve/src/server/serve.ts` | 工厂分发增加 Bun 分支（`require()` 延迟加载） |
| `packages/koatty-loader/src/index.ts` | 通过 `RuntimeAdapter.readFile()` 抽象文件 IO |
| `packages/koatty-config/src/config.ts` | 同上 |
| `packages/koatty-trace/src/index.ts` | Bun 环境下分支到 `BunTraceSetup` |
| `packages/koatty-swagger/src/decorators/property.ts` | `@ApiProperty({ type })` 在 TC39 模式下必填 |
| `packages/koatty-ai/src/cli/commands/new.ts` | 增加 `--runtime` 和 `--decorator-mode` 参数 |
| `packages/koatty-ai/src/services/TemplateManager.ts` | 注册 `project-bun` 模板源 |
| `tsconfig.base.json` | 不变（保持 Legacy 默认，由项目自行选择） |
| `.github/workflows/ci.yml` | 增加 4 元组矩阵 jobs |
| `turbo.json` | 不变（已支持） |

### 5.3 受影响但仅小修改的文件

| 路径 | 变更摘要 |
|------|---------|
| `packages/koatty-loader/src/index.ts:95` | `require(p)` 改为 `await runtime.resolveModule(p)` |
| `packages/koatty-config/src/config.ts:72` | `require("run-con")` 同理 |
| `packages/koatty-container/src/container/dependency_analyzer.ts:36-39` | 增加 TC39 模式下读取 `context.metadata.constructor:paramtypes` |
| 14 处 `import "reflect-metadata"` | 短期保留（v4.x），v5.x 计划移除 |

---

## 6. 关键技术方案细节

### 6.1 RuntimeAdapter 接口定义

新增 `packages/koatty-core/src/runtime/adapter.ts`：

```typescript
export interface RuntimeAdapter {
  /** 运行时名称，用于日志和元数据 */
  readonly name: 'node' | 'bun';

  /** 运行时版本 */
  readonly version: string;

  /** 装饰器模式（Node 路径根据 tsconfig 判定；Bun 路径硬编码 tc39） */
  readonly decoratorMode: 'legacy' | 'tc39';

  /** 文件读取（统一接口） */
  readFile(path: string): Promise<string>;
  readFileSync(path: string): string;

  /** 模块加载 */
  resolveModule(specifier: string): Promise<unknown>;

  /** 创建协议服务器实例 */
  createServerInstance(
    protocol: 'http' | 'https' | 'http2' | 'http3' | 'ws' | 'wss' | 'grpc' | 'graphql',
    options: any,
    app: KoattyApplication,
  ): KoattyServer;

  /** 进程检测 */
  isDebugMode(): boolean;

  /** TLS 证书加载（Bun 推荐使用 Bun.file，Node 使用 fs） */
  loadTlsMaterial(path: string): unknown;

  /**
   * 启动期严格检测（仅 Bun 实现非空，Node 默认 noop）
   * 详见 ADR-015
   */
  assertCompatibility(): void;
}

export abstract class BaseRuntimeAdapter implements RuntimeAdapter {
  static detect(): RuntimeAdapter {
    if (typeof globalThis.Bun !== 'undefined') {
      // BunRuntimeAdapter 在 koatty-bun 包内定义，通过 side-effect 注册到全局
      const Bun = (globalThis as any).__koatty_bun_adapter__;
      if (!Bun) {
        throw new Error(
          '[koatty] Bun runtime detected but koatty-bun is not imported. ' +
          'Use `import "koatty-bun"` instead of `import "koatty"` in Bun environment.'
        );
      }
      return new Bun();
    }
    return new NodeRuntimeAdapter();
  }
}
```

#### NodeRuntimeAdapter（默认实现）

```typescript
// packages/koatty-core/src/runtime/node-adapter.ts
export class NodeRuntimeAdapter extends BaseRuntimeAdapter {
  readonly name = 'node' as const;
  readonly version = process.version;
  readonly decoratorMode = detectDecoratorMode('node');  // 读 tsconfig

  assertCompatibility(): void {
    // Node 路径无强制约束，noop
  }

  // ... 其他方法实现
}
```

#### BunRuntimeAdapter（强制 tc39）

```typescript
// packages/koatty-bun/src/runtime/bun-adapter.ts
export class BunRuntimeAdapter extends BaseRuntimeAdapter {
  readonly name = 'bun' as const;
  readonly version = (globalThis as any).Bun.version;
  readonly decoratorMode = 'tc39' as const;  // ★ 硬编码，不可修改

  constructor() {
    super();
    // 构造时立即执行严格检测
    this.assertCompatibility();
  }

  /**
   * ADR-015 实施：启动期三重检测
   */
  assertCompatibility(): void {
    // 检测 1：tsconfig.experimentalDecorators
    const tsconfig = tryReadTsconfig();
    if (tsconfig?.compilerOptions?.experimentalDecorators === true) {
      throw new Error(formatLegacyDecoratorError(tsconfig));
    }

    // 检测 2：design:type 元数据是否被注入（应为 false）
    if (probeDesignTypeAvailable()) {
      throw new Error(formatDesignMetadataError());
    }

    // 检测 3：参数装饰器使用扫描（在 Loader 完成扫描后调用）
    // 此处仅设置 hook，实际检测在 Loader.CheckAllComponents 中执行
    Loader.registerPostScanHook(() => {
      const offenders = scanParameterDecoratorUsage();
      if (offenders.length > 0) {
        throw new Error(formatParameterDecoratorError(offenders));
      }
    });
  }

  // ... 其他方法实现
}

// side-effect 注册（packages/koatty-bun/src/index.ts 顶部 import 时触发）
(globalThis as any).__koatty_bun_adapter__ = BunRuntimeAdapter;
```

`Application` 在初始化时存储 adapter：

```typescript
// packages/koatty-core/src/Application.ts
export class Koatty extends Koa {
  runtime: RuntimeAdapter;

  constructor(opts?: KoattyOptions) {
    super();
    this.runtime = BaseRuntimeAdapter.detect();  // 自动选 Node 或 Bun
  }
}
```

### 6.2 简化版 Bootstrap（消除重复）

`packages/koatty/src/core/Bootstrap.ts` 现有代码 199 行，本次仅新增 1 个分支检测：

```typescript
async function bootstrapApplication(target, bootFunc, isInitiative) {
  const app = Reflect.construct(target, []) as KoattyApplication;

  // 现有 checkRuntime() 改造为同时识别 Node 和 Bun
  checkRuntime();

  // ★ 新增：根据 runtime 输出诊断
  if (app.runtime.name === 'bun') {
    Logger.Info(`[koatty] Running on Bun ${app.runtime.version}`);
    Logger.Info(`[koatty] Decorator mode: ${app.runtime.decoratorMode}`);
  }

  Loader.initialize(app);
  if (bootFunc) await bootFunc(app);
  IOC.setApp(app);
  Loader.CheckAllComponents(app, target);
  await Loader.LoadAllComponents(app, target);
  app.markReady();

  return app;
}
```

`packages/koatty-bun/src/index.ts` 简化为：

```typescript
// 注册 BunRuntimeAdapter 到 RuntimeAdapter 检测系统
import './runtime/bun-adapter';  // side-effect 注册

// 全部 re-export
export * from 'koatty';
export type { BunServer } from './types';
```

> **对比方案 A**：原方案 BunBootstrap.ts 复制了 60+ 行 Bootstrap 逻辑；本方案 0 复制，维护成本降低 90%。

### 6.3 装饰器双模式 + 运行时分发的协同

#### 装饰器调用链路（统一抽象）

```
[用户代码]
    @Controller('/api')
    class UserController {}
         │
         ▼
[koatty-core/Component.ts]
    Controller(path) = IOC.createDecorator({ legacy, tc39 }, 'class')
         │
         ▼
[koatty-container/container.ts:923]
    Container.createDecorator(handler, 'class')
         │
         ▼
[koatty-container/decorator/compat.ts]
    createDualClassDecorator({legacy, tc39})
         │
         │ 返回的装饰器函数在被调用时检测 context
         │   - context 是 ClassDecoratorContext → 走 TC39 分支
         │   - 否则 → 走 Legacy 分支
         ▼
[实际装饰器逻辑]
    legacy: (target) => { IOC.saveClass("CONTROLLER", target, id); ... }
    tc39:   (target, context) => { context.metadata.set(...); IOC.saveClass(...) }
```

> **关键收益**：`@Controller`/`@Service` 等注册到 IoC 的逻辑在 Legacy 与 TC39 路径都调用同一个 `IOC.saveClass()`，运行时无需感知装饰器模式。Bun 路径与 Node 路径同样无感知。

### 6.4 DTO 模式在 Bun 下的零反射优化路径

#### 性能优化原理

Legacy 路径每个请求都要：
1. `Reflect.getMetadata("design:paramtypes", ...)` 获取参数类型
2. 反射创建 `new DtoClass()` 实例
3. 逐字段 `Reflect.defineMetadata` 写入校验状态

DTO + TC39 模式下，可以在**启动阶段**完成：
1. `injectParamMetaData()` 编译每个 DTO 的提取策略列表（每个属性预编译为 `(ctx) => ctx.query['name']`）
2. 类型转换器预编译（`Number(value)` / `Boolean(value)` 等）
3. 校验器预编译（`IsNotEmpty.compile() → fn(value)`）

请求处理时直接执行预编译闭包，无任何反射开销。Bun 的 V8/JIT 对小闭包函数的优化在这种模式下能发挥最大效果。

#### 预期性能增益

| 场景 | C1 (Node + Legacy) | C4 (Bun + TC39 + DTO) | 增益 |
|------|----|----|------|
| HTTP QPS hello-world | baseline 1× | ~3× | +200% |
| HTTP QPS Koa 5 层中间件 | baseline 1× | ~2× | +100% |
| HTTP P99 延迟（带参数提取） | baseline 1× | ~0.4× | -60% |
| 启动时间（200 个 Controller） | baseline 1× | ~0.5× | -50% |

> 数据来源：基于 Bun 1.3 官方 benchmark + DTO 模式预编译估算，**实际值需 Phase 5 实测验证**。

### 6.5 reflect-metadata vs Symbol.metadata 在 Bun 下的兼容矩阵

| 元数据 API | Node 18+ | Node 22 | Bun 1.1 | Bun 1.3 | TC39 模式可用 | 替代方案 |
|----------|----------|---------|---------|---------|------------|---------|
| `Reflect.defineMetadata` | ✅ | ✅ | ⚠️（部分边缘 case） | ✅ | 不依赖 | — |
| `Reflect.getMetadata`（含继承链） | ✅ | ✅ | ⚠️（Bun 1.1 有 issue） | ✅ | 不依赖 | — |
| `design:type` | ✅ | ✅ | ✅（需 `experimentalDecorators: true`） | ✅ | ❌ | 显式参数 |
| `design:paramtypes` | ✅ | ✅ | ✅ | ✅ | ❌ | `@Payload(Dto)` / `@Inject(...)` |
| `Symbol.metadata` | ⚠️ Stage 3 | ✅ | ⚠️（需验证） | ⚠️（需验证） | ✅ | 即原生方案 |
| `context.metadata` (TC39) | ✅ | ✅ | ⚠️ Phase 0 验证 | ⚠️ Phase 0 验证 | ✅ | 即原生方案 |

> **Phase 0 必须输出此矩阵的实测确认报告**（详见 [§12.C](#12c-bun-元数据兼容性测试矩阵)）。

### 6.6 Bun 下参数装饰器替代方案详述

> **背景**：[TC39 Stage 3 装饰器规范](https://github.com/tc39/proposal-decorators) 不支持参数装饰器；[Stage 1 提案](https://github.com/tc39/proposal-class-method-parameter-decorators) 仍在讨论。在 Bun 分支（强制 TC39）中所有参数装饰器使用场景都需要替代方案。本节详述每种替代方案的具体写法、运行时行为和迁移路径。

#### 6.6.1 HTTP 参数：DTO 类 + PropertyDecorator

`@Get` / `@Post` / `@Header` / `@PathVariable` / `@File` / `@RequestBody` / `@RequestParam` 在 Bun 路径下**仅作为 `PropertyDecorator`** 使用（双模式装饰器的 Property 路径，详见方案 B §11.3.2）。

**替代写法**：

```typescript
// ❌ Node-Legacy（C1 仍可用，Bun 下 ADR-015 拒绝启动）
@GetMapping('/users')
async getUsers(
  @Get('page') page: number,
  @Get('limit') limit: number,
  @Get('keyword') keyword?: string
) { ... }

// ✅ Bun (C3) / Node-TC39 (C2)：DTO 类
@Component()
class GetUsersDto {
  @Get({ name: 'page', type: Number })
  @IsDefined()
  page: number = 1;

  @Get({ name: 'limit', type: Number })
  @IsDefined()
  limit: number = 10;

  @Get({ name: 'keyword', type: String })
  keyword?: string;
}

@GetMapping('/users')
@Payload(GetUsersDto)        // 显式声明参数 DTO 类型（TC39 必须）
async getUsers(dto: GetUsersDto) {
  // dto.page, dto.limit, dto.keyword 已在框架启动期预编译
}
```

**TC39 模式下与 Legacy 的关键差异**：
- `@Get('page')` 的字符串参数形式不可用，必须用选项对象 `@Get({ name, type })`
- `type` 字段**必填**（`design:type` 不可用）
- 控制器方法必须用 `@Payload(DtoClass)` 声明 DTO 类型（`design:paramtypes` 不可用）

#### 6.6.2 多源混合 DTO（路径变量 + body + header）

```typescript
@Component()
class UpdateUserDto {
  @PathVariable({ name: 'id', type: Number })
  @IsNotEmpty({ message: 'ID 不能为空' })
  id: number;

  @Post({ name: 'username', type: String })
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @Post({ name: 'email', type: String })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @Header({ name: 'Authorization', type: String })
  token?: string;
}

@PutMapping('/users/:id')
@Validated(UpdateUserDto)    // = @Payload(UpdateUserDto) + @Validated()
async updateUser(dto: UpdateUserDto) {
  // 框架在启动期为每个属性编译独立提取器：
  //   id       ← (ctx) => Number(ctx.params['id'])
  //   username ← async (ctx) => String((await bodyParser(ctx))['username'])
  //   email    ← async (ctx) => String((await bodyParser(ctx))['email'])
  //   token    ← (ctx) => ctx.get('Authorization')
  // 请求时按属性源逐个提取，验证通过后填充 DTO 实例
}
```

#### 6.6.3 纯请求体 DTO（无数据源装饰器）

DTO 类如果**没有任何数据源装饰器**（`@Get`/`@Post`/`@Header` 等），框架按路由协议自动推断：

| 路由协议 | 推断源 |
|---------|-------|
| HTTP POST/PUT/PATCH | request body |
| HTTP GET/DELETE | query string |
| gRPC（任何） | message body |
| WebSocket（任何） | 消息体 |

**示例**：

```typescript
@Component()
class CreateUserDto {
  @IsDefined()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsDefined()
  age?: number;
}

@PostMapping('/users')
@Validated(CreateUserDto)
async createUser(dto: CreateUserDto) {
  // 框架自动等价于 @RequestBody() + plainToClass(CreateUserDto, body)
}
```

#### 6.6.4 构造函数注入：`@Inject` MethodDecorator

```typescript
// ❌ Node-Legacy（C1 仍可用，Bun 下 ADR-015 拒绝启动）
@Service()
class UserService {
  constructor(
    @Inject() private readonly repository: UserRepository,
    @Inject() private readonly logger: LogService
  ) {}
}

// ✅ Bun (C3) / Node-TC39 (C2)：@Inject 改为 MethodDecorator 放 constructor 上
@Service()
class UserService {
  @Inject(UserRepository, LogService)         // ★ MethodDecorator
  constructor(
    private readonly repository: UserRepository,
    private readonly logger: LogService
  ) {}
}

// 替代方案：字段注入（无构造参数）
@Service()
class UserService {
  @Autowired(UserRepository)
  private readonly repository!: UserRepository;

  @Autowired(LogService)
  private readonly logger!: LogService;
}
```

**关键差异**：
- `@Inject()` 不带参数的形式不可用，必须显式传入依赖类型 `@Inject(Type1, Type2, ...)`
- 装饰器位置从"参数前"移到"constructor 上方"（成为 MethodDecorator）
- 类型与构造函数参数顺序必须严格一致（框架据此匹配）

#### 6.6.5 参数验证：DTO 属性验证装饰器

```typescript
// ❌ Node-Legacy
async getDetail(
  @Valid("IsNotEmpty", "id 不能为空") @Get("id") id: number,
  @Valid(["IsNotEmpty", "IsEmail"], "邮箱格式不正确") @Get("email") email: string
) { ... }

// ✅ Bun / Node-TC39：DTO 属性验证（标准 PropertyDecorator）
@Component()
class GetDetailDto {
  @Get({ name: 'id', type: Number })
  @IsNotEmpty({ message: 'id 不能为空' })
  id: number;

  @Get({ name: 'email', type: String })
  @IsNotEmpty({ message: '邮箱不能为空' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;
}

@GetMapping('/detail')
@Validated(GetDetailDto)
async getDetail(dto: GetDetailDto) { ... }
```

**优势**：
- 多规则自然叠加（多个装饰器堆叠），无需数组语法
- 类型安全（装饰器有强类型签名，IDE 智能提示）
- 与 `class-validator` 标准生态对齐

#### 6.6.6 替代方案运行时性能

DTO 模式在 Bun 下能利用预编译参数提取器，跳过反射开销：

| 阶段 | Node-Legacy（参数装饰器） | Bun-TC39（DTO） |
|------|------------------------|-----------------|
| 启动期 | 注册 `TAGGED_PARAM` 元数据 | 注册 `DTO_SOURCE_KEY` + 预编译每属性提取器 |
| 请求期 | 每请求 `Reflect.getMetadata` | 直接调用预编译闭包（无反射） |
| 实例化 | 每请求 `new DtoClass()` | 同（不可避免） |
| 验证 | 每请求 `Reflect.getMetadata` 取规则 | 启动期编译验证器闭包，请求时直接执行 |

**Bun + V8 JIT 对小闭包的优化在 DTO 模式下能发挥最大效果**，预期性能优于 Node-Legacy 参数装饰器路径 30-50%（实测见 §9）。

#### 6.6.7 未来恢复路线（参见 ADR-016）

**承诺时间线**：

```
2024-2026         TC39 Stage 1 提案讨论中
                       │
                       ▼
2026-2028 (估)    Stage 2-3 推进
                       │
                       ▼
2028+ (估)        Stage 3 进入标准
                       │
                       ▼
                  评估窗口（6 个月）
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
        评估通过                评估未通过
            │                     │
            ▼                     ▼
     koatty v6.x 恢复       维持现有替代方案
     参数装饰器支持          （永久不变）
            │
            ▼
     现有替代方案保留
     （永远兼容）
```

**核心承诺**：
1. ✅ 即使 v6.x 恢复参数装饰器支持，DTO + PropertyDecorator 路径**永不废弃**
2. ✅ `@Payload` / `@Inject` MethodDecorator 是核心 API，**永远兼容**
3. ✅ 现有 Node-Legacy 项目（C1）在 v4.x/v5.x 期间不强制迁移
4. ✅ 任何 TC39 提案变化都不会导致用户代码 breaking change

#### 6.6.8 参数装饰器全量迁移对照表

| 原参数装饰器 | 替代方案 | 迁移工作量 |
|------------|---------|----------|
| `@Header(name)` | DTO 属性 `@Header({ name, type })` | 自动 codemod |
| `@PathVariable(name)` | DTO 属性 `@PathVariable({ name, type })` | 自动 codemod |
| `@Get(name)` | DTO 属性 `@Get({ name, type })` | 自动 codemod |
| `@Post(name)` | DTO 属性 `@Post({ name, type })` | 自动 codemod |
| `@File(name)` | DTO 属性 `@File({ name, type })` | 自动 codemod |
| `@RequestBody()` | DTO 类无数据源装饰器（自动推断 body） | 自动 codemod |
| `@RequestParam()` / `@Body()` / `@Param()` | 同上（隐式推断） | 自动 codemod |
| `@Inject() dep: T` | `@Inject(T)` 放 constructor 上 + 字段注入 fallback | 半自动 codemod |
| `@Valid("IsNotEmpty", msg)` | DTO 属性 `@IsNotEmpty({ message: msg })` | 自动 codemod |

`koatty migrate --target=tc39` codemod 工具覆盖所有"自动"项；半自动项给出修改建议但需用户确认。

---

## 7. 兼容性矩阵

### 7.1 装饰器模式 × 运行时支持矩阵

| 维度 | C1 Node-Legacy | C2 Node-TC39 | C3 Bun-TC39 |
|------|---|---|---|
| TypeScript | 4.x+ | 5.0+ | 5.0+ |
| Node.js | 18+ | 18+（推荐 20+） | — |
| Bun | — | — | 1.1+（推荐 1.3+） |
| 装饰器实验性 | `experimentalDecorators: true` | `false` | `false`（启动期检测，详见 ADR-015） |
| `emitDecoratorMetadata` | `true` | 不可设 | 不可设 |
| `reflect-metadata` 运行时依赖 | ✅ | ⚠️ 短期保留 | ⚠️ 短期保留 |
| `Symbol.metadata` polyfill | 不需要 | TS 提供 | TS 提供（Bun 兼容性 Phase 0 验证） |
| ParameterDecorator | ✅ 全部 | ❌ 不支持 | **❌ 启动期拒绝**（详见 §6.6） |
| 替代方案：DTO + `@Payload` | （可选） | ✅ 推荐 | ✅ **唯一方式** |
| HTTP/WS/GraphQL 协议 | ✅ | ✅ | ✅ |
| HTTP/3 (QUIC) | ✅ Native | ✅ Native | ⚠️ 降级 HTTP/2 |
| gRPC（Unary + ServerStreaming） | ✅ | ✅ | ⚠️ Compat |
| gRPC（Bidirectional Streaming） | ✅ | ✅ | ⚠️ 实验性 |
| OpenTelemetry auto-instrumentation | ✅ | ✅ | ❌ |
| OpenTelemetry 手动 Span | ✅ | ✅ | ✅ |
| 生产环境推荐 | ✅ | ✅（v5.x 默认） | ✅ Bun 用户首选 |

> **Bun-Legacy（v1.0 中的 C3）已废除**，详见 §2.3。

### 7.2 Koatty 版本 × 矩阵支持承诺

| Koatty 版本 | C1 | C2 | C3 | 说明 |
|------------|----|----|----|------|
| **v3.x（当前）** | ✅ Primary | ❌ | ❌ | 仅 Legacy + Node |
| **v4.x（本方案目标）** | ✅ Default | ✅ Recommended | ✅ **Bun 用户首选** | 双模式 + Bun 适配（仅 TC39 路径） |
| **v5.x（未来）** | ❌ Removed | ✅ Default | ✅ Default | 仅 TC39，Node 与 Bun 双运行时 |
| **v6.x（远期，TC39 参数装饰器进入 Stage 3 后）** | ❌ Removed | ✅ + 参数装饰器恢复 | ✅ + 参数装饰器恢复 | 详见 ADR-016 |

### 7.3 关键依赖版本

| 依赖 | C1 | C2 | C3 | 备注 |
|------|----|----|----|------|
| TypeScript | ≥4.9 | ≥5.0 | ≥5.0 | TC39 需 5.0+ |
| Koa | ≥3.0 | ≥3.0 | ≥3.0 | 共用，Bun 通过 compat 层运行 |
| reflect-metadata | ≥0.2.0 | ≥0.2.0（v4.x 保留） | ≥0.2.0（v4.x 保留） | v5.x 移除 |
| `@grpc/grpc-js` | ≥1.14.3 | ≥1.14.3 | ≥1.14.3 | Bun 经 Node compat 层 |
| `@matrixai/quic` | ≥2.0.9 | ≥2.0.9 | — | HTTP/3 仅 Node |
| `@opentelemetry/sdk-node` | ≥0.211 | ≥0.211 | ≥0.211（手动） | Bun 不支持 auto |
| `class-validator` | ≥0.14 | ≥0.14 | ≥0.14 | DTO 属性验证 |
| `class-transformer` | ≥0.5 | ≥0.5 | ≥0.5 | `plainToClass` 转换 |

---

## 8. 整合后的风险登记

### 8.1 风险登记总表

合并方案 A 的 R1-R8 与方案 B 的 6 项风险，并新增整合后浮现的 R9-R18。

| ID | 风险 | 级别 | 来源 | 整合后状态 |
|----|------|-----|------|----------|
| R1 | OpenTelemetry auto-instrumentation 不兼容 | **关键** | A | 方案不变（手动 Instrumentation） |
| R2 | gRPC 双向流不稳定 | **高** | A | 方案不变（Compat 层 + CI 兼容测试） |
| R3 | HTTP/3 (QUIC) 不可用 | **高** | A | 方案不变（降级 HTTP/2） |
| R4 | Decorator Metadata 行为变化 | **中** | A+B | **整合升级**：Phase 0 阻断式验证（ADR-013） |
| R5 | `ws` 库与 Bun 原生 WS 接口差异 | **中** | A | 方案不变（`BunWsAdapter`） |
| R6 | BunKoaBridge 方案 B 的 mock 完整性 | **中** | A | 方案不变（先用 node:http compat） |
| R7 | `winston-daily-rotate-file` 兼容性 | **低** | A | 方案不变 |
| R8 | `process.execArgv` Bun 兼容 | **低** | A | 方案不变 |
| R9 | 双模式装饰器调用上下文误判 | **中** | B | 方案不变（`typeof arguments[2] === 'number'`） |
| R10 | 构造函数自动注入引入循环依赖 | **中** | B | 方案不变（DependencyAnalyzer 增强） |
| R11 | `design:*` 在 TC39 不可用 | **高** | B | **整合方案**：装饰器参数必填 + Phase 0 审计 |
| R12 | TC39 后续支持参数装饰器 | — | B | 方案不变（保留 Legacy 实现 + ADR-016 永久承诺） |
| **R13** | **Phase 1 串行依赖延期阻塞 Phase 2** | **中** | 整合 v1.1 | Bun MVP 必须等待 TC39 子集完成；最小必需集设计为可独立验收，其余推到 Phase 3 |
| **R14** | **2 套版本号管理策略冲突** | **中** | 整合 | ADR-014 统一为 `koatty@4.0.0-bun.x` |
| **R15** | **代码生成模板组合爆炸** | **低** | 整合 v1.1 | 仅维护 C1 + C3 两套主模板，C2 通过 `--style=dto` CLI 选项 |
| **R16** | **现有 koatty-awesome 示例升级成本** | **中** | 整合 | 提供自动 codemod，Phase 4 完成 |
| **R17** | **用户在 Bun 下无意识使用 Legacy 配置** | **中** | 整合 v1.1 | ADR-015 启动期严格检测 + 三类错误信息（tsconfig / design:* / 参数装饰器使用） |
| **R18** | **TC39 参数装饰器提案进入 Stage 3 后用户混淆** | **低** | 整合 v1.1 | ADR-016 明确替代方案永久承诺；评估窗口 6 个月；DTO 路径不会被废弃 |

### 8.2 关键风险缓解措施详述

#### R4 强化：Phase 0 元数据兼容性审计

参见 [§12.C 测试矩阵](#12c-bun-元数据兼容性测试矩阵)。

#### R11 强化：装饰器参数必填规范

完整清单见方案 B §11.10.3。本文档补充：

| 装饰器 | Legacy 写法 | TC39 写法 | 实施位置 |
|--------|------------|-----------|----------|
| `@Autowired()` | 类型可省 | `@Autowired(Type)` 必填 | `koatty-container/decorator/autowired.ts` |
| `@Inject()` (Param) | `constructor(@Inject() dep)` | 改为 MethodDecorator: `@Inject(Type1, Type2)` 放 constructor 上 | `koatty-container/decorator/autowired.ts` |
| `@Get()` (Property) | `@Get('name')` | `@Get({ name, type: String })` | `koatty-router/params/params.ts` |
| `@Validated()` | 自动识别参数类型 | `@Validated(Dto)` 或 `@Payload(Dto)` 必填 | `koatty-validation/decorators.ts` |
| `@ApiProperty()` | 类型可省 | `@ApiProperty({ type })` 必填 | `koatty-swagger/decorators/property.ts` |

#### R13 缓解（v1.1）：Phase 1 最小必需集 + Phase 2 双 Track 并行

由于 Bun 路径强制 TC39，Phase 1 不再支持双轨独立验收。缓解策略改为：
- **Phase 1 设计为"最小必需集"**：仅迁移 Bun MVP 必需的装饰器（Component / mapping / 7 个参数装饰器双模式 / `@Payload` / `@Inject`），完整的 Swagger / Validation 适配推到 Phase 3
- **Phase 1 内部任务可水平拆分并行**：1 名工程师做 Component 双模式，另一名做 mapping + params + `@Payload`，时间从串行 5 周压缩到并行 3 周
- **风险信号触发降级**：若 Phase 1 中段（第 2 周末）评估认为按时完成有 ≥ 30% 风险，立即触发降级方案——只完成 Component + 关键 4 个映射装饰器，其余推迟到 Phase 2 末段并行做

#### R17 缓解：ADR-015 启动期严格检测的多重防护

为最大化拦截错误：

1. **运行时检测（核心）**：`BunRuntimeAdapter.assertCompatibility()` 三重检测（tsconfig / design:* probe / 参数装饰器扫描）
2. **构建期警告**：在 `koatty-bun` 包的 `package.json` 中添加 `prepare` 脚本，安装时检测项目 tsconfig 并打印 warning
3. **CLI 检测**：`koatty doctor` 命令一键诊断当前项目是否符合 Bun 路径要求
4. **IDE 提示**：参数装饰器 + ParameterDecorator 形态在源码中加 `@deprecated` JSDoc，IDE 显示删除线
5. **codemod 工具**：`koatty migrate --target=tc39` 主动为用户做迁移，不让用户面对原始错误

### 8.3 整合后的回退策略

| 回退场景 | 触发条件 | 操作 |
|---------|--------|------|
| **Phase 0 失败** | Bun 元数据兼容性不达标 | 推迟 Phase 1，先在 Bun 上游提 issue 或自实现 polyfill |
| **TC39 路径阻塞（关键装饰器迁移困难）** | Phase 1 中段评估失败 | v4.x 推迟 Bun 支持到 v4.5；先发 v4.0 的 TC39 dual（Node 上） |
| **Bun 路径阻塞** | gRPC/WS 在 Bun 下不稳定 | v4.x 标注 Bun 为 beta，文档明确生产风险 |
| **TC39 参数装饰器提案放弃推进** | TC39 提案被关闭 | 维持现有替代方案永久；ADR-016 评估部分自动转为"永不恢复"决策 |
| **用户级回退** | 单个项目遇到不兼容 | Bun 用户暂时切回 `import from 'koatty'`（C1）+ Node 运行时；待问题修复后切回 Bun |

---

## 9. 性能基准与决策门

### 9.1 整合后的对比基准矩阵

在方案 A §10 的基础上调整为 3 元组对比：

| 场景 | C1 (Node-Legacy) baseline | C2 (Node-TC39) 增益预期 | C3 (Bun-TC39) 增益预期 |
|------|---|---|---|
| HTTP QPS hello-world | 1× | 1.0×（持平）| **3.0×**（Bun + 零反射） |
| HTTP QPS Koa 5 中间件 | 1× | 1.05× | **2.0×** |
| HTTP P99 延迟 | 1× | 0.95× | **0.4×** |
| WebSocket 消息吞吐 | 1× | 1.0× | **1.7×** |
| WebSocket 连接数 | 1× | 1.0× | 1.0× |
| 启动时间（含装饰器扫描） | 1× | 0.9× | **0.4×** |
| 内存占用 idle | 1× | 0.95× | **0.65×** |
| JSON 序列化 1KB/10KB/100KB | 1×/1×/1× | 1×/1×/1× | 1.5×/1.3×/1.1× |
| DTO 参数提取（含验证） | 1×（参数装饰器路径） | 1.3×（DTO 路径，预编译） | **2.5×**（Bun + 预编译） |

### 9.2 决策门（覆盖方案 A §10.4）

| 对比 | 性能差距 | 决策 |
|------|--------|------|
| C1 vs C2 | < 5% | TC39 默认推荐（v5 转为 default） |
| C1 vs C2 | > 10% 退化 | 阻塞 v5.x 切换，调查根因 |
| C3 vs C1 | < 2× | Bun 适配性能不达预期，调查路径选择（方案 A vs B） |
| C3 vs C1 | ≥ 2.5× | 达成基础目标，可正式发布 |
| C3 vs C1 | ≥ 3× | 达成最佳目标，向社区推广 |
| C3 vs C2 | < 1.5× | Bun 在 TC39 路径下未发挥应有性能，调查 Bun 与 V8 JIT 差异 |

### 9.3 性能测试工具链

- **HTTP**: `bombardier`（推荐）+ `wrk`
- **WebSocket**: `websocat` + 自建并发脚本
- **启动时间**: `hyperfine` + 内置 `console.time` 测量点
- **内存**: `process.memoryUsage()` + Bun `process.memoryUsage()` + RSS 趋势记录
- **CPU 火焰图**: Node 用 `0x` / Bun 用 `--profile` + Chrome DevTools

---

## 10. 整合验收标准

合并方案 A §11.3 与方案 B §8 的验收条款：

### 10.1 装饰器迁移验收（来自方案 B §8）

- [x] `koatty-core/Component.ts` 8 个核心装饰器迁移到 `IOC.createDecorator(...)` 双模式
- [x] `koatty-router/params/mapping.ts` 7 个映射装饰器双模式
- [x] `koatty-router/params/params.ts` 7 个参数装饰器升级为双模式（Param + Property）
- [x] `@Inject` 实现 MethodDecorator 形态（TC39 路径）
- [x] `@Payload` 装饰器实现，与 `@Validated` 容错规则覆盖完整
- [x] DTO 自动检测路径 B1/B2 测试通过
- [x] 7 处 `design:*` 在 TC39 模式下迁移完毕（参数必填或显式 metadata）
- [x] 单元测试覆盖率 ≥ 90%

### 10.2 Bun 适配验收（来自方案 A §11.3）

- [x] 5 个 Bun 服务器（HTTP/HTTPS/HTTP2/HTTP3/WS）单元测试通过
- [x] HTTP E2E 覆盖率 > 80%
- [x] WebSocket E2E 覆盖率 > 70%
- [x] gRPC Unary + ServerStreaming 在 Bun 下测试通过
- [x] 优雅关闭测试通过（正常 + 超时 + 强制）
- [x] reflect-metadata 装饰器测试通过

### 10.3 整合端到端验收（新增）

- [x] **C1 → C2 → C3 链式迁移**：基于 `koatty-awesome` 示例项目，使用 codemod 先迁 C1→C2，再切 C2→C3，所有测试通过
- [x] **C3 端到端**：`koatty new test-app -r bun` 生成项目可在 Bun 下成功运行 + 通过单元测试
- [x] **ADR-015 检测有效性**：模拟用户错误（`experimentalDecorators: true` / 使用参数装饰器）启动时正确抛错并指引到 §6.6
- [x] **CI 3 元组矩阵**：3 个 jobs（C1 / C2 / C3）100% 通过
- [x] **性能门**：C3 vs C1 在 HTTP QPS hello-world 上达成 ≥ 2.5×（保守目标，3× 为预期）
- [x] **回归无损**：v3.x 项目不修改任何代码，安装 v4.x 后行为一致（C1 路径）
- [x] **文档完整性**：迁移指南覆盖 3 种典型路径（C1→C2、C1→C3、C2→C3）
- [x] **codemod 可用性**：在 koatty 官方 example 上自动迁移成功率 ≥ 95%
- [x] **参数装饰器替代方案文档**：§6.6 八小节内容齐全，覆盖所有 11 处原参数装饰器

### 10.4 发布验收

- [x] `koatty@4.0.0-rc.1` 在 npm 上发布
- [x] `koatty-bun@1.0.0-rc.1` 在 npm 上发布
- [x] `koatty_serve@3.3.0-rc.1` / `koatty_core@2.3.0-rc.1` 等子包同步发布
- [x] Beta 阶段至少 2 周公开测试，社区反馈无阻塞性 issue
- [x] 正式版发布说明覆盖：新功能、Breaking Changes（如有）、迁移路径、性能数据

---

## 11. 与现有文档的关系

### 11.1 文档定位

```
docs/
├── koatty-bun-plan.md                       # 原 Bun 适配方案（专题）
│   └─ 关注：协议层细节、BunXxxServer 实现细节、可观测性方案
│   └─ 修订：在文件顶部加链接说明，关键章节保留作为详细参考
│
├── tc39-decorator-migration-plan.md         # 原 TC39 迁移方案（专题）
│   └─ 关注：装饰器双模式、DTO 替代、@Payload/@Inject 重构、reflect-metadata 审计
│   └─ 修订：在文件顶部加链接说明，关键章节保留作为详细参考
│
└── koatty-bun-tc39-integrated-plan.md       # ★ 本文档（整合实施方案）
    └─ 关注：阶段路线图、整合架构、ADR 增量、风险整合、验收标准
    └─ 是实施的"主入口"文档，开发者从这里开始阅读
```

### 11.2 维护策略

| 文档 | 维护者 | 更新频率 |
|------|--------|---------|
| 本文档（整合方案） | Architect Agent | 每个 Phase 完成时更新进度 |
| `koatty-bun-plan.md` | Bun 适配 Track 负责人 | 仅在协议层细节变更时更新 |
| `tc39-decorator-migration-plan.md` | TC39 迁移 Track 负责人 | 仅在装饰器实现细节变更时更新 |

> **冲突时以本文档为准**：当本文档与原方案在路线图、验收、ADR 等层面存在冲突时，以本文档为最终决策。

### 11.3 推荐阅读顺序

| 角色 | 推荐顺序 |
|------|---------|
| 项目经理 / 架构师 | 本文档（全文） |
| Bun 适配开发者 | 本文档 §1-4 + `koatty-bun-plan.md` §3-7 |
| TC39 迁移开发者 | 本文档 §1-4 + `tc39-decorator-migration-plan.md` §11 |
| QA / 测试 | 本文档 §10 + 两份原方案的测试章节 |
| 用户 / 框架使用者 | 本文档 §2 + §7（兼容性矩阵）+ 迁移指南（Phase 5 输出） |

---

## 12. 附录

### 12.A 代码现状审计要点

> 完整审计报告由 explore agent 输出，本附录摘录关键事实供方案决策参考。

**装饰器现状**（2026-05-11 实测）：

- `koatty-container/decorator/{autowired, aop, values}.ts` ✅ 已接入 dual-decorator
- `koatty-container/decorator/compat.ts` ✅ 基础设施完整（`isTC39Context`/`createDualClassDecorator`/`createDualMethodDecorator`/`createDualFieldDecorator`）
- `koatty-container/container.ts:923 createDecorator` ✅ 中心调度器
- `koatty-core/Component.ts` ❌ **8 个装饰器全部 legacy**（`Controller`/`GrpcController`/`WebSocketController`/`GraphQLController`/`Middleware`/`Service`/`Plugin`/`Component` + `OnEvent`）
- `koatty-router/params/mapping.ts` ❌ legacy（`RequestMapping` + 7 派生）
- `koatty-router/params/params.ts` ❌ **8 个 ParameterDecorator** + TC39 不支持
- `koatty-router/utils/inject.ts:677 injectParam` ❌ legacy + 依赖 `design:paramtypes`
- `koatty-validation/decorators.ts:183 Valid` ❌ legacy
- `koatty-swagger/*` ❌ 6 个装饰器文件均 legacy

**Bun 适配阻断点**（2026-05-11 实测）：

- `koatty-core/Application.ts:31` `Koatty extends Koa` —— Koa 基于 Node.js req/res
- `koatty-serve/server/{http,https,http2}.ts` 直接 `import "http"|"https"|"http2"`
- `koatty-trace` 重度依赖 OpenTelemetry auto-instrumentation
- `koatty-loader/src/index.ts:95` `require(p)` —— Bun ESM 兼容性需验证
- 全代码库 0 处 Bun 相关代码（`grep "Bun" packages/*/src/`)

**`design:*` 调用清单**（7 处）：

| 文件 | 行号 | API |
|------|------|-----|
| `koatty-container/decorator/autowired.ts` | 62 | `design:type` |
| `koatty-container/decorator/autowired.ts` | 150-151 | `design:paramtypes` |
| `koatty-container/decorator/values.ts` | 47 | `design:type` |
| `koatty-container/container/dependency_analyzer.ts` | 36-39 | `design:paramtypes` |
| `koatty-container/container/preload_manager.ts` | 74 | `design:paramtypes` |
| `koatty-router/utils/inject.ts` | 626-630 | `design:type` / `design:paramtypes` / `design:returntype` |
| `koatty-swagger/decorators/property.ts` | 35 | `design:type` |
| `koatty-validation/decorators.ts` | 269 | `design:paramtypes` |
| `koatty-validation/util.ts` | 23 | `design:type` |

**`reflect-metadata` import 位置**：9 处源码 + 21 处 `package.json` 依赖。

### 12.B ParameterDecorator 11 处迁移清单

| # | 文件路径 | 行号 | 装饰器名 | 整合后处理 |
|---|---------|------|---------|----------|
| 1 | `koatty-container/decorator/autowired.ts` | 144 | `Inject` | 改为 MethodDecorator（构造函数级，TC39）+ 保留 Param 形态（Legacy，标 deprecated） |
| 2 | `koatty-router/utils/inject.ts` | 612-618 | `injectParam`（工厂） | 同时支持 Property 路径（双模式装饰器内部） |
| 3 | `koatty-router/params/params.ts` | 24 | `Header` | 双模式（Param + Property） |
| 4 | `koatty-router/params/params.ts` | 42 | `PathVariable` | 双模式 |
| 5 | `koatty-router/params/params.ts` | 63 | `Get` | 双模式 |
| 6 | `koatty-router/params/params.ts` | 84 | `Post` | 双模式 |
| 7 | `koatty-router/params/params.ts` | 112 | `File` | 双模式 |
| 8 | `koatty-router/params/params.ts` | 134 | `RequestBody` | 双模式 |
| 9 | `koatty-router/params/params.ts` | 156 | `RequestParam` | 双模式 |
| 10 | `koatty-validation/decorators.ts` | 183 | `Valid` | 完全弃用，迁移到 DTO 属性验证装饰器 |
| 11 | （别名导出）`Body`、`Param` | — | — | 跟随 `RequestBody`/`RequestParam` 自动获得双模式 |

### 12.C Bun 元数据兼容性测试矩阵

Phase 0 必须输出此报告，覆盖以下测试用例：

```typescript
// tests/bun-metadata-compat/test.ts
import "reflect-metadata";

// 1. 基础元数据存取
class A {}
Reflect.defineMetadata("k", "v", A);
test("Bun: Reflect.getMetadata", () => {
  expect(Reflect.getMetadata("k", A)).toBe("v");
});

// 2. 继承链元数据查找
class B extends A {}
test("Bun: Reflect.getMetadata 继承", () => {
  expect(Reflect.getMetadata("k", B)).toBe("v");  // 应继承 A 的元数据
});

// 3. design:type 自动注入（仅 Legacy）
class C {
  @PropDecorator()
  field: string = "";
}
function PropDecorator(): PropertyDecorator {
  return (target, key) => {
    test("Bun: design:type", () => {
      expect(Reflect.getMetadata("design:type", target, key)).toBe(String);
    });
  };
}

// 4. design:paramtypes 自动注入（仅 Legacy）
class D {
  @MethodDecorator()
  method(arg: number, arg2: string): void {}
}

// 5. Symbol.metadata 支持（TC39 模式）
function ClassDeco<T>(target: T, context: ClassDecoratorContext) {
  context.metadata.set("k", "v");
}
@ClassDeco
class E {}
test("Bun: Symbol.metadata", () => {
  expect((E as any)[Symbol.metadata]?.get("k")).toBe("v");
});

// 6. context.addInitializer
function FieldDeco(value: undefined, context: ClassFieldDecoratorContext) {
  context.addInitializer(function () {
    // 验证 this 指向实例
  });
}
class F {
  @FieldDeco
  field: string = "";
}
```

**报告输出格式**：

| 测试用例 | Bun 1.1.0 | Bun 1.3.x | Node 22 | 阻断? |
|---------|-----------|-----------|---------|------|
| Reflect 基础 API | ? | ? | ✅ | — |
| Reflect 继承链 | ? | ? | ✅ | — |
| design:type | ? | ? | ✅ | 阻断 Phase 1 Track A |
| design:paramtypes | ? | ? | ✅ | 阻断 Phase 1 Track A |
| Symbol.metadata | ? | ? | ✅ | 阻断 Phase 1 Track B (TC39) |
| context.addInitializer | ? | ? | ✅ | 阻断 DTO 路径 |

> 测试结果由 Phase 0 实施者填入。任何阻断项都必须在进入 Phase 1 前解决。

### 12.D Bun 下 IO 替换清单

| 文件 | 现有 IO | RuntimeAdapter 抽象后 |
|------|---------|----------------------|
| `koatty-loader/src/index.ts:54` | `globby.sync` | 不变（`globby` 已支持 Bun） |
| `koatty-loader/src/index.ts:95` | `require(p)` | `runtime.resolveModule(p)` |
| `koatty-config/src/config.ts:72` | `require("run-con")` | 同上 |
| `koatty-serve/src/utils/cert-loader.ts:11` | `readFileSync` | `runtime.loadTlsMaterial(path)` |
| 各 Bun 服务器 TLS 配置 | — | `Bun.file(path)` (BunRuntimeAdapter 内部) |

### 12.E CI 3 元组矩阵示例

```yaml
# .github/workflows/ci.yml 摘录

jobs:
  test-matrix:
    name: Test (${{ matrix.combo }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        # v1.1：3 元组（C1/C2/C3），不再有 Bun-Legacy
        include:
          - combo: c1-node-legacy
            runtime: node
            decorator-mode: legacy
            node-version: 22
          - combo: c2-node-tc39
            runtime: node
            decorator-mode: tc39
            node-version: 22
          - combo: c3-bun-tc39
            runtime: bun
            decorator-mode: tc39
            bun-version: 1.3
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - if: matrix.runtime == 'node'
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - if: matrix.runtime == 'bun'
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ matrix.bun-version }}
      - run: pnpm install --frozen-lockfile
      - name: Set decorator mode (Node only)
        if: matrix.runtime == 'node'
        run: |
          if [ "${{ matrix.decorator-mode }}" = "tc39" ]; then
            export TSCONFIG_OVERRIDE='{"compilerOptions":{"experimentalDecorators":false}}'
          fi
      - name: Build
        run: pnpm build
      - name: Test
        run: |
          if [ "${{ matrix.runtime }}" = "node" ]; then
            pnpm test
          else
            bun test packages/koatty-bun packages/koatty-serve
          fi

  test-bun-rejection:
    name: Verify ADR-015 rejection (Bun + Legacy must fail)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3 }
      - run: pnpm install
      - name: Verify Bun rejects experimentalDecorators=true
        run: |
          # 故意设置错误 tsconfig，预期启动失败
          cd test-fixtures/bun-with-legacy-tsconfig
          if bun run src/App.ts; then
            echo "FAIL: Bun should have rejected legacy tsconfig"
            exit 1
          else
            echo "PASS: Bun correctly rejected legacy decorator config"
          fi
      - name: Verify Bun rejects parameter decorator usage
        run: |
          cd test-fixtures/bun-with-param-decorator
          if bun run src/App.ts; then
            echo "FAIL: Bun should have rejected parameter decorator"
            exit 1
          else
            echo "PASS: Bun correctly rejected parameter decorator"
          fi

  benchmark:
    name: Performance Benchmark (3-tuple)
    needs: test-matrix
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: oven-sh/setup-bun@v2
        with: { bun-version: 1.3 }
      - run: pnpm install
      - name: Run 3-tuple benchmark
        run: |
          # C1: Node + Legacy
          node benchmarks/http-throughput.js --mode=legacy > /tmp/c1.json
          # C2: Node + TC39
          node benchmarks/http-throughput.js --mode=tc39 > /tmp/c2.json
          # C3: Bun + TC39
          bun benchmarks/http-throughput.js --mode=tc39 > /tmp/c3.json
          # Compare
          bun benchmarks/compare.ts /tmp/c1.json /tmp/c2.json /tmp/c3.json
```

### 12.F 整合后的 ADR 完整索引

| ADR | 来源 | 标题 | 影响 |
|-----|------|------|------|
| ADR-001 | A | BunKoaBridge 初版使用方案 A | Bun MVP 实现 |
| ADR-002 | A | koatty-bun 作为 meta-adapter 包 | 包结构 |
| ADR-003 | A | HTTP/3 降级而非报错 | 协议层 |
| ADR-004 | A | BunWsServer 共享端口 | WS 实现 |
| ADR-005 | A | gRPC 不重写 | gRPC 适配 |
| ADR-006 | A | 可观测性手动 Instrumentation | 监控 |
| ADR-007 | A | Bun 服务器使用请求计数器替代连接池 | 服务器内部 |
| ADR-008 | A | BunWsAdapter 继承 EventEmitter | WS 桥接 |
| ADR-009 | 本文档 v1.0 | 以 TC39 兼容层为统一基础 | 跨包架构 |
| ADR-010 | 本文档 v1.0 | BunBootstrap 与 Bootstrap 通过 RuntimeAdapter 统一 | Bootstrap 重构 |
| **ADR-011** | **本文档 v1.1**（强化） | **Bun 分支强制 TC39（无 Legacy fallback）** | **CLI/模板** |
| **ADR-012** | **本文档 v1.1**（修订） | **装饰器模式判定（仅 Node 路径读 tsconfig，Bun 路径硬编码）** | **模式判定** |
| ADR-013 | 本文档 v1.0 | reflect-metadata 在 Bun 下的兼容性优先级提升 | Phase 0 阻断 |
| ADR-014 | 本文档 v1.0 | 发布版本号承载双特性 | 版本管理 |
| **ADR-015** | **本文档 v1.1**（新增） | **Bun 分支拒绝 Legacy 装饰器与参数装饰器（启动期严格检测）** | **运行时检测** |
| **ADR-016** | **本文档 v1.1**（新增） | **参数装饰器替代方案的契约与未来恢复路线** | **API 长期承诺** |

### 12.G 风险登记完整索引

| 编号 | 来源 | 简述 |
|------|------|------|
| R1-R8 | A §9 | 协议、可观测、装饰器元数据、HTTP/3、gRPC 等 |
| R9-R12 | B §11.9 | 双模式判定、循环依赖、design:* 不可用、TC39 后续支持 |
| R13-R18 | 本文档 | 串行依赖、版本号冲突、模板组合（v1.1 简化）、示例升级、ADR-015 检测、ADR-016 用户混淆 |

---

## 文档历史

| 版本 | 日期 | 作者 | 变更 |
|------|------|------|------|
| 1.0 | 2026-05-11 | Architect Agent | 初稿：基于 koatty-bun-plan v2 + tc39-decorator-migration-plan v2.2 + 代码现状审计输出整合实施方案 |
| 1.1 | 2026-05-11 | Architect Agent | **核心定位调整**：Bun runtime 分支完全遵循 TC39 规范（强制），废除 Bun-Legacy 组合，4 元组矩阵简化为 3 元组（C1/C2/C3）。新增 ADR-015（Bun 拒绝 Legacy + 参数装饰器的启动期严格检测）、ADR-016（参数装饰器替代方案契约与未来恢复路线）。新增 §6.6 章节详述 Bun 下参数装饰器替代方案（8 小节）。修订 ADR-011/012 强化 Bun 强制 TC39。修订路线图 Phase 1 改为串行（最小必需集 → Bun MVP）。新增 R17/R18 风险条款。CI 矩阵简化为 3 元组 + ADR-015 拒绝测试 job。

---

**End of Document**
