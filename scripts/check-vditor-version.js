const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const packageMetadata = readJson(path.join(root, 'package.json'));
const lockMetadata = readJson(path.join(root, 'package-lock.json'));
const installedMetadata = readJson(path.join(root, 'node_modules', 'vditor', 'package.json'));
const declared = packageMetadata.dependencies.vditor;
const locked = lockMetadata.packages['node_modules/vditor'].version;
const lockRoot = lockMetadata.packages[''].dependencies.vditor;

const failures = [];
if (!/^\d+\.\d+\.\d+$/.test(declared))
  failures.push(`package.json must pin Vditor exactly: ${declared}`);
if (lockRoot !== declared)
  failures.push(`package-lock root declares ${lockRoot}, expected ${declared}`);
if (locked !== declared) failures.push(`package-lock resolves ${locked}, expected ${declared}`);
if (installedMetadata.version !== declared)
  failures.push(`node_modules contains ${installedMetadata.version}, expected ${declared}`);

const mainSource = fs.readFileSync(path.join(root, 'src', 'main', 'index.ts'), 'utf8');
if (!mainSource.includes(`vditor: '${declared}'`))
  failures.push('app:getInfo Vditor version does not match package.json');

if (failures.length) {
  failures.forEach((failure) => console.error(`Vditor version check failed: ${failure}`));
  process.exit(1);
}

console.log(`Vditor integration is pinned consistently at ${declared}.`);
