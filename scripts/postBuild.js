#!/usr/bin/env node
/**
 * Shared postBuild script for all koatty packages.
 * 
 * Usage: node ../../scripts/postBuild.js [options]
 * 
 * This script:
 * 1. Copies package.json, LICENSE, README.md to dist/
 * 2. Fixes paths in dist/package.json (removes ./dist/ prefix)
 * 3. Cleans private/protected declarations from index.d.ts
 * 4. Adds copyright header to index.d.ts
 */
const fs = require('fs');
const path = require('path');

// Get the package directory (caller's cwd)
const PACKAGE_DIR = process.cwd();
const DIST_DIR = path.join(PACKAGE_DIR, 'dist');

// ───── 1. Copy files to dist/ ─────
function copyFilesToDist() {
  const filesToCopy = ['package.json', 'LICENSE', 'README.md'];
  
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }
  
  for (const file of filesToCopy) {
    const src = path.join(PACKAGE_DIR, file);
    const dest = path.join(DIST_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`  ✓ Copied ${file} to dist/`);
    }
  }
}

// ───── 2. Fix dist/package.json paths ─────
function fixDistPackageJson() {
  const distPkgPath = path.join(DIST_DIR, 'package.json');
  if (!fs.existsSync(distPkgPath)) return;
  
  const pkg = JSON.parse(fs.readFileSync(distPkgPath, 'utf-8'));
  let changed = false;
  
  // Fix main
  if (pkg.main && pkg.main.startsWith('./dist/')) {
    pkg.main = pkg.main.replace('./dist/', './');
    changed = true;
  }
  
  // Fix types
  if (pkg.types && pkg.types.startsWith('./dist/')) {
    pkg.types = pkg.types.replace('./dist/', './');
    changed = true;
  }
  
  // Add types if missing
  if (!pkg.types && pkg.main) {
    pkg.types = pkg.main.replace(/\.js$/, '.d.ts');
    changed = true;
  }
  
  // Fix exports
  if (pkg.exports) {
    for (const key of Object.keys(pkg.exports)) {
      if (typeof pkg.exports[key] === 'string' && pkg.exports[key].startsWith('./dist/')) {
        pkg.exports[key] = pkg.exports[key].replace('./dist/', './');
        changed = true;
      }
    }
  }
  
  if (changed) {
    fs.writeFileSync(distPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log('  ✓ Fixed paths in dist/package.json');
  }
}

// ───── 3. Clean DTS & add copyright ─────
function cleanDts() {
  const dtsPath = path.join(DIST_DIR, 'index.d.ts');
  if (!fs.existsSync(dtsPath)) return;
  
  let content = fs.readFileSync(dtsPath, 'utf-8');
  content = content.replace(/\s+(private|protected).+;/g, '');
  
  // Add copyright header
  const copyright = getCopyright();
  content = copyright + '\n' + content;
  
  fs.writeFileSync(dtsPath, content, 'utf-8');
  console.log('  ✓ Cleaned DTS declarations');
}

function getCopyright() {
  const now = new Date();
  const y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `/*!
* @Author: richen
* @Date: ${y}-${M}-${d} ${h}:${m}:${s}
* @License: BSD (3-Clause)
* @Copyright (c) - <richenlin(at)gmail.com>
* @HomePage: https://koatty.org/
*/`;
}

// ───── Run ─────
const pkgName = path.basename(PACKAGE_DIR);
console.log(`📦 postBuild: ${pkgName}`);
copyFilesToDist();
fixDistPackageJson();
cleanDts();
console.log(`  ✅ Done\n`);
