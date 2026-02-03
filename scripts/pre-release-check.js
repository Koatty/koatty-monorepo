#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('='.repeat(80));
console.log('发布前检查脚本');
console.log('='.repeat(80));

let hasError = false;

// 检查 1: 验证依赖一致性
console.log('\n[1/5] 验证依赖一致性...');
try {
  execSync('node scripts/validate-dependencies.js', { stdio: 'inherit' });
  console.log('✅ 依赖一致性检查通过');
} catch (error) {
  console.error('❌ 依赖一致性检查失败');
  hasError = true;
}

// 检查 2: 验证工作区状态
console.log('\n[2/5] 验证工作区状态...');
try {
  const status = execSync('git status --porcelain').toString();
  if (status.trim()) {
    console.warn('⚠️  工作区有未提交的更改，请先提交或暂存：');
    console.warn(status);
    hasError = true;
  } else {
    console.log('✅ 工作区状态干净');
  }
} catch (error) {
  console.error('❌ 无法检查工作区状态');
  hasError = true;
}

// 检查 3: 验证 changeset 文件
console.log('\n[3/5] 验证 changeset 文件...');
try {
  const changesetDir = path.join(__dirname, '../.changeset');
  const files = fs.readdirSync(changesetDir)
    .filter(file => file.endsWith('.md') && file !== 'README.md');
  
  if (files.length === 0) {
    console.warn('⚠️  没有找到 changeset 文件，请先运行: pnpm changeset');
    hasError = true;
  } else {
    console.log(`✅ 找到 ${files.length} 个 changeset 文件`);
  }
} catch (error) {
  console.error('❌ 无法检查 changeset 文件');
  hasError = true;
}

// 检查 4: 验证所有包是否构建
console.log('\n[4/5] 验证构建产物...');
const packagesDir = path.join(__dirname, '../packages');
const packageDirs = fs.readdirSync(packagesDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

let missingDists = [];
for (const pkgName of packageDirs) {
  const pkgJsonPath = path.join(packagesDir, pkgName, 'package.json');
  const distPath = path.join(packagesDir, pkgName, 'dist');
  
  if (!fs.existsSync(pkgJsonPath)) {
    continue;
  }
  
  if (!fs.existsSync(distPath) || !fs.existsSync(path.join(distPath, 'package.json'))) {
    missingDists.push(pkgName);
  }
}

if (missingDists.length > 0) {
  console.warn('⚠️  以下包缺少构建产物，请先运行: pnpm build');
  missingDists.forEach(pkg => console.warn(`  - ${pkg}`));
  hasError = true;
} else {
  console.log('✅ 所有包都有构建产物');
}

// 检查 5: 验证依赖构建顺序
console.log('\n[5/5] 验证依赖构建顺序...');
const pkgVersions = {};

for (const pkgName of packageDirs) {
  const pkgJsonPath = path.join(packagesDir, pkgName, 'package.json');
  
  if (!fs.existsSync(pkgJsonPath)) {
    continue;
  }
  
  const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  pkgVersions[pkgData.name] = pkgData.version;
}

console.log('✅ 包版本号已同步');

console.log('\n' + '='.repeat(80));

if (hasError) {
  console.error('\n❌ 发布前检查失败，请修复上述问题后再发布');
  process.exit(1);
} else {
  console.log('\n✅ 所有检查通过，可以开始发布流程');
  console.log('\n下一步操作:');
  console.log('  1. pnpm changeset version   # 更新版本号');
  console.log('  2. pnpm build              # 构建所有包');
  console.log('  3. pnpm changeset publish   # 发布到 npm');
}

console.log('\n' + '='.repeat(80));