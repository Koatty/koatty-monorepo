# TC39 Decorator Migration Plan

**Document Version:** 1.0  
**Date:** 2026-04-02  
**Status:** Draft  
**Author:** Coder Agent (TASK-4-3)

---

## Executive Summary

This document outlines a comprehensive migration plan from legacy TypeScript experimental decorators to TC39 standard decorators for the Koatty framework. The migration will ensure future compatibility with JavaScript standards while maintaining backward compatibility during the transition period.

---

## 1. Current Decorator Usage Statistics

### 1.1 Overall Usage

Based on the audit conducted on 2026-04-02, the project uses decorators in **271 locations** across the codebase.

### 1.2 Detailed Breakdown by Type

| Decorator Category | Count | Files Affected |
|-------------------|-------|----------------|
| **@Service / @Component** | 93 | 30+ |
| **@Autowired / @Injectable** | 57 | 20+ |
| **@GetMapping / @PostMapping / @PutMapping / @DeleteMapping** | 32 | 15+ |
| **@Config / @Value** | 34 | 12+ |
| **@OnEvent / @EventListener** | 28 | 10+ |
| **@Controller** | 23 | 15+ |
| **Other (custom decorators)** | ~4 | 5+ |

### 1.3 Key Files Using Decorators

#### Core Framework Files
- `packages/koatty-container/src/decorator/autowired.ts` - DI decorators
- `packages/koatty-core/src/Component.ts` - Component lifecycle decorators
- `packages/koatty-router/src/params/mapping.ts` - HTTP routing decorators

#### Example Applications
- `packages/koatty/examples/basic-app/src/controller/*.ts` - Controller examples
- `packages/koatty/examples/basic-app/src/service/*.ts` - Service examples
- `packages/koatty-awesome/example/src/**/*.ts` - Complete example app

---

## 2. TC39 Standard Decorators Overview

### 2.1 Key Differences from Legacy Decorators

| Aspect | Legacy (TypeScript Experimental) | TC39 Standard |
|--------|----------------------------------|---------------|
| **Class Decorator Signature** | `(target: Function) => Function \| void` | `(target: Class, context: ClassDecoratorContext) => Class \| void` |
| **Method Decorator Signature** | `(target: any, key: string, descriptor: PropertyDescriptor) => PropertyDescriptor \| void` | `(method: Function, context: ClassMethodDecoratorContext) => Function \| void` |
| **Property Decorator Signature** | `(target: any, key: string \| symbol) => void` | `(value: undefined, context: ClassFieldDecoratorContext) => (initialValue: any) => any` |
| **Parameter Decorator** | Supported | **NOT SUPPORTED** (use alternatives) |
| **Metadata** | `reflect-metadata` required | Built-in via `context.metadata` |
| **Stage** | Stage 2 (legacy) | Stage 3 (standardized) |

### 2.2 TC39 Decorator Syntax Examples

#### Class Decorator

**Legacy (Current):**
```typescript
import "reflect-metadata";

function Controller(path: string): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata("controller:path", path, target);
    return target;
  };
}

@Controller("/api")
class UserController {}
```

**TC39 Standard:**
```typescript
function Controller(path: string) {
  return <T extends Class>(target: T, context: ClassDecoratorContext): T => {
    context.metadata.set("controller:path", path);
    return target;
  };
}

@Controller("/api")
class UserController {}
```

#### Method Decorator

**Legacy (Current):**
```typescript
function GetMapping(path: string): MethodDecorator {
  return (target: any, key: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata("route:path", path, target, key);
    return descriptor;
  };
}

class UserController {
  @GetMapping("/users")
  getUsers() {}
}
```

**TC39 Standard:**
```typescript
function GetMapping(path: string) {
  return (method: Function, context: ClassMethodDecoratorContext): Function => {
    context.metadata.set("route:path", path);
    return method;
  };
}

class UserController {
  @GetMapping("/users")
  getUsers() {}
}
```

#### Property Decorator (Field Decorator)

**Legacy (Current):**
```typescript
import "reflect-metadata";

function Autowired(): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const type = Reflect.getMetadata("design:type", target, propertyKey);
    // Store injection metadata
  };
}

class UserService {
  @Autowired()
  private repository: UserRepository;
}
```

**TC39 Standard:**
```typescript
function Autowired() {
  return (value: undefined, context: ClassFieldDecoratorContext) => {
    return (initialValue: any) => {
      // Use context.metadata for metadata storage
      context.metadata.set("injection:field", context.name);
      // Return the actual value (from DI container)
      return IOCContainer.resolve(context.name.toString());
    };
  };
}

class UserService {
  @Autowired()
  private repository?: UserRepository;
}
```

#### Parameter Decorator (Alternative Approach)

**Legacy (Current):**
```typescript
function Inject(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol, parameterIndex: number) => {
    const paramTypes = Reflect.getMetadata("design:paramtypes", target, propertyKey);
    // Store parameter injection metadata
  };
}

class UserService {
  constructor(@Inject() private repository: UserRepository) {}
}
```

**TC39 Standard (Alternative):**
```typescript
// TC39 does NOT support parameter decorators
// Use constructor-based DI or field injection instead

class UserService {
  @Autowired()
  private repository?: UserRepository;
  
  // Or use explicit constructor injection
  constructor(repository: UserRepository) {
    this.repository = repository;
  }
}
```

---

## 3. Migration Strategy

### 3.1 Phased Migration Approach

#### Phase 1: Preparation (2-3 weeks)
- [ ] Set up TC39 decorator polyfill/shim layer
- [ ] Create decorator compatibility layer
- [ ] Update TypeScript to version 5.0+ (full TC39 support)
- [ ] Create automated migration scripts
- [ ] Document all custom decorator usage patterns

#### Phase 2: Core Framework Migration (3-4 weeks)
- [ ] Migrate `koatty-container` decorators
  - `@Autowired` → TC39 field decorator
  - `@Inject` → Remove (use field injection or constructor DI)
  - `@Service`, `@Component` → TC39 class decorators
- [ ] Migrate `koatty-core` decorators
  - `@Controller` → TC39 class decorator
  - `@Middleware` → TC39 class decorator
  - `@OnEvent` → TC39 method decorator
- [ ] Migrate `koatty-router` decorators
  - `@GetMapping`, `@PostMapping`, etc. → TC39 method decorators

#### Phase 3: Example & Test Migration (2-3 weeks)
- [ ] Update all example applications
- [ ] Update all test files
- [ ] Update documentation and tutorials

#### Phase 4: Cleanup & Optimization (1-2 weeks)
- [ ] Remove legacy decorator support
- [ ] Remove `reflect-metadata` dependency
- [ ] Performance optimization
- [ ] Final documentation updates

### 3.2 Backward Compatibility Strategy

During the transition period (Phases 1-3), both decorator styles will be supported:

#### Option A: Dual Decorator Factories

```typescript
// Support both legacy and TC39 decorators
function createClassDecorator(options: any) {
  return (target: any, context?: any) => {
    // Detect decorator type
    if (context && context.kind === 'class') {
      // TC39 path
      return handleTC39Decorator(target, context, options);
    } else {
      // Legacy path
      return handleLegacyDecorator(target, options);
    }
  };
}
```

#### Option B: Separate Decorator Exports

```typescript
// Legacy decorators (deprecated)
export { Controller } from './decorators/legacy/controller';
export { Service } from './decorators/legacy/service';

// TC39 decorators (recommended)
export { Controller as ControllerV2 } from './decorators/tc39/controller';
export { Service as ServiceV2 } from './decorators/tc39/service';
```

#### Option C: TypeScript Version Detection

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": false, // Use TC39 decorators
    "target": "ES2022",
    "useDefineForClassFields": false
  }
}
```

---

## 4. Detailed Migration Steps

### 4.1 Step 1: Update TypeScript Configuration

**File:** `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "ESNext.Decorators"],
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false,
    "useDefineForClassFields": false
  }
}
```

### 4.2 Step 2: Create Compatibility Layer

**File:** `packages/koatty-container/src/decorator/compat.ts`

```typescript
/**
 * Decorator compatibility layer
 * Provides utilities for supporting both legacy and TC39 decorators
 */

export interface DecoratorContext {
  kind: 'class' | 'method' | 'field' | 'getter' | 'setter';
  name: string | symbol;
  metadata: Map<string, any>;
  addInitializer?: (initializer: () => void) => void;
}

export function isTC39Context(context: any): context is DecoratorContext {
  return context && typeof context === 'object' && 'kind' in context;
}
```

### 4.3 Step 3: Migrate @Autowired Decorator

**Before (Legacy):**
```typescript
// packages/koatty-container/src/decorator/autowired.ts
export function Autowired<T>(paramName?: ClassOrString<T>): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const designType = Reflect.getMetadata("design:type", target, propertyKey);
    IOC.savePropertyData(TAGGED_PROP, { type: designType }, target, propertyKey);
  };
}
```

**After (TC39):**
```typescript
// packages/koatty-container/src/decorator/autowired.ts
export function Autowired<T>(paramName?: ClassOrString<T>) {
  return (value: undefined, context: ClassFieldDecoratorContext) => {
    return (initialValue: any) => {
      const fieldName = context.name.toString();
      const metadata = context.metadata;
      
      // Store injection metadata
      metadata.set(`autowired:${fieldName}`, {
        paramName,
        fieldName
      });
      
      // Return resolved instance from IOC container
      return IOC.resolve(paramName || fieldName);
    };
  };
}
```

### 4.4 Step 4: Migrate @Controller Decorator

**Before (Legacy):**
```typescript
// packages/koatty-core/src/Component.ts
export function Controller(path = "", options?: IControllerOptions): ClassDecorator {
  return (target: Function) => {
    const identifier = IOC.getIdentifier(target);
    IOC.saveClass("CONTROLLER", target, identifier);
    IOC.savePropertyData(CONTROLLER_ROUTER, { path }, target, identifier);
  };
}
```

**After (TC39):**
```typescript
// packages/koatty-core/src/Component.ts
export function Controller(path = "", options?: IControllerOptions) {
  return <T extends Class>(target: T, context: ClassDecoratorContext): T => {
    const identifier = IOC.getIdentifier(target);
    IOC.saveClass("CONTROLLER", target, identifier);
    
    // Use context.metadata instead of Reflect
    context.metadata.set(`controller:router:${identifier}`, { path, ...options });
    
    return target;
  };
}
```

### 4.5 Step 5: Migrate HTTP Mapping Decorators

**Before (Legacy):**
```typescript
// packages/koatty-router/src/params/mapping.ts
export const RequestMapping = (
  path = "/",
  reqMethod: RequestMethod = RequestMethod.GET
): MethodDecorator => {
  return (target: any, key: string, descriptor: PropertyDescriptor) => {
    IOC.attachPropertyData(MAPPING_KEY, { path, method: key }, target, key);
    return descriptor;
  };
};
```

**After (TC39):**
```typescript
// packages/koatty-router/src/params/mapping.ts
export const RequestMapping = (
  path = "/",
  reqMethod: RequestMethod = RequestMethod.GET
) => {
  return (method: Function, context: ClassMethodDecoratorContext): Function => {
    const methodName = context.name.toString();
    
    // Store in context metadata
    context.metadata.set(`route:${methodName}`, {
      path,
      method: methodName,
      requestMethod: reqMethod
    });
    
    return method;
  };
};
```

### 4.6 Step 6: Remove Parameter Decorators

**Strategy:** Replace parameter decorators with field injection or constructor-based DI.

**Before (Legacy):**
```typescript
class UserService {
  constructor(@Inject() private repository: UserRepository) {}
}
```

**After (TC39 - Field Injection):**
```typescript
class UserService {
  @Autowired()
  private repository?: UserRepository;
}
```

**After (TC39 - Constructor Injection):**
```typescript
class UserService {
  private repository: UserRepository;
  
