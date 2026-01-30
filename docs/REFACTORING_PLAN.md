# Koatty 可插拔扩展机制重构方案

## 一、背景与现状分析

### 1.1 当前代码结构

```
packages/
├── koatty-core/
│   ├── src/
│   │   ├── IApplication.ts      # AppEvent 事件定义
│   │   ├── Component.ts         # 组件装饰器（Controller, Middleware, Service, Plugin）
│   │   ├── ComponentManager.ts  # 组件管理器（当前过于复杂）
│   │   └── Application.ts       # Koatty 应用核心
├── koatty-router/
│   └── src/RouterPlugin.ts      # 路由组件（当前使用 Plugin 装饰器）
├── koatty-serve/
│   └── src/ServePlugin.ts       # 服务组件（当前使用 Plugin 装饰器）
└── koatty/
    └── src/
        ├── config/plugin.ts     # 插件配置
        └── core/
            ├── Bootstrap.ts     # 启动流程
            └── Loader.ts        # 组件加载器
```

### 1.2 当前问题

1. **Plugin 装饰器过于复杂**
   - 包含 `dependencies`, `provides`, `conflicts`, `events` 等复杂配置
   - 与设计理念不符：Plugin 应该只是 Component 的简单子类

2. **组件类型定义混乱**
   - `IPlugin` 接口包含过多职责：依赖声明、能力提供、冲突检测、事件绑定
   - `IPluginOptions` 与 `IPlugin` 属性重复

3. **事件绑定机制不通用**
   - 只有 Plugin 可以通过 `events` 对象绑定事件
   - 其他组件类型无法灵活绑定事件

4. **内核态/用户态区分模糊**
   - 通过 `type: 'core' | 'user'` 区分，但语义不够清晰
   - 加载顺序控制不够直观

### 1.3 设计理念回顾

1. **所有组件都是 Component**
   - Plugin、Controller、Middleware、Service 是 Component 的特殊子类
   - 便于 IOC 分类加载

2. **框架启动本质**
   - 不同分类 Component 加载绑定到事件
   - 按事件顺序执行组件逻辑

3. **可插拔原则**
   - 除底层依赖（logger、lib、container、exception）和核心（core）外
   - 其他组件都可按需加载

---

## 二、重构目标

### 2.1 核心目标

1. **简化 Plugin 装饰器**：回归简单版本，只保留必要配置
2. **统一组件模型**：所有组件遵循相同的基础接口
3. **通用事件绑定机制**：任何组件都可以绑定到 AppEvent
4. **清晰的内核态/用户态分离**：明确加载顺序和依赖关系

### 2.2 设计原则

**接口继承关系：**

```
                      IComponent (基类接口)
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
      IPlugin          IService        (独立接口)
   (用户态扩展)         (服务)              │
                                    ┌───────┴───────┐
                                    │               │
                               IMiddleware    IController
                                (中间件)        (控制器)
```

**内核态 vs 用户态：**

```
┌─────────────────────────────────────────────────────────────────┐
│                    内核态 (Core)                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  @Component                                              │    │
│  │  implements IComponent                                   │    │
│  │  - 框架内置组件                                           │    │
│  │  - 类名必须以 "Component" 结尾                            │    │
│  │  - 例如：RouterComponent, ServeComponent, TraceComponent │    │
│  │  - 默认在用户态组件之前加载                               │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                    用户态 (User)                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  @Plugin                                                 │    │
│  │  implements IPlugin (extends IComponent)                 │    │
│  │  - 用户自定义扩展插件                                     │    │
│  │  - 类名必须以 "Plugin" 结尾                               │    │
│  │  - 例如：AuthPlugin, CachePlugin, SchedulePlugin        │    │
│  │  - 在内核态组件之后加载                                   │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                    其他组件类型                                    │
│  @Middleware (IOC: Prototype) - 请求级中间件                     │
│  @Service (IOC: Singleton) - 业务逻辑服务                        │
│  @Controller (IOC: Prototype) - 请求处理控制器                   │
└─────────────────────────────────────────────────────────────────┘
```

**加载顺序：**
```
1. 内核态组件 (@Component) - 按 priority 排序
   └── RouterComponent, ServeComponent, TraceComponent ...
2. 用户态插件 (@Plugin) - 按 config/plugin.ts 的 list 顺序 + priority
   └── AuthPlugin, CachePlugin, SchedulePlugin ...
3. 中间件 (@Middleware)
4. 服务 (@Service)
5. 控制器 (@Controller)
```

---

## 2.5 组件执行机制：run 方法与 OnEvent 融合

### 两种方案对比分析

#### 原有方案：run 方法

```typescript
@Plugin('AuthPlugin')
class AuthPlugin implements IPlugin {
  async run(options: object, app: KoattyApplication) {
    // 初始化逻辑
  }
}
```

| 特点 | 说明 |
|------|------|
| **优点** | 简单直观，逻辑集中，适合简单场景 |
| **缺点** | 执行时机固定，无法精确控制，无法响应多个生命周期事件 |

#### 新方案：OnEvent 装饰器

```typescript
@Component('RouterComponent')
class RouterComponent implements IComponent {
  @OnEvent(AppEvent.beforeRouterLoad)
  async init(app: KoattyApplication) { /* 初始化 */ }
  
  @OnEvent(AppEvent.appStop)
  async cleanup(app: KoattyApplication) { /* 清理 */ }
}
```

| 特点 | 说明 |
|------|------|
| **优点** | 精确控制执行时机，支持多事件响应，清理逻辑自然融入 |
| **缺点** | 需要理解事件系统，对简单场景可能过于复杂 |

### 融合方案设计

**设计原则**：保持向后兼容，同时提供高级功能

```
┌─────────────────────────────────────────────────────────────────┐
│                    组件执行机制                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 方式一：简单模式（仅 run 方法）                           │   │
│  │                                                         │   │
│  │  @Plugin('AuthPlugin')                                  │   │
│  │  class AuthPlugin {                                     │   │
│  │    async run(options, app) {                            │   │
│  │      // 初始化逻辑                                       │   │
│  │    }                                                    │   │
│  │  }                                                      │   │
│  │                                                         │   │
│  │  → 自动绑定到 AppEvent.appReady 执行                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 方式二：事件模式（@OnEvent 装饰器）                       │   │
│  │                                                         │   │
│  │  @Component('RouterComponent')                          │   │
│  │  class RouterComponent {                                │   │
│  │    @OnEvent(AppEvent.beforeRouterLoad)                  │   │
│  │    async init(app) { /* 初始化 */ }                     │   │
│  │                                                         │   │
│  │    @OnEvent(AppEvent.appStop)                           │   │
│  │    async cleanup(app) { /* 清理 */ }                    │   │
│  │  }                                                      │   │
│  │                                                         │   │
│  │  → 精确绑定到指定事件                                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 方式三：混合模式（run + @OnEvent）                        │   │
│  │                                                         │   │
│  │  @Plugin('CachePlugin')                                 │   │
│  │  class CachePlugin {                                    │   │
│  │    async run(options, app) {                            │   │
│  │      // 主初始化逻辑（绑定到 appReady）                   │   │
│  │    }                                                    │   │
│  │                                                         │   │
│  │    @OnEvent(AppEvent.appStop)                           │   │
│  │    async cleanup(app) {                                 │   │
│  │      // 清理逻辑（绑定到 appStop）                        │   │
│  │    }                                                    │   │
│  │  }                                                      │   │
│  │                                                         │   │
│  │  → run 绑定到默认事件，OnEvent 绑定到指定事件             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 执行规则

| 规则 | 说明 |
|------|------|
| **run 方法默认事件** | 如果组件有 `run` 方法但没有用 `@OnEvent` 标记，自动绑定到 `AppEvent.appReady` |
| **OnEvent 优先级** | `@OnEvent` 装饰器显式指定的事件绑定优先于默认行为 |
| **同事件多方法** | 同一事件可绑定多个方法，按定义顺序执行 |
| **run + OnEvent(appReady)** | 如果 `run` 方法被 `@OnEvent(appReady)` 标记，则使用标记的配置 |

### @OnEvent 使用范围限制

> **重要约束**：`@OnEvent` 装饰器**只能**用于 `@Plugin` 和 `@Component` 类，**禁止**用于 `@Controller`、`@Middleware`、`@Service` 等业务类。

```
┌─────────────────────────────────────────────────────────────────┐
│                 @OnEvent 装饰器使用范围                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ✅ 允许使用                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  @Component  - 内核态组件（RouterComponent 等）          │   │
│  │  @Plugin     - 用户态插件（AuthPlugin 等）               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ❌ 禁止使用                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  @Controller  - 请求处理控制器                           │   │
│  │  @Middleware  - 请求级中间件                             │   │
│  │  @Service     - 业务逻辑服务                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**设计原因：**

| 原因 | 说明 |
|------|------|
| **职责分离** | Plugin/Component 负责框架扩展，Controller/Middleware/Service 负责业务逻辑 |
| **生命周期管理** | 业务类的生命周期由框架统一管理（IOC 容器），不应自行绑定框架事件 |
| **避免混乱** | 如果业务类也能绑定框架事件，会导致事件处理顺序不可控 |
| **作用域差异** | Controller/Middleware 是 Prototype 作用域（每次请求创建），不适合绑定框架级事件 |

**装饰器实现校验：**

> **重要**：不能通过 `target.constructor.name` 判断类型，必须通过 `IOC.getType()` 获取在装饰器注册时写入的元数据类型。

**各装饰器注册的 type：**

| 装饰器 | saveClass type | IOC.getType() 返回 |
|--------|----------------|-------------------|
| `@Controller` | `"CONTROLLER"` | `"CONTROLLER"` |
| `@Middleware` | `"MIDDLEWARE"` | `"MIDDLEWARE"` |
| `@Service` | `"SERVICE"` | `"SERVICE"` |
| `@Component` | `"COMPONENT"` | `"COMPONENT"` |
| `@Plugin` | `"COMPONENT"` | `"COMPONENT"` |

```typescript
// packages/koatty-core/src/Component.ts

/**
 * Event binding decorator
 * ONLY for @Plugin and @Component classes (type === "COMPONENT")
 * 
 * @param event The AppEvent to bind to
 * @returns MethodDecorator
 * @throws Error if used on non-Plugin/Component class
 */
export function OnEvent(event: AppEvent): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const targetClass = target.constructor;
    
    // 通过 IOC.getType() 获取元数据中的类型
    // saveClass 时写入了正确的 type（CONTROLLER/MIDDLEWARE/SERVICE/COMPONENT）
    const componentType = IOC.getType(targetClass);
    
    // 校验：只允许 type 为 "COMPONENT" 的类使用（包括 @Plugin 和 @Component）
    if (componentType && componentType !== 'COMPONENT') {
      const className = targetClass.name || 'Unknown';
      throw new Error(
        `@OnEvent can only be used in @Plugin or @Component classes.\n` +
        `  → Found in: ${className}.${String(propertyKey)} (type: ${componentType})\n` +
        `  → Solution: Move event handling logic to a Plugin or Component class.`
      );
    }
    
    const events = Reflect.getMetadata(COMPONENT_EVENTS, targetClass) || {};
    if (!events[event]) {
      events[event] = [];
    }
    events[event].push(propertyKey);
    Reflect.defineMetadata(COMPONENT_EVENTS, events, targetClass);
    return descriptor;
  };
}
```

