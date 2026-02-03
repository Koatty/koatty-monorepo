const fs = require('fs');
const path = require('path');

const filesToCopy = [
  'package.json',
  'LICENSE',
  'README.md'
];

const distDir = path.resolve(__dirname, '../dist');
const projectRoot = path.resolve(__dirname, '..');

console.log('Copying files to dist directory...');

filesToCopy.forEach(file => {
  const src = path.join(projectRoot, file);
  const dest = path.join(distDir, file);
  
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✓ Copied ${file}`);
  } else {
    console.warn(`⚠️  Source file not found: ${src}`);
  }
});

console.log('✅ File copy completed');
