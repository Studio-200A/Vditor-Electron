const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const packageMetadata = require(path.join(projectRoot, 'package.json'));
const version = packageMetadata.version;
const mode = process.argv[2] || 'all';
const releaseDir = path.join(projectRoot, 'release');
const unpackedDir = path.join(releaseDir, 'linux-unpacked');
const stagingDir = path.join(releaseDir, '.linux-release-staging');
const resourcesDir = path.join(projectRoot, 'resources', 'linux');
const iconSource = path.join(
  projectRoot,
  'src',
  'renderer',
  'assets',
  'app-icon',
  'vditor-desktop.svg',
);
const appImageToolVersion = '1.9.1';
const appImageToolChecksum = 'ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0';
const appImageToolUrl = `https://github.com/AppImage/appimagetool/releases/download/${appImageToolVersion}/appimagetool-x86_64.AppImage`;
const appImageToolPath = path.join(
  projectRoot,
  '.cache',
  'appimage-tools',
  `appimagetool-${appImageToolVersion}-x86_64.AppImage`,
);
const appImageRuntimeChecksum = '1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf';
const appImageRuntimeUrl =
  'https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64';
const appImageRuntimePath = path.join(
  projectRoot,
  '.cache',
  'appimage-tools',
  `runtime-x86_64-${appImageRuntimeChecksum.slice(0, 12)}`,
);

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) fail(`${command} could not be started: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with status ${result.status}`);
}

function remove(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDirectory(source, destination) {
  fs.cpSync(source, destination, { recursive: true, dereference: false });
}

function renderDesktop(exec, icon) {
  return fs
    .readFileSync(path.join(resourcesDir, 'vditor-desktop.desktop.in'), 'utf8')
    .replace('@EXEC@', exec)
    .replace('@ICON@', icon);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function download(url, destination, redirects = 0) {
  if (redirects > 8) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'User-Agent': 'Vditor-Desktop-release' } },
      (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          const next = new URL(response.headers.location, url).href;
          download(next, destination, redirects + 1).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const temporary = `${destination}.download`;
        const output = fs.createWriteStream(temporary, { mode: 0o755 });
        response.pipe(output);
        output.on('finish', () => {
          output.close(() => {
            fs.renameSync(temporary, destination);
            resolve();
          });
        });
        output.on('error', reject);
      },
    );
    request.on('error', reject);
  });
}

async function ensureAppImageTool() {
  const override = process.env.APPIMAGETOOL;
  const tool = override ? path.resolve(override) : appImageToolPath;
  if (!fs.existsSync(tool)) {
    if (override) fail(`APPIMAGETOOL does not exist: ${tool}`);
    console.log(`Downloading appimagetool ${appImageToolVersion}...`);
    await download(appImageToolUrl, tool);
  }
  if (!override && sha256(tool) !== appImageToolChecksum) {
    remove(tool);
    fail('appimagetool SHA-256 verification failed');
  }
  fs.chmodSync(tool, 0o755);
  return tool;
}

async function ensureAppImageRuntime() {
  if (!fs.existsSync(appImageRuntimePath)) {
    console.log('Downloading pinned AppImage x86_64 runtime...');
    await download(appImageRuntimeUrl, appImageRuntimePath);
  }
  if (sha256(appImageRuntimePath) !== appImageRuntimeChecksum) {
    remove(appImageRuntimePath);
    fail('AppImage runtime SHA-256 verification failed');
  }
  return appImageRuntimePath;
}

function buildUnpackedApplication() {
  run(process.execPath, [
    path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js'),
    '--linux',
    'dir',
    '--x64',
  ]);
  const executable = path.join(unpackedDir, 'vditor-desktop');
  if (!fs.existsSync(executable)) fail(`Linux executable was not generated: ${executable}`);
}