  constructor(repository: UserRepository) {
    this.repository = repository;
  }
}

// In DI container configuration
IOC.register(UserService, [UserRepository]);
```

---

## 5. Compatibility Matrix

### 5.1 TypeScript Version Support

| TypeScript Version | Experimental Decorators | TC39 Decorators | Recommended |
|-------------------|------------------------|-----------------|-------------|
| 4.x | ✅ Full Support | ❌ Not Supported | Legacy |
| 5.0+ | ✅ Full Support | ✅ Full Support | Transition |
| 6.0+ (future) | ⚠️ Deprecated | ✅ Full Support | TC39 Only |

### 5.2 Node.js Version Support

| Node.js Version | TC39 Decorators | Notes |
|----------------|-----------------|-------|
| 18.x | ✅ (with flags) | Requires `--experimental-decorators` |
| 20.x+ | ✅ Full Support | Native support |

### 5.3 Framework Compatibility

| Koatty Version | Legacy Decorators | TC39 Decorators | Status |
|----------------|-------------------|-----------------|--------|
| 3.x | ✅ Primary | ❌ Not Supported | Current |
| 4.x (planned) | ✅ Deprecated | ✅ Primary | Migration |
| 5.x (future) | ❌ Removed | ✅ Only | Final |

---

## 6. Risk Assessment & Mitigation

### 6.1 High-Risk Areas

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Breaking changes for users** | High | High | Dual decorator support, gradual migration guide |
| **Parameter decorator removal** | High | Certain | Provide clear migration path to field injection |
| **reflect-metadata dependency** | Medium | High | Use built-in `context.metadata` |
| **Third-party library compatibility** | Medium | Medium | Maintain compatibility layer |
| **Performance regression** | Low | Low | Benchmark before/after migration |

### 6.2 Mitigation Strategies

1. **Dual Support Period**: Maintain both decorator styles for 2 major versions
2. **Migration Tools**: Provide codemods and automated migration scripts
3. **Comprehensive Testing**: Ensure 100% test coverage during migration
4. **Documentation**: Provide step-by-step migration guides for users
5. **Community Feedback**: Release alpha/beta versions for community testing

---

## 7. Estimated Effort

### 7.1 Work Breakdown

| Task | Effort (person-days) | Priority |
|------|---------------------|----------|
| **Phase 1: Preparation** | | |
| Update TypeScript & tooling | 3 | High |
| Create compatibility layer | 5 | High |
| Document current decorator usage | 2 | Medium |
| **Phase 2: Core Framework Migration** | | |
| Migrate koatty-container | 8 | High |
| Migrate koatty-core | 6 | High |
| Migrate koatty-router | 5 | High |
| Update unit tests | 5 | High |
| **Phase 3: Example & Test Migration** | | |
| Update example applications | 4 | Medium |
| Update integration tests | 3 | Medium |
| Update documentation | 4 | Medium |
| **Phase 4: Cleanup & Optimization** | | |
| Remove legacy support | 2 | Low |
| Performance optimization | 3 | Medium |
| Final documentation | 2 | Low |
| **Total** | **52 person-days** | |

### 7.2 Timeline

| Phase | Duration | Team Size | Calendar Time |
|-------|----------|-----------|---------------|
| Phase 1 | 2-3 weeks | 1 developer | 3 weeks |
| Phase 2 | 3-4 weeks | 2 developers | 4 weeks |
| Phase 3 | 2-3 weeks | 1 developer | 3 weeks |
| Phase 4 | 1-2 weeks | 1 developer | 2 weeks |
| **Total** | **8-12 weeks** | | **12 weeks** |

### 7.3 Resource Requirements

- **Senior TypeScript Developer**: 1 full-time (12 weeks)
- **Mid-level Developer**: 1 part-time (4 weeks, Phase 2 only)
- **Technical Writer**: 1 part-time (2 weeks, Phase 3-4)
- **QA Engineer**: 1 part-time (throughout migration)

---

## 8. Success Criteria

### 8.1 Technical Criteria

- [ ] All core framework decorators migrated to TC39 standard
- [ ] 100% test coverage maintained
- [ ] No performance regression (>5% slower)
- [ ] TypeScript strict mode compliance
- [ ] `reflect-metadata` dependency removed
- [ ] All examples updated and working

### 8.2 User Experience Criteria

- [ ] Clear migration guide published
- [ ] Automated migration tools available
- [ ] Backward compatibility maintained for 2 major versions
- [ ] No breaking changes in minor versions
- [ ] Community feedback incorporated

---

## 9. Rollout Plan

### 9.1 Release Strategy

#### Version 3.x (Current)
- Maintain legacy decorators
- Add TC39 decorator support behind feature flag
- Document migration path

#### Version 4.0 (Migration Release)
- Dual decorator support (legacy + TC39)
- Deprecation warnings for legacy decorators
- Migration tools released
- Extensive documentation

#### Version 5.0 (Future)
- TC39 decorators only
- Legacy decorator support removed
- Clean codebase

### 9.2 Communication Plan

1. **Pre-announcement** (3 months before v4.0)
   - Blog post explaining migration
   - RFC (Request for Comments) published
   
2. **Alpha Release** (2 months before v4.0)
   - Community testing
   - Gather feedback
   
3. **Beta Release** (1 month before v4.0)
   - Final adjustments
   - Documentation finalized
   
4. **Production Release** (v4.0)
   - Migration guide published
   - Support channels active

---

## 10. Appendix

### 10.1 References

- [TC39 Decorators Proposal](https://github.com/tc39/proposal-decorators)
- [TypeScript 5.0 Release Notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html)
- [ECMAScript Decorators specification](https://tc39.es/proposal-decorators/)
- [reflect-metadata library](https://github.com/rbuckton/reflect-metadata)

### 10.2 Related Issues

- Issue #XXX: Add TC39 decorator support
- Issue #YYY: Remove reflect-metadata dependency
- Issue #ZZZ: Update TypeScript to 5.0+

### 10.3 Migration Checklist

For each decorator type:

- [ ] Document current implementation
- [ ] Design TC39 equivalent
- [ ] Implement compatibility layer
- [ ] Write unit tests
- [ ] Update integration tests
- [ ] Update documentation
- [ ] Create migration example
- [ ] Performance benchmark
- [ ] Code review
- [ ] Merge to main branch

---

## 11. 参数装饰器迁移方案 (Parameter Decorator Migration Plan)

> **背景:** TC39 Stage 3 装饰器规范目前不支持参数装饰器（Parameter Decorator）。虽然存在 [TC39 参数装饰器提案](https://github.com/tc39/proposal-class-method-parameter-decorators)（Stage 1），但何时进入标准尚不确定。本章节提供基于 DTO 类的渐进式替代方案，在不删除现有实现的前提下，为用户提供符合 TC39 标准的迁移路径。

---

### 11.1 参数装饰器现状分析

#### 11.1.1 参数装饰器完整清单

项目中共定义了 **12 个参数装饰器**，分布在 3 个包中：

**A. HTTP 参数提取装饰器（koatty-router）**

| 装饰器 | 文件 | 签名 | 功能 | 提取源 |
|--------|------|------|------|--------|
| `@Header(name?, defaultValue?)` | `params/params.ts:24` | `ParameterDecorator` | 提取请求头 | `ctx.get(name)` / `ctx.headers` |
| `@PathVariable(name?, defaultValue?)` | `params/params.ts:42` | `ParameterDecorator` | 提取路径变量 | `ctx.params[name]` |
| `@Get(name?, defaultValue?)` | `params/params.ts:63` | `ParameterDecorator` | 提取查询参数 | `ctx.query[name]` |
| `@Post(name?, defaultValue?)` | `params/params.ts:84` | `ParameterDecorator` | 提取 POST 请求体字段 | `bodyParser(ctx)[name]` |
| `@File(name?, defaultValue?)` | `params/params.ts:106` | `ParameterDecorator` | 提取上传文件 | `bodyParser(ctx).file[name]` |
| `@RequestBody()` | `params/params.ts:127` | `ParameterDecorator` | 提取完整请求体 | `bodyParser(ctx)` |
| `@Body()` | `params/params.ts:140` | `RequestBody` 别名 | 同上 | 同上 |
| `@RequestParam()` | `params/params.ts:149` | `ParameterDecorator` | 提取合并的查询+路径参数 | `queryParser(ctx)` |
| `@Param()` | `params/params.ts:162` | `RequestParam` 别名 | 同上 | 同上 |

所有 HTTP 参数装饰器通过共享的 `injectParam()` 工厂函数实现（`utils/inject.ts:661-702`），该函数将提取元数据存储到 `TAGGED_PARAM` 键下。

**B. DI 参数装饰器（koatty-container）**

| 装饰器 | 文件 | 签名 | 功能 |
|--------|------|------|------|
| `@Inject(paramName?, cType?)` | `decorator/autowired.ts:144` | `ParameterDecorator` | 构造函数参数注入 |

仅用于构造函数参数，将依赖注入元数据存储到 `TAGGED_PROP` 键下。

**C. 验证参数装饰器（koatty-validation）**

| 装饰器 | 文件 | 签名 | 功能 |
|--------|------|------|------|
| `@Valid(rule, options?)` | `decorators.ts:183` | `ParameterDecorator` | 标量参数验证 |

为方法参数附加验证规则，元数据存储在 `PARAM_RULE_KEY` 下。

#### 11.1.2 使用范围统计

| 装饰器 | 使用次数 | 影响文件 |
|--------|---------|---------|
| `@RequestBody()` | 11 | 6 个源文件 + 4 个代码生成模板 |
| `@PathVariable(name)` | 5 | 1 个源文件 + 1 个模板 |
| `@RequestParam()` | 4 | 1 个源文件 + 2 个模板 |
| `@Get(name)` / `@QueryParam(name)` | 4 | 2 个源文件 + 1 个模板 |
| `@Valid(rules, msg?)` | 5 | 3 个文件（源码+测试+示例） |
| `@Post()` | 1 | 1 个源文件 |
| `@Inject()` | ≤5 | 仅构造函数注入场景 |
| `@Header()` / `@File()` / `@Body()` / `@Param()` | 0 | 已定义但尚无使用 |

**总计约 30 处使用**（不含代码生成模板的输出）。

#### 11.1.3 运行时触发机制（三阶段架构）

当前参数装饰器系统采用**三阶段架构**：

```
[阶段 1] 编译时 — 装饰器执行，写入元数据
    @Get('id') → injectParam() → IOC.attachPropertyData(TAGGED_PARAM, {
        name: propertyKey,      // 方法名
        fn: (ctx) => ctx.query['id'],  // 提取函数
        index: 0,               // 参数位置
        type: 'number',         // 参数类型
        isDto: false,           // 是否 DTO
        sourceType: 'query',    // 提取源
        paramName: 'id',        // 字段名
        defaultValue: undefined // 默认值
    })

