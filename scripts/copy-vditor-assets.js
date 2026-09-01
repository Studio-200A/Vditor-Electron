const fs = require('fs');
const path = require('path');

const VditorSrc = path.join(__dirname, '..', 'node_modules', 'vditor', 'dist');
const LUCIDE_STATIC_ICONS_DIR = path.join(
  __dirname,
  '..',
  'node_modules',
  'lucide-static',
  'icons',
);
const DestDir = path.join(__dirname, '..', 'static', 'dist');
const RendererSrc = path.join(__dirname, '..', 'src', 'renderer');
const RendererDest = path.join(__dirname, '..', 'dist', 'renderer');
const LUCIDE_ICON_ASSETS = [
  ['moon.svg', 'dark-symbolic.svg'],
  ['sun.svg', 'light-symbolic.svg'],
  ['rotate-cw.svg', 'refresh.svg'],
  ['info.svg', 'settings-about.svg'],
  ['palette.svg', 'settings-appearance.svg'],
  ['square-text.svg', 'settings-editor.svg'],
  ['folder.svg', 'settings-files.svg'],
  ['type.svg', 'settings-fonts.svg'],
  ['eye.svg', 'settings-preview.svg'],
  ['settings.svg', 'settings.svg'],
  ['monitor.svg', 'system-symbolic.svg'],
  ['file-plus-corner.svg', 'titlebar-new.svg'],
  ['folder-open.svg', 'titlebar-open.svg'],
  ['save.svg', 'titlebar-save.svg'],
  ['panel-left.svg', 'titlebar-sidebar.svg'],
  ['replace.svg', 'replace.svg'],
  ['replace-all.svg', 'replace-all.svg'],
  ['file.svg', 'tree-file.svg'],
  ['folder.svg', 'tree-folder.svg'],
  ['folder-symlink.svg', 'tree-folder-symlink.svg'],
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  console.log(`  Copied: ${path.basename(src)}`);
}

function copyLucideIconAssets() {
  if (!fs.existsSync(LUCIDE_STATIC_ICONS_DIR)) {
    console.error(`ERROR: lucide-static icons not found at ${LUCIDE_STATIC_ICONS_DIR}`);
    console.error('Run "npm install" first to install lucide-static.');
    process.exit(1);
  }

  console.log('Copying Lucide icon assets...');
  const symbolicDest = path.join(RendererDest, 'assets', 'symbolic');
  fs.rmSync(symbolicDest, { force: true, recursive: true });
  for (const [sourceName, destinationName] of LUCIDE_ICON_ASSETS) {
    copyFile(
      path.join(LUCIDE_STATIC_ICONS_DIR, sourceName),
      path.join(symbolicDest, destinationName),
    );
  }
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
copyLucideIconAssets();
console.log('Renderer assets copied successfully.');
