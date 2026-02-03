#!/usr/bin/env node
/**
 * 批量更新所有包的 build:dts 脚本，使用新的等待逻辑
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, 'packages');

// 需要保留特殊处理的包
const SPECIAL_PACKAGES = {
  'koatty': 'bash scripts/build-dts.sh', // 使用自己的脚本
};

function updatePackageBuildDts(packageDir) {
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const packageName = pkg.name;
  const packageDirName = path.basename(packageDir);

  // 跳过特殊处理的包
  if (SPECIAL_PACKAGES[packageDirName]) {
    console.log(`⏭️  Skipping ${packageName} (has custom script)`);
    return false;
  }

  // 检查是否有 build:dts 脚本
  if (!pkg.scripts || !pkg.scripts['build:dts']) {
    console.log(`⏭️  Skipping ${packageName} (no build:dts script)`);
    return false;
  }

  // 检查是否已经使用新脚本
  const currentScript = pkg.scripts['build:dts'];
  if (currentScript.includes('../../scripts/build-dts.sh') || 
      currentScript.includes('scripts/build-dts.sh')) {
    console.log(`✓ ${packageName} already uses new script`);
    return false;
  }

  // 更新脚本
  pkg.scripts['build:dts'] = 'bash ../../scripts/build-dts.sh';
  
  // 写回文件
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`✅ Updated ${packageName}`);
  return true;
}

function main() {
  console.log('🔄 Updating build:dts scripts...\n');

  const packages = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => path.join(PACKAGES_DIR, dirent.name));

  let updated = 0;
  for (const packageDir of packages) {
    if (updatePackageBuildDts(packageDir)) {
      updated++;
    }
  }

  console.log(`\n✅ Updated ${updated} packages`);
}

if (require.main === module) {
  main();
}

module.exports = { updatePackageBuildDts };