[阶段 2] 启动时 — 路由加载，元数据编译
    HttpRouter.LoadRouter()
      → injectRouter()          // 读取 MAPPING_KEY, CONTROLLER_ROUTER
      → injectParamMetaData()   // 读取 TAGGED_PARAM + PARAM_RULE_KEY + PARAM_CHECK_KEY
          → compileValidator()             // 预编译验证闭包
          → compileTypeConverter()         // 预编译类型转换闭包
          → generatePrecompiledExtractor() // 预编译 ctx→value 提取器
          → detectFastPathScenario()       // 检测优化路径
      → SetRouter(path, closure)           // 注册到 KoaRouter

[阶段 3] 运行时 — 请求处理，参数提取
    HTTP Request → KoaRouter 路由匹配 → 闭包执行
      → IOC.getInsByClass(ctlClass, [ctx])  // 每请求创建控制器实例
      → Handler(app, ctx, ctl, method, params)
          → extractParameters(app, ctx, params)
              → strategyCache.getOrCreate(params)  // 缓存策略处理器
              → handler(ctx, params)
                  → precompiledExtractor(ctx)       // 如 ctx.query['id']
                  → compiledTypeConverter(value)     // 如 Number(value)
                  → compiledValidator(converted)     // 如 IsNotEmpty 检查
          → ctl[method](...args)  // 调用控制器方法
```

**关键元数据键：**

| 常量 | 值 | 用途 |
|------|---|------|
| `TAGGED_PARAM` | `'TAGGED_PARAM'` | HTTP 参数提取元数据 |
| `TAGGED_PROP` | `'TAGGED_PROP'` | 属性/构造注入元数据 |
| `PARAM_RULE_KEY` | `'PARAM_RULE_KEY'` | `@Valid` 验证规则 |
| `PARAM_CHECK_KEY` | `'PARAM_CHECK_KEY'` | `@Validated` DTO 校验标记 |

---

### 11.2 保留策略与 `@deprecated` 声明

#### 11.2.1 不删除现有实现

TC39 参数装饰器提案（[proposal-class-method-parameter-decorators](https://github.com/tc39/proposal-class-method-parameter-decorators)）目前处于 Stage 1，存在进入标准的可能性。因此：

1. **保留所有参数装饰器的完整实现**，不做删除
2. 使用 JSDoc `@deprecated` 标签标注，IDE 中显示删除线提示，给出迁移说明
3. 在 v4.x 期间两种方式并存，在 v5.x 根据 TC39 标准进展做最终决策

#### 11.2.2 `@deprecated` 注释规范

所有参数装饰器统一使用 `@deprecated` 标签。按三类分别给出针对性说明：

**A. HTTP 参数提取装饰器（以 `@Get` 为例，`@Post`/`@Header`/`@PathVariable`/`@File`/`@RequestBody`/`@RequestParam` 同理）：**

```typescript
/**
 * Get query-string parameters (take value from ctx.query).
 *
 * 支持双模式：
 * - ParameterDecorator：用在方法参数上，从请求中提取查询参数
 * - PropertyDecorator：用在 DTO 类属性上，标记数据来源为查询参数
 *
 * @param {string | {name?, type?, defaultValue?}} [nameOrOptions]
 * @param {any} [defaultValue]
 * @returns {ParameterDecorator & PropertyDecorator}
 *
 * @deprecated ParameterDecorator 用法已弃用。
 * TC39 标准装饰器规范（Stage 3，已被 TypeScript 5.0+ 和主流运行时采纳）不支持参数装饰器。
 * 当项目迁移到 TC39 标准装饰器（关闭 experimentalDecorators）后，
 * ParameterDecorator 将无法通过编译。
 *
 * 请使用 DTO 类替代方案，将本装饰器用作 PropertyDecorator：
 * ```typescript
 * @Component()
 * class GetUserDto {
 *   @Get({ type: String })         // PropertyDecorator 模式（TC39 兼容）
 *   @IsNotEmpty({ message: 'name 不能为空' })
 *   name: string;
 * }
 *
 * @GetMapping('/users')
 * @Payload(GetUserDto)             // 参数绑定
 * @Validated()                     // 验证（可选）
 * async getUsers(dto: GetUserDto) { ... }
 * ```
 *
 * 注：TC39 参数装饰器提案（Stage 1）仍在讨论中。
 * 若该提案最终进入标准，ParameterDecorator 用法将视情况恢复支持。
 *
 * @see {@link https://github.com/tc39/proposal-class-method-parameter-decorators}
 * @see §11.3 DTO 替代方案设计
 */
```

**B. DI 参数装饰器 `@Inject`：**

```typescript
/**
 * Constructor parameter dependency injection.
 *
 * @param {ClassOrString<T>} [paramName] - 依赖的类或标识符字符串
 * @param {string} [cType] - 组件类型，默认 "COMPONENT"
 * @returns {ParameterDecorator}
 *
 * @deprecated ParameterDecorator 用法已弃用。
 * TC39 标准装饰器规范不支持参数装饰器，当项目迁移到 TC39 后，
 * 本装饰器的 ParameterDecorator 形态将无法通过编译。
 *
 * 迁移方案：
 * - 属性注入：改用 @Autowired(Type)
 * - 构造注入：改用 @Inject(Type1, Type2, ...) 作为 MethodDecorator 放在 constructor 上
 *
 * ```typescript
 * // TC39 构造注入
 * @Service()
 * class UserService {
 *   @Inject(UserRepository, LogService)
 *   constructor(
 *     private readonly repo: UserRepository,
 *     private readonly log: LogService
 *   ) {}
 * }
 * ```
 *
 * 注：TC39 参数装饰器提案（Stage 1）仍在讨论中。
 * 若该提案最终进入标准，ParameterDecorator 用法将视情况恢复支持。
 *
 * @see {@link https://github.com/tc39/proposal-class-method-parameter-decorators}
 * @see §11.4 @Inject 迁移方案
 */
```

**C. 验证参数装饰器 `@Valid`：**

```typescript
/**
 * Parameter validation decorator.
 *
 * @param {ValidRules | ValidRules[] | Function} rule - 验证规则
 * @param {string | ValidOtpions} [options] - 错误消息或验证选项
 * @returns {ParameterDecorator}
 *
 * @deprecated 已弃用，请使用 DTO 属性验证装饰器替代。
 * TC39 标准装饰器规范不支持参数装饰器，当项目迁移到 TC39 后，
 * 本装饰器将无法通过编译。
 *
 * DTO 属性验证装饰器（@IsNotEmpty, @IsEmail 等）是 TC39 兼容的 PropertyDecorator，
 * 支持多规则自然叠加、强类型、IDE 智能提示，是更优的替代方案。
 *
 * ```typescript
 * // 旧：@Valid("IsNotEmpty", "id 不能为空") @Get("id") id: number
 * // 新：
 * @Component()
 * class GetDetailDto {
 *   @Get({ type: Number })
 *   @IsNotEmpty({ message: 'id 不能为空' })
 *   id: number;
 * }
 * ```
 *
 * 注：TC39 参数装饰器提案（Stage 1）仍在讨论中。
 * 若该提案最终进入标准，本装饰器将视情况恢复支持。
 *
 * @see {@link https://github.com/tc39/proposal-class-method-parameter-decorators}
 * @see §11.5 @Valid 迁移方案
 */
```

#### 11.2.3 需要添加 `@deprecated` 的装饰器清单

| 包 | 装饰器 | 文件位置 | 弃用说明要点 |
|----|--------|---------|------------|
| koatty-router | `Header`, `PathVariable`, `Get`, `Post`, `File` | `src/params/params.ts` | ParameterDecorator 用法弃用，改用 PropertyDecorator 模式（DTO 属性上） |
| koatty-router | `RequestBody`, `RequestParam` (`Body`, `Param`) | `src/params/params.ts` | 同上 |
| koatty-container | `Inject` | `src/decorator/autowired.ts` | ParameterDecorator 用法弃用，改用 `@Autowired(Type)` 或 `@Inject(Type...)` MethodDecorator |
| koatty-validation | `Valid` | `src/decorators.ts` | 完全弃用，改用 DTO 属性验证装饰器（`@IsNotEmpty` 等） |

---

### 11.3 DTO 替代方案设计

#### 11.3.1 设计原则

1. **渐进式迁移**：新旧两种方式并存，用户可逐步迁移
2. **零破坏性变更**：现有使用参数装饰器的代码无需修改即可继续运行
3. **复用现有基础设施**：DTO 方案复用现有的 `injectParamMetaData()` 编译管线和策略化提取系统
4. **复用已有关键字，降低心智负担**：不引入 `@FromXxx` 等新名称，而是将现有的 `@Get`、`@Post`、`@Header`、`@PathVariable`、`@File` 升级为双模式装饰器（同时支持 `ParameterDecorator` + `PropertyDecorator`），用户无需学习新 API

#### 11.3.2 双模式装饰器设计（复用已有关键字）

**核心思路：** 将 `@Get`、`@Post`、`@Header`、`@PathVariable`、`@File` 等现有装饰器升级为**双模式装饰器**，根据调用上下文自动区分：

- **用在方法参数上** → 走现有 `ParameterDecorator` 逻辑（`injectParam`）
- **用在 DTO 类属性上** → 走新增 `PropertyDecorator` 逻辑（写入 `DTO_SOURCE_KEY`）

**调用上下文检测方式：**

```typescript
// Legacy 模式下的签名区分
// ParameterDecorator: (target, propertyKey, parameterIndex: number) → 3 个参数，第 3 个是 number
// PropertyDecorator:  (target, propertyKey: string | symbol) → 2 个参数

