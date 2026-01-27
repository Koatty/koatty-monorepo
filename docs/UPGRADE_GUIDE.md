# Koatty 升级指南

本指南帮助您从旧版本的 Koatty 升级到最新版本。

## 版本管理

Koatty 现在使用 [Changesets](https://github.com/changesets/changesets) 进行统一的版本管理。所有包的版本都在 monorepo 中统一管理，而不是每个包独立管理。

## 主要变化

### 1. 统一版本管理

**之前**：
- 每个包使用 `standard-version` 独立管理版本
- 每个包都有自己的 `CHANGELOG.md`
- 版本同步需要手动操作

**现在**：
- 所有包使用 Changesets 统一管理版本
- 统一的版本发布流程
- 自动生成 CHANGELOG
- 内部依赖版本自动更新

### 2. 依赖策略改进

**之前**：
```json
{
  "peerDependencies": {
    "koatty_core": "workspace:*",
    "koatty_lib": "^1.x.x"
  }
}
```

**现在**：
```json
{
  "dependencies": {
    "koatty_core": "workspace:*",
    "koatty_lib": "^1.x.x"
  },
  "engines": {
    "koatty": ">=4.0.0"
  }
}
```

**优点**：
- 不需要用户手动安装 peerDependencies
- 减少依赖冲突
- 更清晰的版本约束

## 升级步骤

### 步骤 1：检查当前版本

运行诊断工具检查您的项目健康状况：

```bash
# 全局安装 koatty doctor
npm install -g koatty

# 或者直接在项目中运行
npm run doctor
```

这会生成兼容性矩阵并检查潜在问题。

### 步骤 2：更新依赖

更新 `package.json` 中的依赖版本：

```json
{
  "dependencies": {
    "koatty": "^4.0.0"
  }
}
```

然后运行：

```bash
npm install
```

### 步骤 3：检查代码兼容性

检查以下方面：

#### 3.1 导入语句

确保使用新的包名：

```typescript
// 旧方式（如果包名有变化）
import { Controller } from '@koatty/core';

// 新方式
import { Controller } from 'koatty';
import { KoattyCore } from 'koatty_core';
```

#### 3.2 依赖注入

如果之前使用 peerDependencies，现在可以直接使用：

```typescript
// 之前需要手动安装
import { App } from 'koatty';

// 现在自动包含
import { App } from 'koatty';
import { Router } from 'koatty_router';
```

### 步骤 4：运行测试

确保所有测试通过：

```bash
npm test
```

### 步骤 5：部署

如果一切正常，您可以部署您的应用：

```bash
npm run build
npm start
```

## 兼容性矩阵

使用 `npm run doctor` 命令生成最新的兼容性矩阵：

```
🔍 Generating compatibility matrix...

📦 koatty
   Version: 4.0.0
   Engines: >=18.0.0
   Koatty Dependencies:
     - koatty_config: workspace:*
     - koatty_core: workspace:*
     - koatty_exception: workspace:*
     ...

✅ Compatibility matrix saved to docs/COMPATIBILITY_MATRIX.md
```

## 常见问题

### Q: 我需要手动更新所有 koatty_* 依赖吗？

A: 不需要。现在所有 koatty 包的依赖都通过 `workspace:*` 协议自动管理。您只需要更新主 `koatty` 包即可。

### Q: 如何知道哪些包需要更新？

A: 运行 `npm run doctor` 会生成完整的兼容性矩阵，显示所有包的版本和依赖关系。

### Q: 升级后会破坏我的现有代码吗？

A: 通常不会。新版本主要改进了依赖管理，核心 API 保持向后兼容。建议在升级前运行完整的测试套件。

### Q: 如何回退到旧版本？

A: 在 `package.json` 中指定旧版本：

```json
{
  "dependencies": {
    "koatty": "3.0.0"
  }
}
```

然后运行 `npm install`。

### Q: 我的项目使用了一些内部依赖（如 koatty_logger），怎么办？

A: 这些内部依赖现在通过 `dependencies` 自动管理，不需要手动安装或指定版本。

## 从旧版本迁移的具体指南

### 从 v3.x 到 v4.0

1. **更新 package.json**：
   ```json
   {
     "dependencies": {
       "koatty": "^4.0.0"
     }
   }
   ```

2. **移除手动安装的 peerDependencies**：
   ```bash
   npm uninstall koatty_core koatty_lib koatty_logger
   ```

3. **重新安装依赖**：
   ```bash
   npm install
   ```

4. **运行诊断**：
   ```bash
   npm run doctor
   ```

5. **运行测试**：
   ```bash
   npm test
   ```

### 从 v2.x 到 v4.0

建议先升级到 v3.x，然后再升级到 v4.0。如果直接升级，请特别注意：

- 检查所有导入语句
- 确保没有使用已弃用的 API
- 运行完整的测试套件

## 获取帮助

如果在升级过程中遇到问题：

1. 运行 `npm run doctor` 查看诊断信息
2. 查看兼容性矩阵：`docs/COMPATIBILITY_MATRIX.md`
3. 检查 CHANGELOG.md 了解详细变更
4. 在 GitHub 上提交 issue

## 最佳实践

1. **定期更新**：保持依赖最新，避免累积大量变更
2. **使用锁文件**：确保团队使用相同的依赖版本
3. **运行诊断**：升级前运行 `npm run doctor` 检查潜在问题
4. **版本固定**：生产环境建议固定版本而不是使用 `^`
5. **测试覆盖**：确保有足够的测试覆盖以捕获兼容性问题

## 更新日志

详细的更新日志请参阅：
- [Koatty CHANGELOG](../packages/koatty/CHANGELOG.md)
- [各包 CHANGELOG](../packages/*/CHANGELOG.md)

---

**注意**：本指南会随 Koatty 版本更新而更新。建议每次升级前查看最新版本。
