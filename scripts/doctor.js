#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const colors = {
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
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
  console.log(chalk.cyan('\n🔍 Checking dependency conflicts...\n'));

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
    console.log(chalk.red('❌ Found dependency conflicts:\n'));
    conflicts.forEach(conflict => {
      console.log(chalk.red(`  - Package: ${conflict.package}`));
      console.log(chalk.red(`    Dependency: ${conflict.dependency}`));
      console.log(chalk.red(`    Issue: ${conflict.issue}`));
      console.log(chalk.red(`    Current version: ${conflict.currentVersion}\n`));
    });
  } else {
    console.log(chalk.green('✅ No dependency conflicts found\n'));
  }

  return !hasConflicts;
}

function checkVersionConsistency() {
  console.log(chalk.cyan('🔍 Checking version consistency...\n'));

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
    console.log(`  ${chalk.green(name)}: ${chalk.yellow(version)}`);
  });
  console.log();

  return true;
}

function checkEngineCompatibility() {
  console.log(chalk.cyan('🔍 Checking engine compatibility...\n'));

  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const nodeVersion = process.version;
  const requiredNodeVersion = rootPkg.engines?.node;

  if (requiredNodeVersion) {
    console.log(`Node.js version: ${chalk.yellow(nodeVersion)}`);
    console.log(`Required: ${chalk.green(requiredNodeVersion)}\n`);

    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    const requiredMajor = parseInt(requiredNodeVersion.replace('>=', '').split('.')[0]);

    if (majorVersion >= requiredMajor) {
      console.log(chalk.green('✅ Node.js version compatible\n'));
      return true;
    } else {
      console.log(chalk.red(`❌ Node.js version incompatible. Required: ${requiredNodeVersion}\n`));
      return false;
    }
  }

  return true;
}

function checkWorkspaceDeps() {
  console.log(chalk.cyan('🔍 Checking workspace dependencies...\n'));

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
    console.log(chalk.red('❌ Found workspace dependency issues:\n'));
    issues.forEach(issue => {
      console.log(chalk.red(`  - Package: ${issue.package}`));
      console.log(chalk.red(`    Dependency: ${issue.dependency}`));
      console.log(chalk.red(`    Issue: ${issue.issue}\n`));
    });
  } else {
    console.log(chalk.green('✅ All workspace dependencies are valid\n'));
  }

  return !hasIssues;
}

function generateCompatibilityMatrix() {
  console.log(chalk.cyan('🔍 Generating compatibility matrix...\n'));

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

  console.log(chalk.bold('Koatty Package Compatibility Matrix:\n'));

  matrix.sort((a, b) => a.name.localeCompare(b.name)).forEach(pkg => {
    console.log(chalk.green(`📦 ${pkg.name}`));
    console.log(`   Version: ${chalk.yellow(pkg.version)}`);
    console.log(`   Engines: ${chalk.cyan(pkg.engines.node || 'Not specified')}`);

    if (Object.keys(pkg.dependencies).length > 0) {
      console.log('   Koatty Dependencies:');
      Object.entries(pkg.dependencies).forEach(([dep, ver]) => {
        console.log(`     - ${chalk.cyan(dep)}: ${ver}`);
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

  console.log(chalk.green(`✅ Compatibility matrix saved to ${matrixPath}\n`));

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

async function main() {
  console.log(chalk.bold.cyan('\n🩺 Koatty Doctor - Health Check Tool\n'));
  console.log(chalk.gray('='.repeat(50)) + '\n');

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
      console.error(chalk.red(`❌ Error running check: ${error.message}\n`));
      results.push(false);
    }
  }

  console.log(chalk.bold.cyan('\n' + '='.repeat(50)));
  console.log(chalk.bold.cyan('📊 Summary\n'));

  const passed = results.filter(r => r).length;
  const total = results.length;

  if (passed === total) {
    console.log(chalk.green(`\n✅ All checks passed! (${passed}/${total})\n`));
    process.exit(0);
  } else {
    console.log(chalk.yellow(`\n⚠️  Some checks failed. Passed: ${passed}/${total}\n`));
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
  generateCompatibilityMatrix
};
