# Koatty 组件职责边界

本文档详细说明了 Koatty 框架中各组件的职责边界，帮助开发者理解每个组件的定位和使用场景。

## 架构概览

Koatty 采用分层架构，主要分为三层：

```
┌─────────────────────────────────────────┐
│        门面层 (Facade Layer)            │
│              koatty                     │
│    统一导出所有功能，提供简洁的 API       │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│      功能层 (Feature Layer)              │
│  koatty_router  koatty_serve            │
│  koatty_exception koatty_trace          │
│  koatty_config   koatty_core            │
│    独立功能模块，快速迭代                 │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│       核心层 (Core Layer)               │
│    koatty_container  koatty_lib         │
│      koatty_core                        │
│    稳定的基础设施，不频繁变更            │
└─────────────────────────────────────────┘
```

## 核心层 (Core Layer)

### koatty_container

**定位**：依赖注入容器（IoC Container）

**职责**：
- 管理对象的生命周期（Singleton, Transient, Scoped）
- 提供依赖注入功能
- 实现装饰器支持（@Injectable, @Inject）
- 管理服务注册和解析

**不应该做的事**：
- 不直接处理 HTTP 请求
- 不包含业务逻辑
- 不处理配置加载
- 不涉及日志记录

**使用场景**：
```typescript
import { Injectable, Container } from 'koatty_container';

@Injectable()
class UserService {
  constructor() {
    // Service implementation
  }
}

const container = new Container();
container.bind(UserService).to(UserService);
```

**稳定级别**：⭐⭐⭐⭐⭐（非常稳定，不频繁变更）

---

### koatty_lib

**定位**：通用工具库

**职责**：
- 提供常用的工具函数
- 数据验证工具
- 类型定义和接口
- 辅助函数

**不应该做的事**：
- 不直接依赖框架核心
- 不处理 HTTP 相关逻辑
- 不包含业务特定功能

**使用场景**：
```typescript
import { validate, isEmail, formatDate } from 'koatty_lib';

if (isEmail(email)) {
  const formatted = formatDate(new Date());
}
```

**稳定级别**：⭐⭐⭐⭐⭐（非常稳定，不频繁变更）

---

### koatty_core

**定位**：框架核心引擎

**职责**：
- 应用生命周期管理
- 中间件系统实现
- 核心装饰器（@App, @Controller, @Action）
- 请求上下文管理
- 路由分发机制

**不应该做的事**：
- 不直接处理 HTTP/2、WebSocket、gRPC 等协议
- 不处理异常捕获和错误处理
- 不处理配置加载
- 不处理链路追踪

**使用场景**：
```typescript
import { App, Controller, Action } from 'koatty';

@Controller('/user')
class UserController {
  @Action('/list')
  async list() {
    return { users: [] };
  }
}

@App()
class MyApp {}
```

**稳定级别**：⭐⭐⭐⭐（稳定，主要功能基本不变）

---

## 功能层 (Feature Layer)

### koatty_router

**定位**：路由系统

**职责**：
- HTTP/1.1 和 HTTP/2 路由
- WebSocket 路由
- gRPC 路由
- 路由参数解析
- 中间件链管理
- 请求体解析（form, json, xml, multipart）

**不应该做的事**：
- 不处理服务器启动和监听
- 不处理异常捕获
- 不处理配置加载
- 不涉及链路追踪

**使用场景**：
```typescript
import { Router } from 'koatty_router';

const router = new Router();
router.get('/users/:id', async (ctx) => {
  const user = await getUser(ctx.params.id);
  ctx.body = user;
});
```

**稳定级别**：⭐⭐⭐（中等稳定，功能持续迭代）

---

### koatty_serve

**定位**：服务器管理

**职责**：
- HTTP/1.1、HTTP/2、HTTP/3 服务器
- WebSocket 服务器
- gRPC 服务器
- 服务器生命周期管理
- 服务器配置

**不应该做的事**：
- 不处理路由逻辑
- 不处理中间件
- 不处理异常捕获
- 不涉及链路追踪

**使用场景**：
```typescript
import { Server } from 'koatty_serve';

const server = new Server({
  http: { port: 3000 },
  https: { port: 3443 },
  websocket: { port: 8080 },
  grpc: { port: 50051 }
});

await server.start();
```

**稳定级别**：⭐⭐⭐（中等稳定，协议支持持续更新）

---

### koatty_exception

**定位**：异常处理系统

**职责**：
- 全局异常捕获
- 错误分类和处理
- 错误日志记录
- 用户友好的错误响应
- 异常堆栈追踪

**不应该做的事**：
- 不直接处理 HTTP 请求
- 不处理配置加载
- 不涉及链路追踪