**IOC.saveClass 写入 type 的机制：**

```typescript
// packages/koatty-container/src/container/container.ts

/**
 * Save class metadata and store class module in container.
 * 将 type 写入 TAGGED_CLS 元数据
 */
public saveClass(type: string, module: Function, identifier: string) {
  // 关键：这里将 type 写入元数据
  Reflect.defineMetadata(TAGGED_CLS, { id: identifier, type }, module);
  const key = `${type}:${identifier}`;
  if (!this.classMap.has(key)) {
    this.classMap.set(key, module);
  }
}

/**
 * Get the component type of target class or object.
 * 从 TAGGED_CLS 元数据中读取 type
 */
public getType(target: Function | object) {
  const metaData = Reflect.getOwnMetadata(TAGGED_CLS, target);
  if (metaData) {
    return metaData.type;  // 返回 saveClass 时写入的 type
  }
  // 降级：通过类名推断（不推荐依赖此逻辑）
  const identifier = (<Function>target).name || (target.constructor ? target.constructor.name : "");
  return getComponentTypeByClassName(identifier);
}
```

**校验逻辑说明：**

```
┌─────────────────────────────────────────────────────────────────┐
│                  @OnEvent 类型校验流程                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  @OnEvent(AppEvent.xxx)                                         │
│       ↓                                                         │
│  IOC.getType(target.constructor)                                │
│       ↓                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  type === "COMPONENT"                                   │   │
│  │       ↓                                                 │   │
│  │  ✅ 允许：@Plugin, @Component                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  type === "CONTROLLER" | "MIDDLEWARE" | "SERVICE"       │   │
│  │       ↓                                                 │   │
│  │  ❌ 抛出错误                                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  type === undefined (类未被装饰器注册)                   │   │
│  │       ↓                                                 │   │
│  │  ⚠️ 允许（可能是运行时动态创建的组件）                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```
```

**错误示例：**

```typescript
// ❌ 错误：在 Service 中使用 @OnEvent
@Service()
export class UserService implements IService {
  readonly app: KoattyApplication;
  
  @OnEvent(AppEvent.appReady)  // ❌ 抛出错误
  async onReady() {
    // 这种做法会导致事件处理混乱
  }
}

// ❌ 错误：在 Controller 中使用 @OnEvent
@Controller('/user')
export class UserController implements IController {
  readonly app: KoattyApplication;
  readonly ctx: KoattyContext;
  
  @OnEvent(AppEvent.appStop)  // ❌ 抛出错误
  async cleanup() {
    // Controller 是 Prototype 作用域，每个请求都会创建新实例
    // 绑定框架事件会导致不可预期的行为
  }
}
```

**正确做法：**

```typescript
// ✅ 正确：业务初始化逻辑放在 Plugin 中
@Plugin('UserInitPlugin')
export class UserInitPlugin implements IPlugin {
  async run(options: object, app: KoattyApplication) {
    // 在这里进行业务初始化
    const userService = IOC.get('UserService');
    await userService.init();
  }
  
  @OnEvent(AppEvent.appStop)
  async cleanup(app: KoattyApplication) {
    // 在这里进行业务清理
    const userService = IOC.get('UserService');
    await userService.cleanup();
  }
}

// Service 只负责业务逻辑
@Service()
export class UserService implements IService {
  readonly app: KoattyApplication;
  
  async init() {
    // 初始化逻辑，由 Plugin 调用
  }
  
  async cleanup() {
    // 清理逻辑，由 Plugin 调用
  }
}
```

### ComponentManager 执行逻辑

```typescript
// packages/koatty-core/src/ComponentManager.ts

private registerComponentEvents(name: string, meta: ComponentMeta): void {
  const events = meta.events;  // 从 @OnEvent 收集的事件绑定
  const hasRunMethod = Helper.isFunction(meta.instance.run);
  const hasEventBindings = Object.keys(events).length > 0;
  
  // 规则1：如果有 @OnEvent 绑定，注册这些事件
  if (hasEventBindings) {
    for (const [eventName, methodNames] of Object.entries(events)) {
      for (const methodName of methodNames) {
        this.bindEventHandler(name, meta, eventName, methodName);
      }
    }
  }
  
  // 规则2：如果有 run 方法，检查是否需要默认绑定
  if (hasRunMethod) {
    // 检查 run 是否已经被 @OnEvent 标记
    const runAlreadyBound = Object.values(events).some(
      methods => methods.includes('run')
    );
    
    // 如果 run 没有被 @OnEvent 标记，绑定到默认事件
    if (!runAlreadyBound) {
      const defaultEvent = AppEvent.appReady;
      Logger.Debug(`Component ${name}.run() auto-binds to ${defaultEvent}`);
      this.bindRunMethod(name, meta, defaultEvent);
    }
  }
}

/**
 * 绑定 run 方法到指定事件
 */
private bindRunMethod(name: string, meta: ComponentMeta, eventName: string): void {
  const wrappedHandler = async () => {
    try {
      Logger.Debug(`[${name}] Executing run() on ${eventName}`);
      await meta.instance.run!(meta.options, this.app);
    } catch (error) {
      Logger.Error(`[${name}] Error in run():`, error);
      throw error;
    }
  };
  
  this.app.once(eventName, wrappedHandler);
  this.registeredEvents.add(`${name}:${eventName}:run`);
}
```

### 使用场景推荐

| 场景 | 推荐方式 | 示例 |
|------|----------|------|
| **简单初始化** | 仅 `run` 方法 | 认证插件、配置加载 |
| **需要清理资源** | `run` + `@OnEvent(appStop)` | 数据库连接、Redis、定时任务 |
| **精确控制时机** | 仅 `@OnEvent` | Router、Serve 等核心组件 |
| **多事件响应** | 多个 `@OnEvent` | 监控组件、Trace组件 |

### 示例代码

#### 简单模式（向后兼容）

```typescript
// 用户只需关心业务逻辑，无需了解事件系统
@Plugin('AuthPlugin')
export class AuthPlugin implements IPlugin {
  async run(options: object, app: KoattyApplication) {
    const jwtSecret = options.secret || app.config('jwt.secret');
    app.use(async (ctx, next) => {
      // JWT 验证逻辑
      await next();
    });
    Logger.Log('Koatty', '', '✓ Auth middleware installed');
  }
}
```

#### 混合模式（推荐）

```typescript
// 初始化用 run，清理用 @OnEvent
@Plugin('RedisPlugin')
export class RedisPlugin implements IPlugin {
  private client: RedisClient;
  
  async run(options: object, app: KoattyApplication) {
    this.client = new RedisClient(options);
    await this.client.connect();
    app.redis = this.client;
    Logger.Log('Koatty', '', '✓ Redis connected');
  }
  
  @OnEvent(AppEvent.appStop)
  async cleanup(app: KoattyApplication) {
    if (this.client) {
      await this.client.quit();
      Logger.Log('Koatty', '', '✓ Redis disconnected');
    }
  }
}
```

#### 事件模式（高级用法）

```typescript
// 精确控制多个生命周期事件
@Component('TraceComponent', { scope: 'core', priority: 1000 })
export class TraceComponent implements IComponent {
  private tracer: any;
  
  @OnEvent(AppEvent.beforeMiddlewareLoad)
  async initTrace(app: KoattyApplication) {
    // 在中间件加载前初始化，确保追踪覆盖所有请求
    this.tracer = createTracer(app.config('trace'));
    app.use(this.tracer.middleware());
  }
  
  @OnEvent(AppEvent.afterServerStart)
  async onServerStarted(app: KoattyApplication) {
    // 服务启动后记录
    this.tracer.recordEvent('server_started', { port: app.config('server.port') });
  }
  
  @OnEvent(AppEvent.appStop)
  async cleanup(app: KoattyApplication) {
    // 关闭追踪器，刷新数据
    await this.tracer.shutdown();
  }
}
```

---

## 三、详细重构方案

### 3.1 AppEvent 事件体系（保持不变）

```typescript
// packages/koatty-core/src/IApplication.ts

export enum AppEvent {
  appBoot = "appBoot",
  appReady = "appReady",
  appStart = "appStart",
  appStop = "appStop",
  configLoaded = "configLoaded",
  beforeComponentLoad = "beforeComponentLoad",
  componentLoading = "componentLoading",
  afterComponentLoad = "afterComponentLoad",
  beforeMiddlewareLoad = "beforeMiddlewareLoad",
  middlewareLoading = "middlewareLoading",
  afterMiddlewareLoad = "afterMiddlewareLoad",
  beforeServiceLoad = "beforeServiceLoad",
  afterServiceLoad = "afterServiceLoad",
  beforeControllerLoad = "beforeControllerLoad",
  afterControllerLoad = "afterControllerLoad",
  beforeRouterLoad = "beforeRouterLoad",
  afterRouterLoad = "afterRouterLoad",
  beforeServerStart = "beforeServerStart",
  afterServerStart = "afterServerStart",
  beforeServerStop = "beforeServerStop",
  afterServerStop = "afterServerStop",
}

// 事件执行顺序（固定）
export const AppEventArr = [
  "appBoot",
  "configLoaded",
  "beforeComponentLoad",
  "componentLoading",
  "afterComponentLoad",
  "beforeMiddlewareLoad",
  "middlewareLoading",
  "afterMiddlewareLoad",
  "beforeServiceLoad",
  "afterServiceLoad",
  "beforeControllerLoad",
  "afterControllerLoad",
  "beforeRouterLoad",
  "afterRouterLoad",
  "appReady",
  "beforeServerStart",
  "afterServerStart",
  "appStart",
  "beforeServerStop",
  "appStop",
  "afterServerStop",
];
```

### 3.2 简化 Component 接口

> **重要约束**：Controller 和 Middleware 装饰器的元数据 Key 和格式必须保持不变，因为：
> - `CONTROLLER_ROUTER` 被 `koatty-router/src/utils/inject.ts` 使用（路由注入）
> - `MIDDLEWARE_OPTIONS` 被 `koatty/src/core/Loader.ts` 使用（中间件加载）

```typescript
// packages/koatty-core/src/Component.ts

/**
 * 组件作用域
 * - core: 内核态组件（框架内置，优先加载）
 * - user: 用户态组件（用户定义，后加载）
 */
export type ComponentScope = 'core' | 'user';

/**
 * 组件类型
 */
export type ComponentType = 'COMPONENT' | 'CONTROLLER' | 'MIDDLEWARE' | 'SERVICE';

