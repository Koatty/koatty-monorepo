#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packagesDir = path.join(__dirname, '../packages');
const internalPackages = [];
const issues = [];
const packageVersions = {};

console.log('='.repeat(80));
console.log('依赖声明一致性验证脚本');
console.log('='.repeat(80));

// 扫描所有包的 package.json
const packageDirs = fs.readdirSync(packagesDir, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name);

for (const pkgName of packageDirs) {
  const pkgJsonPath = path.join(packagesDir, pkgName, 'package.json');
  
  if (!fs.existsSync(pkgJsonPath)) {
    continue;
  }
  
  const pkgData = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
  const packageName = pkgData.name;
  
  internalPackages.push(packageName);
  packageVersions[packageName] = pkgData.version;
  
  // 检查 dependencies
  const deps = pkgData.dependencies || {};
  for (const [depName, depVersion] of Object.entries(deps)) {
    if (depName.startsWith('koatty_')) {
      if (depVersion !== 'workspace:*') {
        issues.push({
          package: packageName,
          type: 'dependencies',
          dependency: depName,
          version: depVersion,
          expected: 'workspace:*'
        });
      }
    }
  }
  
  // 检查 peerDependencies
  const peerDeps = pkgData.peerDependencies || {};
  for (const [depName, depVersion] of Object.entries(peerDeps)) {
    if (depName.startsWith('koatty_')) {
      if (depVersion !== 'workspace:*') {
        issues.push({
          package: packageName,
          type: 'peerDependencies',
          dependency: depName,
          version: depVersion,
          expected: 'workspace:*'
        });
      }
    }
  }
}

// 输出验证报告
console.log(`\n扫描的内部包数量: ${internalPackages.length}`);
console.log(`发现的包: ${internalPackages.sort().join(', ')}`);
console.log(`\n发现的问题数量: ${issues.length}`);

if (issues.length > 0) {
  console.log('\n问题详情:');
  console.log('-'.repeat(80));
  issues.forEach((issue, index) => {
    console.log(`\n问题 ${index + 1}:`);
    console.log(`  包: ${issue.package}`);
    console.log(`  类型: ${issue.type}`);
    console.log(`  依赖: ${issue.dependency}`);
    console.log(`  当前版本: ${issue.version}`);
    console.log(`  期望版本: ${issue.expected}`);
  });
  console.log('\n❌ 验证失败，发现依赖声明不一致');
  process.exit(1);
} else {
  console.log('\n✅ 所有内部包的依赖声明都使用了 workspace:*');
  
  // 检查版本号同步
  console.log('\n检查版本号同步...');
  console.log('-'.repeat(80));
  
  internalPackages.sort().forEach(pkgName => {
    const version = packageVersions[pkgName];
    console.log(`${pkgName}: ${version}`);
  });
  
  console.log('\n✅ 版本号检查完成');
}

console.log('\n' + '='.repeat(80));