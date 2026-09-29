# koatty_trace

Full link tracking and error interception for koatty.

## 功能特性

- 🔍 **全链路追踪**: 基于OpenTelemetry的分布式链路追踪
- 📊 **多协议指标收集**: 支持HTTP、WebSocket、gRPC的指标收集并导出到Prometheus
- 🚨 **错误拦截**: 统一的错误处理和异常捕获
- 🔗 **服务拓扑**: 自动分析和记录服务依赖关系
- ⚡ **性能监控**: 请求响应时间、错误率等关键指标
- 🔄 **重试机制**: 可配置的请求重试策略
- 🎯 **请求ID追踪**: 全链路请求ID生成和传播
- 🛡️ **并发安全**: 线程安全的指标收集和Span管理
- 🚀 **高性能**: 路径标准化缓存、批量处理、内存优化

## 安装

```bash
npm install koatty_trace
# 或
pnpm add koatty_trace
```

## 基础使用

```typescript
import { Trace } from 'koatty_trace';
import { Koatty } from 'koatty_core';

const app = new Koatty();

// 基础配置
app.use(Trace({
  enableTrace: true,
  timeout: 10000,
  requestIdHeaderName: 'X-Request-Id'
}, app));
```

## 多协议指标收集

### 配置Prometheus指标导出

```typescript
import { Trace } from 'koatty_trace';

app.use(Trace({
  enableTrace: true,
  // Prometheus指标配置
  metricsConf: {
    metricsEndpoint: '/metrics',    // 指标端点路径
    metricsPort: 9464,             // 指标服务端口
    reportInterval: 5000,          // 上报间隔(ms)
    defaultAttributes: {           // 默认标签
      service: 'my-service',
      version: '1.0.0'
    }
  }
}, app));
```

### 自动收集的指标

框架会自动收集以下多协议指标，支持HTTP、WebSocket和gRPC：

#### 1. 请求总数 (`requests_total`)
- **类型**: Counter
- **描述**: 所有协议的请求总数统计
- **标签**:
  - `method`: 请求方法 (GET, POST, PUT, DELETE等)
  - `status`: 状态码 (HTTP状态码或gRPC状态码)
  - `path`: 标准化的请求路径 (如 `/users/:id`)
  - `protocol`: 协议类型 (`http`, `websocket`, `grpc`)
  - `compression`: 压缩类型 (WebSocket: `deflate`/`none`, gRPC: `gzip`/`brotli`/`none`)
  - `grpc_service`: gRPC服务名 (仅gRPC协议)

#### 2. 错误总数 (`errors_total`)
- **类型**: Counter
- **描述**: 所有协议的错误请求统计
- **标签**:
  - `method`: 请求方法
  - `status`: 状态码
  - `path`: 标准化的请求路径
  - `protocol`: 协议类型
  - `error_type`: 错误类型
    - HTTP/WebSocket: `client_error` (4xx), `server_error` (5xx)
    - gRPC: `grpc_error` (非0状态码)

#### 3. 响应时间 (`response_time_seconds`)
- **类型**: Histogram
- **描述**: 所有协议的请求响应时间分布
- **单位**: 秒
- **桶边界**: [0.1, 0.5, 1, 2.5, 5, 10]
- **标签**:
  - `method`: 请求方法
  - `status`: 状态码
  - `path`: 标准化的请求路径
  - `protocol`: 协议类型

#### 4. WebSocket连接总数 (`websocket_connections_total`)
- **类型**: Counter
- **描述**: WebSocket连接统计
- **标签**:
  - `protocol`: 协议类型 (websocket)
  - `service`: 服务名称

### 协议检测

框架会自动检测请求协议类型：

```typescript
// HTTP请求
GET /api/users HTTP/1.1
-> protocol: "http"

// WebSocket连接
GET /ws HTTP/1.1
Upgrade: websocket
-> protocol: "websocket"

// gRPC请求
POST /package.UserService/GetUser HTTP/2
Content-Type: application/grpc
-> protocol: "grpc"
```

### 路径标准化

为了减少指标的基数，框架会自动标准化请求路径：

```typescript
// 原始路径 -> 标准化路径
'/users/123'           -> '/users/:id'
'/users/123/profile'   -> '/users/:id/profile'
'/api/v1/users/550e8400-e29b-41d4-a716-446655440000' -> '/api/v1/users/:uuid'
'/posts/507f1f77bcf86cd799439011' -> '/posts/:objectid'

// gRPC服务路径
'/package.UserService/GetUser' -> '/package.UserService/GetUser' (保持原样)
```

### 查看指标

启动应用后，可以通过以下方式查看指标：

