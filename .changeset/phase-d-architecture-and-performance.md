---
"koatty": major
"koatty_cli": minor
"koatty_config": patch
"koatty_container": minor
"koatty_core": minor
"koatty_lib": patch
"koatty_loader": minor
"koatty_logger": patch
"koatty_router": minor
"koatty_serve": major
"koatty_store": patch
"koatty_trace": patch
"koatty_validation": patch
---

Phase A–D 审计修复，未发布：
- 容器注册表、类标识、实例注入与 AOP 解析均按容器隔离；注入不再写入共享原型。同名构造函数的元数据缓存不再串用。
- `app.container` 与 Core ALS 贯通；请求结束释放对应容器的请求实例。组件实例和事件处理器使用所属应用。
- 注册期构造路由 handler；控制器、参数元数据、中间件和 RouterFactory 使用应用容器。关闭一个应用不会清理另一应用的路由。
- 扫描目录、每个模块与缓存条目均以 realpath 校验根目录边界；越界路径直接拒绝，不再回退扫描整个项目。
- Bootstrap 自动创建应用独立容器，Loader/Router/注入链路使用 app.container；扫描同时处理默认导出与具名导出。
- SSE 复用普通路由和 streamSSE；现有 middleware 与 Around/run 承担鉴权、限流和方法包装。
- HTTPS/HTTP2 证书热更新及失败回退。
- Serve 使用连接追踪器，HTTP/3 移至独立实验包 koatty_http3；移除核心 QUIC 依赖及模拟监听。
- 生产构建可用既有 manifest 命令生成 runtime 清单；启动前逐文件校验路径与 SHA256。
- 修复独立安装缺失运行时/公开类型依赖，以及原生 Node ESM 入口加载错误。
- Config 复用既有双模式装饰器适配器，支持 TC39 字段初始化与应用隔离。

移除 Http3Server 等核心导出和入站池语义属于破坏性变更，因此 koatty 与 koatty_serve 必须按 major 发布，不能沿用原计划的 4.5.0 minor。koatty_http3 是首次发布包，按发布工具的新包流程单独处理；最终版本需与主包依赖同步。

迁移：docs/migration/phase-d-router-hotpath.md。D-5 实现及 D-7 清单已补齐；性能门槛、Linux CI 与部署验收仍未关闭。此文件不代表验收通过，不自动应用版本或发布。
