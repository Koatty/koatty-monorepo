# 等待依赖包类型声明文件脚本

## 概述

`wait-for-deps.js` 脚本用于解决 monorepo 中构建类型声明文件时的级联依赖问题。它会在运行 `build:dts` 之前等待所有依赖包的类型声明文件生成完成。

## 问题背景

在 monorepo 并行构建时，可能出现以下情况：

1. `koatty-exception` 的 `build:dts` 需要完成，生成 `dist/index.d.ts`
2. `koatty-core` 依赖 `koatty-exception`，它的 `build:dts` 需要 `koatty-exception/dist/index.d.ts`
3. 但 `koatty-exception` 的 `build:dts` 可能还没完成，导致 `koatty-core` 的 `build:dts` 失败
4. `koatty-core/dist/index.d.ts` 不存在
5. `koatty` 依赖 `koatty-core`，它的 `build:dts` 需要 `koatty-core/dist/index.d.ts`
6. 但 `koatty-core/dist/index.d.ts` 不存在，导致 `koatty` 的 `build:dts` 失败

## 解决方案

`wait-for-deps.js` 脚本会：

1. 从 `package.json` 中自动提取所有 `koatty_` 开头的依赖包
2. 检查每个依赖包的类型声明文件（`dist/index.d.ts`）是否存在
3. 如果不存在，等待一段时间后重试（默认每 500ms 检查一次）
4. 设置最大等待时间（默认 30 秒），避免无限等待
5. 所有依赖都准备好后，继续执行构建

## 使用方法

### 自动使用（推荐）

所有包的 `build:dts` 脚本已经更新为使用 `build-dts.sh`，它会自动调用 `wait-for-deps.js`：

```json
{
  "scripts": {
    "build:dts": "bash ../../scripts/build-dts.sh"
  }
}
```

### 手动使用

```bash
# 在包目录中运行
cd packages/koatty-core
node ../../scripts/wait-for-deps.js
```

### 环境变量

- `MAX_WAIT_TIME`: 最大等待时间（毫秒），默认 30000（30 秒）
- `CHECK_INTERVAL`: 检查间隔（毫秒），默认 500（0.5 秒）

```bash
MAX_WAIT_TIME=60000 CHECK_INTERVAL=1000 node scripts/wait-for-deps.js
```

## 工作原理

1. **依赖检测**：从 `package.json` 的 `dependencies`、`devDependencies`、`peerDependencies` 中提取所有 `koatty_` 开头的包
2. **文件检查**：检查以下路径的类型声明文件：
   - `node_modules/koatty_xxx/dist/index.d.ts`（pnpm workspace 链接）
   - `packages/koatty-xxx/dist/index.d.ts`（源包目录）
3. **等待机制**：使用异步等待，每 500ms 检查一次，直到所有依赖都准备好或超时

## 示例输出

```
🔍 Checking dependencies: koatty_exception, koatty_container, koatty_lib, koatty_logger
  ⏳ Waiting for: koatty_exception (500ms)
  ✓ koatty_exception type declarations ready
  ⏳ Waiting for: koatty_container (1000ms)
  ✓ koatty_container type declarations ready
  ✓ koatty_lib type declarations ready
  ✓ koatty_logger type declarations ready

✅ All dependencies ready (waited 1500ms)
```

## 相关文件

- `scripts/wait-for-deps.js` - 等待依赖脚本
- `scripts/build-dts.sh` - 通用的 build:dts 脚本
- `ANALYSIS_TYPE_ERROR.md` - 类型错误根本原因分析