// ============================================================
// 元数据 Key（保持不变，确保兼容性）
// ============================================================

/** Controller 路由元数据 Key - 被 koatty-router 使用 */
export const CONTROLLER_ROUTER = "CONTROLLER_ROUTER";

/** Middleware 选项元数据 Key - 被 Loader.ts 使用 */
export const MIDDLEWARE_OPTIONS = "MIDDLEWARE_OPTIONS";

/** Service 选项元数据 Key */
export const SERVICE_OPTIONS = "SERVICE_OPTIONS";

/** Plugin/Component 选项元数据 Key（新增） */
export const COMPONENT_OPTIONS = "COMPONENT_OPTIONS";

/** @deprecated 使用 COMPONENT_OPTIONS 替代 */
export const PLUGIN_OPTIONS = "PLUGIN_OPTIONS";

// ============================================================
// IOC 作用域规则（重要）
// ============================================================

/**
 * IOC 作用域类型
 * - Singleton: 单例模式，整个应用生命周期只有一个实例
 * - Prototype: 原型模式，每次请求/获取都创建新实例
 */
export type IOCScope = 'Singleton' | 'Prototype';

/**
 * 各组件类型的默认 IOC 作用域
 * 
 * | 组件类型    | 默认作用域  | 原因                                    |
 * |------------|------------|----------------------------------------|
 * | Controller | Prototype  | 每个请求需要独立的上下文（ctx）            |
 * | Middleware | Prototype  | 每个请求需要独立的实例                    |
 * | Service    | Singleton  | 业务逻辑层，共享状态                      |
 * | Plugin     | Singleton  | 扩展组件，通常只需初始化一次              |
 * | Component  | Singleton  | 通用组件，默认单例                        |
 */

// ============================================================
// 接口定义
// ============================================================

/**
 * 基础组件选项（所有组件共用）
 */
export interface IComponentOptions {
  /** 是否启用，默认 true */
  enabled?: boolean;
  /** 优先级，数值越大优先级越高，默认 0 */
  priority?: number;
  /** 内核态/用户态作用域，默认 'user' */
  scope?: ComponentScope;
  /** 依赖的组件名称列表（可选） */
  requires?: string[];
  /** 其他自定义配置 */
  [key: string]: any;
}

/**
 * 组件基础接口（所有组件类型的父接口）
 * 
 * 继承关系：
 * - IComponent (基类)
 *   ├── IPlugin extends IComponent
 *   ├── IMiddleware (独立接口，有特殊的 run 签名)
 *   ├── IService extends IComponent  
 *   └── IController (独立接口，有 app 和 ctx 属性)
 * 
 * 注意：移除了 uninstall 方法
 * 清理逻辑统一使用 @OnEvent(AppEvent.appStop) 装饰器处理
 */
export interface IComponent {
  /** 组件初始化/运行方法（可选，推荐使用 @OnEvent 替代） */
  run?: (options: object, app: KoattyApplication) => Promise<any>;
}

/**
 * Plugin 选项（继承基础选项）
 * 
 * IOC 注册：{ scope: "Singleton", type: "COMPONENT" }
 * 
 * 注意：此接口独立保留，后续可扩展 Plugin 特有的功能
 */
export interface IPluginOptions extends IComponentOptions {
  // 当前简化版本，移除复杂选项
  // dependencies, provides, conflicts, events 暂时移除
  
  // 预留扩展字段（后续可能添加）
  // lifecycle?: IPluginLifecycle;  // 生命周期钩子
  // hotReload?: boolean;           // 热更新支持
  // metadata?: Record<string, any>; // 插件元数据
}

/**
 * Plugin 接口（继承 IComponent）
 * 
 * IOC 作用域：Singleton（单例，整个应用生命周期只有一个实例）
 * 
 * 清理逻辑：使用 @OnEvent(AppEvent.appStop) 装饰器，不需要 uninstall 方法
 * 
 * 后续可能扩展的方法：
 * - onEnable?: () => Promise<void>   // 启用时回调
 * - onDisable?: () => Promise<void>  // 禁用时回调
 * - onUpdate?: () => Promise<void>   // 配置更新时回调
 */
export interface IPlugin extends IComponent {
  // 继承 IComponent 的 run 方法
  // 后续可扩展 Plugin 特有的方法
}

// ============================================================
// Middleware（保持不变）
// IOC 作用域：Prototype（每次请求创建新实例）
// ============================================================

/**
 * Middleware 配置选项
 * 
 * 注意：此接口被 Loader.ts 使用，格式必须保持兼容
 * IOC 注册：{ scope: "Prototype", type: "MIDDLEWARE" }
 */
export interface IMiddlewareOptions {
  /**
   * Protocol(s) this middleware applies to
   * If not specified, applies to all protocols
   * @example 'http'
   * @example ['http', 'https']
   */
  protocol?: string | string[];
  
  /**
   * Middleware priority (lower number = higher priority)
   * @default 50
   */
  priority?: number;
  
  /**
   * Whether this middleware is enabled
   * @default true
   */
  enabled?: boolean;
  
  /**
   * Additional custom options
   */
  [key: string]: any;
}

/**
 * Middleware 接口
 */
export interface IMiddleware {
  run: (options: any, app: KoattyApplication) => KoattyMiddleware;
}

// ============================================================
// Service（保持不变）
// IOC 作用域：Singleton（默认）
// ============================================================

/**
 * Service 选项
 */
export interface IServiceOptions {
  /** 其他自定义配置 */
  [key: string]: any;
}

/**
 * Service 接口
 * 
 * IOC 注册：{ scope: "Singleton", type: "SERVICE" }
 */
export interface IService {
  readonly app: KoattyApplication;
}

// ============================================================
// Controller（保持不变）
// IOC 作用域：Prototype（每次请求创建新实例，绑定独立的 ctx）
// ============================================================

/**
 * Controller 选项
 * 
 * 注意：此接口被 koatty-router 使用，格式必须保持兼容
 * IOC 注册：{ scope: "Prototype", type: "CONTROLLER" }
 */
export interface IControllerOptions {
  /** 路由路径前缀 */
  path?: string;
  /** 协议类型 */
  protocol?: ControllerProtocol;
  /** 控制器级别中间件 */
  middleware?: Function[];
}

/**
 * Protocol types supported by the controller.
 */
export enum ControllerProtocol {
  http = "http",
  websocket = "ws",
  grpc = "grpc",
  graphql = "graphql",
}

/**
 * Interface for extra controller options
 */
export interface IExtraControllerOptions {
  path?: string;
  middleware?: Function[];
}

/**
 * Controller 接口
 */
export interface IController {
  readonly app: KoattyApplication;
  readonly ctx: KoattyContext;
}
```

### 3.3 简化装饰器定义

> **重要**：Controller 和 Middleware 装饰器的实现必须保持不变，只修改 Plugin 装饰器。

```typescript
// packages/koatty-core/src/Component.ts

// ============================================================
// Component 装饰器（内核态组件）
// ============================================================

/**
 * Component 装饰器（内核态组件）
 * 
 * 用途：框架内置的核心组件
 * 特点：
 * - 类名必须以 "Component" 结尾
 * - 默认 scope 为 'core'（内核态）
 * - 在用户态 Plugin 之前加载
 * - 通常由框架提供，用户一般不需要自定义
 * 
 * 内置组件示例：
 * - RouterComponent: 路由管理
 * - ServeComponent: 服务器管理
 * - TraceComponent: 链路追踪
 * 
 * @example
 * ```ts
 * @Component("RouterComponent", { priority: 100 })
 * class RouterComponent implements IComponent {
 *   async run(options: object, app: KoattyApplication) {
 *     // 初始化路由
 *   }
 *   
 *   @OnEvent(AppEvent.appStop)
 *   async cleanup(app: KoattyApplication) {
 *     // 清理资源
 *   }
 * }
 * ```
 */
export function Component(identifier?: string, options?: IComponentOptions): ClassDecorator {
  return (target: any) => {
    identifier = identifier || IOC.getIdentifier(target);

    if (!identifier.endsWith("Component")) {
      throw Error("Component class name must end with 'Component' suffix.");
    }

    IOC.saveClass("COMPONENT", target, identifier);

    // 保存组件选项（内核态默认 scope: 'core'）
    const componentOptions: IComponentOptions = {
      enabled: true,
      priority: 0,
      scope: 'core',  // 内核态组件默认 scope 为 'core'
      ...options
    };
    IOC.savePropertyData(COMPONENT_OPTIONS, componentOptions, target, identifier);
  };
}

// ============================================================
// Plugin 装饰器（用户态插件）
// ============================================================

/**
 * Plugin 装饰器（用户态插件）
 * 
 * 用途：用户自定义的扩展插件
 * 特点：
 * - 类名必须以 "Plugin" 结尾
 * - 默认 scope 为 'user'（用户态）
 * - 在内核态 Component 之后加载
 * - 可通过 config/plugin.ts 控制加载顺序和配置
 * - 后续可能扩展插件特有功能（生命周期钩子、热更新等）
 * 
 * 用户插件示例：
 * - AuthPlugin: 认证授权
 * - CachePlugin: 缓存管理
 * - SchedulePlugin: 定时任务
 * - RateLimitPlugin: 限流控制
 * 
 * @example
 * ```ts
 * @Plugin()
 * class AuthPlugin implements IPlugin {
 *   async run(options: object, app: KoattyApplication) {
 *     // 初始化认证模块
 *   }
 * }
 * 
 * @Plugin("CachePlugin", { priority: 100 })
 * class CachePlugin implements IPlugin {
 *   async run(options: object, app: KoattyApplication) {
 *     // 初始化缓存
 *   }
 *   
 *   @OnEvent(AppEvent.appStop)
 *   async cleanup(app: KoattyApplication) {
 *     // 关闭缓存连接
 *   }
 * }
 * ```
 */
export function Plugin(identifier?: string, options?: IPluginOptions): ClassDecorator {
  return (target: any) => {
    identifier = identifier || IOC.getIdentifier(target);

    if (!identifier.endsWith("Plugin")) {
      throw Error("Plugin class name must end with 'Plugin' suffix.");
    }

    IOC.saveClass("COMPONENT", target, identifier);

    // 保存组件选项（用户态默认 scope: 'user'）
    const pluginOptions: IPluginOptions = {
      enabled: true,
      priority: 0,
      scope: 'user',  // 用户态插件默认 scope 为 'user'
      ...options
    };
    
    // 保存到 COMPONENT_OPTIONS（统一管理）
    IOC.savePropertyData(COMPONENT_OPTIONS, pluginOptions, target, identifier);
    
    // 保存到 PLUGIN_OPTIONS（Plugin 特有，可用于后续扩展）
    IOC.savePropertyData(PLUGIN_OPTIONS, pluginOptions, target, identifier);
  };
}

// ============================================================
// Controller 装饰器（保持不变）
// ============================================================

