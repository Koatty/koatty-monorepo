#!/usr/bin/env node

/**
 * 自动提交 changeset version 后的版本变更
 * 
 * 使用方式：
 *   node scripts/commit-version-changes.js
 *   node scripts/commit-version-changes.js --message "custom message"
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

/**
 * 检查是否有未提交的变更
 */
function hasChanges() {
  try {
    const status = execSync('git status --porcelain', {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return status.trim().length > 0;
  } catch (error) {
    console.error('❌ Error checking git status:', error.message);
    return false;
  }
}

/**
 * 获取变更的文件列表
 */
function getChangedFiles() {
  try {
    const status = execSync('git status --porcelain', {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    
    const files = status
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.substring(3).trim())
      .filter(file => {
        // 只关注 package.json 和 CHANGELOG.md 的变更
        return file.endsWith('package.json') || 
               file.endsWith('CHANGELOG.md') ||
               file.startsWith('.changeset/');
      });
    
    return files;
  } catch (error) {
    console.error('❌ Error getting changed files:', error.message);
    return [];
  }
}

/**
 * 生成 commit message
 */
function generateCommitMessage(changedFiles) {
  const packageJsonFiles = changedFiles.filter(f => f.endsWith('package.json'));
  const changelogFiles = changedFiles.filter(f => f.endsWith('CHANGELOG.md'));
  
  const packages = packageJsonFiles
    .map(file => {
      // 提取包名
      const match = file.match(/packages\/([^\/]+)\/package\.json/);
      return match ? match[1] : null;
    })
    .filter(Boolean);
  
  if (packages.length === 0) {
    return 'chore: version packages';
  } else if (packages.length === 1) {
    return `chore: version ${packages[0]}`;
  } else if (packages.length <= 3) {
    return `chore: version ${packages.join(', ')}`;
  } else {
    return `chore: version ${packages.length} packages`;
  }
}

/**
 * 主函数
 */
function main() {
  console.log('🔍 Checking for version changes...\n');
  
  // 检查是否有变更
  if (!hasChanges()) {
    console.log('✓ No changes to commit');
    return;
  }
  
  // 获取变更的文件
  const changedFiles = getChangedFiles();
  
  if (changedFiles.length === 0) {
    console.log('✓ No version-related changes to commit');
    console.log('  (Only non-version files were changed)');
    return;
  }
  
  console.log('📝 Found version changes:');
  changedFiles.forEach(file => {
    console.log(`   - ${file}`);
  });
  console.log();
  
  // 生成 commit message
  const customMessage = process.argv.find(arg => arg.startsWith('--message='));
  const commitMessage = customMessage 
    ? customMessage.split('=')[1]
    : generateCommitMessage(changedFiles);
  
  try {
    // 添加所有变更的文件
    console.log('📦 Staging changes...');
    execSync('git add .', {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit'
    });
    
    // 提交
    console.log(`💾 Committing: "${commitMessage}"`);
    execSync(`git commit -m "${commitMessage}"`, {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit'
    });
    
    console.log('\n✅ Successfully committed version changes');
    console.log(`\n💡 Next steps:`);
    console.log(`   git push origin master`);
    console.log(`   pnpm release`);
    
  } catch (error) {
    if (error.status === 0) {
      // Git 命令成功，但可能没有变更需要提交
      console.log('✓ No changes to commit (already committed or no changes)');
    } else {
      console.error('\n❌ Error committing changes:', error.message);
      process.exit(1);
    }
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

module.exports = { hasChanges, getChangedFiles, generateCommitMessage };
