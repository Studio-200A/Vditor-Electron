const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const metadata = require(path.join(root, 'package.json'));

function resolveTaggedCommit() {
  const tags = [metadata.version, `v${metadata.version}`];
  for (const tag of tags) {
    try {
      const commit = execFileSync('git', ['rev-parse', `${tag}^{commit}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return { commit, tag };
    } catch (_) {}
  }
  const commit = process.env.VDITOR_DESKTOP_TAG_COMMIT || '';
  return { commit, tag: commit ? metadata.version : '' };
}

const { commit, tag } = resolveTaggedCommit();
const output = path.join(root, 'dist', 'build-info.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  `${JSON.stringify(
    {
      version: metadata.version,
      tag,
      commit,
      commitShort: commit.slice(0, 12),
      repository: 'https://github.com/Studio-200A/Vditor-Electron',
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Build metadata: ${tag ? `${tag} -> ${commit.slice(0, 12)}` : 'version tag unavailable'}`,
);
