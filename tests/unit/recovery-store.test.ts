import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RECOVERY_SNAPSHOT_BYTES,
  RECOVERY_SCHEMA_VERSION,
  RecoverySnapshot,
  RecoveryStore,
} from '../../src/main/services/recovery-store';

describe('RecoveryStore', () => {
  let configDir: string;
  let recoveryDir: string;
  let store: RecoveryStore;

  const snapshot = (overrides: Partial<RecoverySnapshot> = {}): RecoverySnapshot => ({
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    id: 'a6c66b3f-2a90-49fd-baf3-6ab1cda45aaa',
    filePath: null,
    title: 'Untitled 1',
    content: 'Recovered text',
    savedContent: '',
    expectedSavedContent: '',
    encoding: 'utf-8',
    lineEnding: 'LF',
    mode: 'ir',
    updatedAt: 1_725_000_000_000,
    ...overrides,
  });

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vditor-recovery-'));
    recoveryDir = path.join(configDir, 'recovery-data');
    store = new RecoveryStore(recoveryDir);
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('stores private recovery data outside config.toml and lists metadata without document bodies', async () => {
    await store.save(snapshot());

    const recoveryPath = path.join(recoveryDir, `${snapshot().id}.json`);
    expect(await store.listCandidates()).toEqual([
      { id: snapshot().id, title: 'Untitled 1', updatedAt: 1_725_000_000_000 },
    ]);
    expect(fs.readFileSync(recoveryPath, 'utf8')).toContain('Recovered text');
    expect(fs.existsSync(path.join(configDir, 'config.toml'))).toBe(false);
    expect(fs.statSync(recoveryDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(recoveryPath).mode & 0o777).toBe(0o600);
  });

  it('keeps a snapshot until it is explicitly discarded', async () => {
    await store.save(snapshot());

    await expect(store.restore(snapshot().id)).resolves.toMatchObject({
      content: 'Recovered text',
      diskState: 'unchanged',
    });
    await store.discard(snapshot().id);
    await expect(store.listCandidates()).resolves.toEqual([]);
  });

  it('marks a saved document as unsafe to overwrite when the disk version changed', async () => {
    const filePath = path.join(configDir, 'note.md');
    fs.writeFileSync(filePath, 'Original disk version');
    await store.save(
      snapshot({
        filePath,
        title: 'note.md',
        content: 'Unsaved local version',
        savedContent: 'Original disk version',
        expectedSavedContent: 'Original disk version',
      }),
    );
    fs.writeFileSync(filePath, 'Changed outside the app');

    await expect(store.restore(snapshot().id)).resolves.toMatchObject({ diskState: 'changed' });
  });

  it('marks a missing saved document as unavailable', async () => {
    const filePath = path.join(configDir, 'missing.md');
    await store.save(snapshot({ filePath, title: 'missing.md' }));

    await expect(store.restore(snapshot().id)).resolves.toMatchObject({ diskState: 'unavailable' });
  });

  it('compares recovery baselines through the document decoder for BOM, CRLF, and GB18030', async () => {
    const bomPath = path.join(configDir, 'bom.md');
    fs.writeFileSync(
      bomPath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\r\ntwo')]),
    );
    await store.save(
      snapshot({
        filePath: bomPath,
        savedContent: 'one\ntwo',
        expectedSavedContent: 'one\r\ntwo',
      }),
    );
    await expect(store.restore(snapshot().id)).resolves.toMatchObject({ diskState: 'unchanged' });

    const gbPath = path.join(configDir, 'gb18030.md');
    fs.writeFileSync(gbPath, Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
    await store.save(
      snapshot({
        id: 'b6c66b3f-2a90-49fd-baf3-6ab1cda45aaa',
        filePath: gbPath,
        savedContent: '中文',
        expectedSavedContent: '中文',
      }),
    );
    await expect(store.restore('b6c66b3f-2a90-49fd-baf3-6ab1cda45aaa')).resolves.toMatchObject({
      diskState: 'unchanged',
    });
  });

  it('removes damaged, unsupported, and oversized snapshots without exposing their content', async () => {
    fs.mkdirSync(recoveryDir, { recursive: true });
    fs.writeFileSync(path.join(recoveryDir, 'broken.json'), '{not json');
    fs.writeFileSync(
      path.join(recoveryDir, 'unsupported.json'),
      JSON.stringify({ ...snapshot(), id: 'unsupported', schemaVersion: 99, content: 'secret' }),
    );
    fs.writeFileSync(
      path.join(recoveryDir, 'oversized.json'),
      'x'.repeat(MAX_RECOVERY_SNAPSHOT_BYTES + 1),
    );

    await expect(store.listCandidates()).resolves.toEqual([]);
    expect(fs.readdirSync(recoveryDir)).toEqual([]);
  });

  it('rejects snapshots that exceed the single-snapshot size limit', async () => {
    await expect(
      store.save(snapshot({ content: 'x'.repeat(MAX_RECOVERY_SNAPSHOT_BYTES) })),
    ).rejects.toThrow('size limit');
  });
});