/**
 * Controller decorator for registering controller class.
 * Used to mark a class as a Controller and define its routing path.
 * 
 * 注意：实现必须保持不变，因为 koatty-router 依赖 CONTROLLER_ROUTER 元数据格式
 * 
 * @param path The base path for all routes in this controller
 * @param options Additional configuration options for the controller
 * @returns ClassDecorator
 */
export function Controller(path = "", options?: IControllerOptions): ClassDecorator {
  options = Object.assign({
    path,
    protocol: ControllerProtocol.http,
    middleware: [],
  }, options);
  return parseControllerDecorator(options);
}

/**
 * Controller decorator internal implementation
 * 
 * 注意：元数据格式必须保持为 { path, protocol, middleware }
 */
function parseControllerDecorator(options?: IControllerOptions) {
  return (target: Function) => {
    const identifier = IOC.getIdentifier(target);
    IOC.saveClass("CONTROLLER", target, identifier);
    
    if (options.middleware) {
      for (const m of options.middleware) {
        if (typeof m !== 'function' || !('run' in m.prototype)) {
          throw new Error(`Middleware must be a class implementing IMiddleware`);
        }
      }
    }
    
    // Get middleware names from options.middleware array
    const middlewareNames = options.middleware?.map(m => m.name) || [];
    
    // 保存路由元数据 - 格式必须保持不变！
    // koatty-router/src/utils/inject.ts 依赖此格式
    IOC.savePropertyData(CONTROLLER_ROUTER, {
      path: options.path,
      protocol: options.protocol,
      middleware: middlewareNames,
    }, target, identifier);
  };
}

/**
 * GrpcController decorator
 */
export function GrpcController(path = "", options?: IExtraControllerOptions): ClassDecorator {
  options = Object.assign({ path, middleware: [] }, options);
  return parseControllerDecorator({
    path,
    protocol: ControllerProtocol.grpc,
    middleware: options.middleware,
  });
}

/**
 * WebSocketController decorator
 */
export function WebSocketController(path = "", options?: IExtraControllerOptions): ClassDecorator {
  options = Object.assign({ path, middleware: [] }, options);
  return parseControllerDecorator({
    path,
    protocol: ControllerProtocol.websocket,
    middleware: options.middleware,
  });
}

/**
 * GraphQLController decorator
 */
export function GraphQLController(path = "", options?: IControllerOptions): ClassDecorator {
  options = Object.assign({ path, middleware: [] }, options);
  return parseControllerDecorator({
    path,
    protocol: ControllerProtocol.graphql,
    middleware: options.middleware,
  });
}

// ============================================================
// Middleware 装饰器（保持不变）
// ============================================================

/**
 * Middleware decorator, used to mark a class as a middleware component.
 * 
 * 注意：实现必须保持不变，因为 Loader.ts 依赖 MIDDLEWARE_OPTIONS 元数据格式
 * 
 * @param identifier Optional custom identifier for the middleware
 * @param options Optional configuration options for the middleware
 * @returns ClassDecorator
 */
export function Middleware(identifier?: string, options?: IMiddlewareOptions): ClassDecorator {
  return (target: Function) => {
    identifier = identifier || IOC.getIdentifier(target);
    IOC.saveClass("MIDDLEWARE", target, identifier);
    
    // 保存中间件选项 - 使用 MIDDLEWARE_OPTIONS key！
    // koatty/src/core/Loader.ts 依赖此 key
    if (options) {
      IOC.savePropertyData(MIDDLEWARE_OPTIONS, options, target, identifier);
    }
  };
}

// ============================================================
// Service 装饰器（保持不变）
// ============================================================

/**
 * Service decorator, used to mark a class as a service component.
 * 
 * @param identifier Optional service identifier
 * @param options Optional configuration options for the service
 * @returns ClassDecorator
 */
export function Service(identifier?: string, options?: IServiceOptions): ClassDecorator {
  return (target: Function) => {
    identifier = identifier || IOC.getIdentifier(target);
    IOC.saveClass("SERVICE", target, identifier);
    
    // 保存服务选项
    if (options) {
      IOC.savePropertyData(SERVICE_OPTIONS, options, target, identifier);
    }
  };
}
```

### 3.4 通用事件绑定机制

```typescript
// packages/koatty-core/src/Component.ts

/**
 * 事件绑定装饰器
 * 用于将组件方法绑定到 AppEvent
 * 
 * @example
 * ```ts
 * @Component("RouterComponent", { scope: 'core', priority: 100 })
 * class RouterComponent implements IComponent {
 *   
 *   @OnEvent(AppEvent.beforeRouterLoad)
 *   async initRouter(app: KoattyApplication) {
 *     // 初始化路由
 *   }
 *   
 *   @OnEvent(AppEvent.appStop)
 *   async cleanup(app: KoattyApplication) {
 *     // 清理资源
 *   }
 * }
 * ```
 */
export function OnEvent(event: AppEvent): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const events = Reflect.getMetadata(COMPONENT_EVENTS, target.constructor) || {};
    if (!events[event]) {
      events[event] = [];
    }
    events[event].push(propertyKey);
    Reflect.defineMetadata(COMPONENT_EVENTS, events, target.constructor);
    return descriptor;
  };
}

export const COMPONENT_EVENTS = "COMPONENT_EVENTS";

/**
 * 获取组件的事件绑定
 */
export function getComponentEvents(target: any): Record<AppEvent, string[]> {
  return Reflect.getMetadata(COMPONENT_EVENTS, target) || {};
}
```

### 3.5 重构 ComponentManager

```typescript
// packages/koatty-core/src/ComponentManager.ts

import { IOC } from "koatty_container";
import { Helper } from "koatty_lib";
import { DefaultLogger as Logger } from "koatty_logger";
import {
  IPlugin,
  IComponentOptions,
  ComponentScope,
  COMPONENT_OPTIONS,
  COMPONENT_EVENTS,
  getComponentEvents,
  implementsPluginInterface,
} from './Component';
import {
  AppEventArr,
  AppEvent,
  KoattyApplication,
} from './IApplication';

/**
 * 组件元信息
 */
interface ComponentMeta {
  name: string;
  instance: IPlugin;
  options: IComponentOptions;
  scope: ComponentScope;
  events: Record<string, string[]>;
}

/**
 * 组件管理器（简化版）
 * 
 * 职责：
 * 1. 发现和注册组件
 * 2. 按作用域和优先级排序
 * 3. 绑定组件事件到 AppEvent
 * 4. 检查组件依赖
 */
export class ComponentManager {
  private app: KoattyApplication;
  private coreComponents: Map<string, ComponentMeta> = new Map();
  private userComponents: Map<string, ComponentMeta> = new Map();
  private registeredEvents: Set<string> = new Set();

  constructor(app: KoattyApplication) {
    this.app = app;
  }

  /**
   * 发现所有组件
   */
  discoverComponents(): void {
    const componentList = IOC.listClass("COMPONENT") || [];

    for (const item of componentList) {
      const identifier = (item.id ?? "").replace("COMPONENT:", "");

      // 支持 Plugin 和 Component 两种后缀
      const isPlugin = identifier.endsWith("Plugin");
      const isComponent = identifier.endsWith("Component");
      
      if (!isPlugin && !isComponent) {
        continue;
      }

      if (!identifier || !Helper.isClass(item.target)) {
        continue;
      }

      // 获取组件选项
      // 优先从 COMPONENT_OPTIONS 获取（统一管理）
      // 其次从 PLUGIN_OPTIONS 获取（向后兼容）
      let options: IComponentOptions = IOC.getPropertyData(
        COMPONENT_OPTIONS, item.target, identifier
      );
      
      if (!options) {
        options = IOC.getPropertyData(PLUGIN_OPTIONS, item.target, identifier);
      }
      
      // 默认值
      options = options || { enabled: true, priority: 0, scope: 'user' };
      
      // 标记组件类型（用于后续扩展）
      const componentType = isPlugin ? 'plugin' : 'component';

      // 检查配置是否禁用
      const pluginConfig = this.app.config('plugin') || {};
      const configOptions = pluginConfig.config?.[identifier] || {};
      if (configOptions.enabled === false) {
        options.enabled = false;
      }

      if (options.enabled === false) {
        Logger.Warn(`Component ${identifier} is disabled`);
        continue;
      }

      // 创建实例
      const instance = IOC.getInsByClass(item.target);
      if (!implementsPluginInterface(instance)) {
        Logger.Warn(`Component ${identifier} does not implement IPlugin interface, skipping`);
        continue;
      }

      // 获取事件绑定
      const events = getComponentEvents(item.target);

      const meta: ComponentMeta = {
        name: identifier,
        instance,
        options: { ...options, ...configOptions },
        scope: options.scope || 'user',
        events,
      };

      // 按作用域分类
      if (meta.scope === 'core') {
        this.coreComponents.set(identifier, meta);
        Logger.Log('Koatty', '', `✓ Discovered core component: ${identifier}`);
      } else {
        this.userComponents.set(identifier, meta);
        Logger.Debug(`Discovered user component: ${identifier}`);
      }
    }
  }

  /**
   * 检查组件依赖
   */
  private checkDependencies(): void {
    const allComponents = new Set([
      ...this.coreComponents.keys(),
      ...this.userComponents.keys()
    ]);

    const checkComponent = (name: string, meta: ComponentMeta) => {
      const requires = meta.options.requires || [];
      for (const dep of requires) {
        if (!allComponents.has(dep)) {
          throw new Error(
            `Component '${name}' requires '${dep}' but it is not available.\n` +
            `  → Solution: Enable '${dep}' in config/plugin.ts`
          );
        }
      }
    };

    // 检查内核态组件依赖
    for (const [name, meta] of this.coreComponents) {
      checkComponent(name, meta);
    }

    // 检查用户态组件依赖
    for (const [name, meta] of this.userComponents) {
      checkComponent(name, meta);
    }
  }

  /**
   * 按优先级排序组件
   */
  private sortByPriority(components: Map<string, ComponentMeta>): string[] {
    return Array.from(components.entries())
      .sort((a, b) => (b[1].options.priority || 0) - (a[1].options.priority || 0))
      .map(([name]) => name);
  }

  /**
   * 注册内核态组件事件
   */
  registerCoreComponentHooks(): void {
    Logger.Log('Koatty', '', '============ Registering Core Component Hooks ============');

    this.checkDependencies();

    const componentOrder = this.sortByPriority(this.coreComponents);
    Logger.Log('Koatty', '', `Core component order: ${componentOrder.join(' -> ')}`);

    for (const name of componentOrder) {
      const meta = this.coreComponents.get(name)!;
      this.registerComponentEvents(name, meta);
    }

    Logger.Log('Koatty', '', '============ Core Component Hooks Registered ============');
  }

