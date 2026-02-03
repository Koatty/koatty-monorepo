#!/usr/bin/env node
/**
 * 等待依赖包的类型声明文件生成
 * 用于解决级联依赖问题：确保依赖包的 build:dts 完成后再继续
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, 'packages');

// 从 package.json 中提取 koatty_ 开头的依赖包
function getKoattyDependencies(packageJsonPath) {
  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const deps = new Set();

  // 检查 dependencies, devDependencies, peerDependencies
  ['dependencies', 'devDependencies', 'peerDependencies'].forEach(depType => {
    if (pkg[depType]) {
      Object.keys(pkg[depType]).forEach(depName => {
        if (depName.startsWith('koatty_')) {
          deps.add(depName);
        }
      });
    }
  });

  return Array.from(deps);
}

// 检查依赖包的类型声明文件和 JS 文件是否存在
// API Extractor 需要同时有 .js 和 .d.ts 文件
function checkDepTypeFile(depName) {
  // 可能的路径：
  // 1. node_modules/koatty_core/dist/index.d.ts (pnpm workspace 链接)
  // 2. packages/koatty-core/dist/index.d.ts (源包目录)
  const possibleDtsPaths = [
    path.join(WORKSPACE_ROOT, 'node_modules', depName, 'dist', 'index.d.ts'),
    path.join(PACKAGES_DIR, depName.replace(/_/g, '-'), 'dist', 'index.d.ts'),
  ];
  
  const possibleJsPaths = [
    path.join(WORKSPACE_ROOT, 'node_modules', depName, 'dist', 'index.js'),
    path.join(PACKAGES_DIR, depName.replace(/_/g, '-'), 'dist', 'index.js'),
  ];

  // 检查 .d.ts 文件
  let dtsExists = false;
  for (const filePath of possibleDtsPaths) {
    if (fs.existsSync(filePath)) {
      dtsExists = true;
      break;
    }
  }
  
  // 检查 .js 文件（API Extractor 需要两者都存在）
  let jsExists = false;
  for (const filePath of possibleJsPaths) {
    if (fs.existsSync(filePath)) {
      jsExists = true;
      break;
    }
  }

  // 两者都存在才返回 true
  return dtsExists && jsExists;
}

// 等待依赖包的类型声明文件（异步版本）
// 增加超时时间到 60 秒，因为并行构建时可能需要更长时间
function waitForDependencies(packageDir, maxWaitTime = 60000, checkInterval = 500) {
  return new Promise((resolve, reject) => {
    const packageJsonPath = path.join(packageDir, 'package.json');
    const deps = getKoattyDependencies(packageJsonPath);

    if (deps.length === 0) {
      console.log('✓ No koatty dependencies to wait for');
      resolve(true);
      return;
    }

    console.log(`\n🔍 Checking dependencies: ${deps.join(', ')}`);

    const startTime = Date.now();
    const missingDeps = new Set(deps);

    function checkDependencies() {
      // 检查超时
      if (Date.now() - startTime > maxWaitTime) {
        console.warn(`\n⚠️  Timeout waiting for dependencies: ${Array.from(missingDeps).join(', ')}`);
        console.warn(`   Maximum wait time: ${maxWaitTime}ms`);
        console.warn(`   Continuing build anyway - dependencies may be building in parallel`);
        // 不拒绝，而是解析为成功（但标记为部分成功）
        resolve(false); // false 表示超时但继续
        return;
      }

      // 检查每个依赖
      for (const dep of Array.from(missingDeps)) {
        if (checkDepTypeFile(dep)) {
          console.log(`  ✓ ${dep} type declarations ready`);
          missingDeps.delete(dep);
        }
      }

      // 如果所有依赖都准备好了
      if (missingDeps.size === 0) {
        console.log(`\n✅ All dependencies ready (waited ${Date.now() - startTime}ms)`);
        resolve(true);
        return;
      }

      // 如果还有缺失的依赖，等待后重试
      const waited = Date.now() - startTime;
      // 每 5 秒输出一次详细状态
      if (waited % 5000 < checkInterval) {
        console.log(`  ⏳ Waiting for: ${Array.from(missingDeps).join(', ')} (${Math.floor(waited / 1000)}s)`);
        // 输出每个依赖的检查状态（检查 .d.ts 和 .js 文件）
        for (const dep of Array.from(missingDeps)) {
          const depDir = path.join(PACKAGES_DIR, dep.replace(/_/g, '-'), 'dist');
          const dtsPath = path.join(depDir, 'index.d.ts');
          const jsPath = path.join(depDir, 'index.js');
          const dtsExists = fs.existsSync(dtsPath);
          const jsExists = fs.existsSync(jsPath);
          const bothExist = dtsExists && jsExists;
          const status = bothExist ? 'ready' : 
                        (dtsExists ? 'missing .js' : jsExists ? 'missing .d.ts' : 'not found');
          console.log(`     ${bothExist ? '✓' : '✗'} ${dep}: ${status}`);
        }
      }
      setTimeout(checkDependencies, checkInterval);
    }

    // 开始检查
    checkDependencies();
  });
}

// 主函数
async function main() {
  const packageDir = process.cwd();
  // 默认超时时间增加到 60 秒，因为并行构建时可能需要更长时间
  const maxWaitTime = parseInt(process.env.MAX_WAIT_TIME || '60000', 10);
  const checkInterval = parseInt(process.env.CHECK_INTERVAL || '500', 10);

  try {
    const success = await waitForDependencies(packageDir, maxWaitTime, checkInterval);
    // success === true: 所有依赖都准备好了
    // success === false: 超时但继续构建
    process.exit(0); // 总是成功退出，让构建继续
  } catch (error) {
    console.warn(`\n⚠️  Error waiting for dependencies: ${error.message}`);
    console.warn(`   Continuing build anyway...`);
    process.exit(0); // 即使出错也继续构建
  }
}

if (require.main === module) {
  main();
}

module.exports = { waitForDependencies, getKoattyDependencies, checkDepTypeFile };
