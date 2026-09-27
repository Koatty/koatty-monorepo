#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const colors = {
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  bold: {
    cyan: (text) => `\x1b[1;36m${text}\x1b[0m`,
    green: (text) => `\x1b[1;32m${text}\x1b[0m`,
    yellow: (text) => `\x1b[1;33m${text}\x1b[0m`,
    red: (text) => `\x1b[1;31m${text}\x1b[0m`,
  },
  gray: (text) => `\x1b[90m${text}\x1b[0m`
};

const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');

function getPackageJson(packageName) {
  const possiblePaths = [
    path.join(packagesDir, packageName, 'package.json'),
    path.join(packagesDir, packageName.replace('koatty_', 'koatty-'), 'package.json'),
  ];

  for (const pkgPath of possiblePaths) {
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    }
  }
  return null;
}

function getPackageVersion(packageName) {
  const pkg = getPackageJson(packageName);
  return pkg ? pkg.version : null;
}

function checkDependencyConflicts() {
  console.log(colors.cyan('\n🔍 Checking dependency conflicts...\n'));

  const packages = fs.readdirSync(packagesDir).filter(
    name => fs.statSync(path.join(packagesDir, name)).isDirectory()
  );

  let hasConflicts = false;
  const conflicts = [];

  packages.forEach(packageName => {
    const pkg = getPackageJson(packageName);
    if (!pkg) return;

    const { dependencies = {}, devDependencies = {} } = pkg;
    const allDeps = { ...dependencies, ...devDependencies };

    Object.entries(allDeps).forEach(([depName, depVersion]) => {
      if (depName.startsWith('koatty_') && depVersion.startsWith('workspace:*')) {
        const actualVersion = getPackageVersion(depName);
        if (!actualVersion) {
          conflicts.push({
            package: packageName,
            dependency: depName,
            issue: 'Workspace dependency not found in monorepo',
            currentVersion: depVersion
          });
          hasConflicts = true;
        }
      }
    });
  });

  if (conflicts.length > 0) {
    console.log(colors.red('❌ Found dependency conflicts:\n'));
    conflicts.forEach(conflict => {
      console.log(colors.red(`  - Package: ${conflict.package}`));
      console.log(colors.red(`    Dependency: ${conflict.dependency}`));
      console.log(colors.red(`    Issue: ${conflict.issue}`));
      console.log(colors.red(`    Current version: ${conflict.currentVersion}\n`));
    });
  } else {
    console.log(colors.green('✅ No dependency conflicts found\n'));
  }

  return !hasConflicts;
}

function checkVersionConsistency() {
  console.log(colors.cyan('🔍 Checking version consistency...\n'));

  const packages = fs.readdirSync(packagesDir).filter(
    name => fs.statSync(path.join(packagesDir, name)).isDirectory()
  );

  const packageVersions = {};
  packages.forEach(packageName => {
    const pkg = getPackageJson(packageName);
    if (pkg) {
      packageVersions[packageName] = pkg.version;
    }
  });

  console.log('Package versions:');
  Object.entries(packageVersions).sort().forEach(([name, version]) => {
    console.log(`  ${colors.green(name)}: ${colors.yellow(version)}`);
  });
  console.log();

  return true;
}

function checkEngineCompatibility() {
  console.log(colors.cyan('🔍 Checking engine compatibility...\n'));

  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const nodeVersion = process.version;
  const requiredNodeVersion = rootPkg.engines?.node;

  if (requiredNodeVersion) {
    console.log(`Node.js version: ${colors.yellow(nodeVersion)}`);
    console.log(`Required: ${colors.green(requiredNodeVersion)}\n`);

    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    const requiredMajor = parseInt(requiredNodeVersion.replace('>=', '').split('.')[0]);

    if (majorVersion >= requiredMajor) {
      console.log(colors.green('✅ Node.js version compatible\n'));
      return true;
    } else {
      console.log(colors.red(`❌ Node.js version incompatible. Required: ${requiredNodeVersion}\n`));
      return false;
    }
  }

  return true;
}

