# Phase A–D 修复与 API 迁移

2026-09-28。本工作区已实施下述修复，尚未发布；最新验证与未关闭验收门见 [补齐记录](../audits/phase-ad-completion-2026-09-28.md)。原始缺陷证据保留在 [Phase D 审计](../audits/phase-d-audit-2026-09-28.md)，其中复现脚本断言的是旧缺陷，不能作为修复后的通过门。

## 复用既有入口

| 需求 | 使用方式 |
|---|---|
| 路由鉴权、限流、请求前后处理 | `@Controller(path, { middleware: [AuthMiddleware] })` 或 `@GetMapping(path, { middleware: [AuthMiddleware] })`；类实现 `IMiddleware.run(options, app)` |
| 方法审计、缓存、返回值包装 | `@Aspect`、`@Around(AspectClass)` 与 `IAspect.run(args, proceed, options)` |
| SSE | 普通路由方法调用 `await streamSSE(ctx, signal => source)` |
| 独立容器 | `new Container()`；正常 Bootstrap 自动使用应用容器 |
| 请求作用域 | `@Service(undefined, { scope: 'Request' })`；复用 Core ALS，无新作用域装饰器 |
| 生命周期 | 现有 `initMethod` / `destroyMethod`；保留已实现的 PostConstruct/PreDestroy |

撤回工作区中尚未发布的 UseGuard、UseInterceptor、IGuard、IInterceptor、SSE 装饰器、runSync、createIsolated。静态 manifest 移除 guards/interceptors 字段，middleware 读取现有 Controller/Mapping 配置，aspects 继续描述切面。不要使用此前错误示例 `@Autowired({ lazy: true })`。

## 容器与请求生命周期

- Bootstrap、Loader、Router、中间件、AOP 和配置注入使用所属应用。默认 IOC 仍是装饰器定义目录与兼容入口；运行期不要从 IOC 获取某个已启动应用的实例，应使用 `app.container`。
- 类标识、注入值和 app 不再通过共享原型传播。相同类在不同应用中的实例、配置和依赖独立；同名但不同构造函数不共用元数据缓存。
- Request 实例跨 await 保持身份，不同请求不共享；请求外访问抛错，Singleton 捕获 Request 依赖也抛错。需要请求状态的消费者应使用 Request/Prototype，而非缓存某次请求实例。
- Controller 在真实请求到来时构造；不再为了启动验证创建无上下文的临时控制器。Prototype 每次重新注入。Request/Prototype 生命周期钩子作用于真实实例，Core 在请求完成时清理。
- 手动使用 `runInRequestScope(ctx, fn)` 的嵌入程序须在结束时调用 `releaseRequestScope(ctx)`；异步初始化在使用前等待 `readyRequestScope(ctx)`。常规 Router 已接入初始化等待，Core 已接入清理。
- `getInsByClass(Class)` 对无额外参数的 Singleton 保留查询已建实例的行为；Request/Prototype 则遵守对应作用域。
- `@Config` 从注入实例的 app 读取配置。Values 函数以注入实例为 this 执行；不得用默认 IOC 的 app 作为多应用配置来源。
- 旧 env 路径变量仍为兼容而保留，应用代码使用 `app.paths`。默认日志器仍为进程级共享配置，不承诺日志配置隔离；停止应用只刷新、不销毁其他应用正在使用的默认日志器。

## AOP 与响应

仅使用 `run`。调用链保持同步直到出现 Promise/thenable；异步 `__before` 完成后才执行业务。默认切面异常向上传播；显式 onError:log 兼容策略仍可用。Around 中重复调用 proceed 复用首次结果或错误，不重复执行业务。

Router 只在 `ctx.body === undefined` 时填入控制器结果，保留中间件已设置的 0、false 和空字符串。错误协商遵守 Accept 权重与 q=0，默认保持文本；gRPC/WS 不套用 HTTP 协商。

SSE 支持 AsyncIterable、Web ReadableStream、Node Readable。建议 source factory 接收 AbortSignal，并将 signal 传给实际模型/网络请求；任意异步生成器无法被框架强制中断，不能承诺不合作的生产者立即停止或不再计费。发送缓冲区满时等待 drain，等待 next/drain 时断连均可结束路由清理。心跳默认 15 秒，可设 0 关闭。

## 扫描、证书与资源