// TC39 模式下的签名区分
// PropertyDecorator(TC39): (value: undefined, context: ClassFieldDecoratorContext)
// ParameterDecorator:      TC39 不支持，无需处理
```

**实现模式（以 `@Get` 为例）：**

TC39 模式下 `design:type` 不可用，因此 PropertyDecorator 模式需要通过选项对象显式传入属性类型。
签名设计为重载：

```typescript
// 作为 ParameterDecorator（Legacy，保留）
Get(name?: string, defaultValue?: any): ParameterDecorator

// 作为 PropertyDecorator（新增，TC39 兼容）
// options.type 在 TC39 模式下必填（Legacy 模式可选，可从 design:type 推断）
Get(options?: { name?: string, type?: Function, defaultValue?: any }): PropertyDecorator
```

```typescript
// packages/koatty-router/src/params/params.ts

const DTO_SOURCE_KEY = 'DTO_SOURCE';

export function Get(nameOrOptions?: string | { name?: string, type?: Function, defaultValue?: any },
  defaultValue?: any): ParameterDecorator & PropertyDecorator {

  // 参数归一化
  const opts = typeof nameOrOptions === 'string'
    ? { name: nameOrOptions, defaultValue }
    : { name: nameOrOptions?.name, type: nameOrOptions?.type, defaultValue: nameOrOptions?.defaultValue ?? defaultValue };

  return function(
    targetOrValue: any,
    propertyKeyOrContext: any,
    descriptorOrUndefined?: any
  ): any {
    // —— 路径 1: ParameterDecorator（Legacy 参数装饰器）——
    if (typeof descriptorOrUndefined === 'number') {
      return injectParam(
        (ctx: KoattyContext) => {
          const queryParams = ctx.query ?? {};
          return opts.name ? queryParams[opts.name] : queryParams;
        },
        "Get",
        ParamSourceType.QUERY,
        opts.name,
        opts.defaultValue
      )(targetOrValue, propertyKeyOrContext, descriptorOrUndefined);
    }

    // —— 路径 2: PropertyDecorator（TC39 字段装饰器）——
    if (propertyKeyOrContext && typeof propertyKeyOrContext === 'object' && 'kind' in propertyKeyOrContext) {
      const context = propertyKeyOrContext as ClassFieldDecoratorContext;
      const fieldName = String(context.name);
      context.addInitializer(function() {
        const ctor = this.constructor;
        const sources = Reflect.getOwnMetadata(DTO_SOURCE_KEY, ctor) || {};
        sources[fieldName] = {
          sourceType: ParamSourceType.QUERY,
          paramName: opts.name || fieldName,
          type: opts.type,               // TC39 模式下必填
          defaultValue: opts.defaultValue,
        };
        Reflect.defineMetadata(DTO_SOURCE_KEY, sources, ctor);
      });
      return;
    }

    // —— 路径 3: PropertyDecorator（Legacy 属性装饰器）——
    const target = targetOrValue;
    const propertyKey = propertyKeyOrContext as string | symbol;
    // Legacy 模式可从 design:type 推断，TC39 模式从 opts.type 获取
    const designType = opts.type ?? Reflect.getMetadata("design:type", target, propertyKey);
    const sources = Reflect.getOwnMetadata(DTO_SOURCE_KEY, target.constructor) || {};
    sources[String(propertyKey)] = {
      sourceType: ParamSourceType.QUERY,
      paramName: opts.name || String(propertyKey),
      type: designType,
      defaultValue: opts.defaultValue,
    };
    Reflect.defineMetadata(DTO_SOURCE_KEY, sources, target.constructor);
  } as any;
}
```

**装饰器名称与数据源映射（全部复用现有名称）：**

| 装饰器 | 作为 ParameterDecorator（Legacy） | 作为 PropertyDecorator（新增，TC39 兼容） |
|--------|-------------------------------|-------------------------------|
| `@Get(name?)` 或 `@Get({ type })` | `ctx.query[name]` | DTO 属性 ← query |
| `@Post(name?)` 或 `@Post({ type })` | `bodyParser(ctx)[name]` | DTO 属性 ← body |
| `@Header(name?)` 或 `@Header({ type })` | `ctx.get(name)` | DTO 属性 ← header |
| `@PathVariable(name?)` 或 `@PathVariable({ type })` | `ctx.params[name]` | DTO 属性 ← path |
| `@File(name?)` 或 `@File({ type })` | `bodyParser(ctx).file[name]` | DTO 属性 ← file |
| `@RequestBody()` 或 `@RequestBody({ type })` | 整个 `bodyParser(ctx)` | DTO 属性 ← 整个 body |
| `@RequestParam()` 或 `@RequestParam({ type })` | `queryParser(ctx)` | DTO 属性 ← 合并 query+params |

> **`@Body`、`@Param` 作为别名，同样自动获得双模式支持。**
> 
> **Legacy 模式下**：`@Get('name')` 字符串参数写法仍可使用，`type` 从 `design:type` 自动推断。
> **TC39 模式下**：必须使用选项对象写法 `@Get({ type: String })` 显式传入类型。

#### 11.3.3 DTO 类定义规范

**核心模式：参数类型即 DTO 声明**

原有写法（参数装饰器）与新写法（DTO）的本质区别：参数绑定和验证的声明从方法签名**搬到 DTO 类属性**上，控制器方法参数类型直接声明为 DTO 类，框架自动识别。

```typescript
// ❌ 原有写法（参数装饰器）
@GetMapping('/path')
getUser(@Get() @Valid("IsNotEmpty") username: string) {
  // ...
}

// ✅ 新写法（DTO — Legacy 模式，type 可选）
@GetMapping('/path')
@Validated()                          // 验证
getUser(username: GetUserDto) {       // design:paramtypes 自动识别 DTO
  // ...
}

@Component()
class GetUserDto {
  @Get()              // Legacy：type 从 design:type 自动推断
  @IsNotEmpty()
  username: string;
}

// ✅ 新写法（DTO — TC39 模式，type 必填）
@GetMapping('/path')
@Payload(GetUserDto)                  // 参数绑定（声明 DTO 类型）
@Validated()                          // 验证（可选，需要验证时才加）
getUser(username: GetUserDto) {
  // ...
}

@Component()
class GetUserDto {
  @Get({ type: String })    // TC39：type 必须显式传入
  @IsNotEmpty()
  username: string;
}
```

> **关键点：** 控制器方法不需要任何参数装饰器，也不需要在 `@GetMapping` 上额外配置。
> - Legacy 模式：框架通过 `design:paramtypes` 自动识别 DTO，`@Get()` 通过 `design:type` 自动获取属性类型
> - TC39 模式：`@Payload(DtoClass)` 显式声明 DTO 类型，`@Get({ type })` 显式传入属性类型
> 
> **`@Payload` 与 `@Validated` 的关系：**
> - `@Payload(DtoClass)` — 纯参数绑定：声明方法参数的 DTO 类型，框架据此实例化并填充数据
> - `@Validated()` — 参数验证：对已绑定的 DTO 实例执行验证规则
> - `@Validated(DtoClass)` — 绑定 + 验证的简写：等价于 `@Payload(DtoClass) @Validated()`，即 `@Validated` 是 `@Payload` 的超集
> 
> | 场景 | 写法 |
> |------|------|
> | 只绑定不验证 | `@Payload(DtoClass)` |
> | 绑定 + 验证 | `@Payload(DtoClass) @Validated()` 或简写为 `@Validated(DtoClass)` |
> | Legacy 模式绑定 + 验证 | `@Validated()`（`design:paramtypes` 自动识别 DTO） |
> 
> **容错规则：** 用户可能同时使用两个装饰器，框架需处理所有组合而不冲突：
> 
> | 用法 | 行为 |
> |------|------|
> | `@Payload(A) @Validated()` | 绑定 A + 验证 |
> | `@Validated(A)` | 绑定 A + 验证（简写） |
> | `@Payload(A) @Validated(A)` | 两者声明了同一 DTO，**去重**，绑定 A + 验证 |
> | `@Payload(A) @Validated(B)` | **冲突**，启动时抛出明确错误提示 |
> | `@Validated(A) @Payload(A)` | 顺序无关，行为与上面一致 |
> | `@Payload(A)`（无 `@Validated`） | 仅绑定，不验证 |
> | `@Validated()`（无 `@Payload`，Legacy 模式） | 从 `design:paramtypes` 推断 DTO，绑定 + 验证 |
> | `@Validated()`（无 `@Payload`，TC39 模式） | **无法推断 DTO**，启动时抛出错误：需要 `@Payload(DtoClass)` 或 `@Validated(DtoClass)` |
>
> **实现逻辑：** `@Payload` 和 `@Validated` 都向同一个元数据键（如 `PAYLOAD_TYPE_KEY`）写入 DTO 类型。
> 框架在 `injectParamMetaData()` 启动阶段合并时：先检查是否冲突（不同类型），再去重，最终得到唯一的 DTO 类型。

**基本 DTO（多字段，单一数据源）：**

```typescript
import { Component } from 'koatty';
import { IsDefined, IsNotEmpty } from 'koatty_validation';
import { Get } from 'koatty_router';

// Legacy 模式（type 可选，自动推断）
@Component()
export class GetUsersDto {
  @Get('page')
  @IsDefined()
  page: number = 1;

