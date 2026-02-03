#!/usr/bin/env node

/**
 * 创建指定类型的 changeset 并立即应用版本更新
 * 
 * 使用方式：
 *   node scripts/create-and-version.js minor [package1] [package2]
 *   node scripts/create-and-version.js major koatty
 *   node scripts/create-and-version.js patch
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
 * 获取所有可发布的包（返回 package.json 中的 name）
 */
function getPackages() {
  const packagesDir = path.join(WORKSPACE_ROOT, 'packages');
  const packages = [];
  
  fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .forEach(dirent => {
      const pkgPath = path.join(packagesDir, dirent.name, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (!pkg.private && pkg.name) {
            packages.push({
              name: pkg.name, // package.json 中的 name（如 koatty_core）
              dir: dirent.name // 目录名（如 koatty-core）
            });
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    });
  
  return packages;
}

/**
 * 创建 changeset 文件
 */
function createChangesetFile(type, packages, message) {
  const timestamp = Date.now();
  const filename = `${type}-${timestamp}.md`;
  const filepath = path.join(CHANGESET_DIR, filename);
  
  // 确保 .changeset 目录存在
  if (!fs.existsSync(CHANGESET_DIR)) {
    fs.mkdirSync(CHANGESET_DIR, { recursive: true });
  }
  
  const content = `---
${packages.map(pkg => `"${pkg}": ${type}`).join('\n')}
---

${message || `${type} version bump`}
`;
  
  fs.writeFileSync(filepath, content, 'utf8');
  console.log(`✅ 创建 changeset: ${filename}`);
  return filepath;
}

/**
 * 主函数
 */
function main() {
  const args = process.argv.slice(2);
  const type = args[0]?.toLowerCase();
  
  if (!type || !VERSION_TYPES[type]) {
    console.error('❌ 请指定版本类型');
    console.error('\n使用方式:');
    console.error('  node scripts/create-and-version.js <type> [package1] [package2] ...');
    console.error('\n支持的版本类型:');
    Object.keys(VERSION_TYPES).forEach(t => {
      console.error(`  - ${t}`);
    });
    console.error('\n示例:');
    console.error('  node scripts/create-and-version.js minor koatty koatty-core');
    console.error('  node scripts/create-and-version.js patch  # 更新所有包');
    process.exit(1);
  }
  
  const versionType = VERSION_TYPES[type];
  const specifiedPackages = args.slice(1);
  const allPackages = getPackages();
  const packageNames = allPackages.map(p => p.name);
  const packageDirs = allPackages.map(p => p.dir);
  
  // 确定要更新的包
  let packagesToUpdate;
  if (specifiedPackages.length > 0) {
    // 验证包名（支持目录名或包名）
    const packagesToUpdateNames = specifiedPackages.map(spec => {
      // 查找匹配的包（支持目录名或包名）
      const found = allPackages.find(p => p.name === spec || p.dir === spec);
      if (!found) {
        return null;
      }
      return found.name; // 使用 package.json 中的 name
    });
    
    const invalidPackages = specifiedPackages.filter((spec, idx) => packagesToUpdateNames[idx] === null);
    if (invalidPackages.length > 0) {
      console.error(`❌ 无效的包名: ${invalidPackages.join(', ')}`);
      console.error(`\n可用的包:`);
      allPackages.forEach(p => {
        console.error(`  - ${p.name} (目录: ${p.dir})`);
      });
      process.exit(1);
    }
    packagesToUpdate = packagesToUpdateNames.filter(Boolean);
  } else {
    // 如果没有指定包，更新所有包
    packagesToUpdate = packageNames;
  }
  
  console.log(`🚀 创建 ${versionType} 类型的 changeset 并应用版本更新\n`);
  console.log(`📦 要更新的包: ${packagesToUpdate.join(', ')}\n`);
  
  // 创建 changeset 文件
  const message = `${versionType} version bump for ${packagesToUpdate.join(', ')}`;
  createChangesetFile(versionType, packagesToUpdate, message);
  
  // 运行 changeset version
  console.log('\n🔄 应用版本更新...\n');
  try {
    execSync('changeset version', {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit'
    });
  } catch (error) {
    console.error('\n❌ 版本更新失败:', error.message);
    process.exit(1);
  }
  
  // 自动提交
  console.log('\n💾 自动提交版本变更...\n');
  try {
    execSync('node scripts/commit-version-changes.js', {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit'
    });
  } catch (error) {
    console.log('\n⚠️  自动提交失败，请手动提交');
  }
  
  console.log('\n✅ 完成！');
  console.log('\n💡 下一步:');
  console.log('  git push origin master  # 推送变更');
  console.log('  pnpm release            # 发布到 npm');
}

if (require.main === module) {
  main();
}

module.exports = { createChangesetFile, getPackages };
