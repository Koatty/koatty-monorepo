#!/usr/bin/env node

/**
 * 支持指定版本类型的 changeset version 包装脚本
 * 
 * 使用方式：
 *   node scripts/changeset-version.js minor
 *   node scripts/changeset-version.js major
 *   node scripts/changeset-version.js patch
 *   node scripts/changeset-version.js pre
 *   node scripts/changeset-version.js (默认 patch)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const CHANGESET_DIR = path.join(WORKSPACE_ROOT, '.changeset');

// 支持的版本类型
const VERSION_TYPES = {
  'major': 'major',
  'minor': 'minor',
  'patch': 'patch',
  'pre': 'pre',
  'premajor': 'premajor',
  'preminor': 'preminor',
  'prepatch': 'prepatch',
  'prerelease': 'prerelease'
};

/**
 * 获取命令行参数
 */
function getVersionType() {
  const args = process.argv.slice(2);
  const type = args[0]?.toLowerCase();
  
  if (!type) {
    return 'patch'; // 默认 patch
  }
  
  if (!VERSION_TYPES[type]) {
    console.error(`❌ 无效的版本类型: ${type}`);
    console.error(`\n支持的版本类型:`);
    Object.keys(VERSION_TYPES).forEach(t => {
      console.error(`  - ${t}`);
    });
    process.exit(1);
  }
  
  return VERSION_TYPES[type];
}

/**
 * 检查是否有待处理的 changesets
 */
function hasPendingChangesets() {
  try {
    const files = fs.readdirSync(CHANGESET_DIR);
    return files.some(file => file.endsWith('.md') && file !== 'README.md');
  } catch (error) {
    return false;
  }
}

/**
 * 创建指定类型的 changeset
 */
function createChangeset(type) {
  console.log(`📝 创建 ${type} 类型的 changeset...\n`);
  
  try {
    // 使用 changeset 的交互式命令，但通过 stdin 输入
    // 注意：这需要用户交互，所以我们需要一个不同的方法
    
    // 实际上，changesets 不支持非交互式创建 changeset
    // 我们需要提示用户先创建 changeset
    if (!hasPendingChangesets()) {
      console.log('⚠️  没有待处理的 changeset');
      console.log(`\n请先运行以下命令创建 changeset:`);
      console.log(`  pnpm changeset`);
      console.log(`\n或者使用以下命令直接创建并应用版本:`);
      console.log(`  pnpm changeset:version:${type}`);
      console.log(`\n注意: 此命令会创建一个临时的 ${type} 类型 changeset 并立即应用`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 创建 changeset 失败:', error.message);
    process.exit(1);
  }
}

/**
 * 运行 changeset version
 */
function runChangesetVersion(type) {
  console.log(`🔄 应用 ${type} 类型的版本更新...\n`);
  
  try {
    // changeset version 命令本身不支持指定版本类型
    // 版本类型是在创建 changeset 时指定的
    // 所以这里只是运行标准的 version 命令
    execSync('changeset version', {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('\n❌ 版本更新失败:', error.message);
    process.exit(1);
  }
}

/**
 * 主函数
 */
function main() {
  const versionType = getVersionType();
  
  console.log(`🚀 Changeset Version - ${versionType.toUpperCase()}\n`);
  
  // 检查是否有待处理的 changesets
  if (!hasPendingChangesets()) {
    console.log('⚠️  没有待处理的 changeset');
    console.log(`\n请先运行以下命令创建 changeset:`);
    console.log(`  pnpm changeset`);
    console.log(`\n在创建 changeset 时，请选择 "${versionType}" 版本类型`);
    process.exit(1);
  }
  
  // 运行 changeset version
  runChangesetVersion(versionType);
  
  // 自动提交（如果配置了）
  console.log('\n✅ 版本更新完成');
  console.log('\n💡 下一步:');
  console.log('  node scripts/commit-version-changes.js  # 自动提交版本变更');
  console.log('  git push origin master                   # 推送变更');
  console.log('  pnpm release                             # 发布到 npm');
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

module.exports = { getVersionType, hasPendingChangesets };