function checkWorkspaceDeps() {
  console.log(colors.cyan('🔍 Checking workspace dependencies...\n'));

  const packages = fs.readdirSync(packagesDir).filter(
    name => fs.statSync(path.join(packagesDir, name)).isDirectory()
  );

  let hasIssues = false;
  const issues = [];

  packages.forEach(packageName => {
    const pkg = getPackageJson(packageName);
    if (!pkg) return;

    const { dependencies = {}, devDependencies = {} } = pkg;
    const allDeps = { ...dependencies, ...devDependencies };

    const workspaceDeps = Object.entries(allDeps).filter(
      ([_, version]) => version === 'workspace:*'
    );

    if (workspaceDeps.length > 0) {
      workspaceDeps.forEach(([depName, depVersion]) => {
        const depPkg = getPackageJson(depName);
        if (!depPkg) {
          issues.push({
            package: packageName,
            dependency: depName,
            issue: 'Workspace dependency not found'
          });
          hasIssues = true;
        }
      });
    }
  });

  if (issues.length > 0) {
    console.log(colors.red('❌ Found workspace dependency issues:\n'));
    issues.forEach(issue => {
      console.log(colors.red(`  - Package: ${issue.package}`));
      console.log(colors.red(`    Dependency: ${issue.dependency}`));
      console.log(colors.red(`    Issue: ${issue.issue}\n`));
    });
  } else {
    console.log(colors.green('✅ All workspace dependencies are valid\n'));
  }

  return !hasIssues;
}

