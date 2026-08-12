const fs = require('fs');
const path = require('path');

const VditorSrc = path.join(__dirname, '..', 'node_modules', 'vditor', 'dist');
const DestDir = path.join(__dirname, '..', 'static', 'dist');
const RendererSrc = path.join(__dirname, '..', 'src', 'renderer');
const RendererDest = path.join(__dirname, '..', 'dist', 'renderer');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log(`  Copied: ${path.basename(src)}`);
}

console.log('Copying Vditor assets...\n');

if (!fs.existsSync(VditorSrc)) {
  console.error(`ERROR: Vditor dist not found at ${VditorSrc}`);
  console.error('Run "npm install" first to install vditor.');
  process.exit(1);
}

ensureDir(DestDir);

copyFile(path.join(VditorSrc, 'index.min.js'), path.join(DestDir, 'index.min.js'));

copyFile(path.join(VditorSrc, 'index.css'), path.join(DestDir, 'index.css'));

if (fs.existsSync(path.join(VditorSrc, 'method.min.js'))) {
  copyFile(path.join(VditorSrc, 'method.min.js'), path.join(DestDir, 'method.min.js'));
}

if (fs.existsSync(path.join(VditorSrc, 'css'))) {
  console.log('  Copying css/...');
  copyDir(path.join(VditorSrc, 'css'), path.join(DestDir, 'css'));
}

if (fs.existsSync(path.join(VditorSrc, 'js'))) {
  console.log('  Copying js/...');
  copyDir(path.join(VditorSrc, 'js'), path.join(DestDir, 'js'));
}

if (fs.existsSync(path.join(VditorSrc, 'images'))) {
  console.log('  Copying images/...');
  copyDir(path.join(VditorSrc, 'images'), path.join(DestDir, 'images'));
}

console.log('\nVditor assets copied successfully.');
console.log('Copying renderer assets...');
copyDir(RendererSrc, RendererDest);
console.log('Renderer assets copied successfully.');
