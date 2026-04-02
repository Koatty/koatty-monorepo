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

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-04-02 | Coder Agent (TASK-4-3) | Initial draft |

---

**End of Document**
