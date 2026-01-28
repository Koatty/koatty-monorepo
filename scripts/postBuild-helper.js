/**
 * postBuild 辅助函数
 * 用于在构建后修复 dist/package.json 中的 workspace:* 依赖和路径
 * 
 * 使用方法：
 *   const { fixWorkspaceDeps, fixPaths } = require('./postBuild-helper');
 *   fixWorkspaceDeps(path.resolve(__dirname, '../dist/package.json'));
 *   fixPaths(path.resolve(__dirname, '../dist/package.json'));
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, 'packages');

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
        // 忽略错误
      }
    }
  }

  return null;
}

/**
 * 修复 dist/package.json 中的 workspace:* 依赖
 */
function fixWorkspaceDeps(distPkgPath) {
  if (!fs.existsSync(distPkgPath)) {
    return false;
  }

  const pkg = JSON.parse(fs.readFileSync(distPkgPath, 'utf8'));
  let changed = false;

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
    fs.writeFileSync(distPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  return changed;
}

/**
 * 修复 dist/package.json 中的路径
 */
function fixPaths(distPkgPath) {
  if (!fs.existsSync(distPkgPath)) {
    return false;
  }

  const pkg = JSON.parse(fs.readFileSync(distPkgPath, 'utf8'));
  let changed = false;

  // Fix paths for dist/package.json (relative to dist/)
  if (pkg.main && pkg.main.startsWith('./dist/')) {
    pkg.main = pkg.main.replace('./dist/', './');
    changed = true;
    console.log(`  ✓ Fixed main: ./dist/... → ${pkg.main}`);
  }

  if (pkg.types && pkg.types.startsWith('./dist/')) {
    pkg.types = pkg.types.replace('./dist/', './');
    changed = true;
    console.log(`  ✓ Fixed types: ./dist/... → ${pkg.types}`);
  }

  if (!pkg.types && pkg.main) {
    pkg.types = pkg.main.replace(/\.js$/, '.d.ts');
    changed = true;
    console.log(`  ✓ Added types field: ${pkg.types}`);
  }

  if (pkg.exports) {
    Object.keys(pkg.exports).forEach(key => {
      if (typeof pkg.exports[key] === 'string' && pkg.exports[key].startsWith('./dist/')) {
        const oldPath = pkg.exports[key];
        pkg.exports[key] = pkg.exports[key].replace('./dist/', './');
        changed = true;
        console.log(`  ✓ Fixed exports.${key}: ${oldPath} → ${pkg.exports[key]}`);
      }
    });
  }

  if (changed) {
    fs.writeFileSync(distPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  }

  return changed;
}

module.exports = {
  fixWorkspaceDeps,
  fixPaths,
  getPackageVersion,
};