function buildPortable() {
  const rootName = `vditor-desktop-${version}`;
  const portableStage = path.join(stagingDir, 'portable');
  const applicationDir = path.join(portableStage, rootName);
  const artifact = path.join(releaseDir, `vditor-desktop-x86_64-${version}-portable.tar.gz`);
  remove(portableStage);
  remove(artifact);
  fs.mkdirSync(portableStage, { recursive: true });
  copyDirectory(unpackedDir, applicationDir);
  fs.symlinkSync(rootName, path.join(portableStage, 'current'));
  fs.copyFileSync(iconSource, path.join(portableStage, 'vditor-desktop-icon.svg'));
  fs.writeFileSync(
    path.join(portableStage, 'vditor-desktop.desktop'),
    renderDesktop(
      '/path/to/vditor-desktop/current/vditor-desktop',
      '/path/to/vditor-desktop/vditor-desktop-icon.svg',
    ),
    { mode: 0o644 },
  );
  run('tar', [
    '-czf',
    artifact,
    '-C',
    portableStage,
    rootName,
    'current',
    'vditor-desktop-icon.svg',
    'vditor-desktop.desktop',
  ]);
  console.log(`Portable artifact: ${artifact}`);
}

function prepareAppDir() {
  const appDir = path.join(stagingDir, 'VditorDesktop.AppDir');
  const appImageDesktopBaseName = packageMetadata.desktopName;
  remove(appDir);
  const payload = path.join(appDir, 'usr', 'lib', 'vditor-desktop');
  const applications = path.join(appDir, 'usr', 'share', 'applications');
  const icons = path.join(appDir, 'usr', 'share', 'icons', 'hicolor', 'scalable', 'apps');
  const mimePackages = path.join(appDir, 'usr', 'share', 'mime', 'packages');
  const metadata = path.join(appDir, 'usr', 'share', 'metainfo');
  fs.mkdirSync(payload, { recursive: true });
  fs.mkdirSync(applications, { recursive: true });
  fs.mkdirSync(icons, { recursive: true });
  fs.mkdirSync(mimePackages, { recursive: true });
  fs.mkdirSync(metadata, { recursive: true });
  copyDirectory(unpackedDir, payload);
  fs.copyFileSync(path.join(resourcesDir, 'AppRun'), path.join(appDir, 'AppRun'));
  fs.chmodSync(path.join(appDir, 'AppRun'), 0o755);
  const desktop = renderDesktop('AppRun', 'vditor-desktop');
  fs.writeFileSync(path.join(appDir, `${appImageDesktopBaseName}.desktop`), desktop, {
    mode: 0o644,
  });
  fs.writeFileSync(path.join(applications, `${appImageDesktopBaseName}.desktop`), desktop, {
    mode: 0o644,
  });
  fs.copyFileSync(iconSource, path.join(appDir, 'vditor-desktop.svg'));
  fs.copyFileSync(iconSource, path.join(icons, 'vditor-desktop.svg'));
  fs.copyFileSync(
    path.join(resourcesDir, 'vditor-desktop.xml'),
    path.join(mimePackages, 'vditor-desktop.xml'),
  );
  fs.copyFileSync(
    path.join(resourcesDir, 'vditor-desktop.metainfo.xml'),
    path.join(metadata, `${appImageDesktopBaseName}.appdata.xml`),
  );
  return appDir;
}

async function buildAppImage() {
  const appDir = prepareAppDir();
  const artifact = path.join(releaseDir, `vditor-desktop-x86_64-${version}-portable.AppImage`);
  const [tool, runtime] = await Promise.all([ensureAppImageTool(), ensureAppImageRuntime()]);
  remove(artifact);
  run(tool, ['--appimage-extract-and-run', '--runtime-file', runtime, appDir, artifact], {
    env: { ...process.env, ARCH: 'x86_64' },
  });
  fs.chmodSync(artifact, 0o755);
  console.log(`AppImage artifact: ${artifact}`);
}

async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    fail('Linux x86_64 releases must be built on a Linux x86_64 host');
  }
  if (!['portable', 'appimage', 'all'].includes(mode)) {
    fail('usage: node scripts/release-linux.js [portable|appimage|all]');
  }
  fs.mkdirSync(stagingDir, { recursive: true });
  buildUnpackedApplication();
  if (mode === 'portable' || mode === 'all') buildPortable();
  if (mode === 'appimage' || mode === 'all') await buildAppImage();
}

main().catch((error) => fail(error.stack || error.message));