  @Get('limit')
  @IsDefined()
  limit: number = 10;

  @Get('keyword')
  keyword?: string;
}

// TC39 模式（type 必填）
@Component()
export class GetUsersDto {
  @Get({ name: 'page', type: Number })
  @IsDefined()
  page: number = 1;

  @Get({ name: 'limit', type: Number })
  @IsDefined()
  limit: number = 10;

  @Get({ name: 'keyword', type: String })
  keyword?: string;
}
```

**混合数据源 DTO：**

```typescript
import { PathVariable, Post, Header } from 'koatty_router';

// TC39 模式示例（type 必填）
@Component()
export class UpdateUserDto {
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
```

**纯请求体 DTO（与现有 DTO 模式一致，无需数据源装饰器）：**

```typescript
@Component()
export class CreateUserDto {
  @IsDefined()
  @IsNotEmpty({ message: '用户名不能为空' })
  username: string;

  @IsDefined()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsDefined()
  age?: number;
}
// 无数据源装饰器 → 框架根据路由协议推断源（HTTP/gRPC/WebSocket → body）
```

#### 11.3.4 触发时机设计（核心变更）

**问题：** 当前系统依赖参数装饰器在编译时写入 `TAGGED_PARAM` 元数据，`injectParamMetaData()` 在启动时读取该元数据编译提取策略。如果不使用参数装饰器，`TAGGED_PARAM` 为空，框架如何知道要提取参数？

##### `design:paramtypes` 可用性约束

> **结论：TC39 标准装饰器模式下 `design:paramtypes` 完全不可用。**
> 
> TypeScript 编译器硬性约束：`emitDecoratorMetadata` 必须与 `experimentalDecorators` 同时启用，
> 否则直接报错 `TS5052: Option 'emitDecoratorMetadata' cannot be specified without specifying option 'experimentalDecorators'.`
> 
> 这意味着：
> - **Legacy 模式**（`experimentalDecorators: true` + `emitDecoratorMetadata: true`）：`design:paramtypes` **可用**，框架可通过它自动识别方法参数的 DTO 类型
> - **TC39 模式**（`experimentalDecorators: false`）：`design:paramtypes` **不可用**，框架无法自动获取方法参数类型
> 
> TC39 提供的替代机制是 **Decorator Metadata**（Stage 3，`Symbol.metadata` + `context.metadata`），
> 但它只是一个存取对象，不会自动发射类型信息——需要装饰器代码主动写入。

##### 解决方案：分 Legacy/TC39 两条路径

> **模式判断**：框架通过项目 `tsconfig.json` 中的 `emitDecoratorMetadata` 值判断编译模式（详见 §11.10.4）。

**Legacy 模式（`emitDecoratorMetadata: true`）：**

`design:paramtypes` 可用，框架可直接通过参数类型自动检测 DTO：

```typescript
// 控制器方法参数类型声明为 DTO 类，框架自动识别
@GetMapping('/path')
@Validated()
getUser(username: GetUserDto) { ... }
// → design:paramtypes 提供 [GetUserDto] → 框架识别为 DTO → 读取 DTO_SOURCE_KEY
```

**TC39 模式（迁移目标，`emitDecoratorMetadata` 不可用）：**

需要路由映射装饰器（`@GetMapping` 等）将方法参数类型信息写入 `context.metadata`，但 TC39 方法装饰器拿不到参数类型。
因此必须由**用户显式传入 DTO 类**。有两种方式：

**通过 `@Payload` 方法装饰器声明 DTO 类型：**

```typescript
// @Payload 专门负责参数绑定，声明 DTO 类型
@GetMapping('/path')
@Payload(GetUserDto)            // 声明 DTO 类型（参数绑定）
@Validated()                    // 可选，需要验证时加上
getUser(username: GetUserDto) {
  // ...
}

// 或使用 @Validated 简写（绑定 + 验证）
@GetMapping('/path')
@Validated(GetUserDto)          // 等价于 @Payload(GetUserDto) + @Validated()
getUser(username: GetUserDto) {
  // ...
}
```

**`@Payload` 装饰器实现（TC39 模式）：**

```typescript
const PAYLOAD_TYPE_KEY = 'PAYLOAD_TYPE';

function Payload(...dtoClasses: Function[]) {
  return (method: Function, context: ClassMethodDecoratorContext) => {
    // 将 DTO 类型存入 context.metadata，替代 design:paramtypes
    context.metadata[`${PAYLOAD_TYPE_KEY}:${String(context.name)}`] = dtoClasses;
    return method;
  };
}
```

> Legacy 模式下 `@Payload` 是可选的（`design:paramtypes` 可自动识别 DTO）。
> TC39 模式下，`@Payload(DtoClass)` 或 `@Validated(DtoClass)` 至少需要一个来声明 DTO 类型。

##### `injectParamMetaData()` 扩展逻辑

```
injectParamMetaData(app, target, options) {
    taggedParams = IOC.getPropertyData(TAGGED_PARAM, target);
    
    对于每个方法 method:
        if (taggedParams[method] 存在且非空) {
            // 路径 A：现有参数装饰器路径（保持不变）
            → 使用 TAGGED_PARAM 元数据编译策略
        } else {
            // 路径 B：DTO 自动检测路径（新增）
            
            // 获取方法参数类型（通过 emitDecoratorMetadata 判断模式）
            if (isLegacyMode) {  // tsconfig.emitDecoratorMetadata === true
                paramTypes = Reflect.getMetadata("design:paramtypes", target, method) ?? [];
            } else {
                // TC39 模式：从 @Payload/@Validated 写入的 PAYLOAD_TYPE_KEY 获取
                paramTypes = target.constructor[Symbol.metadata]?.[`PAYLOAD_TYPE:${method}`] ?? [];
            }
            
            for each paramType in paramTypes:
                if (isDtoClass(paramType)) {
                    dtoSources = Reflect.getMetadata(DTO_SOURCE_KEY, paramType);
                    
                    if (dtoSources 非空) {
                        // 路径 B1：显式源声明
                        // DTO 属性上有 @Get/@Post/@Header 等装饰器
                        → 从 DTO_SOURCE_KEY 读取每个属性的数据源
                        → 合成等价的 TAGGED_PARAM 元数据
                    } else {
                        // 路径 B2：隐式源推断
                        // DTO 属性上只有验证装饰器，无数据源装饰器
                        → 根据路由协议推断默认源:
                            HTTP → body（整个请求体转为 DTO）
                            gRPC/WebSocket → body（消息体转为 DTO）
                        → 生成单条 TAGGED_PARAM 元数据 (sourceType=BODY, isDto=true)
                    }
                    
                    → 编译提取策略（复用现有编译管线）
                }
        }
}
```

##### 触发时机对比

| 阶段 | 参数装饰器方式（现有） | DTO — Legacy 模式 | DTO — TC39 模式 |
|------|----------------------|-------------------|-----------------|
| **编译时** | 参数装饰器 → `TAGGED_PARAM` | DTO 属性装饰器 → `DTO_SOURCE_KEY` | 同 Legacy |
| **类型获取** | `design:paramtypes`（自动） | `design:paramtypes`（自动） | `@Payload(DtoClass)` 或 `@Validated(DtoClass)` → `context.metadata`（显式） |
| **启动时** | 读取 `TAGGED_PARAM` → 编译策略 | 读取参数类型 → 读取 `DTO_SOURCE_KEY` → 编译策略 | 同 Legacy |
| **运行时** | 策略提取 → 传参 | 策略提取 → 实例化 DTO → 填充 → 验证 → 传参 | 同 Legacy |

##### 运行时 DTO 填充流程（路径 B1，多数据源）

```
HTTP Request
    │
    ▼
extractParameters(app, ctx, compiledParams)
    │
    ├─ 检测到参数是多源 DTO
    │
    ├─ 对于每个 DTO 属性（已在启动时编译为提取器列表）:
    │   ├─ @Get       → ctx.query[paramName]
    │   ├─ @PathVariable → ctx.params[paramName]
    │   ├─ @Header    → ctx.get(paramName)
    │   ├─ @Post      → (await bodyParser(ctx))[paramName]
    │   └─ @File      → (await bodyParser(ctx)).file[paramName]
    │
    ├─ 类型转换: compiledTypeConverter(value)
    │
    ├─ 实例化: plainToClass(DtoClass, extractedData, true)
    │
    ├─ 验证 (if @Validated): ClassValidator.valid(DtoClass, instance)
    │
    └─ 返回 [dtoInstance]
        │
        ▼
ctl[method](dtoInstance)
```

##### 运行时 DTO 填充流程（路径 B2，纯请求体）

```
HTTP Request
    │
    ▼
extractParameters(app, ctx, compiledParams)
    │
    ├─ 检测到参数是纯体 DTO（无数据源装饰器，等同于 @RequestBody + DTO）
    │
    ├─ await bodyParser(ctx) → rawBody
    │
    ├─ plainToClass(DtoClass, rawBody, true)
    │
    ├─ 验证 (if @Validated): ClassValidator.valid(DtoClass, instance)
    │
    └─ 返回 [dtoInstance]
```

#### 11.3.5 `isDtoClass` 检测逻辑

判断一个参数类型是否为 DTO 类的条件（按优先级）：

1. 类上存在 `DTO_SOURCE_KEY` 元数据（属性上使用了 `@Get`/`@Post`/`@Header` 等双模式装饰器）→ 确定是 DTO
2. 类已在 IOC 容器中注册（`@Component()`）且类型不在基本类型列表中（`String, Number, Boolean, Array, Object, Date`）→ 确定是 DTO
3. 类的原型上存在 `PARAM_TYPE_KEY` 元数据（`@IsDefined`/`@Expose` 等已注册属性）→ 确定是 DTO

---

### 11.4 `@Inject` 迁移方案：构造函数自动注入

#### 11.4.1 现状分析

**当前 `@Inject` 的工作原理（本质是"伪"构造注入）：**

```
@Inject(Dep) 在构造函数参数上
    → 保存 TAGGED_PROP 元数据到原型（等同于 @Autowired 保存的内容）
    → 应用启动时 injectAutowired() 读取 TAGGED_PROP → 在 prototype 上定义属性
    → Reflect.construct(target, []) ← 构造时传入空数组，参数为 undefined
    → constructor(@Inject(Dep) dep: Dep) { this.dep = dep } ← dep 实际是 undefined
    → overridePrototypeValue(instance) ← 从 prototype 拷贝值覆盖 undefined 属性
```

`@Inject` 实际上并不传递构造函数参数，而是将依赖保存为属性注入元数据，再通过 `overridePrototypeValue` 从原型拷贝到实例。这是一种利用原型继承的变通方案。

#### 11.4.2 目标

构造函数参数注入是依赖注入的最佳实践（不可变性、测试友好、依赖可见）。目标是：

> **当构造函数参数是一个类，并且该类可以被注入（已声明为 `@Component`、`@Service` 等），则在类实例化时自动解析构造参数并注入，无需 `@Inject` 装饰器。**

#### 11.4.3 实现方案

**改造 `LifecycleManager.setInstance()` 和 `container.get()`，在 `Reflect.construct()` 之前自动解析构造参数：**

```typescript
// packages/koatty-container/src/container/lifecycle_manager.ts

public setInstance<T extends object | Function>(
  target: T, 
  options: ObjectDefinitionOptions,
  container: IContainer   // 新增参数：IOC 容器引用
): void {
  // 1. 如果有显式 args，直接使用
  let constructorArgs = options?.args || [];
  
  // 2. 如果没有显式 args，尝试自动解析构造函数参数
  if (constructorArgs.length === 0) {
    constructorArgs = this.resolveConstructorParams(target, container);
  }
  
  const instance = Reflect.construct(<Function>target, constructorArgs);
  overridePrototypeValue(instance);
  if (options?.scope === "Singleton") {
    Object.seal(instance);
  }
  this.instanceMap.set(target, instance);
}

/**
 * 自动解析构造函数参数
 * 读取 design:paramtypes，对每个参数类型尝试从容器中解析实例
 */
private resolveConstructorParams<T extends object | Function>(
  target: T,
  container: IContainer
): any[] {
  const paramTypes = Reflect.getMetadata("design:paramtypes", target);
  if (!paramTypes || paramTypes.length === 0) {
    return [];
  }

  return paramTypes.map((paramType: Function, index: number) => {
    // 跳过基本类型
    if (!paramType || !paramType.name || isBuiltinType(paramType)) {
      return undefined;
    }
    
    // 尝试从容器中解析
    const identifier = container.getIdentifier(paramType);
    const componentType = container.getType(paramType);
    
    // 仅解析已注册的可注入组件（COMPONENT, SERVICE, MIDDLEWARE 等）
    if (componentType && componentType !== "CONTROLLER") {
      try {
        return container.get(identifier, componentType);
      } catch {
        return undefined;  // 解析失败则传 undefined，回退到 overridePrototypeValue
      }
    }
    return undefined;
  });
}
```

**用户体验：**

```typescript
// 无需 @Inject 装饰器，IOC 容器自动解析构造参数
@Service()
class UserService {
  constructor(
    private readonly repository: UserRepository,  // 自动注入（已注册为 @Component）
    private readonly logger: LogService            // 自动注入（已注册为 @Service）
  ) {}
}

// 等价于之前的：
@Service()
class UserService {
  constructor(
    @Inject() private readonly repository: UserRepository,
    @Inject() private readonly logger: LogService
  ) {}
}
```

#### 11.4.4 TC39 模式下的构造注入

TC39 装饰器关闭了 `emitDecoratorMetadata`，`design:paramtypes` 不可用。
解决方案：**将 `@Inject` 从参数装饰器改为方法装饰器，放在 `constructor` 上，显式传入依赖类型。**

```typescript
// TC39 模式：@Inject 改为方法装饰器，作用于 constructor
@Service()
class UserService {
  @Inject(UserRepository, LogService)   // 方法装饰器，声明构造函数依赖
  constructor(
    private readonly repository: UserRepository,
    private readonly logger: LogService
  ) {}
}
```

**`@Inject` 作为方法装饰器的实现：**

```typescript
// TC39 MethodDecorator：作用于 constructor
function Inject(...deps: Function[]) {
  return (method: Function, context: ClassMethodDecoratorContext) => {
    // 将依赖类型存入 context.metadata，供 IOC 容器在实例化时读取
    context.metadata['constructor:paramtypes'] = deps;
    return method;
  };
}
```

> **关键：** `@Autowired(Type)` 负责属性注入，`@Inject(Type1, Type2, ...)` 负责构造注入。
> 两者组合已覆盖所有 DI 场景，无需在 `@Service` / `@Component` 上增加 `deps` 选项。

**完整 DI 场景覆盖：**

| 注入方式 | 装饰器 | TC39 兼容 | 适用场景 |
|---------|--------|----------|---------|
| 属性注入 | `@Autowired(Type)` | FieldDecorator | 可选依赖、延迟注入、打破循环依赖 |
| 构造注入 | `@Inject(Type1, Type2, ...)` | MethodDecorator (constructor) | 核心依赖、不可变性、测试友好 |

#### 11.4.5 `@Inject` 演进策略

| 阶段 | `@Inject` 形态 | 说明 |
|------|---------------|------|
| **Legacy（当前）** | `ParameterDecorator`：`constructor(@Inject() dep: Dep)` | 现有实现，保留不删 |
| **TC39（迁移目标）** | `MethodDecorator`：`@Inject(Dep1, Dep2) constructor(...)` | 新增实现，显式声明构造依赖 |

- Legacy 参数装饰器实现**保留不删**（TC39 参数装饰器提案仍在 Stage 1）
- TC39 模式下新增方法装饰器形态，参数**必填**
- 添加注释说明标准兼容性情况

#### 11.4.6 循环依赖处理

构造函数自动注入不能使用 `LazyProxy`（构造时需要实际值）。处理策略：

1. **启动时检测**：`DependencyAnalyzer` 已有循环依赖检测能力，发现构造参数级别的循环依赖时抛出明确错误
2. **降级提示**：错误信息中建议将其中一个依赖改为 `@Autowired` 属性注入（属性注入支持延迟加载，可打破循环）
3. **规则**：构造注入用于核心依赖（必须的），属性注入用于可选依赖或需要打破循环的场景

---

### 11.5 `@Valid` 迁移方案

`@Valid` 参数装饰器可**完全由 DTO 属性验证装饰器替代**，不需要独立的迁移路径。

#### 11.5.1 为什么 `@Valid` 可以完全替代

| 维度 | `@Valid` 参数装饰器 | DTO 属性验证装饰器 |
|------|-------------------|--------------------|
| 作用位置 | 方法参数 | DTO 类属性 |
| 验证规则 | 字符串 `"IsNotEmpty"` 或函数 | 原生 PropertyDecorator `@IsNotEmpty()` |
| 多规则支持 | 需要传数组 `["IsNotEmpty", "IsEmail"]` | 自然叠加多个装饰器 |
| 类型安全 | 弱（字符串规则名） | 强（装饰器函数有类型签名） |
| IDE 支持 | 差（字符串无自动补全） | 好（装饰器函数有智能提示） |
| TC39 兼容 | 不兼容（参数装饰器） | 完全兼容（属性装饰器） |

#### 11.5.2 迁移对照

```typescript
// ❌ 旧方式（@Valid 参数装饰器）
@GetMapping('/detail')
async get(
  @Valid("IsNotEmpty", "id 不能为空") @Get("id") id: number,
  @Valid(["IsNotEmpty", "IsEmail"], "邮箱格式不正确") @Get("email") email: string
) { ... }

// ✅ 新方式（DTO 属性验证，完全替代 @Valid）
@Component()
class GetDetailDto {
  @Get('id')
  @IsNotEmpty({ message: 'id 不能为空' })
  id: number;

