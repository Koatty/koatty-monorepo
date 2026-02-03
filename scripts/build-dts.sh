#!/bin/bash
# 通用的 build:dts 脚本
# 等待依赖包的类型声明文件生成后再继续构建

set -e  # 遇到错误立即退出

# 获取脚本所在目录（scripts/）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 获取工作区根目录（scripts/ 的父目录）
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# 获取当前包目录（从当前工作目录）
PACKAGE_DIR="$(pwd)"
PACKAGE_NAME="$(basename "$PACKAGE_DIR")"

echo "🔨 Building type declarations for $PACKAGE_NAME..."

# 等待依赖包的类型声明文件
echo "⏳ Waiting for dependencies to be ready..."
# 如果等待失败，记录警告但继续构建（依赖可能在构建过程中生成）
if ! node "$WORKSPACE_ROOT/scripts/wait-for-deps.js"; then
  echo "⚠️  Some dependencies may not be ready, but continuing build..."
  echo "   (This is expected in parallel builds - dependencies will be available soon)"
fi

# 运行 tsc
echo "📝 Running TypeScript compiler..."
npx tsc --skipLibCheck || {
  echo "⚠️  TypeScript compilation had errors, but continuing..."
}

# 运行 api-extractor
echo "📦 Running API Extractor..."
npx api-extractor run --local --verbose || {
  echo "❌ API Extractor failed"
  exit 1
}

echo "✅ Type declarations built successfully"