  /**
   * 注册组件事件到 AppEvent
   */
  private registerComponentEvents(name: string, meta: ComponentMeta): void {
    const events = meta.events;

    if (Object.keys(events).length === 0) {
      // 如果没有通过装饰器绑定事件，尝试调用 run 方法
      if (Helper.isFunction(meta.instance.run)) {
        Logger.Debug(`Component ${name} will be loaded via run() method`);
      }
      return;
    }

    let registeredCount = 0;

    for (const [eventName, methodNames] of Object.entries(events)) {
      if (!AppEventArr.includes(eventName)) {
        Logger.Warn(`Component ${name} registers unknown event: ${eventName}`);
        continue;
      }

      for (const methodName of methodNames) {
        const handler = (meta.instance as any)[methodName];
        if (!Helper.isFunction(handler)) {
          Logger.Warn(`Component ${name} event handler ${methodName} is not a function`);
          continue;
        }

        const wrappedHandler = async () => {
          try {
            Logger.Debug(`[${name}] Handling event: ${eventName} via ${String(methodName)}`);
            await handler.call(meta.instance, this.app);
          } catch (error) {
            Logger.Error(`[${name}] Error handling event ${eventName}:`, error);
            throw error;
          }
        };

        this.app.once(eventName, wrappedHandler);
        registeredCount++;
        this.registeredEvents.add(`${name}:${eventName}`);
      }
    }

    if (registeredCount > 0) {
      Logger.Log('Koatty', '', `✓ Component ${name} registered ${registeredCount} event hooks`);
    }
  }

  /**
   * 加载用户态组件
   */
  async loadUserComponents(): Promise<string[]> {
    Logger.Log('Koatty', '', '============ Loading User Components ============');

    // 按配置顺序和优先级排序
    const pluginConfig = this.app.config('plugin') || {};
    const configList = pluginConfig.list || [];

    const loadOrder: string[] = [];
    const remaining = new Set(this.userComponents.keys());

    // 配置中指定的顺序优先
    for (const name of configList) {
      if (this.userComponents.has(name)) {
        loadOrder.push(name);
        remaining.delete(name);
      }
    }

    // 剩余的按优先级排序
    const remainingOrder = this.sortByPriority(
      new Map(Array.from(remaining).map(n => [n, this.userComponents.get(n)!]))
    );
    loadOrder.push(...remainingOrder);

    const loaded: string[] = [];

    for (const name of loadOrder) {
      const meta = this.userComponents.get(name);
      if (!meta) continue;

      // 先注册事件
      this.registerComponentEvents(name, meta);

      // 再调用 run 方法
      if (Helper.isFunction(meta.instance.run)) {
        try {
          Logger.Log('Koatty', '', `Loading user component: ${name}`);
          await meta.instance.run(meta.options, this.app);
          loaded.push(name);
          Logger.Log('Koatty', '', `✓ User component ${name} loaded`);
        } catch (error) {
          Logger.Error(`Failed to load user component ${name}:`, error);
          throw error;
        }
      }
    }

    Logger.Log('Koatty', '', `============ Loaded ${loaded.length} User Components ============`);
    return loaded;
  }

  /**
   * 卸载所有组件
   */
  async unloadComponents(): Promise<void> {
    Logger.Log('Koatty', '', 'Unloading components...');

    // 先卸载用户态组件
    for (const [name, meta] of this.userComponents) {
      if (!meta.instance.uninstall) continue;
      try {
        await meta.instance.uninstall(this.app);
      } catch (error) {
        Logger.Warn(`Failed to unload user component ${name}:`, error);
      }
    }

    // 再卸载内核态组件
    for (const [name, meta] of this.coreComponents) {
      if (!meta.instance.uninstall) continue;
      try {
        await meta.instance.uninstall(this.app);
      } catch (error) {
        Logger.Warn(`Failed to unload core component ${name}:`, error);
      }
    }

    this.coreComponents.clear();
    this.userComponents.clear();
    this.registeredEvents.clear();
  }

  /**
   * 获取组件
   */
  getComponent<T = IPlugin>(name: string): T | undefined {
    const meta = this.coreComponents.get(name) || this.userComponents.get(name);
    return meta?.instance as T;
  }

  /**
   * 检查组件是否存在
   */
  hasComponent(name: string): boolean {
    return this.coreComponents.has(name) || this.userComponents.has(name);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      coreComponents: this.coreComponents.size,
      userComponents: this.userComponents.size,
      totalComponents: this.coreComponents.size + this.userComponents.size,
      registeredEvents: this.registeredEvents.size,
    };
  }
}
```

### 3.6 重构 RouterPlugin → RouterComponent

```typescript
// packages/koatty-router/src/RouterComponent.ts

import {
  Component,
  IComponent,
  AppEvent,
  OnEvent,
  KoattyApplication,
} from 'koatty_core';
import { Helper } from 'koatty_lib';
import { DefaultLogger as Logger } from 'koatty_logger';
import { NewRouter, RouterFactory } from './router/router';

/**
 * 路由组件
 * 负责初始化和管理路由
 * 
 * 实现 IComponent 接口（基类接口）
 * 
 * 事件绑定：
 * - beforeRouterLoad: 初始化路由
 * - appStop: 清理路由资源
 */
@Component('RouterComponent', {
  scope: 'core',
  priority: 100,
})
export class RouterComponent implements IComponent {
  private factory: RouterFactory | null = null;
  
  /**
   * 初始化路由
   */
  @OnEvent(AppEvent.beforeRouterLoad)
  async initRouter(app: KoattyApplication): Promise<void> {
    const routerOpts = app.config(undefined, 'router') || {};
    const serveOpts = app.config('server') ?? { protocol: "http" };
    const protocol = serveOpts.protocol ?? "http";
    const protocols = Helper.isArray(protocol) ? protocol : [protocol];

    Logger.Log('Koatty', '', `Creating routers for protocols: ${protocols.join(', ')}`);

    if (protocols.length > 1) {
      // 多协议路由
      const routers: Record<string, any> = {};
      for (const proto of protocols) {
        const protoRouterOpts = { protocol: proto, ...routerOpts };
        if (routerOpts.ext && routerOpts.ext[proto]) {
          protoRouterOpts.ext = routerOpts.ext[proto];
        }
        const { router, factory } = NewRouter(app, protoRouterOpts);
        routers[proto] = router;
        this.factory = factory;  // 保存 factory 引用用于清理
      }
      Helper.define(app, "router", routers);
    } else {
      // 单协议路由
      const { router, factory } = NewRouter(app, { protocol: protocols[0], ...routerOpts });
      Helper.define(app, "router", router);
      this.factory = factory;
    }

    Logger.Log('Koatty', '', '✓ Router initialized');
  }

  /**
   * 应用停止时清理路由资源
   * 
   * 注意：原 router.ts 中的 app.once("appStop", ...) 监听
   * 统一迁移到此处使用 @OnEvent 装饰器处理
   */
  @OnEvent(AppEvent.appStop)
  async cleanup(app: KoattyApplication): Promise<void> {
    Logger.Log('Koatty', '', 'RouterComponent: Cleaning up router resources...');
    
    if (this.factory) {
      await this.factory.shutdownAll();
    }
    
    Logger.Log('Koatty', '', '✓ Router resources cleaned up');
  }

}
```

### 3.7 重构 ServePlugin → ServeComponent

```typescript
// packages/koatty-serve/src/ServeComponent.ts

import {
  Component,
  IComponent,
  AppEvent,
  OnEvent,
  KoattyApplication,
} from 'koatty_core';
import { Helper } from 'koatty_lib';
import { DefaultLogger as Logger } from 'koatty_logger';
import { NewServe } from './server/serve';

/**
 * 服务组件
 * 负责初始化和管理服务器
 * 
 * 实现 IComponent 接口（基类接口）
 * 
 * 事件绑定：
 * - beforeServerStart: 初始化服务器
 * - appStop: 优雅关闭服务器
 */
@Component('ServeComponent', {
  scope: 'core',
  priority: 100,
  requires: [], // 路由是可选依赖，不强制要求
})
export class ServeComponent implements IComponent {
  
  /**
   * 初始化服务器
   */
  @OnEvent(AppEvent.beforeServerStart)
  async initServer(app: KoattyApplication): Promise<void> {
    const serveOpts = app.config('server') || { protocol: "http" };
    const protocol = serveOpts.protocol ?? "http";
    const protocols = Helper.isArray(protocol) ? protocol : [protocol];

    Logger.Log('Koatty', '', `Creating servers for protocols: ${protocols.join(', ')}`);

    // 检查路由是否可用
    const hasRouter = !!app.router;
    if (!hasRouter) {
      Logger.Warn('Koatty', '', 'Router not available. Server will run in standalone mode.');
    }

    if (protocols.length > 1) {
      // 多协议服务器
      const servers: any[] = [];
      const basePort = Helper.isArray(serveOpts.port) ? serveOpts.port : [serveOpts.port];
      const ports: number[] = [];

      for (let i = 0; i < protocols.length; i++) {
        if (i < basePort.length) {
          ports.push(Helper.toNumber(basePort[i]));
        } else {
          ports.push(Helper.toNumber(basePort[0]) + i);
        }
      }

      for (let i = 0; i < protocols.length; i++) {
        const proto = protocols[i];
        const protoServerOpts = { ...serveOpts, protocol: proto, port: ports[i] };
        servers.push(NewServe(app, protoServerOpts));
      }

      Helper.define(app, "server", servers);
    } else {
      // 单协议服务器
      const server = NewServe(app, { protocol: protocols[0], ...serveOpts });
      Helper.define(app, "server", server);
    }

    Logger.Log('Koatty', '', '✓ Server initialized');
  }

  /**
   * 应用停止时优雅关闭服务器
   * 
   * 注意：原 terminus.ts 中触发的 appStop 事件处理
   * 统一迁移到此处使用 @OnEvent 装饰器处理
   */
  @OnEvent(AppEvent.appStop)
  async stopServer(app: KoattyApplication): Promise<void> {
    const server = app.server as any;
    if (!server) return;

    Logger.Log('Koatty', '', 'ServeComponent: Gracefully stopping server...');

    try {
      if (Helper.isArray(server)) {
        // 多协议：并行关闭所有服务器
        await Promise.all(server.map((s: any) => 
          new Promise<void>((resolve) => {
            if (s.Stop) {
              s.Stop(() => resolve());
            } else {
              resolve();
            }
          })
        ));
      } else {
        // 单协议：关闭单个服务器
        await new Promise<void>((resolve) => {
          if (server.Stop) {
            server.Stop(() => resolve());
          } else {
            resolve();
          }
        });
      }
      Logger.Log('Koatty', '', '✓ Server stopped gracefully');
    } catch (error) {
      Logger.Error('ServeComponent: Error stopping server:', error);
    }
  }

}
```

### 3.8 重构 TracePlugin → TraceComponent

```typescript
// packages/koatty-trace/src/TraceComponent.ts

import {
  Component,
  IComponent,
  AppEvent,
  OnEvent,
  KoattyApplication,
  Koatty,
} from 'koatty_core';
import { DefaultLogger as Logger } from 'koatty_logger';
import { Trace } from './trace/trace';

