const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

const packageMetadata = readJson(path.join(projectRoot, 'package.json'));
const lockMetadata = readJson(path.join(projectRoot, 'package-lock.json'));
const lockRoot = lockMetadata.packages?.[''];
const failures = [];
const version = packageMetadata.version;
const productName = packageMetadata.productName;
const applicationId = packageMetadata.desktopName;
const electronVersion = packageMetadata.devDependencies?.electron;

function expectEqual(label, actual, expected) {
  if (actual !== expected) failures.push(`${label} is ${actual}, expected ${expected}`);
}

expectEqual('package-lock.json version', lockMetadata.version, version);
expectEqual('package-lock root version', lockRoot?.version, version);
expectEqual('electron-builder productName', packageMetadata.build?.productName, productName);
expectEqual('electron-builder appId', packageMetadata.build?.appId, applicationId);
expectEqual(
  'package-lock root electron declaration',
  lockRoot?.devDependencies?.electron,
  electronVersion,
);
expectEqual(
  'locked Electron version',
  lockMetadata.packages?.['node_modules/electron']?.version,
  electronVersion,
);
expectEqual(
  'package-lock root Node.js engine',
  lockRoot?.engines?.node,
  packageMetadata.engines?.node,
);

if (!/^\d+\.\d+\.\d+$/.test(electronVersion || '')) {
  failures.push(`Electron must be exact-pinned in package.json: ${electronVersion}`);
}

const allowedElectronScript = `electron@${electronVersion}`;
if (packageMetadata.allowScripts?.[allowedElectronScript] !== true) {
  failures.push(`allowScripts must allow ${allowedElectronScript}`);
}
for (const key of Object.keys(packageMetadata.allowScripts || {})) {
  if (key.startsWith('electron@') && key !== allowedElectronScript) {
    failures.push(`allowScripts contains stale Electron entry: ${key}`);
  }
}

const appPathsSource = readText(path.join(projectRoot, 'src', 'main', 'app-paths.ts'));
if (!appPathsSource.includes(`export const APP_IDENTIFIER = '${applicationId}';`)) {
  failures.push('src/main/app-paths.ts does not use package.json desktopName');
}

const desktopSource = readText(
  path.join(projectRoot, 'resources', 'linux', 'vditor-desktop.desktop.in'),
);
if (!desktopSource.includes(`Name=${productName}\n`)) {
  failures.push('Linux desktop template name does not match package.json productName');
}
if (!desktopSource.includes(`StartupWMClass=${applicationId}\n`)) {
  failures.push('Linux desktop template StartupWMClass does not match package.json desktopName');
}

const metainfoSource = readText(
  path.join(projectRoot, 'resources', 'linux', 'vditor-desktop.metainfo.xml'),
);
if (!metainfoSource.includes(`<id>${applicationId}</id>`)) {
  failures.push('AppStream metadata id does not match package.json desktopName');
}
if (!metainfoSource.includes(`<name>${productName}</name>`)) {
  failures.push('AppStream metadata name does not match package.json productName');
}
if (
  !metainfoSource.includes(`<launchable type="desktop-id">${applicationId}.desktop</launchable>`)
) {
  failures.push('AppStream launchable desktop id does not match package.json desktopName');
}

const releaseSource = readText(path.join(projectRoot, 'scripts', 'release-linux.js'));
if (!releaseSource.includes('const appImageDesktopBaseName = packageMetadata.desktopName;')) {
  failures.push('Linux release script does not derive AppImage metadata name from package.json');
}
if (!/const appImageToolVersion = '[^']+';/.test(releaseSource)) {
  failures.push('Linux release script is missing the pinned AppImage tool version');
}
if (!/const appImageToolChecksum = '[a-f0-9]{64}';/.test(releaseSource)) {
  failures.push('Linux release script is missing the AppImage tool SHA-256');
}
if (!/const appImageRuntimeChecksum = '[a-f0-9]{64}';/.test(releaseSource)) {
  failures.push('Linux release script is missing the AppImage runtime SHA-256');
}

const rendererSource = readText(path.join(projectRoot, 'src', 'renderer', 'index.html'));
if (!rendererSource.includes(`id="statusVersion">v${version}</span>`)) {
  failures.push('renderer fallback version does not match package.json version');
}

for (const readmeName of ['README.md', 'README_CN.md']) {
  const readmeSource = readText(path.join(projectRoot, readmeName));
  if (!readmeSource.includes(`version-${version}-blue`)) {
    failures.push(`${readmeName} version badge does not match package.json version`);
  }
}

const npmrcSource = readText(path.join(projectRoot, '.npmrc')).trim();
if (npmrcSource !== 'engine-strict=true') {
  failures.push('.npmrc must enforce engine-strict=true for reproducible installs');
}

if (failures.length) {
  for (const failure of failures) console.error(`Project metadata check failed: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Project metadata is consistent for ${productName} ${version} (${applicationId}).`);
}