function generateCompatibilityMatrix() {
  console.log(colors.cyan('🔍 Generating compatibility matrix...\n'));

  const packages = fs.readdirSync(packagesDir).filter(
    name => fs.statSync(path.join(packagesDir, name)).isDirectory()
  );

  const matrix = [];
  packages.forEach(packageName => {
    const pkg = getPackageJson(packageName);
    if (!pkg) return;

    const { name, version, dependencies = {}, peerDependencies = {}, engines = {} } = pkg;
    const coreDeps = Object.entries({ ...dependencies, ...peerDependencies })
      .filter(([key]) => key.startsWith('koatty_'))
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

    matrix.push({
      name,
      version,
      engines,
      dependencies: coreDeps
    });
  });

  console.log(colors.bold.cyan('Koatty Package Compatibility Matrix:\n'));

  matrix.sort((a, b) => a.name.localeCompare(b.name)).forEach(pkg => {
    console.log(colors.green(`📦 ${pkg.name}`));
    console.log(`   Version: ${colors.yellow(pkg.version)}`);
    console.log(`   Engines: ${colors.cyan(pkg.engines.node || 'Not specified')}`);

    if (Object.keys(pkg.dependencies).length > 0) {
      console.log('   Koatty Dependencies:');
      Object.entries(pkg.dependencies).forEach(([dep, ver]) => {
        console.log(`     - ${colors.cyan(dep)}: ${ver}`);
      });
    }
    console.log();
  });

  const matrixPath = path.join(rootDir, 'docs', 'COMPATIBILITY_MATRIX.md');
  const matrixContent = generateMarkdownMatrix(matrix);
  
  const docsDir = path.join(rootDir, 'docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  fs.writeFileSync(matrixPath, matrixContent);

  console.log(colors.green(`✅ Compatibility matrix saved to ${matrixPath}\n`));

  return true;
}

function generateMarkdownMatrix(matrix) {
  let content = '# Koatty Compatibility Matrix\n\n';
  content += 'This document shows the compatibility between all Koatty packages.\n\n';
  content += '## Package Versions\n\n';
  content += '| Package | Version | Node.js | Koatty Dependencies |\n';
  content += '|---------|---------|---------|---------------------|\n';

  matrix.sort((a, b) => a.name.localeCompare(b.name)).forEach(pkg => {
    const deps = Object.entries(pkg.dependencies)
      .map(([name, ver]) => `${name}@${ver}`)
      .join(', ') || '-';
    content += `| ${pkg.name} | ${pkg.version} | ${pkg.engines.node || '-'} | ${deps} |\n`;
  });

  content += '\n## Legend\n\n';
  content += '- **workspace:***: Package is part of the monorepo\n';
  content += '- **^x.x.x**: Semantic versioning range\n\n';
  content += '## Note\n\n';
  content += 'This matrix is automatically generated. Do not edit manually.\n';

  return content;
}

/**
 * Assert that every submodule declared in .gitmodules is actually checked out
 * and testable (Phase A / QA-02): each path must contain a package.json with a
 * `test` script, otherwise turbo silently treats the package as "no tasks"
 * and CI passes without running any tests. Exits 1 on the first problem.
 */
function assertSubmodules() {
  console.log(colors.cyan('\n🔍 Asserting submodules are checked out and testable...\n'));

  // documentation-only submodules: no code, intentionally no test script
  const DOCS_ONLY_SUBMODULES = new Set(['packages/koatty-awesome']);

  const gitmodulesPath = path.join(rootDir, '.gitmodules');
  if (!fs.existsSync(gitmodulesPath)) {
    console.log(colors.yellow('⚠️  No .gitmodules found, nothing to assert\n'));
    return true;
  }

  const gitmodules = fs.readFileSync(gitmodulesPath, 'utf8');
  const paths = [];
  for (const match of gitmodules.matchAll(/path\s*=\s*(.+)/g)) {
    paths.push(match[1].trim());
  }

  const problems = [];
  for (const subPath of paths) {
    if (DOCS_ONLY_SUBMODULES.has(subPath)) {
      continue;
    }
    const pkgPath = path.join(rootDir, subPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      problems.push(`${subPath}: package.json missing (submodule not checked out?)`);
      continue;
    }
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch (e) {
      problems.push(`${subPath}: package.json is not valid JSON (${e.message})`);
      continue;
    }
    if (!pkg.scripts || !pkg.scripts.test) {
      problems.push(`${subPath}: package.json has no "test" script (turbo would skip it)`);
    }
  }

  if (problems.length > 0) {
    console.log(colors.red('❌ Submodule assertion failed:\n'));
    problems.forEach((problem) => {
      console.log(colors.red(`  - ${problem}`));
    });
    console.log();
    return false;
  }

  console.log(colors.green(`✅ All ${paths.length} submodules are checked out and have a test script\n`));
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const assertOnly = args.includes('--assert-submodules');

  console.log(colors.bold.cyan('\n🩺 Koatty Doctor - Health Check Tool\n'));
  console.log(colors.gray('='.repeat(50)) + '\n');

  // standalone CI gate: verify submodules only, exit non-zero on failure
  if (assertOnly) {
    const ok = assertSubmodules();
    process.exit(ok ? 0 : 1);
  }

  const checks = [
    checkEngineCompatibility,
    checkVersionConsistency,
    checkWorkspaceDeps,
    checkDependencyConflicts,
    generateCompatibilityMatrix
  ];

  const results = [];
  for (const check of checks) {
    try {
      const result = await check();
      results.push(result);
    } catch (error) {
      console.error(colors.red(`❌ Error running check: ${error.message}\n`));
      results.push(false);
    }
  }

  console.log(colors.bold.cyan('\n' + '='.repeat(50)));
  console.log(colors.bold.cyan('📊 Summary\n'));

  const passed = results.filter(r => r).length;
  const total = results.length;

  if (passed === total) {
    console.log(colors.green(`\n✅ All checks passed! (${passed}/${total})\n`));
    process.exit(0);
  } else {
    console.log(colors.yellow(`\n⚠️  Some checks failed. Passed: ${passed}/${total}\n`));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  checkDependencyConflicts,
  checkVersionConsistency,
  checkEngineCompatibility,
  checkWorkspaceDeps,
  generateCompatibilityMatrix,
  assertSubmodules
};