/**
 * 链路追踪组件
 * 负责初始化 OpenTelemetry 追踪
 * 
 * 实现 IComponent 接口（基类接口）
 * 
 * 事件绑定：
 * - beforeMiddlewareLoad: 初始化追踪中间件（优先于其他中间件）
 * - appStop: 关闭追踪器，刷新数据
 */
@Component('TraceComponent', {
  scope: 'core',
  priority: 1000,  // 高优先级，确保追踪中间件最先加载
})
export class TraceComponent implements IComponent {
  private tracer: any = null;

  /**
   * 初始化追踪中间件
   * 
   * 在 beforeMiddlewareLoad 事件中执行，确保追踪中间件
   * 在所有其他中间件之前加载，以便追踪完整的请求链路
   */
  @OnEvent(AppEvent.beforeMiddlewareLoad)
  async initTrace(app: KoattyApplication): Promise<void> {
    const traceOptions = app.config('trace') || {};

    Logger.Log('Koatty', '', 'Initializing trace middleware...');

    this.tracer = Trace(traceOptions, app as Koatty);
    
    // 将 tracer 挂载到 app 上，供其他组件使用
    (app as any).tracer = this.tracer;
    app.use(this.tracer);

    Logger.Log('Koatty', '', '✓ Trace middleware initialized');
  }

  /**
   * 应用停止时关闭追踪器
   * 
   * 确保所有追踪数据被刷新到后端
   */
  @OnEvent(AppEvent.appStop)
  async stopTrace(app: KoattyApplication): Promise<void> {
    if (!this.tracer) return;

    Logger.Log('Koatty', '', 'TraceComponent: Shutting down tracer...');

    try {
      if (typeof this.tracer.shutdown === 'function') {
        await this.tracer.shutdown();
      }
      Logger.Log('Koatty', '', '✓ Tracer shutdown completed');
    } catch (error) {
      Logger.Error('TraceComponent: Error shutting down tracer:', error);
    }
  }

}
```

### 3.9 appStop 事件统一处理与 uninstall 移除

**重构要点**：
1. 将原有分散的 `app.once("appStop", ...)` 监听统一迁移到组件的 `@OnEvent(AppEvent.appStop)` 装饰器
2. **移除 `uninstall` 方法** - 清理逻辑全部通过 `@OnEvent(AppEvent.appStop)` 处理

#### 为什么移除 uninstall

| 原因 | 说明 |
|------|------|
| 未被调用 | `ComponentManager.unloadPlugins()` 方法虽然定义了，但从未被任何代码调用 |
| 功能重复 | `@OnEvent(AppEvent.appStop)` 已经提供了统一的清理时机 |
| 简化接口 | 减少接口复杂度，组件只需关注事件绑定 |

#### 需要移除的代码

**1. IComponent / IPlugin 接口**
```typescript
// 移除 uninstall 方法定义
export interface IComponent {
  run?: (options: object, app: KoattyApplication) => Promise<any>;
  // uninstall?: (app: KoattyApplication) => Promise<void>;  // 移除
}
```

**2. ComponentManager.unloadPlugins()**
```typescript
// 整个方法可以移除，或保留为空实现以兼容
async unloadPlugins(): Promise<void> {
  // 清理逻辑已通过 @OnEvent(AppEvent.appStop) 处理
  Logger.Log('Koatty', '', 'Plugins cleanup via appStop event');
}
```

**3. 各组件的 uninstall 实现**
```typescript
// RouterComponent, ServeComponent, TraceComponent 等
// 移除 uninstall 方法，使用 @OnEvent(AppEvent.appStop) 替代
```

#### 需要移除的旧代码

**1. koatty-router/src/router/router.ts**
```typescript
// 移除此代码块
app.once("appStop", async () => {
  await factory.shutdownAll();
});
```

**2. koatty-serve/src/utils/terminus.ts**
```typescript
// 保留触发 appStop 事件的代码（由 terminus 触发）
// 但清理逻辑由 ServeComponent.stopServer() 处理
await asyncEvent(app, 'appStop');
```

**3. koatty-trace（如果有的话）**
```typescript
// 移除任何 app.once("appStop", ...) 监听
// 清理逻辑由 TraceComponent.stopTrace() 处理
```

#### 新的统一处理方式

```
┌─────────────────────────────────────────────────────────────────┐
│                    appStop 事件触发流程                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  进程收到 SIGTERM/SIGINT                                        │
│           ↓                                                     │
│  terminus.ts 触发 asyncEvent(app, 'appStop')                    │
│           ↓                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 按优先级执行绑定到 appStop 的处理函数                      │   │
│  │                                                         │   │
│  │  1. TraceComponent.stopTrace()      (priority: 1000)   │   │
│  │     └── 关闭追踪器，刷新数据                              │   │
│  │                                                         │   │
│  │  2. RouterComponent.cleanup()       (priority: 100)    │   │
│  │     └── 关闭路由资源                                     │   │
│  │                                                         │   │
│  │  3. ServeComponent.stopServer()     (priority: 100)    │   │
│  │     └── 优雅关闭服务器                                   │   │
│  │                                                         │   │
│  │  4. 用户态 Plugin 的 appStop 处理   (按 priority)       │   │
│  │     └── 用户自定义的清理逻辑                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│           ↓                                                     │
│  process.exit()                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.10 修改 plugin.ts 配置

```typescript
// packages/koatty/src/config/plugin.ts

export default {
  // ============================================================
  // 用户态插件加载列表（按顺序执行）
  // 注意：内核态组件（Component）不需要在此配置，自动加载
  // ============================================================
  list: [
    // 'AuthPlugin',      // 认证插件
    // 'CachePlugin',     // 缓存插件
    // 'SchedulePlugin',  // 定时任务插件
  ],
  
  // ============================================================
  // 组件/插件配置
  // ============================================================
  config: {
    // --- 内核态组件（@Component）---
    // 框架内置，通常不需要修改，可通过 enabled: false 禁用
    RouterComponent: {
      enabled: true,
    },
    ServeComponent: {
      enabled: true,
    },
    TraceComponent: {
      enabled: true,
    },
    
    // --- 用户态插件（@Plugin）---
    // 用户自定义插件的配置
    // AuthPlugin: {
    //   enabled: true,
    //   // 插件特定配置
    //   secret: 'your-jwt-secret',
    // },
    // CachePlugin: {
    //   enabled: true,
    //   redis: {
    //     host: 'localhost',
    //     port: 6379,
    //   },
    // },
  }
};
```

### 3.9 修改 Loader.ts

```typescript
// packages/koatty/src/core/Loader.ts (关键修改部分)

/**
 * 加载所有组件
 */
public static async LoadAllComponents(app: KoattyApplication, target: any) {
  // ... 前置代码保持不变 ...

  Logger.Log('Koatty', '', 'Initializing Component Manager ...');
  const componentManager = new ComponentManager(app);
  Helper.define(app, 'componentManager', componentManager);

  // 发现组件（替换 discoverPlugins）
  componentManager.discoverComponents();
  
  // 注册内核态组件事件（替换 registerCorePluginHooks）
  componentManager.registerCoreComponentHooks();

  const stats = componentManager.getStats();
  Logger.Log('Koatty', '', `Discovered ${stats.coreComponents} core components, ${stats.userComponents} user components`);

  // ... 事件触发代码保持不变 ...

  Logger.Log('Koatty', '', 'Load Components ...');
  // 替换 loadUserPlugins
  await loader.LoadComponents(componentManager);

  // ... 后续代码保持不变 ...
}

/**
 * 加载组件
 */
protected async LoadComponents(componentManager?: ComponentManager) {
  const componentList = IOC.listClass("COMPONENT");

  componentList.forEach((item: ComponentItem) => {
    item.id = (item.id ?? "").replace("COMPONENT:", "");
    if (Helper.isClass(item.target)) {
      IOC.reg(item.id, item.target, { scope: "Singleton", type: "COMPONENT", args: [] });

      // Aspect 检查保持不变
      if (item.id && (item.id).endsWith("Aspect")) {
        const ctl = IOC.getInsByClass(item.target);
        if (!implementsAspectInterface(ctl)) {
          throw Error(`The aspect ${item.id} must implements interface 'IAspect'.`);
        }
      }
    }
  });

  if (componentManager) {
    // 使用新的组件管理器加载用户态组件
    await componentManager.loadUserComponents();
  }
}
```

---

## 四、加载流程说明

### 4.1 事件绑定与执行机制

#### 4.1.1 核心函数：asyncEvent

```typescript
// packages/koatty-core/src/Utils.ts

/**
 * 异步执行事件的所有监听器
 * 
 * 工作流程：
 * 1. 获取事件的所有监听器 (listeners)
 * 2. 按注册顺序依次执行每个监听器（await）
 * 3. 执行完毕后移除所有监听器
 */
export async function asyncEvent(event: EventEmitter, eventName: string): Promise<void> {
  const listeners = event.listeners(eventName);
  for (const func of listeners) {
    if (Helper.isFunction(func)) await func();
  }
  event.removeAllListeners(eventName);
}
```

#### 4.1.2 组件绑定到事件队列

```typescript
// ComponentManager.registerCoreComponentHooks()

// 1. 按依赖关系解析组件加载顺序
const componentOrder = this.resolveComponentOrder();

// 2. 遍历每个组件，将其事件处理函数绑定到 app 事件
for (const name of componentOrder) {
  const meta = this.coreComponents.get(name);
  const events = meta.events;  // 来自 @OnEvent 装饰器或 events 对象
  
  for (const [eventName, handler] of Object.entries(events)) {
    // 使用 app.once 绑定事件（执行一次后自动移除）
    this.app.once(eventName, async () => {
      await handler(this.app);
    });
  }
}
```

#### 4.1.3 事件执行时机

```typescript
// Bootstrap.ts 和 Loader.ts 中的事件触发

// 触发事件 = 执行所有绑定到该事件的处理函数
await asyncEvent(app, AppEvent.configLoaded);
await asyncEvent(app, AppEvent.beforeComponentLoad);
// ... 其他事件
```

### 4.2 完整启动流程（LoadAllComponents → asyncEvent）

