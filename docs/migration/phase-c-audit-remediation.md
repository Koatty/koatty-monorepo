# Phase C 审计修复迁移说明

本轮修改尚未发布（版本已随 2026-09-30 的 changeset 应用）。Changeset 覆盖入口及 8 个直接修改包；发布时 changeset publish 会带上全部直接修改包，不要仅升级入口包。

## 容器与停机

- `isAsync` 单例在 `await container.ready()` 前不构造；提前 `get()` 会明确报 not ready。框架 Loader 在启动监听前建立 ready 屏障。
- `@PostConstruct()` / `@PreDestroy()` 同时支持 Legacy / TC39 方法装饰器；也可配置 `initMethod` / `destroyMethod`。初始化按注册顺序等待，销毁按逆序等待。
- 框架在 appReady 的异步监听器全部执行后 seal 单例。手工使用容器时，先 `await container.ready()`，完成延迟注入后再 `container.seal()`。
- 使用 `await app.stop()`、`await container.clear()`；异步资源管理使用 `await using`。普通 `using` 无法等待异步销毁。
- `app.stop()` 与信号停机共享一次资源清理，先等待 appStop 监听器，再销毁容器。清理失败向调用者传播。
- 调度停止后丢弃未运行的 queued tick，拒绝新 tick；等待已启动任务，受 drainTimeout 限制。
- 默认信号停机预算调整为 preStop 5s + drain 19s + 清理余量 5s，总上限 29s。自定义配置也受总上限约束，超限按失败处理。

## gRPC

Serve 将 proto 声明的调用类型交给 Core/Trace。客户端 deadline 优先；没有客户端 deadline 的 unary/client-stream 才使用配置超时。server-stream/bidi 不再套固定 unary 超时，Trace 在流的 finish/error/cancel 之后结算指标和 Span。

流控制器必须负责 `call.end()`，不能用 middleware 返回表示流已结束。客户端取消后 Serve 拒绝继续写出。压缩由 grpc-js 的传输层协商，不再对 protobuf 消息手工套 HTTP gzip/brotli 流。

## RedLock

`maxHoldTime` 到期会 abort 业务收到的 signal，结束 using 回调并停止自动续期/释放租约，业务只执行一次。业务必须在写入前检查 signal，并把它传给支持取消的操作。JavaScript 无法强制停止忽略 signal 的业务；这类业务需要 fencing 或幂等约束，不能把租约释放等同于业务已经停止。

## 配置

标准 JSON Schema 使用 AJV 8 校验并应用默认值。消费者使用 JSON Schema 时须安装 `ajv@^8`；未安装、版本不符或 schema 无效会明确失败。原有轻量逐键 schema 保留。

画像在配置文件和环境覆盖合并后确定，显式 `security.profile`（或 `config.security.profile`）优先于环境推断。strict 下缺失且无默认值的环境变量报错，包含嵌套数组。

## Redis

普通 CacheStore 命令共享一个多路复用连接；显式 `getConnection()` 返回独立 native 连接，用于 WATCH、阻塞命令等，用完必须 `release(conn)`。`getRawClient().withConnection(...)` 可自动归还。

事务使用独立句柄，不把 transaction 状态放在共享 Store 上：

```ts
const transaction = await store.beginTransaction(['full:key']);
let submitted = false;
try {
  transaction.commands.set('full:key', 'value');
  submitted = true;
  const result = await transaction.commit(); // WATCH 冲突时返回 null
  // result 内含每条 Redis 命令的 [error, value]，调用方须处理命令错误。
} finally {
  if (!submitted) await transaction.rollback();
  // commit 已调用时，无论成功还是失败，连接均自动关闭。
}
```

不提交时必须调用 `transaction.rollback()`。`store.commit(transaction)` / `store.rollback(transaction)` 也接受句柄；无句柄明确报错，避免并发事务互相污染。句柄的 WATCH 和 native 命令使用完整 Redis key，不自动追加 CacheStore 的 keyPrefix。

## 缓存

命中值采用带版本标记的 JSON 信封，保持字符串、有限数值、布尔、null、数组及普通 JSON 对象类型。旧的无类型缓存无法可靠恢复原类型，因此作为 miss 回源并重写。undefined、Date、Buffer、BigInt、循环对象等不支持的值不缓存。

同一存储实例、最终 key 的并发 miss 共用回源和写入 Promise；失败后清除在途记录。长 key 改为保留命名空间前缀的 SHA-1 key，升级后旧长 key 自然过期。

## 验证命令

```bash
pnpm test:phase-c:integration
KOATTY_TEST_REDIS_PORT=6379 node scripts/regression/phase-c-redis.cjs
```

第二条必须使用测试 Redis，只清理随机命名空间下本次创建的 key。CI 已配置 Redis 服务和对应门禁；增加门禁不代表远端已经运行通过。独立 npm tarball 消费和目标平台验收仍须在发布前执行。
