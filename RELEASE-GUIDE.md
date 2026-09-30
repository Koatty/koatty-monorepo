# Koatty Monorepo 发布指南

本指南介绍如何在 monorepo 中使用 Changesets 统一管理和发布所有包。

## 📋 目录

1. [工具链说明](#工具链说明)
2. [快速开始](#快速开始)
3. [版本管理流程](#版本管理流程)
4. [发布流程](#发布流程)
5. [常见操作](#常见操作)
6. [故障排除](#故障排除)

---

## 工具链说明

当前项目使用的工具：

- **pnpm workspace**: 管理 monorepo 的包依赖
- **Changesets**: 统一的版本管理工具（推荐使用）
- **Turbo**: 构建系统（缓存和并行构建）
- **npm**: 发布到 npm registry

---

## 快速开始

### 支持的包

当前 monorepo 包含以下可发布的包：

**核心包（7个）**

- `koatty` - Koatty 核心框架
- `koatty-core` - 核心工具库
- `koatty-router` - 路由组件
- `koatty-serve` - 服务组件
- `koatty-exception` - 异常处理组件
- `koatty-trace` - 链路追踪组件
- `koatty-config` - 配置组件

**独立包（12个，submodules）**

- `koatty-container` - IoC 容器
- `koatty-lib` - 工具函数库
- `koatty-loader` - 加载器
- `koatty-logger` - 日志库
- `koatty-validation` - 参数校验
- `koatty-cacheable` - 缓存组件
- `koatty-store` - 存储组件
- `koatty-schedule` - 定时任务
- `koatty-proto` - 协议定义
- `koatty-graphql` - GraphQL 支持
- `koatty-doc` - 文档工具
- `koatty-serverless` - Serverless 适配器（AWS Lambda / 阿里云 FC / 腾讯云 SCF）

### Changesets 工作流

#### 方式一：标准流程（推荐）

```bash
# 1. 创建 changeset（记录变更）
pnpm changeset

# 2. 更新版本号并自动提交（应用 changesets）
pnpm changeset version

# 3. 推送变更
git push origin main

# 4. 构建并发布到 npm
pnpm release
```

#### 方式二：快速版本更新（支持指定版本类型）

```bash
# 直接创建并应用指定类型的版本更新（所有包）
pnpm changeset:version:patch   # patch 版本
pnpm changeset:version:minor   # minor 版本
pnpm changeset:version:major   # major 版本
pnpm changeset:version:pre     # pre-release 版本

# 指定特定包
node scripts/create-and-version.js minor koatty koatty-core
node scripts/create-and-version.js patch koatty-router
node scripts/create-and-version.js patch koatty_serverless   # 包名与目录名均可
```

`koatty-serverless` 与其它 submodule 一样：`pnpm changeset version` 会更新其 `package.json` 与 `CHANGELOG.md`，随后 `commit-submodule-changes.js` 会在该 submodule 内提交并推送，再提交 monorepo 的 submodule 指针。

---

## 版本管理流程

### Step 1: 创建 Changeset

当你的代码变更准备好发布时，运行：

```bash
pnpm changeset
```

这会引导你完成以下步骤：
1. 选择要发布的包
2. 选择版本类型：patch、minor、major
3. 添加变更描述

这会在 `.changeset/` 目录下创建一个 Markdown 文件。

### Step 2: 应用版本变更（自动提交）

#### 方式一：使用已有的 changeset

```bash
pnpm changeset version
```

这个命令会：
1. **读取并应用「所有」待处理的 changesets**（`.changeset/*.md`），而不是只应用最近一次创建的
2. 更新相关包的版本号
3. 删除已应用的 changesets
4. 生成 CHANGELOG.md
5. **自动提交所有版本变更**（包括 package.json 和 CHANGELOG.md）

**⚠️ 为何只选了 koatty-logger 却很多包被更新？**  
若之前多次运行 `pnpm changeset` 为不同包创建了多份 changeset 但未运行 `changeset version`，这些 `.md` 会一直留在 `.changeset/`。下次执行 `pnpm changeset version` 时会**一次性应用所有未消费的 changesets**，导致多个包一起被升版本。发布前可先查看待应用列表：`ls .changeset/*.md`（仅查看 .md，不含 config.json、README.md）。

#### 方式二：直接指定版本类型（快速）

```bash
# 更新所有包为 patch 版本
pnpm changeset:version:patch

# 更新所有包为 minor 版本
pnpm changeset:version:minor

# 更新所有包为 major 版本
pnpm changeset:version:major

# 更新所有包为 pre-release 版本
pnpm changeset:version:pre

# 更新指定包
node scripts/create-and-version.js minor koatty koatty-core
```

**注意**：
- 如果需要手动提交，可以使用：`pnpm changeset:version:no-commit`
- 快速版本更新会自动创建 changeset 并立即应用，适合快速发布场景

### Step 3: 推送变更

```bash
git push origin main
```

### Step 4: 发布

```bash
# 构建所有包并发布到 npm
pnpm release
```

---

## 发布流程

### 完整发布示例

```bash
# 1. 确保在正确的分支
git checkout main
git pull origin main

# 2. 检查工作区状态
git status

# 3. 创建 changeset
pnpm changeset
# 选择要发布的包（例如 koatty-router）
# 选择版本类型（例如 minor）
# 添加变更描述

# 4. 应用版本变更（自动提交）
pnpm changeset version
# 这会自动提交所有版本变更

# 5. 推送变更
git push origin main

# 6. 发布到 npm
pnpm release
```

### 发布前检查清单

- [ ] 所有测试通过
- [ ] 代码已经过 code review
- [ ] CHANGELOG 更新准确
- [ ] 文档已更新（如果需要）
- [ ] 已登录 npm

```bash
# 检查 npm 登录状态
npm whoami

# 如未登录
npm login
```

---

## 常见操作

### 仅构建所有包

```bash
pnpm build
```

### 仅测试所有包

```bash
pnpm test
```

### Lint 所有包

```bash
pnpm lint
```

### 清理构建产物

```bash
pnpm clean
```

### 查看待发布的 changesets

```bash
ls -la .changeset/*.md
```

### 撤销未应用的 changeset

```bash
rm .changeset/<changeset-name>.md
```

### 查看包在 npm 上的信息

```bash
# 查看最新版本
npm view koatty_router version

# 查看所有版本
npm view koatty_router versions

# 查看完整信息
npm view koatty_router
```

---

## 独立仓库状态

之前的独立仓库已归档，不再主动维护：

**核心包（7个）**

- `https://github.com/koatty/koatty.git`
- `https://github.com/koatty/koatty_core.git`
- `https://github.com/koatty/koatty_router.git`
- `https://github.com/koatty/koatty_serve.git`
- `https://github.com/koatty/koatty_exception.git`
- `https://github.com/koatty/koatty_trace.git`
- `https://github.com/koatty/koatty_config.git`

**独立包（11个）**

- `https://github.com/koatty/koatty_container.git`
- `https://github.com/koatty/koatty_lib.git`
- `https://github.com/koatty/koatty_loader.git`
- `https://github.com/koatty/koatty_logger.git`
- `https://github.com/koatty/koatty_validation.git`
- `https://github.com/koatty/koatty_cacheable.git`
- `https://github.com/koatty/koatty_store.git`
- `https://github.com/koatty/koatty_schedule.git`
- `https://github.com/koatty/koatty_proto.git`
- `https://github.com/koatty/koatty_graphql.git`
- `https://github.com/koatty/koatty_doc.git`

**新版本发布统一通过 `koatty-monorepo`**

---

## 版本发布历史

### 2025-02-03 发布

#### 发布包

**核心包（7个）**

- `koatty` - 主框架
- `koatty_core` - 核心功能
- `koatty_router` - 路由组件
- `koatty_serve` - 服务器组件
- `koatty_exception` - 异常处理
- `koatty_trace` - 链路追踪
- `koatty_config` - 配置加载

**独立包（11个，submodules）**

- `koatty_container` - IoC 容器
- `koatty_lib` - 工具函数库
- `koatty_loader` - 加载器
- `koatty_logger` - 日志库
- `koatty_validation` - 参数校验
- `koatty_cacheable` - 缓存组件
- `koatty_store` - 存储组件
- `koatty_schedule` - 定时任务
- `koatty_proto` - 协议定义
- `koatty_graphql` - GraphQL 支持
- `koatty_doc` - 文档工具

#### 主要变更

**koatty_core@2.1.0**
- ✨ 改进组件启用逻辑，区分核心组件和用户组件
  - 核心组件：默认启用，除非显式设置 `enabled: false`
  - 用户组件：向后兼容，支持 `list` 数组或 `config.enabled` 任一条件启用
- 🔧 优化组件配置合并逻辑

**koatty_trace@2.1.1**
- ✨ 支持多协议服务器场景
  - 根据 `ctx.protocol` 智能匹配对应协议服务器
  - 支持协议映射：http/https/http2/http3、ws/wss、grpc
- 🔧 修复多服务器状态下 503 检查逻辑

**koatty_serve@2.1.1**
- 🔧 优化 HTTP/3 服务器日志级别
- 🔧 改进 RingBuffer 日志记录

#### 升级指南

**从 2.0.x 升级到 2.1.x**

1. **组件启用配置（重要）**
   
   如果你使用了自定义 Plugin/Component，请检查启用逻辑：
   
   ```typescript
   // config/plugin.ts
   export default {
     list: ['MyPlugin'],  // 方式1：通过 list 数组启用
     config: {
       MyPlugin: {
         enabled: true,   // 方式2：通过 config.enabled 启用
         // ... 其他配置
       }
     }
   }
   ```
   
   两种方式任一满足即可启用扩展。

2. **多协议服务器支持**
   
   如果你同时启用了多个协议（如 http + grpc），trace 中间件会自动处理：
   
   ```typescript
   // config/server.ts
   export default {
     protocol: ['http', 'grpc'],  // 多协议
     port: [3000, 50051]
   }
   ```

3. **核心组件**
   
   核心组件（如 ServeComponent）默认启用，如需禁用：
   
   ```typescript
   @Component('MyComponent', {
     scope: 'core',
     enabled: false  // 显式禁用
   })
   ```

#### 破坏性变更

无破坏性变更，所有改进均为向后兼容。

---

## 故障排除

### 问题1: npm publish 权限错误

**错误信息**:
```
npm ERR! code E403
npm ERR! 403 Forbidden - PUT https://registry.npmjs.org/koatty_router
```

**解决方案**:
```bash
# 检查登录状态
npm whoami

# 重新登录
npm logout
npm login

# 检查包所有者
npm owner ls koatty_router

# 添加所有者（如果需要）
npm owner add <username> koatty_router
```

### 问题2: Changesets 版本更新失败

**错误信息**:
```
Error: No changesets found
```

**解决方案**:
```bash
# 先创建 changeset
pnpm changeset

# 然后再更新版本
pnpm changeset version
```

### 问题3: 版本号冲突

**错误信息**:
```
npm ERR! You cannot publish over the previously published versions
```

**解决方案**:
```bash
# 查看 npm 上的版本
npm view koatty_router version

# 查看本地版本
node -p "require('./packages/koatty-router/package.json').version"

# 如果本地版本号 <= npm 版本号，需要重新创建 changeset
pnpm changeset
pnpm changeset version
```

### 问题4: 构建失败

**解决方案**:
```bash
# 清理构建产物
pnpm clean

# 重新安装依赖
rm -rf node_modules
pnpm install

# 重新构建
pnpm build
```

### 问题5: 发布前测试失败

**解决方案**:
```bash
# 查看详细测试输出
pnpm test

# 或测试特定包
pnpm --filter koatty_router test

# 清理并重新安装依赖
rm -rf node_modules
pnpm install
```

---

## 高级配置

### 自定义 Changesets 配置

编辑 `.changeset/config.json`：

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

**配置说明**:
- `changelog`: changelog 生成器
- `commit`: 是否自动提交（建议设为 false，手动提交）
- `fixed`: 固定版本号的包列表（一起发布）
- `linked`: 链接的包列表（版本号保持一致）
- `access`: npm 发布权限（public/private）
- `baseBranch`: 主分支名
- `updateInternalDependencies`: 内部依赖更新策略
- `ignore`: 忽略的包列表

---

## 最佳实践

### 1. 版本规范

遵循语义化版本规范（Semantic Versioning）：

- **Major** (主版本): 破坏性变更
- **Minor** (次版本): 新功能，向后兼容
- **Patch** (补丁版本): bug 修复，向后兼容

### 2. Commit 规范

使用 Conventional Commits 规范（Changesets 会自动识别）：

```
feat: 新功能
fix: bug 修复
docs: 文档更新
style: 代码格式（不影响功能）
refactor: 重构
perf: 性能优化
test: 测试
chore: 构建/工具链
```

### 3. Changeset 规范

在创建 changeset 时：

- 选择合适的版本类型（patch/minor/major）
- 添加清晰、简洁的变更描述
- 一次 changeset 可以包含多个包的变更

### 4. 发布前检查清单

- [ ] 所有测试通过
- [ ] 代码已经过 code review
- [ ] CHANGELOG 更新准确
- [ ] 文档已更新（如果需要）
- [ ] 已登录 npm
- [ ] 版本号符合语义化规范

### 5. 发布后检查清单

- [ ] npm 上可以安装新版本
- [ ] GitHub Release 已创建
- [ ] 文档网站已更新（如果需要）
- [ ] 通知用户升级（如果有破坏性变更）

---

## 总结

### 推荐工作流程

1. **开发**: 在 monorepo 中开发功能或修复 bug
2. **测试**: 运行测试确保代码质量
3. **提交**: 使用规范的 commit message
4. **创建 changeset**: 记录版本变更
5. **更新版本**: 应用 changesets 更新版本号
6. **提交**: 提交版本变更
7. **发布**: 发布到 npm
8. **Release**: 在 GitHub 创建 Release 记录

### 快速参考

```bash
# 创建 changeset
pnpm changeset

# 更新版本
pnpm changeset version

# 构建并发布
pnpm release

# 仅构建
pnpm build

# 仅测试
pnpm test

# 清理
pnpm clean
```

---

## 相关资源

- **Koatty Monorepo**: https://github.com/koatty/koatty-monorepo
- **Changesets**: https://github.com/changesets/changesets
- **Semantic Versioning**: https://semver.org/
- **Conventional Commits**: https://www.conventionalcommits.org/
- **pnpm Workspace**: https://pnpm.io/workspaces

---

**需要帮助?** 请在 [GitHub Issues](https://github.com/koatty/koatty-monorepo/issues) 提出问题。