```
┌─────────────────────────────────────────────────────────────────┐
│                    Bootstrap.executeBootstrap                    │
├─────────────────────────────────────────────────────────────────┤
│  1. checkRuntime()                                              │
│  2. Loader.initialize(app)                                      │
│  3. bootFunc(app)                                               │
│  4. IOC.setApp(app)                                             │
│  5. Loader.CheckAllComponents(app, target)                      │
│  6. Loader.LoadAppEventHooks(app, target)                       │
│  7. await asyncEvent(app, AppEvent.appBoot)                     │
│  8. await Loader.LoadAllComponents(app, target)  ─────────────┐ │
│  9. await asyncEvent(app, AppEvent.appReady)                  │ │
│ 10. await asyncEvent(app, AppEvent.beforeServerStart)         │ │
│ 11. app.listen()                                              │ │
│ 12. await asyncEvent(app, AppEvent.afterServerStart)          │ │
└───────────────────────────────────────────────────────────────┼─┘
                                                                │
┌───────────────────────────────────────────────────────────────┼─┐
│                    Loader.LoadAllComponents                   │ │
├───────────────────────────────────────────────────────────────┼─┤
│  ┌─────────────────────────────────────────────────────────┐  │ │
│  │ Phase 1: 配置加载                                        │  │ │
│  │  - loader.LoadConfigs()                                 │  │ │
│  │  - await asyncEvent(app, AppEvent.configLoaded)         │  │ │
│  └─────────────────────────────────────────────────────────┘  │ │
│                              ↓                                 │ │
│  ┌─────────────────────────────────────────────────────────┐  │ │
│  │ Phase 2: 组件发现与事件绑定                               │  │ │
│  │  - componentManager = new ComponentManager(app)         │  │ │
│  │  - componentManager.discoverComponents()                │  │ │
│  │  - componentManager.registerCoreComponentHooks()  ←──┐  │  │ │
│  │    ↑ 将组件的事件处理函数绑定到 app 事件队列          │  │  │ │
│  └───────────────────────────────────────────────────────┼──┘  │ │
│                              ↓                           │     │ │
│  ┌─────────────────────────────────────────────────────────┐  │ │
│  │ Phase 3: 组件加载                                        │  │ │
│  │  - await asyncEvent(app, AppEvent.beforeComponentLoad)  │  │ │
│  │  - await loader.LoadComponents(componentManager)        │  │ │
│  │  - await asyncEvent(app, AppEvent.afterComponentLoad)   │  │ │
│  └─────────────────────────────────────────────────────────┘  │ │
│                              ↓                                 │ │
│  ┌─────────────────────────────────────────────────────────┐  │ │
│  │ Phase 4: 中间件加载                                       │  │ │
│  │  - await asyncEvent(app, AppEvent.beforeMiddlewareLoad) │  │ │
│  │  - await loader.LoadMiddlewares()                       │  │ │
│  │  - await asyncEvent(app, AppEvent.afterMiddlewareLoad)  │  │ │
│  └─────────────────────────────────────────────────────────┘  │ │
│                              ↓                                 │ │
│  ┌─────────────────────────────────────────────────────────┐  │ │
│  │ Phase 5: 服务加载                                         │  │ │
│  │  - await asyncEvent(app, AppEvent.beforeServiceLoad)    │  │ │
│  │  - await loader.LoadServices()                          │  │ │
│  │  - await asyncEvent(app, AppEvent.afterServiceLoad)     │  │ │
│  └─────────────────────────────────────────────────────────┘  │ │
│                              ↓                                 │ │
│  ┌─────────────────────────────────────────────────────────┐  │ │
│  │ Phase 6: 控制器加载                                       │  │ │
│  │  - await asyncEvent(app, AppEvent.beforeControllerLoad) │  │ │
│  │  - await loader.LoadControllers()                       │  │ │
│  │  - await asyncEvent(app, AppEvent.afterControllerLoad)  │  │ │
│  └─────────────────────────────────────────────────────────┘  │ │
│                              ↓                                 │ │
│  ┌─────────────────────────────────────────────────────────┐  │ │
│  │ Phase 7: 路由加载                                         │  │ │
│  │  - await asyncEvent(app, AppEvent.beforeRouterLoad)  ←──┼──┼─┤
│  │    ↑ RouterComponent 在此事件中初始化路由                 │  │ │
│  │  - await loader.LoadRouter(controllers)                 │  │ │
│  │  - await asyncEvent(app, AppEvent.afterRouterLoad)      │  │ │
│  └─────────────────────────────────────────────────────────┘  │ │
└───────────────────────────────────────────────────────────────┼─┘
                                                                │
┌───────────────────────────────────────────────────────────────┼─┐
│                    继续 Bootstrap 流程                         │ │
├───────────────────────────────────────────────────────────────┼─┤
│  - await asyncEvent(app, AppEvent.appReady)                   │ │
│  - await asyncEvent(app, AppEvent.beforeServerStart)  ←───────┼─┤
│    ↑ ServeComponent 在此事件中初始化服务器                     │ │
│  - app.listen()                                               │ │
│  - await asyncEvent(app, AppEvent.afterServerStart)           │ │
│  - await asyncEvent(app, AppEvent.appStart)                   │ │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 事件执行顺序（固定，不可修改）

```
┌─────────────────────────────────────────────────────────────────┐
│                    AppEvent 执行顺序                             │
├─────────────────────────────────────────────────────────────────┤
│  阶段        │ 事件名                  │ 触发位置                │
├─────────────────────────────────────────────────────────────────┤
│  启动        │ appBoot                │ Bootstrap              │
│  配置        │ configLoaded           │ LoadAllComponents      │
│  组件        │ beforeComponentLoad    │ LoadAllComponents      │
│             │ componentLoading       │ (预留)                  │
│             │ afterComponentLoad     │ LoadAllComponents      │
│  中间件      │ beforeMiddlewareLoad   │ LoadAllComponents      │
│             │ middlewareLoading      │ (预留)                  │
│             │ afterMiddlewareLoad    │ LoadAllComponents      │
│  服务        │ beforeServiceLoad      │ LoadAllComponents      │
│             │ afterServiceLoad       │ LoadAllComponents      │
│  控制器      │ beforeControllerLoad   │ LoadAllComponents      │
│             │ afterControllerLoad    │ LoadAllComponents      │
│  路由        │ beforeRouterLoad       │ LoadAllComponents ←Router│
│             │ afterRouterLoad        │ LoadAllComponents      │
│  就绪        │ appReady               │ Bootstrap              │
│  服务器      │ beforeServerStart      │ Bootstrap ←Serve       │
│             │ afterServerStart       │ Bootstrap              │
│  运行        │ appStart               │ Bootstrap              │
│  停止        │ beforeServerStop       │ (预留)                  │
│             │ appStop                │ 进程退出时              │
│             │ afterServerStop        │ (预留)                  │
└─────────────────────────────────────────────────────────────────┘

注：
- ←Router 表示 RouterComponent 在此事件中初始化
- ←Serve 表示 ServeComponent 在此事件中初始化
```

### 4.4 同一事件的优先级控制

组件绑定到同一事件时，执行顺序由以下因素决定：

1. **组件注册顺序**：先注册的先执行
2. **组件 priority**：影响注册顺序（priority 大的先注册）
3. **依赖关系**：被依赖的组件先注册

```typescript
// ComponentManager.registerCoreComponentHooks()

// 1. 解析组件顺序（考虑 priority 和依赖关系）
const componentOrder = this.sortByPriority(this.coreComponents);

// 2. 按顺序注册事件（先注册的先执行）
for (const name of componentOrder) {
  // priority 高的组件先注册，因此先执行
  this.app.once(eventName, handler);
}
```

**示例**：

```typescript
// RouterComponent priority: 100
// ServeComponent priority: 100
// CustomComponent priority: 50

// 如果都绑定到 beforeServerStart 事件：
// 执行顺序：RouterComponent → ServeComponent → CustomComponent
```

### 4.5 内核态 vs 用户态加载

```
┌─────────────────────────────────────────────────────────────────┐
│                    内核态组件 (@Component)                        │
│                    scope: 'core' (默认)                          │
├─────────────────────────────────────────────────────────────────┤
│  加载时机：框架启动时自动加载                                      │
│  加载顺序：按 priority 排序（数值大的先加载）                       │
│  配置方式：config/plugin.ts 的 config 中可禁用                     │
│                                                                 │
│  示例：                                                          │
│  1. RouterComponent (priority: 100) - 路由初始化                 │
│  2. ServeComponent (priority: 100) - 服务器初始化                │
│  3. TraceComponent (priority: 100) - 链路追踪                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    用户态插件 (@Plugin)                           │
│                    scope: 'user' (默认)                          │
├─────────────────────────────────────────────────────────────────┤
│  加载时机：在内核态组件之后加载                                    │
│  加载顺序：                                                       │
│    1. 按 config/plugin.ts 的 list 数组顺序                        │
│    2. 未在 list 中的插件按 priority 排序                          │
│  配置方式：config/plugin.ts 的 list + config                      │
│                                                                 │
│  示例：                                                          │
│  1. AuthPlugin - 认证授权                                        │
│  2. CachePlugin - 缓存管理                                       │
│  3. SchedulePlugin - 定时任务                                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    其他组件类型                                    │
├─────────────────────────────────────────────────────────────────┤
│  @Middleware - 中间件（按 config/middleware.ts 配置加载）          │
│  @Service - 服务（自动扫描加载）                                   │
│  @Controller - 控制器（自动扫描加载）                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、迁移指南

### 5.1 旧版 Plugin 迁移

**旧版写法：**
```typescript
@Plugin('MyPlugin', {
  type: 'core',
  priority: 100,
  dependencies: ['RouterPlugin'],
  provides: [{ name: 'myFeature', version: '1.0.0' }],
  conflicts: ['OtherPlugin'],
})
export class MyPlugin implements IPlugin {
  readonly events = {
    [AppEvent.beforeServerStart]: async (app) => {
      // ...
    },
  };
  
  async run(options: object, app: KoattyApplication) {
    // ...
  }
}
```

**新版写法：**
```typescript
@Component('MyComponent', {
  scope: 'core',
  priority: 100,
  requires: ['RouterComponent'], // 可选，简化依赖声明
})
export class MyComponent implements IComponent {
  
  @OnEvent(AppEvent.beforeServerStart)
  async initFeature(app: KoattyApplication) {
    // ...
  }
  
  async run(options: object, app: KoattyApplication) {
    // ...
  }
  
  @OnEvent(AppEvent.appStop)
  async cleanup(app: KoattyApplication) {
    // 清理资源
  }
}
```

### 5.2 配置迁移

**旧版配置：**
```typescript
// config/plugin.ts
export default {
  list: ['MyPlugin'],
  config: {
    RouterPlugin: { enabled: true },
    ServePlugin: { enabled: true },
    MyPlugin: { enabled: true },
  }
};
```

**新版配置：**
```typescript
// config/plugin.ts
export default {
  // list 只配置用户态插件（@Plugin）
  // 内核态组件（@Component）自动加载，不需要在 list 中配置
  list: ['AuthPlugin', 'CachePlugin'],
  
  config: {
    // 内核态组件（@Component）
    RouterComponent: { enabled: true },
    ServeComponent: { enabled: true },
    TraceComponent: { enabled: true },
    
    // 用户态插件（@Plugin）
    AuthPlugin: { 
      enabled: true,
      // 插件配置...
    },
    CachePlugin: { 
      enabled: true,
      // 插件配置...
    },
  }
};
```

**注意**：
- 内核态组件（`*Component`）不需要在 `list` 中配置，自动按 priority 加载
- 用户态插件（`*Plugin`）需要在 `list` 中配置才会加载