  @Get('email')
  @IsNotEmpty({ message: '邮箱不能为空' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;
}

@GetMapping('/detail')
@Validated()
async get(dto: GetDetailDto) { ... }
```

`@Valid` 的现有实现保留不删，添加注释声明标准兼容性。

---

### 11.6 迁移对照表

#### 11.6.1 HTTP 参数装饰器迁移

**场景 1：简单查询参数**

```typescript
// ❌ 旧方式（参数装饰器）
@GetMapping('/users')
async getUsers(
  @Get('page') page: number,
  @Get('limit') limit: number,
  @Get('keyword') keyword?: string
) {
  // ...
}

// ✅ 新方式（DTO，同名装饰器用作 PropertyDecorator）
@Component()
class GetUsersDto {
  @Get('page')
  @IsDefined()
  page: number = 1;

  @Get('limit')
  @IsDefined()
  limit: number = 10;

  @Get('keyword')
  keyword?: string;
}

@GetMapping('/users')
@Validated()
async getUsers(dto: GetUsersDto) {
  // dto.page, dto.limit, dto.keyword
}
```

**场景 2：路径变量**

```typescript
// ❌ 旧方式
@GetMapping('/users/:id')
async getUserById(@PathVariable('id') id: number) { ... }

// ✅ 新方式
@Component()
class GetUserByIdDto {
  @PathVariable('id')
  @IsNotEmpty({ message: 'ID 不能为空' })
  id: number;
}

@GetMapping('/users/:id')
@Validated()
async getUserById(dto: GetUserByIdDto) {
  // dto.id
}
```

**场景 3：路径变量 + 请求体（混合数据源）**

```typescript
// ❌ 旧方式
@PutMapping('/users/:id')
@Validated()
async updateUser(
  @PathVariable('id') id: number,
  @RequestBody() data: UpdateUserDto
) { ... }

// ✅ 新方式（扁平化 DTO）
@Component()
class UpdateUserRequestDto {
  @PathVariable('id')
  @IsNotEmpty()
  id: number;

  @Post('username')         // @Post 用作 PropertyDecorator → 来自请求体
  username?: string;

  @Post('email')
  @IsEmail()
  email?: string;
}

@PutMapping('/users/:id')
@Validated()
async updateUser(dto: UpdateUserRequestDto) {
  // dto.id, dto.username, dto.email
}
```

**场景 4：完整请求体（POST）— 最简迁移**

```typescript
// ❌ 旧方式
@PostMapping('/users')
@Validated()
async createUser(@RequestBody() data: CreateUserDto) { ... }

// ✅ 新方式（无需任何数据源装饰器）
@PostMapping('/users')
@Validated()
async createUser(data: CreateUserDto) {
  // 框架自动推断：POST 方法 + DTO 类型 → 从请求体提取
}
```

**场景 5：gRPC 控制器**

```typescript
// ❌ 旧方式
@GrpcMapping('/HelloService/SayHello')
@Validated()
async sayHello(@RequestBody() request: HelloRequestDto) { ... }

// ✅ 新方式（无需 @RequestBody）
@GrpcMapping('/HelloService/SayHello')
@Validated()
async sayHello(request: HelloRequestDto) {
  // 框架自动将 gRPC 请求体转为 HelloRequestDto
}
```

**场景 6：GraphQL 控制器**

```typescript
// ❌ 旧方式
@GetMapping('/graphql', { routerName: 'getUser' })
async getUser(
  @RequestParam() id: string,
  @RequestParam() username: string
) { ... }

// ✅ 新方式
@Component()
class GetUserQueryDto {
  @Get('id')          // 复用 @Get 作为 PropertyDecorator
  id: string;

  @Get('username')
  username: string;
}

@GetMapping('/graphql', { routerName: 'getUser' })
async getUser(dto: GetUserQueryDto) {
  // dto.id, dto.username
}
```

**场景 7：WebSocket 控制器**

```typescript
// ❌ 旧方式
@WsMapping('/chat')
async handleMessage(@RequestBody() message: WsMessage) { ... }

// ✅ 新方式（无需 @RequestBody）
@WsMapping('/chat')
async handleMessage(message: WsMessage) {
  // 框架自动将 WebSocket 消息体转为 WsMessage
}
```

#### 11.6.2 DI 参数装饰器迁移

```typescript
// ❌ 旧方式（@Inject 作为参数装饰器）
@Service()
class UserService {
  constructor(
    @Inject() private readonly repository: UserRepository,
    @Inject() private readonly logger: LogService
  ) {}
}

// ✅ Legacy 模式（design:paramtypes 可用，自动解析）
@Service()
class UserService {
  constructor(
    private readonly repository: UserRepository,  // IOC 自动解析
    private readonly logger: LogService            // IOC 自动解析
  ) {}
}

// ✅ TC39 模式（@Inject 改为方法装饰器，显式声明依赖）
@Service()
class UserService {
  @Inject(UserRepository, LogService)             // 方法装饰器，参数必填
  constructor(
    private readonly repository: UserRepository,
    private readonly logger: LogService
  ) {}
}
```

---

### 11.7 代码生成模板迁移

以下 Handlebars 模板需要同步更新，提供 DTO 版本的代码生成：

| 模板文件 | 当前参数装饰器使用 |
|---------|------------------|
| `koatty-ai/templates/modules/controller/controller.hbs` | `@QueryParam()`, `@PathVariable()`, `@RequestBody()` |
| `koatty-ai/templates/modules/controller/grpc.hbs` | `@RequestBody()` |
| `koatty-ai/templates/modules/controller/grpc-simple.hbs` | `@RequestBody()` |
| `koatty-ai/templates/modules/controller/graphql.hbs` | `@RequestParam()` |
| `koatty-ai/templates/modules/controller/graphql-simple.hbs` | `@RequestParam()` |
| `koatty-ai/templates/modules/controller/websocket-simple.hbs` | `@RequestBody()` |

**迁移策略：**
- 新增 DTO 版本的控制器模板（如 `controller-dto.hbs`）
- 同时生成对应的 DTO 类模板
- 在代码生成配置中增加 `--style=dto` 选项
- 保留原有模板作为 `--style=legacy` 选项

---

### 11.8 框架改造路线图

#### Phase 1：双模式装饰器 + DTO 自动检测（预计 2-3 周）

| 任务 | 包 | 描述 |
|------|---|------|
| 升级现有装饰器为双模式 | `koatty-router` | `@Get`, `@Post`, `@Header`, `@PathVariable`, `@File`, `@RequestBody`, `@RequestParam` 支持 `PropertyDecorator` |
| 定义 `DTO_SOURCE_KEY` | `koatty-router` | 元数据键及存储结构 |
| 扩展 `injectParamMetaData()` | `koatty-router` | 增加 DTO 自动检测回退路径（路径 B1/B2） |
| 新增多源 DTO 策略提取器 | `koatty-router` | 在 `strategy-extractor.ts` 中新增多源 DTO 提取策略 |

#### Phase 2：构造函数注入改造（预计 2 周）

| 任务 | 包 | 描述 |
|------|---|------|
| 改造 `LifecycleManager.setInstance()` | `koatty-container` | Legacy 模式自动解析构造参数类型并注入 |
| 改造 `container.get()` | `koatty-container` | Prototype 作用域同样支持自动构造注入 |
| 构造注入循环依赖检测 | `koatty-container` | `DependencyAnalyzer` 增加构造参数级别循环检测 |
| `@Inject` 改为 MethodDecorator | `koatty-container` | TC39 模式下 `@Inject(Type1, Type2)` 放在 constructor 上，显式声明依赖 |

#### Phase 3：集成验证 + 注释更新（预计 1-2 周）

| 任务 | 包 | 描述 |
|------|---|------|
| 新增 `@Payload` 装饰器 | `koatty-router` | MethodDecorator，负责 DTO 参数绑定（类型声明） |
| `@Payload` 与 `@Validated` 集成 | `koatty-validation` | `@Validated(Dto)` 为 `@Payload(Dto) + @Validated()` 的超集简写；容错去重/冲突检测 |
| 多源 DTO 与 `plainToClass` 集成 | `koatty-validation` | 多源 DTO 实例化按属性源提取，而非整体 body 赋值 |
| 添加标准兼容性注释 | 全部 3 个包 | 为所有参数装饰器添加 TS 标准兼容性说明 |
| 更新示例代码 | `koatty`, `koatty-awesome` | 提供 DTO 版本的示例控制器 |
| 更新代码生成模板 | `koatty-ai` | 新增 DTO 版本的 `.hbs` 模板 |

#### Phase 4：测试验收（预计 1-2 周）

| 任务 | 包 | 描述 |
|------|---|------|
| 双模式装饰器测试 | `koatty-router` | 同一装饰器在参数位置和属性位置的行为正确 |
| 构造函数自动注入测试 | `koatty-container` | 自动注入、循环依赖检测、TC39 `@Inject` MethodDecorator |
| 新旧方式共存测试 | `koatty-router` | 参数装饰器和 DTO 方式在同一项目中共存 |
| 性能基准测试 | 全部 | DTO 方式 + 构造注入的启动和运行时性能 |
| 边界场景测试 | 全部 | 空 DTO、嵌套 DTO、多源 DTO、无装饰器 DTO 等 |

---

### 11.9 风险评估

| 风险 | 影响 | 可能性 | 缓解措施 |
|------|------|--------|---------|
| 双模式装饰器的调用上下文误判 | 高 | 低 | 通过 `typeof arguments[2] === 'number'` 精确区分 ParameterDecorator 和 PropertyDecorator |
| 构造函数自动注入引入循环依赖问题 | 高 | 中 | `DependencyAnalyzer` 增加构造参数级别检测，错误信息建议改用 `@Autowired` 属性注入 |
| DTO 自动检测误判普通类为 DTO | 中 | 低 | 严格的 `isDtoClass` 检测逻辑，要求至少有 `@Component()` 注册或 `DTO_SOURCE_KEY` 元数据 |
| `design:*` 在 TC39 模式下不可用 | 高 | 高 | 所有受影响装饰器参数变为必填（§11.10.3）；通过 `emitDecoratorMetadata` 配置判断模式 |
| TC39 标准后续支持参数装饰器 | — | 未知 | 保留所有现有实现；双模式装饰器中的 ParameterDecorator 路径不受影响 |

---

### 11.10 `design:type` / `design:paramtypes` 可用性分析与显式传参要求

#### 11.10.1 硬性约束

TypeScript 编译器报错 **TS5052**：

> `Option 'emitDecoratorMetadata' cannot be specified without specifying option 'experimentalDecorators'.`

这意味着 `design:type`、`design:paramtypes`、`design:returntype` 在 TC39 模式下**全部不可用**：

| 编译模式 | `experimentalDecorators` | `emitDecoratorMetadata` | `design:*` 元数据 | 参数装饰器 |
|---------|--------------------------|--------------------------|-------------------|-----------|
| **Legacy（当前）** | `true` | `true` | **可用** | **可用** |
| **TC39（迁移目标）** | `false` 或不设置 | 不可设置（TS5052 报错） | **不可用** | **不可用** |

TC39 提供的替代机制是 [Decorator Metadata](https://github.com/tc39/proposal-decorator-metadata)（Stage 3，`Symbol.metadata` + `context.metadata`），但它只是一个存取对象，TypeScript 不会自动向其中写入类型信息——需要装饰器代码主动写入。

#### 11.10.2 受影响的完整审计

项目中共有 **7 处**活跃依赖 `design:type` / `design:paramtypes`，分布在 4 个包中：

| 风险等级 | 文件 | 行号 | 元数据键 | 所属装饰器/函数 | 当前行为（Legacy） | TC39 后果 |
|---------|------|------|---------|--------------|------------------|----------|
| **CRITICAL** | `koatty-router/src/utils/inject.ts` | 677 | `design:paramtypes` | `injectParam()`（所有 HTTP 参数装饰器的核心） | 读取方法参数类型，判断是否 DTO | 直接崩溃（`TypeError: Cannot read properties of undefined`） |
| **HIGH** | `koatty-validation/src/util.ts` | 23 | `design:type` | `setExpose()`（所有验证装饰器的底层） | 读取属性类型，写入 `PARAM_TYPE_KEY` | 静默失效，DTO 类型转换和 `plainToClass` 退化 |
| **HIGH** | `koatty-container/src/decorator/autowired.ts` | 150 | `design:paramtypes` | `@Inject` | 读取构造参数类型 | 无显式 `paramName` 时报错 |
| **MEDIUM** | `koatty-swagger/src/decorators/property.ts` | 35 | `design:type` | `@ApiProperty` | 读取属性类型生成 OpenAPI schema | 无显式 `options.type` 时类型信息丢失 |
| **MEDIUM** | `koatty-container/src/container/dependency_analyzer.ts` | 38 | `design:paramtypes` | `DependencyAnalyzer` | 读取构造参数类型做循环依赖检测 | 降级为 `[]`，依赖图不完整 |
| **MEDIUM** | `koatty-validation/src/decorators.ts` | 269 | `design:paramtypes` | `@Validated`（sync 模式） | 读取方法参数类型做验证 | 降级为 `[]`，sync 模式验证退化 |
| **LOW** | `koatty-container/src/decorator/autowired.ts` | 62 | `design:type` | `@Autowired`（legacy path） | 读取属性类型推断注入目标 | TC39 路径已存在，不走此分支 |

#### 11.10.3 TC39 模式下装饰器参数变为必填

迁移到 TC39 后，以下装饰器的**类型参数从可选变为必填**：

| 装饰器 | Legacy 用法（参数可选） | TC39 用法（参数必填） | 变更说明 |
|--------|----------------------|---------------------|---------|
| `@Autowired()` | `@Autowired()` — 自动从 `design:type` 推断 | `@Autowired(UserService)` — 必须显式传入类型 | `design:type` 不可用，FieldDecorator 不变 |
| `@Payload()` / `@Validated()` | 不需要 / `@Validated()` — 自动从 `design:paramtypes` 识别 DTO | `@Payload(DtoClass)` 必填（参数绑定）；`@Validated(DtoClass)` = 绑定+验证简写 | `design:paramtypes` 不可用。新增 `@Payload` MethodDecorator |
| `@Inject()` | `@Inject()` — ParameterDecorator，自动推断 | `@Inject(Repo, Log)` — **改为 MethodDecorator 放在 constructor 上**，参数必填 | `design:paramtypes` 不可用 + TC39 不支持参数装饰器 |
| `@Get()` / `@Post()` / `@Header()` 等 | `@Get('name')` — 属性类型从 `design:type` 推断 | `@Get({ name: 'name', type: String })` — 必须显式传入 `type` | `design:type` 不可用，PropertyDecorator 签名扩展为选项对象 |
| `@ApiProperty()` | `@ApiProperty()` — 自动从 `design:type` 推断 | `@ApiProperty({ type: String })` — 必须显式传入类型 | `design:type` 不可用 |

**验证装饰器（`@IsDefined`、`@IsNotEmpty` 等）底层调用的 `setExpose()` 也依赖 `design:type`**。
TC39 模式下需要改造 `setExpose()` 从装饰器的 `context` 或显式参数获取类型信息。

**示例对照：**

```typescript
// ——— Legacy 模式（参数可选，自动推断类型）———

@Service()
class UserService {
  @Autowired()                          // 自动从 design:type 推断为 UserRepository
  private repository: UserRepository;

  @Autowired()                          // 自动从 design:type 推断为 LogService
  private logger: LogService;
}

@Controller('/users')
class UserController {
  @PostMapping('/create')
  @Validated()                          // 自动从 design:paramtypes 识别 CreateUserDto
  async createUser(data: CreateUserDto) { ... }
}

// ——— TC39 模式（参数必填，显式声明类型）———

@Service()
class UserService {
  @Autowired(UserRepository)            // 必须显式传入类型（属性注入）
  private repository: UserRepository;

  @Autowired(LogService)                // 必须显式传入类型（属性注入）
  private logger: LogService;
}

// 或使用构造注入：
@Service()
class UserService {
  @Inject(UserRepository, LogService)   // 方法装饰器放在 constructor 上（构造注入）
  constructor(
    private readonly repository: UserRepository,
    private readonly logger: LogService
  ) {}
}

@Controller('/users')
class UserController {
  @PostMapping('/create')
  @Payload(CreateUserDto)               // 参数绑定（声明 DTO 类型）
  @Validated()                          // 验证
  async createUser(data: CreateUserDto) { ... }

  // 或使用简写：
  // @Validated(CreateUserDto)           // 等价于 @Payload + @Validated
}
```

#### 11.10.4 Legacy/TC39 模式判断机制

**框架通过项目 `tsconfig.json` 中的 `emitDecoratorMetadata` 配置值判断当前编译模式：**

```typescript
// 框架启动时读取 tsconfig 配置
const isLegacyMode = tsconfig.compilerOptions?.emitDecoratorMetadata === true;
```

- `emitDecoratorMetadata: true` → **Legacy 模式**：`design:*` 可用，装饰器类型参数可选
- `emitDecoratorMetadata` 未设置或为 `false` → **TC39 模式**：`design:*` 不可用，装饰器类型参数必填

所有受影响的装饰器在运行时根据此标志决定行为：

```typescript
// 装饰器内部判断逻辑（以 @Autowired 为例）
if (isLegacyMode) {
  // design:type 可用，identifier 可自动推断
  designType = Reflect.getMetadata("design:type", target, propertyKey);
  identifier = designType?.name;
}

if (!identifier) {
  // TC39 模式或推断失败：要求显式传参
  if (!paramName) {
    throw new Error(
      `@Autowired() 必须显式传入类型参数，例如 @Autowired(${fieldName})。` +
      `原因：emitDecoratorMetadata 未启用，design:type 不可用。`
    );
  }
}
```

#### 11.10.5 平滑过渡策略

**第一步：参数可选但推荐显式传入（当前即可开始）**

在 Legacy 模式下，装饰器同时支持两种用法。推荐用户开始习惯显式传参：

```typescript
// 两种写法在 Legacy 模式下都可以工作
@Autowired()                  // 依赖 design:type 自动推断（Legacy OK，TC39 不行）
@Autowired(UserService)       // 显式传入（Legacy OK，TC39 OK）
```

**第二步：切换到 TC39 后参数变为必填**

用户将 `tsconfig.json` 中 `emitDecoratorMetadata` 移除或设为 `false` 后，
框架自动切换到 TC39 模式，所有未显式传参的装饰器将抛出明确错误提示。

**第三步：长期探索编译时自动生成类型元数据**

通过 TypeScript transformer 或 SWC 插件在编译时自动生成等价的类型元数据，恢复参数可选的体验。
这是 Angular、NestJS 等框架面临的共同挑战，社区方案正在发展中。

---

### 11.11 `reflect-metadata` 依赖分析

#### 11.11.1 结论

**迁移 TC39 后，`reflect-metadata` 不能直接移除。**

`reflect-metadata` 在项目中承担两个角色：

| 角色 | 说明 | TC39 迁移后状态 |
|------|------|----------------|
| **A. `design:*` 自动类型元数据** | TypeScript `emitDecoratorMetadata` 生成的 `design:type`、`design:paramtypes` | **不再需要**（装饰器参数已改为显式传入） |
| **B. 通用元数据存储 API** | `Reflect.defineMetadata()` / `Reflect.getMetadata()` 作为键值对存储 | **仍在大量使用** |

#### 11.11.2 Reflect 元数据 API 使用审计

项目中共有 **58 处**源码直接调用 Reflect 元数据 API，14 个源文件 `import "reflect-metadata"`：

| 类别 | 调用数 | 说明 | TC39 后状态 |
|------|--------|------|------------|
| `design:*` 读取 | 9 | `design:type`(4) + `design:paramtypes`(5) | 可移除（参数显式传入） |
| 自定义元数据存储 | 41 | `TAGGED_CLS`、`COMPONENT_EVENTS`、`"validate"`、`API_*_KEY` 等 | **仍需保留** |
| 容器内部通用存储 | 8 | `getOriginMetadata()`、`preload_manager` | **仍需保留** |

**自定义元数据存储的分布：**

| 包 | Reflect API 调用数 | 涉及的元数据键 |
|----|-------------------|---------------|
| `koatty-swagger` | 22+ | `API_CONTROLLER_KEY`、`API_PROPERTY_KEY`、`API_RESPONSES_KEY`、`API_PARAMETERS_KEY`、`API_OPERATION_KEY`、`API_MODEL_KEY` 等 |
| `koatty-container` | 8 | `TAGGED_CLS`、`getOriginMetadata()` 通用存储 |
| `koatty-core` | 2 | `COMPONENT_EVENTS` |
| `koatty-validation` | 2 | `"validate"` |

> **注：** `koatty-container` 的 `MetadataStore` 类（`savePropertyData`/`getPropertyData`/`attachPropertyData`）已迁移到 `WeakMap` 存储，不依赖 `reflect-metadata`。
> 但 `TAGGED_CLS` 注册（`container.ts:609,622,638`）和 `getOriginMetadata()` 工具函数（`operator.ts`）仍直接使用 Reflect API。

#### 11.11.3 移除 `reflect-metadata` 的路径

在参数装饰器迁移完成（`design:*` 不再使用）后，仍需额外工作才能彻底移除 `reflect-metadata`：

| Phase | 任务 | 影响范围 | 替代方案 |
|-------|------|---------|---------|
| 1 | `koatty-swagger` 全部迁移 | 22 处调用 | 改用包内 `WeakMap` 或 `Symbol.metadata` 存储 |
| 2 | `TAGGED_CLS` 迁移 | 3 处（`container.ts`） | 改用 `MetadataStore`（已有 WeakMap 实现） |
| 3 | `COMPONENT_EVENTS` 迁移 | 2 处（`Component.ts`） | 改用 `MetadataStore` 或 `Symbol.metadata` |
| 4 | `getOriginMetadata()` 重构 | 8 处（`operator.ts` + 下游） | 改用 `MetadataStore` 封装 |
| 5 | `"validate"` 元数据迁移 | 2 处（`koatty-validation`） | 改用容器 `MetadataStore` |
| 6 | 移除所有 `import "reflect-metadata"` | 14 个源文件 + 20 个测试文件 | 删除导入语句和 `package.json` 依赖 |

> **建议将此项作为独立的后续任务**，不阻塞参数装饰器迁移。
> 参数装饰器迁移完成后，`design:*` 角色消除，`reflect-metadata` 降级为纯粹的元数据存储 polyfill。
> 后续可逐步替换为 `Symbol.metadata`（TC39 Stage 3）+ `WeakMap`，最终移除依赖。

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-02 | Coder Agent (TASK-4-3) | Initial draft |
| 2.0 | 2026-04-23 | Analysis Agent | 新增 §11 参数装饰器迁移方案（完整版）。§11.1-11.10 覆盖：现状分析、`@deprecated` 声明、DTO 替代方案、`@Inject` MethodDecorator 迁移、`@Valid` 替代、迁移对照表、路线图、风险评估、`design:*` 审计与装饰器参数必填清单 |
| 2.1 | 2026-04-23 | Analysis Agent | 新增 §11.11 `reflect-metadata` 依赖分析 |
| 2.2 | 2026-04-24 | Analysis Agent | 新增 `@Payload` 装饰器，拆分参数绑定与验证职责：`@Payload(Dto)` 纯绑定，`@Validated(Dto)` = 绑定+验证超集简写；补充容错规则（去重/冲突检测/双装饰器组合） |

---

**End of Document**