扫描路径越界现在直接拒绝，替代旧版回退到根目录的行为。符号链接和缓存条目按 realpath 校验；缓存 schema 2 覆盖逐文件状态与目录成员，旧缓存自动重扫。生产环境优先消费 `.koatty/manifest.json` 的 runtime 清单，规则见下文。

HTTPS/HTTP2 的文件证书每 500ms 检查变更，并合并短时间内的更新；完整 TLS context 验证成功才替换，新连接使用新证书。无效文件保留当前有效证书，服务器停止时解除监听。直接传入 PEM 内容不会启动文件监听。

内存缓存 TTL 清理不再独自维持 Node 进程存活；显式 quit/end 仍负责主动释放缓存资源。

## Serve 与 HTTP/3 迁移

入站连接池已替换为连接追踪器。HTTP/HTTPS/HTTP2/WS/gRPC 保留 Start/Stop、原生服务器和协议配置入口；原池的预热、租借、健康检查及直方图不再模拟执行。连接统计仅提供实际连接/活动调用计数，指标由 trace 负责。Node 原生空闲连接关闭、HTTP2 会话、WS 心跳和 gRPC deadline 分别由对应传输管理。

HTTP/3 从核心导出移除。使用者在应用目录安装 `koatty_http3`，保持 `protocol: 'http3'` 配置；直接导入改为 `import { Http3Server } from 'koatty_http3'`。未安装、原生后端不可用或 TLS 配置不支持时启动失败，不返回模拟就绪。该包仍是 experimental；移动的 frame/QPACK 测试不代表实际 QUIC 互操作验收。

这些导出和语义删除属于破坏性变更，`koatty`、`koatty_serve` 采用 major changeset，撤回原计划的 minor 兼容承诺。未应用任何版本号。

## 生产构建清单

复用既有 CLI 命令，在编译之后执行：

```sh
pnpm exec koatty manifest --runtime-dir dist --out .koatty/manifest.json --validate
```

部署 `dist` 与 `.koatty/manifest.json`。runtime schema 版本为 1，文件路径相对项目与编译目录保存；启动时先验证全部条目的 realpath、重复文件与 SHA256，再执行任何用户模块。篡改、越界或不兼容版本直接拒绝。清单是权威库存：未列出的新模块不会自动加载，修改编译结果后必须重新生成。没有 runtime 字段的旧静态清单继续使用安全扫描；不要将 AI 静态分析结果当作运行期注册数据。

默认项目模板包含上述构建流程，并声明待发布的 `koatty_cli >=4.3.0`。主框架 major 发布时还须同步模板依赖范围；本轮隔离安装使用本地 tarball overrides，不表示这些版本已经上架。

## 验证与发布边界

本轮已补齐 Serve 瘦身、HTTP/3 拆包及生产清单实现，补上实际 Redis、真实端口双应用、SIGTERM 20 次与独立打包验收。最终结果以 [补齐记录](../audits/phase-ad-completion-2026-09-28.md) 为准。

性能阈值没有因功能实现而自动达标：200 组件整体冷启动降低 30%、完整框架相对 4.2.0 的吞吐提升 10% 且 p99 不回退，仍须独立通过。Linux/Node 20 远端 CI 与目标部署尚无运行证据，当前不建议发布。不要用 CJS 生产启动或 ESM 入口导入检查替代完整原生 ESM 应用部署验收。

后台指标刷新、Span 清理、内存缓存 TTL 和空闲 WS 检查不再单独维持进程存活。应用正常退出仍应调用 stop，确保指标最后刷新与资源清理。gRPC 旧流入口的 deadline 定时器在创建上下文失败、流关闭和 Router cleanup 时释放。最后一个启用批量日志的应用停止后关闭批量定时器，其他应用仍运行时只 flush。

Jest 测试不再因导入带 Bootstrap 装饰器的类而隐式启动应用；请在 setup 中显式 createApplication/ExecBootStrap，并在 teardown 中 await app.stop()。生产环境自动启动保持原行为。

HTTPS 服务器只在 Node 发出 secureConnection 后标记握手完成，不再依赖 authorized 判断握手状态；未要求客户端证书时 authorized=false 不表示 TLS 未建立。此调整不关闭 mTLS 或修改 rejectUnauthorized。握手期间关闭的连接会清理等待定时器和监听器。

`appReady` 表示初始化完成；`appStart` 现在仅在所有监听器绑定成功后触发一次。`createApplication()` 不监听端口，也不提前触发 appStart。依赖真实监听地址的初始化应放在 appStart；纯组件初始化使用既有 appReady。
