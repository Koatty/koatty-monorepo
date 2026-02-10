#!/usr/bin/env node

/**
 * 自动提交所有 submodule 的版本变更，然后提交 monorepo
 * 
 * 解决的问题：
 *   pnpm release (changeset version + publish) 会修改每个 submodule 的
 *   package.json 和 CHANGELOG.md，但因为每个 package 都是独立的 git submodule，
 *   需要先在每个 submodule 内 commit + push，最后才能在 monorepo 层面完整提交。
 * 
 * 使用方式：
 *   node scripts/commit-submodule-changes.js              # commit + push 所有变更的 submodule
 *   node scripts/commit-submodule-changes.js --no-push    # 只 commit，不 push
 *   node scripts/commit-submodule-changes.js --dry-run    # 只检查，不执行
 *   node scripts/commit-submodule-changes.js --message "custom message"
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// 解析命令行参数
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_PUSH = args.includes('--no-push');
const messageArg = args.find(a => a.startsWith('--message='));
const CUSTOM_MESSAGE = messageArg ? messageArg.split('=').slice(1).join('=') : null;

/**
 * 在指定目录执行 git 命令
 */
function git(command, cwd, opts = {}) {
  try {
    return execSync(`git ${command}`, {
      cwd,
      encoding: 'utf8',
      stdio: opts.inherit ? 'inherit' : 'pipe',
      ...opts,
    });
  } catch (error) {
    if (opts.ignoreError) return '';
    throw error;
  }
}

/**
 * 检查目录是否有未提交的变更
 */
function hasChanges(cwd) {
  const status = git('status --porcelain', cwd).trim();
  return status.length > 0;
}

/**
 * 获取变更文件列表
 */
function getChangedFiles(cwd) {
  return git('status --porcelain', cwd)
    .trim()
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      // git status --porcelain format: XY filename (XY are 2 status chars, then a space)
      const status = line.substring(0, 2);
      const file = line.substring(3);
      return { status: status.trim(), file: file.trim() };
    });
}

/**
 * 获取包的版本号（从 package.json 读取）
 */
function getPackageVersion(pkgDir) {
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).version;
  } catch {
    return null;
  }
}

/**
 * 获取包名（从 package.json 读取）
 */
function getPackageName(pkgDir) {
  const pkgJsonPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return path.basename(pkgDir);
  try {
    return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')).name || path.basename(pkgDir);
  } catch {
    return path.basename(pkgDir);
  }
}

/**
 * 检查目录是否是一个 git 仓库（submodule）
 */
function isGitRepo(dir) {
  const gitDir = path.join(dir, '.git');
  return fs.existsSync(gitDir);
}

/**
 * 获取当前分支名
 */
function getCurrentBranch(cwd) {
  try {
    return git('rev-parse --abbrev-ref HEAD', cwd).trim();
  } catch {
    return 'main';
  }
}

/**
 * 判断变更是否是版本相关的（package.json / CHANGELOG.md）
 */
function isVersionChange(file) {
  return file.endsWith('package.json') || file.endsWith('CHANGELOG.md');
}

/**
 * 生成 submodule 的 commit message
 */
function generateSubmoduleMessage(pkgName, version, changedFiles) {
  const hasChangelog = changedFiles.some(f => f.file.endsWith('CHANGELOG.md'));
  const hasPackageJson = changedFiles.some(f => f.file.endsWith('package.json'));

  if (version && hasChangelog) {
    return `chore(release): v${version}`;
  } else if (hasPackageJson) {
    return `chore: update package.json`;
  } else {
    return `chore: update ${pkgName}`;
  }
}