---

## 六、koatty.min 模式支持

### 6.1 最小化模式

当用户设置 `koatty.min` 模式时：

```typescript
// config/plugin.ts
export default {
  list: [],
  config: {
    RouterComponent: { enabled: false },
    ServeComponent: { enabled: false },
    TraceComponent: { enabled: false },
  }
};
```

此时框架只加载底层依赖，用法趋近于 Koa 原生：

```typescript
@Bootstrap()
export class App extends Koatty {
  init() {
    // 手动添加中间件
    this.use(async (ctx, next) => {
      // ...
      await next();
    });
  }
}
```

### 6.2 组件依赖处理

```typescript
// 当 RouterComponent 被禁用时，ServeComponent 仍能正常工作
// ServeComponent 的 requires 是空的，不强制依赖 RouterComponent

// 如果某组件确实需要依赖，会在启动时报错：
// Error: Component 'MyComponent' requires 'RouterComponent' but it is not available.
//   → Solution: Enable 'RouterComponent' in config/plugin.ts
```

---

## 七、重构文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/koatty-core/src/Component.ts` | 修改 | 简化 Plugin 装饰器，添加 OnEvent 装饰器，移除 uninstall 接口方法 |
| `packages/koatty-core/src/ComponentManager.ts` | 重写 | 简化组件管理逻辑，移除/简化 unloadPlugins() |
| `packages/koatty-core/src/index.ts` | 修改 | 导出新增的装饰器和类型 |
| `packages/koatty-router/src/RouterPlugin.ts` | 重命名 | → `RouterComponent.ts`，移除 uninstall 方法 |
| `packages/koatty-router/src/router/router.ts` | 修改 | 移除 `app.once("appStop", ...)` 监听 |
| `packages/koatty-router/src/index.ts` | 修改 | 导出 `RouterComponent` |
| `packages/koatty-serve/src/ServePlugin.ts` | 重命名 | → `ServeComponent.ts`，移除 uninstall 方法 |
| `packages/koatty-serve/src/index.ts` | 修改 | 导出 `ServeComponent` |
| `packages/koatty-trace/src/TracePlugin.ts` | 重命名 | → `TraceComponent.ts`，移除 uninstall 方法 |
| `packages/koatty-trace/src/index.ts` | 修改 | 导出 `TraceComponent` |
| `packages/koatty/src/config/plugin.ts` | 修改 | 更新组件名称 |
| `packages/koatty/src/core/Loader.ts` | 修改 | 适配新的 ComponentManager |
| `packages/koatty/src/core/Bootstrap.ts` | 保持 | 启动流程不变 |

---

## 七-A、兼容性约束（重要）

### 7.1 不可修改的元数据 Key

以下元数据 Key 被其他包依赖，**必须保持不变**：

| Key | 使用位置 | 用途 |
|-----|---------|------|
| `CONTROLLER_ROUTER` | `koatty-router/src/utils/inject.ts` | 获取控制器路由配置 |
| `MIDDLEWARE_OPTIONS` | `koatty/src/core/Loader.ts` | 获取中间件装饰器选项 |

### 7.2 CONTROLLER_ROUTER 元数据格式

```typescript
// koatty-router/src/utils/inject.ts 依赖此格式
interface ControllerRouterMetadata {
  path: string;              // 路由路径前缀
  protocol: string;          // 协议类型 (http/ws/grpc/graphql)
  middleware: string[];      // 中间件名称列表
}

// 使用示例（在 koatty-router 中）
const options = IOC.getPropertyData(CONTROLLER_ROUTER, target, ctlName) ||
  { path: "", protocol: 'http' };
```

### 7.3 MIDDLEWARE_OPTIONS 元数据格式

```typescript
// koatty/src/core/Loader.ts 依赖此格式
interface MiddlewareOptionsMetadata {
  protocol?: string | string[];  // 协议限制
  priority?: number;             // 优先级
  enabled?: boolean;             // 是否启用
  [key: string]: any;            // 其他自定义配置
}

// 使用示例（在 Loader.ts 中）
decoratorOptions = IOC.getPropertyData(MIDDLEWARE_OPTIONS, middlewareClass, key) || {};
```

### 7.4 装饰器修改规则

| 装饰器 | 可修改 | 原因 |
|--------|--------|------|
| `@Plugin` | ✅ 是 | 只被 ComponentManager 使用，可以简化 |
| `@Component` | ✅ 是 | 新增装饰器，等同于 Plugin |
| `@Controller` | ❌ 否 | koatty-router 依赖 CONTROLLER_ROUTER 格式 |
| `@Middleware` | ❌ 否 | Loader.ts 依赖 MIDDLEWARE_OPTIONS 格式 |
| `@Service` | ⚠️ 谨慎 | 当前未被外部依赖，但保持稳定 |

### 7.5 兼容性处理

为确保向后兼容，Plugin 装饰器同时保存新旧两个 Key：

```typescript
export function Plugin(identifier?: string, options?: IPluginOptions): ClassDecorator {
  return (target: any) => {
    // ... 验证逻辑 ...
    
    IOC.saveClass("COMPONENT", target, identifier);
    
    // 新 Key（推荐）
    IOC.savePropertyData(COMPONENT_OPTIONS, componentOptions, target, identifier);
    
    // 旧 Key（兼容）
    IOC.savePropertyData(PLUGIN_OPTIONS, componentOptions, target, identifier);
  };
}
```

### 7.6 IOC 作用域规则

各组件类型在 IOC 容器中的注册作用域是固定的，不可修改：

| 组件类型 | IOC 作用域 | IOC 注册参数 | 原因 |
|---------|-----------|-------------|------|
| **Controller** | `Prototype` | `{ scope: "Prototype", type: "CONTROLLER" }` | 每个请求需要独立的 `ctx` 上下文 |
| **Middleware** | `Prototype` | `{ scope: "Prototype", type: "MIDDLEWARE" }` | 每个请求需要独立的实例状态 |
| **Service** | `Singleton` | `{ scope: "Singleton", type: "SERVICE" }` | 业务逻辑层，共享状态，避免重复初始化 |
| **Plugin/Component** | `Singleton` | `{ scope: "Singleton", type: "COMPONENT" }` | 扩展组件，通常只需初始化一次 |

**代码位置**：`packages/koatty/src/core/Loader.ts`

```typescript
// Controller - Prototype
IOC.reg(item.id, item.target, { scope: "Prototype", type: "CONTROLLER", args: [] });

// Middleware - Prototype  
IOC.reg(item.id, item.target, { scope: "Prototype", type: "MIDDLEWARE", args: [] });

// Service - Singleton
IOC.reg(item.id, item.target, { scope: "Singleton", type: "SERVICE", args: [] });

// Component (Plugin) - Singleton
IOC.reg(item.id, item.target, { scope: "Singleton", type: "COMPONENT", args: [] });
```

---

## 八、测试计划

### 8.1 单元测试

1. **Component 装饰器测试**
   - 测试基本装饰器功能
   - 测试 OnEvent 装饰器
   - 测试组件选项解析

2. **ComponentManager 测试**
   - 测试组件发现
   - 测试优先级排序
   - 测试依赖检查
   - 测试事件注册

### 8.2 集成测试

1. **完整启动流程测试**
   - 测试正常启动
   - 测试 min 模式启动
   - 测试组件禁用场景

2. **多协议支持测试**
   - 测试 HTTP + WebSocket
   - 测试 HTTP + gRPC

### 8.3 兼容性测试

1. **向后兼容测试**
   - 测试旧版 Plugin 写法（临时兼容）
   - 测试配置迁移

---

## 九、预期收益

1. **代码简化**
   - Plugin 装饰器代码量减少 60%
   - ComponentManager 代码量减少 50%

2. **概念清晰**
   - 统一的组件模型
   - 明确的内核态/用户态分离
   - 通用的事件绑定机制

3. **扩展性提升**
   - 任何组件都可以绑定事件
   - 更灵活的加载控制
   - 更简单的自定义组件开发

4. **维护性提升**
   - 减少概念复杂度
   - 统一的代码风格
   - 更好的文档支持

---

## 十、时间线和里程碑

### Phase 1: 核心重构
- 修改 `Component.ts` - 简化装饰器
- 重写 `ComponentManager.ts`
- 添加 `OnEvent` 装饰器

### Phase 2: 组件迁移
- 重构 `RouterPlugin` → `RouterComponent`
- 重构 `ServePlugin` → `ServeComponent`
- 更新配置文件

### Phase 3: Loader 适配
- 修改 `Loader.ts` 适配新的 ComponentManager
- 确保启动流程正常

### Phase 4: 测试和文档
- 编写单元测试
- 编写集成测试
- 更新文档

### Phase 5: 发布
- 版本号升级
- 发布 CHANGELOG
- 迁移指南发布

---

## 附录

### A. 命名规范

**内核态组件（@Component）**：
- 类名必须以 `Component` 结尾
- 示例：`RouterComponent`, `ServeComponent`, `TraceComponent`
- 由框架提供，用户一般不需要自定义

**用户态插件（@Plugin）**：
- 类名必须以 `Plugin` 结尾
- 示例：`AuthPlugin`, `CachePlugin`, `SchedulePlugin`
- 由用户自定义，用于扩展框架功能

**其他组件**：
- Middleware：以 `Middleware` 结尾（如 `LogMiddleware`）
- Service：以 `Service` 结尾（如 `UserService`）
- Controller：以 `Controller` 结尾（如 `UserController`）

### B. Plugin 与 Component 区别

| 特性 | @Component (内核态) | @Plugin (用户态) |
|------|---------------------|------------------|
| **类名后缀** | 必须以 `Component` 结尾 | 必须以 `Plugin` 结尾 |
| **默认 scope** | `core` | `user` |
| **加载顺序** | 优先加载 | 在 Component 之后加载 |
| **主要提供者** | 框架内置 | 用户自定义 |
| **配置位置** | 框架内部 | `config/plugin.ts` |
| **后续扩展** | 保持稳定简单 | 可能添加生命周期钩子、热更新等 |

**内核态组件示例（@Component）**：
```typescript
// 由框架提供
RouterComponent   // 路由管理
ServeComponent    // 服务器管理
TraceComponent    // 链路追踪
```

**用户态插件示例（@Plugin）**：
```typescript
// 由用户定义
AuthPlugin        // 认证授权
CachePlugin       // 缓存管理
SchedulePlugin    // 定时任务
RateLimitPlugin   // 限流控制
LoggerPlugin      // 自定义日志
```

**使用建议**：
- **@Component**：仅限框架内核组件，用户一般不需要使用
- **@Plugin**：用户自定义的所有功能扩展都使用此装饰器

### C. 版本兼容

- `@Plugin` 装饰器独立保留，不再标记为 deprecated
- 旧版 `IPluginOptions` 中的 `dependencies`, `provides`, `conflicts`, `events` 暂时移除
- 后续版本可能重新设计更合理的扩展机制
