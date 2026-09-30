#!/usr/bin/env node
/**
 * 优先构建基础包（公共依赖的底层包）
 * 这些包需要优先构建，否则所有包都会构建不成功
 * 
 * 基础包列表：
 * - koatty_lib - 工具函数库（最底层，无依赖）
 * - koatty_logger - 日志库（依赖 koatty_lib）
 * - koatty_container - IoC 容器（依赖 koatty_lib, koatty_logger）
 * - koatty_loader - 加载器（依赖 koatty_lib）
 * - koatty_exception - 异常处理（依赖 koatty_lib, koatty_logger, koatty_container）
 * - koatty_core - 核心框架（依赖 koatty_exception, koatty_container, koatty_logger, koatty_lib）
 */

const { execSync } = require('child_process');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// 基础包构建顺序（按依赖关系排序）
const BASE_PACKAGES = [
  'koatty_lib',        // 最底层，无依赖
  'koatty_logger',     // 依赖 koatty_lib
  'koatty_container',  // 依赖 koatty_lib, koatty_logger
  'koatty_loader',     // 依赖 koatty_lib
  'koatty_exception',  // 依赖 koatty_lib, koatty_logger, koatty_container
  'koatty_core',       // 依赖 koatty_exception, koatty_container, koatty_logger, koatty_lib
  'koatty_config',     // 依赖 koatty_lib, koatty_core（resolveProfileName）
  'koatty_proto',      // 依赖 koatty_lib
  'koatty_validation', // 依赖 koatty_lib
  'koatty_graphql',    // 依赖 koatty_lib
];

console.log('🚀 Building base packages (foundation dependencies)...\n');
console.log('📦 Build order:', BASE_PACKAGES.join(' → '));
console.log('');

let successCount = 0;
let failCount = 0;

for (const pkg of BASE_PACKAGES) {
  try {
    console.log(`🔨 Building ${pkg}...`);
    execSync(`pnpm --filter ${pkg} build`, {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit',
    });
    console.log(`✅ ${pkg} built successfully\n`);
    successCount++;
  } catch (error) {
    console.error(`❌ Failed to build ${pkg}`);
    console.error(error.message);
    failCount++;
    // 继续构建其他包，但记录失败
  }
}

console.log('\n' + '='.repeat(50));
console.log(`📊 Build Summary:`);
console.log(`   ✅ Success: ${successCount}`);
console.log(`   ❌ Failed: ${failCount}`);
console.log('='.repeat(50));

if (failCount > 0) {
  console.error('\n❌ Some base packages failed to build');
  process.exit(1);
}

console.log('\n✅ All base packages built successfully');
console.log('   Other packages can now build with these dependencies ready\n');
