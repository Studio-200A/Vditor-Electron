const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ENTRY = path.join(__dirname, '..', 'src', 'renderer', 'main.ts');
const OUT_DIR = path.join(__dirname, '..', 'dist', 'renderer');
const OUT_FILE = path.join(OUT_DIR, 'main.js');

async function build() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const isProduction =
    process.argv.includes('--production') || process.env.NODE_ENV === 'production';

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUT_FILE,
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
  });

  if (result.errors.length > 0) {
    console.error('Build failed with errors');
    process.exit(1);
  }

  console.log(`Renderer bundle: ${OUT_FILE}`);
}

build().catch((err) => {
  console.error('Build error:', err);
  process.exit(1);
});
