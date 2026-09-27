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
| `koatty_trace` | 链路追踪 |
| `koatty_config` | 配置加载 |

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
| `koatty_doc` | 文档工具 |

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

# 测试
pnpm test

# Lint
pnpm lint
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
│   └── koatty-doc/        # 文档 (submodule)
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

