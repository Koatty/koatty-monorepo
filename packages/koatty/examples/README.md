# Koatty Examples

这个目录包含了Koatty框架的各种示例应用，帮助你快速上手和理解框架的使用方法。

## 📚 示例列表

### 🟢 basic-app - 基础应用示例

完整的基础应用示例，展示Koatty框架的核心功能。

**功能特性**:
- ✅ HTTP路由和控制器
- ✅ 中间件使用
- ✅ 服务层和依赖注入
- ✅ 数据验证（DTO）
- ✅ 异常处理
- ✅ AOP切面编程
- ✅ 静态资源服务
- ✅ 视图模板

**查看详情**: [basic-app/README.md](./basic-app/README.md)

---

### 🔵 graphql-app - GraphQL应用示例 (规划中)

展示如何使用Koatty构建GraphQL API。

**功能特性**:
- GraphQL Schema定义
- Resolver实现
- GraphiQL调试界面
- DataLoader优化

---

### 🟣 grpc-app - gRPC应用示例 (规划中)

展示如何使用Koatty构建gRPC服务。

**功能特性**:
- Protocol Buffers定义
- gRPC服务实现
- 双向流通信
- 健康检查

---

### 🟡 microservices - 微服务示例 (规划中)

展示如何使用Koatty构建微服务架构。

**功能特性**:
- 服务发现
- 负载均衡
- 熔断降级
- 分布式追踪

---

## 🚀 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/koatty/koatty-monorepo.git
cd koatty-monorepo
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 运行示例

```bash
# 运行基础应用示例
cd examples/basic-app
pnpm dev
```

### 4. 使用VS Code调试

按 `F5` 启动调试，选择对应的调试配置。

---

## 📋 通用要求

所有示例都需要：

- **Node.js**: >= 18.0.0
- **pnpm**: >= 8.0.0

---

## 🏗️ 项目结构

```
examples/
├── basic-app/              # 基础应用示例
│   ├── src/               # 源代码
│   ├── static/            # 静态资源
│   ├── view/              # 视图模板
│   ├── package.json       # 依赖配置
│   ├── tsconfig.json      # TypeScript配置
│   └── README.md          # 示例说明
├── graphql-app/           # GraphQL示例 (规划中)
├── grpc-app/              # gRPC示例 (规划中)
├── microservices/         # 微服务示例 (规划中)
└── README.md              # 本文件
```

---

## 📝 贡献示例

欢迎贡献新的示例！请遵循以下规范：

### 示例结构

```
your-example/
├── src/                   # 源代码
├── package.json           # 必须使用workspace依赖
├── tsconfig.json          # TypeScript配置
└── README.md              # 详细说明
```

### package.json规范

```json
{
  "name": "@koatty/example-your-name",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "koatty": "workspace:*"
  }
}
```

### README规范

每个示例必须包含：
1. 功能描述
2. 项目结构
3. 快速开始指南
4. API示例
5. 相关链接

---

## 🔗 相关链接

- [Koatty主项目](https://github.com/koatty/koatty)
- [Koatty文档](https://koatty.github.io/)
- [API文档](https://koatty.github.io/api/)
- [问题反馈](https://github.com/koatty/koatty/issues)

---

## 📄 许可证

所有示例代码均采用 BSD-3-Clause 许可证。

---

**享受使用Koatty构建应用！** 🚀