**使用场景**：
```typescript
import { ExceptionHandler, Catch } from 'koatty_exception';

@Catch(UserNotFound)
class UserNotFoundHandler extends ExceptionHandler {
  handle(error, ctx) {
    ctx.status = 404;
    ctx.body = { error: 'User not found' };
  }
}
```

**稳定级别**：⭐⭐⭐（中等稳定，错误处理策略可能调整）

---

### koatty_trace

**定位**：链路追踪和监控

**职责**：
- 分布式链路追踪
- 性能监控
- 错误拦截
- OpenTelemetry 集成
- Prometheus 指标导出
- 日志关联

**不应该做的事**：
- 不直接处理 HTTP 请求
- 不处理业务逻辑
- 不处理配置加载

**使用场景**：
```typescript
import { Trace } from 'koatty_trace';

@Trace('user-service')
class UserService {
  async getUser(id: string) {
    // 自动记录追踪信息
    return await fetchUser(id);
  }
}
```

**稳定级别**：⭐⭐（较新，功能可能频繁更新）

---

### koatty_config

**定位**：配置管理

**职责**：
- 配置文件加载（json, yaml, toml, env）
- 环境变量支持
- 配置验证
- 配置热重载
- 多环境配置（dev, test, prod）

**不应该做的事**：
- 不处理业务逻辑
- 不涉及 HTTP 相关功能
- 不处理日志记录

**使用场景**：
```typescript
import { Config } from 'koatty_config';

const config = Config.load('./config/app.yaml');
const dbUrl = config.get('database.url');
```

**稳定级别**：⭐⭐⭐（中等稳定，配置格式可能扩展）

---

## 门面层 (Facade Layer)

### koatty

**定位**：统一入口包

**职责**：
- 重导出所有核心 API
- 提供简化的开发体验
- 文档入口
- 默认配置

**不应该做的事**：
- 不包含具体实现
- 不处理业务逻辑

**使用场景**：
```typescript
import { 
  App, 
  Controller, 
  Action, 
  Injectable, 
  Get, 
  Post 
} from 'koatty';

// 单一导入，无需记住具体包名
```

**稳定级别**：⭐⭐⭐（中等稳定，根据功能层变化调整导出）

---

## 依赖关系图

```
koatty (门面层)
  ├── koatty_config
  ├── koatty_core
  │   ├── koatty_container
  │   ├── koatty_lib
  │   └── koatty_exception
  ├── koatty_router
  │   └── koatty_core
  ├── koatty_serve
  │   └── koatty_core
  ├── koatty_exception
  │   └── koatty_lib
  └── koatty_trace
      └── koatty_lib
```

**依赖原则**：
- 核心层不能依赖功能层
- 功能层可以依赖核心层
- 门面层可以依赖所有层
- 避免循环依赖

---

## 版本发布策略

### 核心层
- **发布频率**：低（3-6 个月）
- **破坏性变更**：需要大版本号变更（2.0 → 3.0）
- **向后兼容性**：高优先级

### 功能层
- **发布频率**：中（1-3 个月）
- **破坏性变更**：中优先级，使用 minor 版本号
- **向后兼容性**：中等优先级

### 门面层
- **发布频率**：高（跟随功能层）
- **破坏性变更**：低优先级，尽量保持稳定
- **向后兼容性**：中优先级

---

## 贡献指南

在为 Koatty 贡献代码时，请遵循以下原则：

1. **明确边界**：确保代码放在正确的组件中
2. **单一职责**：每个组件只负责一个领域
3. **最小依赖**：尽量减少对其他组件的依赖
4. **稳定承诺**：核心层的变更需要更严格的审查
5. **文档更新**：更新相关文档和类型定义

---

## 常见问题

### Q: 我应该直接使用 koatty_* 包还是使用 koatty？

A: 推荐大多数情况下使用 `koatty` 统一入口包。只有在需要单独使用某个功能或需要更细粒度的控制时，才直接使用 `koatty_*` 包。

### Q: 核心层的变化会影响功能层吗？

A: 是的。核心层的变化可能需要功能层相应调整。但是，我们尽量保持向后兼容，减少对功能层的影响。

### Q: 如何知道某个功能属于哪个组件？

A: 查阅本文档的组件职责说明，或使用 `npm run doctor` 查看依赖关系。

### Q: 可以添加新的功能层组件吗？

A: 可以。如果您的功能是独立的、可复用的，并且不属于现有组件，可以考虑创建新的功能层组件。

---

**注意**：本文档会随框架发展而更新。如有疑问，请查阅最新文档或提交 issue。
