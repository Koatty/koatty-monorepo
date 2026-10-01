# Koatty Monorepo

> Koatty Framework 的 Monorepo 仓库，包含所有核心包的统一管理

[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D8.0.0-orange)](https://pnpm.io/)
[![License](https://img.shields.io/badge/license-BSD--3--Clause-blue)](LICENSE)

## 📚 目录

- [简介](#简介)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [开发指南](#开发指南)
- [版本管理](#版本管理)
- [文档](#文档)

## 简介

Koatty Monorepo 采用 **混合架构**，将核心框架包集中管理，同时保持向后兼容。

### 核心包

| 包名 | 说明 | 
|------|------|
| `koatty` | 主框架 |
| `koatty_core` | 核心功能 | 
| `koatty_router` | 路由组件 |
| `koatty_serve` | 服务器组件 | 
| `koatty_exception` | 异常处理 |
| `koatty_trace` | 链路追踪(GenAI 可观测) |
| `koatty_config` | 配置加载 |
| `koatty_testing` | 测试工具 |
| `koatty_http3` | HTTP/3(experimental,独立安装) |
| `koatty_mcp` | MCP Server 宿主(tools/resources/prompts) |
| `koatty_llm` | LLM 调用抽象(路由/预算/缓存/工具循环) |
| `koatty_guard` | AI 安全护栏(脱敏/审批/审计) |

### 独立包 (submodules)

| 包名 | 说明 |
|------|------|
| `koatty_container` | IoC 容器 |
| `koatty_lib` | 工具函数库 |
| `koatty_loader` | 加载器 |
| `koatty_logger` | 日志库 |
| `koatty_validation` | 参数校验 |
| `koatty_cacheable` | 缓存组件 |
| `koatty_store` | 存储组件 |
| `koatty_schedule` | 定时任务 |
| `koatty_proto` | 协议定义 |
| `koatty_graphql` | GraphQL 支持 |
| `koatty_swagger` | OpenAPI/Swagger |
| `koatty_typeorm` | TypeORM 集成 |
| `koatty_serverless` | Serverless 适配器 |
| `koatty_cli` | 脚手架 CLI（packages/koatty_cli） |
| `koatty_ai` | AI Agent 工具包：Skill + Tools（packages/koatty_ai，依赖 koatty_cli） |
| `koatty_doc` | 文档站(packages/koatty-doc) |
| `koatty_awesome` | 示例与模板 |

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### 安装

```bash
# 克隆仓库
git clone https://github.com/koatty/koatty-monorepo.git
cd koatty-monorepo

# 安装依赖
pnpm install

# 构建所有包
pnpm build
```

### 开发

```bash
# 开发模式 (watch)
pnpm dev

# 测试(全仓库,CI 同款并发配置)
pnpm turbo run test --force --concurrency=2 -- --runInBand

# Phase F 专项(MCP/LLM/Guard/GenAI/参考应用)
pnpm test:phase-f

# Lint(要求 0 error)
pnpm lint

# 安全基线(真实请求验证安全默认)
pnpm security:baseline

# 环境/依赖/子模块自检
pnpm doctor
```

### 运行示例

```bash
# 运行基础应用示例
cd packages/koatty/examples/basic-app
pnpm dev

# 或使用VS Code调试 (推荐)
# 按F5，选择 "Koatty Basic App"
```

查看更多示例: [packages/koatty/examples/README.md](packages/koatty/examples/README.md)

## 项目结构

```
koatty-monorepo/
├── packages/               # 所有包
│   ├── koatty/            # 主框架 (submodule)
│   ├── koatty-core/       # 核心
│   ├── koatty-router/     # 路由
│   ├── koatty-serve/      # 服务器
│   ├── koatty-exception/  # 异常
│   ├── koatty-trace/      # 追踪
│   ├── koatty-config/     # 配置
│   ├── koatty-container/  # IoC 容器 (submodule)
│   ├── koatty-lib/        # 工具库 (submodule)
│   ├── koatty-loader/     # 加载器 (submodule)
│   ├── koatty-logger/     # 日志 (submodule)
│   ├── koatty-validation/ # 校验 (submodule)
│   ├── koatty-cacheable/  # 缓存 (submodule)
│   ├── koatty-store/      # 存储 (submodule)
│   ├── koatty-schedule/   # 定时任务 (submodule)
│   ├── koatty-proto/      # 协议 (submodule)
│   ├── koatty-graphql/    # GraphQL (submodule)
│   ├── koatty-swagger/    # Swagger (submodule)
│   ├── koatty-typeorm/    # TypeORM (submodule)
│   ├── koatty-serverless/ # Serverless (submodule)
│   ├── koatty_cli/        # CLI 脚手架 (submodule, npm: koatty_cli)
│   ├── koatty-mcp/        # MCP Server 宿主
│   ├── koatty-llm/        # LLM 调用抽象
│   ├── koatty-guard/      # AI 安全护栏
│   ├── koatty-http3/      # HTTP/3 (experimental)
│   ├── koatty-testing/    # 测试工具
│   ├── koatty-doc/        # 文档站 (submodule)
│   └── koatty-awesome/    # 示例模板 (submodule)
├── scripts/               # 工具脚本
├── .changeset/            # 版本管理
├── .github/workflows/     # CI/CD
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 开发指南

### 包操作

```bash
# 只构建特定包
pnpm --filter koatty_core build

# 为特定包添加依赖
pnpm --filter koatty_core add lodash

# 运行特定包的脚本
pnpm --filter koatty_router test

# 在特定包中执行命令
pnpm --filter koatty_core dev
```

### 清理

```bash
# 清理所有构建产物
pnpm clean

# 清理并重新安装
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## 版本管理

使用 [Changesets](https://github.com/changesets/changesets) 统一管理所有包的版本：

```bash
# 1. 创建 changeset（记录变更）
pnpm changeset

# 2. 更新版本号（应用 changesets）
pnpm changeset version

# 3. 构建并发布到 npm
pnpm release
```

### 独立仓库状态

之前的独立仓库已归档，不再主动维护：
- 新版本发布统一通过 `koatty-monorepo`
- 独立仓库仅作存档参考
- 如需访问旧版本，请查看各包的历史版本

## 最新变更

### 2026-09-30 · v5.0.0 家族发布

#### 🚀 AI 运行时(新包首发)

- **koatty_mcp@1.0.0** — MCP Server 宿主:`@Tool` / `@Resource` / `@Prompt` 声明式暴露
  Service 方法,复用 `@Validated` DTO 白名单、IoC 请求作用域;destructive 工具默认人工审批(fail closed)
- **koatty_llm@1.0.0** — 多供应商 LLM 客户端:逻辑模型路由 + failover、熔断、原子 token 预算、
  精确缓存、结构化输出(DTO 校验)、进程内工具循环
- **官方 Agent Skill** — 随 `koatty_cli` 同版本分发的 `koatty` 技能包(`.agents/skills/koatty/`),
  让 AI 编码代理按框架约定工作(feature detection、manifest 校验、plan/apply/verify 工作流);
  新项目自动携带,详见文档站 Agent Skill 页
- **koatty_guard@1.0.0** — 单切面护栏:脱敏 → 内容检查 → 限流 → 审批 → 审计;
  审批票据持久化、一次性、绑定调用方指纹;审计默认不记录提示词原文

#### 🛡️ 安全画像与 fail-closed 默认

- Security Profile(`KOATTY_ENV || NODE_ENV` → strict/standard/development),只读暴露为 `app.security`
- 请求体 400/413/415、DTO 白名单剥离、WebSocket Origin 默认校验、`/metrics` 默认仅信任回环、
  ops 端点 token、请求 ID、TLS ≥1.2、CLI 写沙箱(拒绝硬链接)
- `koatty_validation` 5.0:DTO 入参转换为真实实例(Date/嵌套/数组),静态 schema 保守化(unresolved 诊断)
- `koatty_trace` 2.5:GenAI 记录器(`genai.*` span 属性,默认不记录提示词/输出原文)

#### 📦 主要版本

`koatty@5.0.0` · `koatty_serve@4.0.0` · `koatty_validation@5.0.0` · `koatty_trace@2.5.0` ·
`koatty_testing@5.0.0` · `koatty_http3@1.0.0` · `koatty_cli@5.1.0`

迁移指南见 [docs/migration](docs/migration) 与文档站
[koatty-doc → v4 to v5](https://github.com/koatty/koatty-doc/tree/main/docs/migration)。

### 2025-02-03

#### 🚀 新特性

- **多协议服务器支持**: `koatty_trace` 中间件现在支持多协议服务器场景，根据请求协议自动匹配对应服务器状态
- **组件启用逻辑优化**: `koatty_core` 改进组件启用逻辑，核心组件默认启用（除非显式禁用），用户组件保持向后兼容

#### 🔧 改进

- **Plugin 扩展向下兼容**: 
  - 支持通过 `list` 数组或 `config.enabled` 任一条件启用扩展
  - 核心组件默认启用，用户组件需显式配置
- **Trace 中间件协议匹配**: 根据 `ctx.protocol` 智能匹配对应协议服务器（http/https/http2/http3/grpc/ws/wss）

#### 📦 受影响包

- `koatty_core@2.1.0+` - 组件管理器改进
- `koatty_trace@2.1.0+` - 多协议服务器支持


## License

BSD-3-Clause © [richenlin](mailto:richenlin@gmail.com)

