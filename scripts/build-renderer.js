const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ENTRY = path.join(__dirname, '..', 'src', 'renderer', 'main.ts');
const PURE_FUNCTIONS_ENTRY = path.join(__dirname, '..', 'src', 'renderer', 'pure-functions.ts');
const OUT_DIR = path.join(__dirname, '..', 'dist', 'renderer');
const OUT_FILE = path.join(OUT_DIR, 'main.js');
const PURE_FUNCTIONS_FILE = path.join(OUT_DIR, 'pure-functions.js');

async function build() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const isProduction =
    process.argv.includes('--production') || process.env.NODE_ENV === 'production';

  const commonOptions = {
    bundle: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    sourcemap: isProduction ? false : 'inline',
    minify: isProduction,
    logLevel: 'info',
    external: [],
    define: {
      'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
    },
  };

  const [mainResult, pureFunctionsResult] = await Promise.all([
    esbuild.build({
      ...commonOptions,
      entryPoints: [ENTRY],
      outfile: OUT_FILE,
    }),
    esbuild.build({
      ...commonOptions,
      entryPoints: [PURE_FUNCTIONS_ENTRY],
      outfile: PURE_FUNCTIONS_FILE,
      globalName: '__vditorDesktopPureFunctions',
    }),
  ]);

  if (mainResult.errors.length > 0 || pureFunctionsResult.errors.length > 0) {
    console.error('Build failed with errors');
    process.exit(1);
  }

  console.log(`Renderer bundle: ${OUT_FILE}`);
  console.log(`Pure functions bundle: ${PURE_FUNCTIONS_FILE}`);
}

build().catch((err) => {
  console.error('Build error:', err);
  process.exit(1);
});
