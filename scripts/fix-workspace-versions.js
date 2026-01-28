#!/usr/bin/env node

/**
 * 在发布前将 dist/package.json 中的 workspace:* 替换为具体版本号
 * 这个脚本会在构建后、发布前运行，确保发布的包使用正确的版本号
 * 
 * 使用方式：
 *   node scripts/fix-workspace-versions.js --dist-only
 * 
 * 注意：默认只处理 dist/package.json，不修改源文件
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, 'packages');

// 存储原始内容，用于恢复（如果需要）
const originalContents = new Map();

// 默认只处理 dist/package.json（构建后的文件）
// 使用 --source 参数可以处理源 package.json（通常不需要）
const ONLY_DIST = !process.argv.includes('--source');

/**
 * 获取 monorepo 中包的版本号
 */
function getPackageVersion(packageName) {
  // 尝试不同的包名格式
  const possibleNames = [
    packageName,
    packageName.replace('koatty_', 'koatty-'),
    packageName.replace('koatty-', 'koatty_'),
  ];

  for (const name of possibleNames) {
    const pkgPath = path.join(PACKAGES_DIR, name, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.version;
      } catch (e) {
        console.warn(`⚠️  Failed to read ${pkgPath}:`, e.message);
      }
    }
  }

  return null;
}

/**
 * 处理单个包的 package.json
 */
function processPackageJson(pkgPath) {
  if (!fs.existsSync(pkgPath)) {
    return false;
  }

  const content = fs.readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(content);
  let changed = false;

  // 保存原始内容（如果需要恢复）
  if (!originalContents.has(pkgPath)) {
    originalContents.set(pkgPath, content);
  }

  // 处理 dependencies, devDependencies, peerDependencies
  ['dependencies', 'devDependencies', 'peerDependencies'].forEach(depType => {
    if (!pkg[depType]) return;

    Object.entries(pkg[depType]).forEach(([name, version]) => {
      if (version === 'workspace:*' || version.startsWith('workspace:')) {
        const actualVersion = getPackageVersion(name);
        if (actualVersion) {
          // 对于 peerDependencies，使用更宽松的版本范围
          const newVersion = depType === 'peerDependencies' 
            ? `^${actualVersion.split('.')[0]}.x.x`
            : `^${actualVersion}`;
          
          pkg[depType][name] = newVersion;
          console.log(`  ✓ Fixed ${depType}.${name}: workspace:* → ${newVersion}`);
          changed = true;
        } else {
          console.warn(`  ⚠️  Could not find version for ${name}, keeping ${version}`);
        }
      }
    });
  });

  if (changed) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    return true;
  }

  return false;
}

/**
 * 主函数
 */
function main() {
  const target = ONLY_DIST ? 'dist/package.json' : 'package.json';
  console.log(`🔧 Fixing workspace:* dependencies in ${target} files...\n`);
  
  if (!ONLY_DIST) {
    console.warn('⚠️  Warning: Modifying source package.json files.');
    console.warn('   This is usually not recommended. Use --dist-only (default) instead.\n');
  }

  // 获取所有包目录
  const packages = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  let totalFixed = 0;

  packages.forEach(pkgName => {
    const pkgPath = ONLY_DIST 
      ? path.join(PACKAGES_DIR, pkgName, 'dist', 'package.json')
      : path.join(PACKAGES_DIR, pkgName, 'package.json');
    
    if (fs.existsSync(pkgPath)) {
      console.log(`Processing ${pkgName}...`);
      if (processPackageJson(pkgPath)) {
        totalFixed++;
        console.log(`  ✅ Fixed workspace:* dependencies\n`);
      } else {
        console.log(`  ✓ No workspace:* dependencies found\n`);
      }
    } else if (ONLY_DIST) {
      // dist/package.json 不存在是正常的（可能还没构建）
      console.log(`  ⏭️  Skipping ${pkgName} (dist/package.json not found)\n`);
    }
  });

  if (totalFixed > 0) {
    console.log(`\n✅ Successfully fixed workspace:* dependencies in ${totalFixed} package(s)`);
    console.log('\n💡 Note: Original files are backed up and can be restored if needed.');
  } else {
    console.log('\n✓ No workspace:* dependencies found in any package');
  }

  // 将备份信息保存到文件，以便后续恢复（如果需要）
  const backupFile = path.join(WORKSPACE_ROOT, '.workspace-versions-backup.json');
  if (originalContents.size > 0) {
    const backup = {};
    originalContents.forEach((content, pkgPath) => {
      backup[pkgPath] = content;
    });
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

module.exports = { processPackageJson, getPackageVersion };
