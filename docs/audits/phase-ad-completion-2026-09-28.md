# Phase A–D 补齐记录（2026-09-28，未发布）

本次接续 [上一轮修复](phase-ad-remediation-2026-09-28.md)。前一份报告保留历史事实；以本记录描述当前交付边界。基础版本为根仓库 `cb7807fb1f71ccc6ba31f4813b4b64ee5d4a674c` 加任务开始时已有的未提交改动。本轮未提交、未应用 changeset、未发布。环境为 macOS / Node 22.23.1 / pnpm 9.15.4。

## 已补实现

| 范围 | 落地内容 | 回归证据 |
|---|---|---|
| A：工程门禁 | DTS 构建不再忽略 tsc 错误；CI 强制测试、增量覆盖率 ≥80%、子模块失败传播、真实协议和独立 tarball 验收 | 根构建/测试、`phase-a-negative-test.cjs`、`check-diff-coverage.cjs` |
| A：独立消费 | Core/Router/Trace/Validation 补运行时及公开类型依赖；修复 Day.js 路径、Lodash ESM 导入、类型导出与动态 require 适配 | CJS/ESM 入口导入、生成项目严格 TS 编译、生产 HTTP 与 SIGTERM |
| B/C：日志与生命周期 | 日志格式化失败不递归、不输出原始异常值；appStart 只在全部真实监听器就绪后触发，启动清单不再提前触发 | `AD.format-failure`、`AD.listen-readiness`、双应用真实监听 |
| C：外部行为 | 实际 Redis 7.4.2 的续期、占锁上限、阻塞隔离和 WATCH 事务；真实 gRPC 四形态、WS、TLS、安全基线、操作系统 SIGTERM | 本目录证据文件及 `scripts/regression/phase-c-*.cjs` |
| D-1/2/3 | 保留上一轮容器/AOP/生命周期修复；补真实双端口与 Legacy/TC39 实编译的 Service、Controller、Autowired、Config 与请求生命周期 | Core/Container/Config/Router/Koatty 回归；`phase-ad-decorators.cjs` |
| D-5 | 入站池改为 Set 连接追踪器；排空、超时强制关闭与错误后清理；23 个 TS 文件、4692 物理行；核心移除 QUIC | Serve 真实 HTTP/HTTPS/HTTP2/WS/gRPC；26 套、211 通过、6 既有 skip |
| D-5：HTTP/3 | 独立 `koatty_http3` experimental 包；延迟加载后端，不可用则拒绝启动；主包/internal 共用资源协调器 | 原 68 个 frame/QPACK/模拟用例迁移，另加 2 个导入/不可用检查；70 通过 |
| D-6 | 继续复用 middleware、Before/After/Around 与 streamSSE；不恢复重复 Guard/Interceptor/SSE 装饰器 | 已有路由拒绝、AOP 至多一次、SSE 背压/取消/内容协商回归 |
| D-7 | `manifest --runtime-dir dist` 静态生成 runtime v1 库存；生产配置和组件加载按真实路径、重复项及 SHA256 先校验后执行 | 200 组件完整 Bootstrap 成功，篡改编译文件后启动拒绝 |

WS 修复验证的是 Serve → Core → Trace → Router → 控制器的连续三条真实消息，不是手工调用 handler。HTTP3 测试包含模拟后端，不能作为真实 QUIC/RFC 互操作通过证据。

## 测试迁移与覆盖范围

删除了绑定旧入站池、私有定时器和手写假 BaseServer 的测试；替代测试直接实例化生产服务器、使用临时端口，验证响应、错误脱敏、TLS/mTLS、超时、重启、限流、Origin、WS 载荷/背压、流式取消及停机。原 HTTP/3 协议测试迁移到可选包。不能用新旧用例数量相等证明行为等价。

根测试上一次完整执行为 48/48 成功（4 个缓存任务），2615 个 Jest 用例通过、30 个 skip；最后的监听生命周期修改另外重跑 Core 与主框架全包测试，最终总数及覆盖率以 `phase-ad-completion-2026-09-28/validation-summary.json` 为准。30 个 skip 分布于 Core 4、TypeORM 20、Serve ring buffer 6，未计为通过；`koatty_testing` 的 Jest 没有用例，不伪装成组件测试完成。已有 doc 检查通过，TS-Jest 与少量 lint warning 仍存在。

双模式证据覆盖受影响的 Service/Controller/Autowired、Config、PostConstruct/PreDestroy、Before/After/Around、middleware、CacheAble/RedLock；TC39 模式用 TypeScript 实际 emit，不以手写 context 代替编译。不是所有装饰器任意排列的穷举；TC39 不支持参数装饰器，仍需使用已存在的显式类型/方法入口。

## 性能与发布门

- Request 作用域使用普通 Node realm 测量；目标 <2µs，不使用 Jest VM 的调度开销作为性能结论。
- 完整 HTTP 对比包括 Serve/Core/Trace/Router/IOC，客户端与服务器独立进程。基线是本轮 D-5 改动前保存的编译快照，已经包含此前的 D-4 修复，**不是正式 4.2.0**。7 组交替顺序、16 并发、每组 4000 预热和 12000 请求；两边统一连接轮换策略，单独报告连接 reset。
- 200 组件冷启动测试使用全新 Node 子进程、实际 Bootstrap、组件解析及退出；扫描与 manifest 交替，共 12 轮，丢弃前 2 轮。包含全部启动成本，不把 glob 局部耗时冒充整体收益。
- 性能脚本加 `--check` 后，在阈值不满足时返回非零；默认仅输出测量，不能将默认退出码作为性能通过。

最终在其余验收结束后串行复测，结果如下；原始逐轮数据见同目录 `benchmark-*.log`：

| 指标 | 基线 | 当前 | 结论 |
|---|---:|---:|---|
| Request 解析 | — | 0.969µs | <2µs 通过 |
| 完整 HTTP 吞吐 | 15163 RPS | 16006 RPS | +5.56%，未达到 10%；基线非正式 4.2.0 |
| HTTP p99 | 3.426ms | 3.253ms | 本轮没有回退 |
| 200 组件全流程冷启动 | 扫描 451.08ms | 清单 468.60ms | 慢 3.89%，未达到降低 30% |

两个性能 `--check` 均实际退出 1，Request 基准退出 0。不能标记 Phase D 全部验收完成。manifest 已解决可执行库存校验和部署一致性，本轮没有证明它带来整体冷启动性能提升。

最终增量覆盖率为 **80.71%（2113/2618）**，无缺失文件。最终已验证的包级 Jest 合计 **2616 通过、30 skip**；独立 tarball 消费 **23 包通过**；安全基线 **14/0/0**；真实 Redis 和 OS SIGTERM **20 次**通过。

Linux/Node 20 远端 CI、真实部署环境与 HTTP/3 原生互操作未运行。CJS 新项目生产启动、安全基线夹具、ESM 导入与自然退出是不同证据；不能相互替代，也不能声称新项目已经通过未配置业务端点的全部安全场景。

## 手动发布前

1. 先关闭上述性能门槛与远端 CI；当前不建议发布。
2. 按 [迁移说明](../migration/phase-d-router-hotpath.md) 审核 major changeset。核心 HTTP/3 导出、池行为移除不能作为兼容 minor 发布。
3. 提交涉及的子模块并更新根 gitlink 后，在干净 CI checkout 再验证。当前仅本地脏工作区通过不代表这些代码已进入远端。
4. 手动执行仓库发行流程，同步主框架、Serve、CLI、可选 HTTP/3 的依赖范围及模板版本。隔离验收使用本地 tarball overrides，不证明新版本已发布。
