# 发布指南

## 概述

Koatty Monorepo 使用 [Changesets](https://github.com/changesets/changesets) 进行版本管理和发布。

## Changeset 工作原理

Changeset 是一个用于管理 monorepo 中多个包版本的工具，它的工作流程如下：

1. **创建 Changeset**: 记录代码变更和期望的版本类型（Major/Minor/Patch）
2. **应用 Changeset**: 将 changeset 文件转换为 package.json 中的版本号更新
3. **发布**: 将更新的包发布到 npm

### Changeset 规则

- `pnpm changeset` 只会提示有更改的 package
- 可以选择版本类型：
  - **Major**: 破坏性变更 (X.0.0)
  - **Minor**: 新功能，向后兼容 (0.X.0)
  - **Patch**: Bug 修复 (0.0.X)
  - **pre**: 预发布版本 (0.0.0-rc.X)
- **默认使用 Patch 版本**
- 只发布有 changeset 文件的 package

## 本地发布流程

### 1. 创建 Changeset

在代码更改完成后，创建一个 changeset：

```bash
pnpm changeset
```

这会交互式地提示：
1. 选择哪些包需要版本更新（只显示有更改的包）
2. 选择版本类型（Major/Minor/Patch/pre）
3. 添加变更摘要

生成的 changeset 文件会保存在 `.changeset/` 目录中。

### 2. 应用 Changeset（更新版本号）

应用所有的 changeset 来更新 package.json 版本号：

```bash
pnpm changeset:version
```

这会：
- 更新相关包的 package.json 中的 version 字段
- 更新包之间的内部依赖版本
- 生成 CHANGELOG.md

### 3. 构建项目

构建所有包：

```bash
pnpm build
```

### 4. 发布到 npm

将包发布到 npm：

```bash
pnpm release
```

这会：
- 读取 `.changeset` 目录中的 changeset 文件
- 发布有 changeset 的包到 npm
- 删除已发布的 changeset 文件

## Submodule 发布流程

`packages/koatty` 是一个独立的 submodule，有自己独立的发布流程：

### 1. 在 Submodule 中创建 Changeset

```bash
cd packages/koatty
pnpm changeset
```

### 2. 在 Submodule 中应用 Changeset

```bash
pnpm changeset:version
```

### 3. 在 Submodule 中构建和发布

```bash
pnpm build && pnpm release
```

### 4. 更新 Monorepo 中的 Submodule 引用

```bash
cd ../..
git add packages/koatty
git commit -m "chore: update koatty submodule"
git push
```

或者在 monorepo 根目录运行：

```bash
./scripts/update-submodule.sh
git add packages/koatty
git commit -m "chore: update koatty submodule"
git push
```

## 自动发布流程

GitHub Actions 配置了自动发布流程：

### CI Pipeline (`.github/workflows/ci.yml`)

在每次 push 或 pull request 时运行：
- Lint 检查
- 测试
- 构建

### Release Pipeline (`.github/workflows/release.yml`)

当有新的 changeset 被合并到 master 分支时：
1. 如果有未发布的 changeset，自动创建 PR（"Version Packages"）
2. 合并 PR 后，自动构建并发布到 npm

### 配置步骤

1. 在 GitHub 仓库设置中添加 Secrets：
   - `NPM_TOKEN`: npm 发布 token（从 npm.com 获取）

2. 确保 CI/CD 中 submodule 被正确检出（已在 workflow 中配置）

## 常见场景

### 场景 1: 修复一个小 Bug（Patch）

```bash
# 1. 修复代码
# 2. 创建 changeset
pnpm changeset
# 选择 koatty-core
# 选择 Patch
# 输入描述: "Fix bug in config loading"

# 3. 应用 changeset
pnpm changeset:version

# 4. 构建和测试
pnpm build
pnpm test

# 5. 提交代码
git add .
git commit -m "fix: config loading bug"
git push

# 6. 等待 CI 通过，GitHub Actions 会自动发布
```

### 场景 2: 添加新功能（Minor）

```bash
# 1. 开发新功能
# 2. 创建 changeset
pnpm changeset
# 选择 koatty-router
# 选择 Minor
# 输入描述: "Add support for dynamic routes"

# 3. 应用 changeset
pnpm changeset:version

# 4. 构建和测试
pnpm build
pnpm test

# 5. 提交代码
git add .
git commit -m "feat: add dynamic routes support"
git push
```

### 场景 3: 破坏性变更（Major）

```bash
# 1. 进行破坏性更改
# 2. 创建 changeset
pnpm changeset
# 选择受影响的所有包
# 选择 Major
# 输入描述: "Remove deprecated API"

# 3. 应用 changeset
pnpm changeset:version

# 4. 更新依赖这个包的其他包的代码
# 5. 构建和测试
pnpm build
pnpm test

# 6. 提交代码
git add .
git commit -m "BREAKING: remove deprecated API"
git push
```

### 场景 4: 更新 Submodule

```bash
# 1. 进入 submodule
cd packages/koatty

# 2. 开发并发布 submodule
pnpm changeset
pnpm changeset:version
pnpm build && pnpm release

# 3. 回到 monorepo
cd ../..

# 4. 更新 submodule 引用
git add packages/koatty
git commit -m "chore: update koatty submodule"
git push
```

## 注意事项

1. **只发布有更改的包**: Changeset 会自动跳过没有 changeset 的包

2. **版本类型要准确**:
   - 破坏性变更必须使用 Major
   - 新功能使用 Minor
   - Bug 修复使用 Patch

3. **Submodule 和 Monorepo 独立发布**:
   - `packages/koatty` 有自己的版本
   - monorepo 中其他包有各自的版本
   - 需要在两个地方分别使用 changeset

4. **内部依赖**:
   - 使用 workspace 协议引用: `"koatty": "workspace:*"`
   - Changeset 会自动更新内部依赖的版本号

5. **测试**:
   - 发布前一定要运行 `pnpm test`
   - 确保 CI 通过

6. **NPM Token**:
   - 确保在 GitHub Secrets 中配置了 `NPM_TOKEN`
   - Token 需要有发布权限（Automation 或更高）

## 故障排查

### 问题: 发布失败，提示 "You are not authorized"

**解决方案**: 检查 `NPM_TOKEN` 是否正确配置，且具有发布权限。

### 问题: Changeset 没有检测到包

**解决方案**: 确保包的 `package.json` 中有正确的 `name` 字段，并且在 `pnpm-workspace.yaml` 中被正确配置。

### 问题: Submodule 未被检出

**解决方案**: 检查 GitHub Actions workflow 中是否设置了 `submodules: recursive`。

### 问题: 版本号没有更新

**解决方案**: 确保运行了 `pnpm changeset:version` 来应用 changeset。

## 参考资源

- [Changesets 官方文档](https://github.com/changesets/changesets)
- [Changeset 发布流程](https://github.com/changesets/action)