// ────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────
function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Submodule Auto-Commit & Push                  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 [DRY RUN] 只检查变更，不执行任何操作\n');
  }

  // ── Step 1: 扫描所有 submodule ──
  const packagesDir = path.join(WORKSPACE_ROOT, 'packages');
  const submoduleDirs = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(packagesDir, d.name))
    .filter(dir => isGitRepo(dir));

  console.log(`📦 发现 ${submoduleDirs.length} 个 submodule\n`);

  // ── Step 2: 检查并处理每个有变更的 submodule ──
  const results = { committed: [], skipped: [], failed: [] };

  for (const dir of submoduleDirs) {
    const dirName = path.basename(dir);
    const pkgName = getPackageName(dir);
    const version = getPackageVersion(dir);

    if (!hasChanges(dir)) {
      results.skipped.push(dirName);
      continue;
    }

    const changedFiles = getChangedFiles(dir);
    const versionFiles = changedFiles.filter(f => isVersionChange(f.file));
    const otherFiles = changedFiles.filter(f => !isVersionChange(f.file));

    console.log(`┌─ ${pkgName} (${dirName})`);
    console.log(`│  版本: ${version || 'unknown'}`);
    console.log(`│  变更文件:`);
    changedFiles.forEach(f => {
      const icon = isVersionChange(f.file) ? '📝' : '📄';
      console.log(`│    ${icon} [${f.status}] ${f.file}`);
    });

    if (DRY_RUN) {
      console.log(`│  ⏭️  [DRY RUN] 跳过提交`);
      console.log(`└─\n`);
      results.committed.push(dirName); // 计为"将要提交"
      continue;
    }

    try {
      const branch = getCurrentBranch(dir);
      const commitMsg = CUSTOM_MESSAGE || generateSubmoduleMessage(pkgName, version, changedFiles);

      // git add all changes
      git('add -A', dir);

      // git commit
      git(`commit -m "${commitMsg}"`, dir, { inherit: false });
      console.log(`│  ✅ 已提交: "${commitMsg}"`);

      // git push (unless --no-push)
      if (!NO_PUSH) {
        try {
          git(`push origin ${branch}`, dir, { inherit: false });
          console.log(`│  🚀 已推送到 origin/${branch}`);
        } catch (pushErr) {
          console.log(`│  ⚠️  推送失败 (可稍后手动推送): ${pushErr.message?.split('\n')[0]}`);
        }
      } else {
        console.log(`│  ⏸️  跳过推送 (--no-push)`);
      }

      results.committed.push(dirName);
    } catch (error) {
      console.log(`│  ❌ 提交失败: ${error.message?.split('\n')[0]}`);
      results.failed.push(dirName);
    }

    console.log(`└─\n`);
  }

  // ── Step 3: 提交 monorepo 层面的变更 ──
  console.log('─'.repeat(50));
  console.log('📋 处理 monorepo 根目录...\n');

  if (hasChanges(WORKSPACE_ROOT)) {
    const changedFiles = getChangedFiles(WORKSPACE_ROOT);
    console.log('  变更文件:');
    changedFiles.forEach(f => {
      console.log(`    [${f.status}] ${f.file}`);
    });

    if (!DRY_RUN) {
      try {
        // Submodule 指针变更 + 根目录的 package.json 等
        git('add -A', WORKSPACE_ROOT);

        const monoMessage = CUSTOM_MESSAGE || `chore(release): publish ${results.committed.length} packages`;
        git(`commit -m "${monoMessage}"`, WORKSPACE_ROOT, { inherit: false });
        console.log(`  ✅ 已提交 monorepo: "${monoMessage}"`);

        if (!NO_PUSH) {
          const branch = getCurrentBranch(WORKSPACE_ROOT);
          try {
            git(`push origin ${branch}`, WORKSPACE_ROOT, { inherit: false });
            console.log(`  🚀 已推送到 origin/${branch}`);
          } catch (pushErr) {
            console.log(`  ⚠️  推送失败 (可稍后手动推送): ${pushErr.message?.split('\n')[0]}`);
          }
        }
      } catch (error) {
        console.log(`  ❌ 提交失败: ${error.message?.split('\n')[0]}`);
        results.failed.push('monorepo-root');
      }
    } else {
      console.log('  ⏭️  [DRY RUN] 跳过提交');
    }
  } else {
    console.log('  ✓ monorepo 根目录无变更');
  }

  // ── Summary ──
  console.log('\n' + '═'.repeat(50));
  console.log('📊 执行结果:');
  console.log(`   ✅ 已提交: ${results.committed.length} 个 submodule`);
  if (results.committed.length > 0) {
    console.log(`      ${results.committed.join(', ')}`);
  }
  console.log(`   ⏭️  无变更: ${results.skipped.length} 个 submodule`);
  if (results.failed.length > 0) {
    console.log(`   ❌ 失败: ${results.failed.length} 个`);
    console.log(`      ${results.failed.join(', ')}`);
  }
  console.log('═'.repeat(50));

  if (results.failed.length > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
