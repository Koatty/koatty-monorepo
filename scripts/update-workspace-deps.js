#!/usr/bin/env node
/**
 * Update all koatty packages to use workspace:* protocol
 */

const fs = require('fs');
const path = require('path');

// List of koatty packages that should use workspace protocol
const koattyPackages = [
  'koatty_config',
  'koatty_container',
  'koatty_core',
  'koatty_exception',
  'koatty_lib',
  'koatty_loader',
  'koatty_logger',
  'koatty_router',
  'koatty_serve',
  'koatty_trace',
  'koatty_proto',
  'koatty_validation',
  'koatty_graphql',
  'koatty_store',
  'koatty_cacheable',
  'koatty_doc'
];

// Find all package.json files in packages/ directory
const packagesDir = path.join(__dirname, '..', 'packages');
const packageDirs = fs.readdirSync(packagesDir).filter(dir => {
  const stat = fs.statSync(path.join(packagesDir, dir));
  return stat.isDirectory();
});

const packageFiles = packageDirs.map(dir => 
  path.join(packagesDir, dir, 'package.json')
).filter(file => fs.existsSync(file));

console.log(`Found ${packageFiles.length} packages to update\n`);

let totalUpdated = 0;

packageFiles.forEach(file => {
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  let updated = false;
  
  // Update dependencies
  if (pkg.dependencies) {
    koattyPackages.forEach(koattyPkg => {
      if (pkg.dependencies[koattyPkg] && !pkg.dependencies[koattyPkg].startsWith('workspace:')) {
        console.log(`${pkg.name}: ${koattyPkg} ${pkg.dependencies[koattyPkg]} -> workspace:*`);
        pkg.dependencies[koattyPkg] = 'workspace:*';
        updated = true;
      }
    });
  }
  
  // Update devDependencies  
  if (pkg.devDependencies) {
    koattyPackages.forEach(koattyPkg => {
      if (pkg.devDependencies[koattyPkg] && !pkg.devDependencies[koattyPkg].startsWith('workspace:')) {
        console.log(`${pkg.name} (dev): ${koattyPkg} ${pkg.devDependencies[koattyPkg]} -> workspace:*`);
        pkg.devDependencies[koattyPkg] = 'workspace:*';
        updated = true;
      }
    });
  }
  
  if (updated) {
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
    totalUpdated++;
  }
});

console.log(`\n✅ Updated ${totalUpdated} packages`);
console.log('\n📦 Run "pnpm install --no-frozen-lockfile" to apply changes');