```bash
# 访问指标端点
curl http://localhost:9464·

# 示例输出
# HELP requests_total Total requests across all protocols
# TYPE requests_total counter
requests_total{method="GET",status="200",path="/api/users",protocol="http"} 42
requests_total{method="POST",status="0",path="/package.UserService/GetUser",protocol="grpc",grpc_service="package.UserService",compression="gzip"} 15
requests_total{method="GET",status="101",path="/ws",protocol="websocket",compression="deflate"} 8

# HELP response_time_seconds Response time in seconds across all protocols
# TYPE response_time_seconds histogram
response_time_seconds_bucket{method="GET",status="200",path="/api/users",protocol="http",le="0.1"} 35
response_time_seconds_bucket{method="POST",status="0",path="/package.UserService/GetUser",protocol="grpc",le="0.1"} 12

# HELP websocket_connections_total Total WebSocket connections
# TYPE websocket_connections_total counter
websocket_connections_total{protocol="websocket",service="my-service"} 5
```

## 完整配置选项

```typescript
app.use(Trace({
  // 基础配置
  enableTrace: true,                    // 是否启用链路追踪
  timeout: 10000,                      // 请求超时时间(ms)
  encoding: 'utf-8',                   // 响应编码
  requestIdHeaderName: 'X-Request-Id', // 请求ID头名称
  requestIdName: 'requestId',          // 请求ID属性名
  asyncHooks: false,                   // 是否启用异步钩子
  
  // 指标配置
  metricsConf: {
    metricsEndpoint: '/metrics',       // Prometheus指标端点
    metricsPort: 9464,                // 指标服务端口
    reportInterval: 5000,             // 上报间隔(ms)
    defaultAttributes: {},            // 默认指标标签
    reporter: (metrics) => {          // 自定义指标上报器
      console.log('Metrics:', metrics);
    }
  },
  
  // OpenTelemetry配置
  opentelemetryConf: {
    endpoint: "http://localhost:4318/v1/traces", // OTLP端点
    enableTopology: false,            // 是否启用拓扑分析
    headers: {},                      // OTLP请求头
    resourceAttributes: {},           // 资源属性
    samplingRate: 1.0,               // 采样率
    timeout: 10000,                  // 导出超时时间
    spanTimeout: 30000,              // Span超时时间
    maxActiveSpans: 1000,            // 最大活跃Span数
  },
  
  // 重试配置
  retryConf: {
    enabled: false,                   // 是否启用重试
    count: 3,                        // 最大重试次数
    interval: 1000,                  // 重试间隔(ms)
    conditions: (error) => true      // 重试条件判断函数
  }
}, app));
```

## 与Prometheus集成

### 1. Prometheus配置

在`prometheus.yml`中添加抓取配置：

```yaml
scrape_configs:
  - job_name: 'koatty-app'
    static_configs:
      - targets: ['localhost:9464']
    scrape_interval: 15s
    metrics_path: /metrics
```

### 2. Grafana仪表板

推荐的Grafana查询示例：

```promql
# 请求QPS
rate(http_requests_total[5m])

# 错误率
rate(http_errors_total[5m]) / rate(http_requests_total[5m])

# 平均响应时间
rate(http_response_time_seconds_sum[5m]) / rate(http_response_time_seconds_count[5m])

# P95响应时间
histogram_quantile(0.95, rate(http_response_time_seconds_bucket[5m]))
```

## GenAI 可观测性（Phase F F-4）

遵循 OpenTelemetry GenAI 语义约定（`gen_ai.*`）记录大模型与工具调用，属性名集中在
`src/genai/constants.ts`，便于跟随上游 development 状态更新。

```typescript
import { createGenAiRecorder } from 'koatty_trace';

const genai = createGenAiRecorder({
  captureContent: false,        // 默认不记录提示词/输出原文（隐私默认值）
  mask: (v) => guard.masking.mask(v),   // 开启抓取时复用 F-3 的脱敏服务
  pricePer1kPrompt: { 'openai:gpt-4o-mini': 0.00015 },
  pricePer1kCompletion: { 'openai:gpt-4o-mini': 0.0006 },
});

// LLM 调用完成后（provider/model/token/耗时/结束原因）
genai.recordChat({ provider: 'openai', model: 'default', responseModel: 'gpt-4o-mini', usage, finishReason, durationMs, context });
// 工具调用
genai.recordToolCall({ name: 'order_query', status: 'success', toolCallId, durationMs, context });
// 人工审批
genai.recordApproval({ tool: 'order_refund', decision: 'approved', context });

// 指标：每个模型的 token 与成本、工具成功率、审批通过率
console.log(genai.metrics());
```

- Span 名称：`gen_ai.chat` / `gen_ai.tool` / `gen_ai.approval`；三者加上已有的 HTTP/MCP 请求 Span 共享同一条 Trace。
- 记录点发生在 `await` 之后时，可用 `context` 显式指定父 Span（`trace.setSpan(context.active(), requestSpan)`）；
  省略则使用当前活动上下文。
- **默认不记录提示词与模型输出原文**；`captureContent: true` 时必须注入脱敏服务（见 F-3），否则会记录未脱敏内容。

## 开发和测试

```bash
# 安装依赖
pnpm install

# 运行测试
pnpm test

# 运行指标收集测试
pnpm test test/metrics.test.ts

# 代码检查
pnpm run eslint

# 构建项目
pnpm run build
```

## 许可证

BSD-3-Clause License

## 贡献

欢迎提交Issue和Pull Request来改进这个项目。
