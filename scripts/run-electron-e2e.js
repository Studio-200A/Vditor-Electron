const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const electronDistPath = path.join(projectRoot, 'node_modules', 'electron', 'dist');

if (
  process.platform === 'linux' &&
  !process.env.ELECTRON_OVERRIDE_DIST_PATH &&
  fs.existsSync(path.join(electronDistPath, 'electron'))
) {
  process.env.ELECTRON_OVERRIDE_DIST_PATH = electronDistPath;
  console.log(`Using local Electron runtime: ${electronDistPath}`);
}

const result = spawnSync(
  process.execPath,
  [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
