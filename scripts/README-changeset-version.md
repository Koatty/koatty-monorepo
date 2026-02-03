# Changeset Version 快捷命令

## 功能说明

提供了快速创建并应用指定版本类型 changeset 的命令，支持 `patch`、`minor`、`major` 和 `pre` 版本类型。

## 使用方法

### 方式一：使用 npm scripts（推荐）

```bash
# Patch 版本（补丁版本，bug 修复）
pnpm changeset:version:patch

# Minor 版本（次版本，新功能）
pnpm changeset:version:minor

# Major 版本（主版本，破坏性变更）
pnpm changeset:version:major

# Pre-release 版本（预发布版本）
pnpm changeset:version:pre
```

### 方式二：使用脚本直接指定包

```bash
# 更新所有包为 minor 版本
node scripts/create-and-version.js minor

# 更新指定包为 minor 版本
node scripts/create-and-version.js minor koatty koatty_core

# 更新指定包为 patch 版本
node scripts/create-and-version.js patch koatty-router
```

## 工作流程

这些命令会：

1. **自动创建 changeset 文件**：在 `.changeset/` 目录下创建指定类型的 changeset
2. **应用版本更新**：运行 `changeset version` 更新版本号
3. **自动提交**：运行 `commit-version-changes.js` 自动提交变更

## 版本类型说明

- **patch**: 补丁版本（1.0.0 → 1.0.1），用于 bug 修复
- **minor**: 次版本（1.0.0 → 1.1.0），用于新功能，向后兼容
- **major**: 主版本（1.0.0 → 2.0.0），用于破坏性变更
- **pre**: 预发布版本（1.0.0 → 1.0.1-0），用于测试版本

## 示例

### 示例 1: 快速发布 patch 版本

```bash
# 1. 更新所有包为 patch 版本并自动提交
pnpm changeset:version:patch

# 2. 推送变更
git push origin master

# 3. 发布到 npm
pnpm release
```

### 示例 2: 更新特定包

```bash
# 更新 koatty 和 koatty-core 为 minor 版本
node scripts/create-and-version.js minor koatty koatty_core

# 推送并发布
git push origin master
pnpm release
```

### 示例 3: 标准流程（使用交互式 changeset）

```bash
# 1. 创建 changeset（交互式选择版本类型）
pnpm changeset

# 2. 应用版本更新
pnpm changeset:version

# 3. 推送并发布
git push origin master
pnpm release
```

## 注意事项

1. **包名格式**：可以使用目录名（如 `koatty-core`）或包名（如 `koatty_core`）
2. **自动提交**：命令会自动提交版本变更，无需手动提交
3. **CHANGELOG**：版本更新会自动生成 CHANGELOG.md
4. **依赖更新**：如果包之间有依赖关系，相关包的版本也会自动更新

## 相关命令

- `pnpm changeset` - 交互式创建 changeset
- `pnpm changeset:version` - 应用已有的 changeset
- `pnpm changeset:version:no-commit` - 应用 changeset 但不自动提交
- `pnpm release` - 构建并发布到 npm
