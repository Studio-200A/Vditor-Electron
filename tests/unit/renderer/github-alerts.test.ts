import { describe, expect, it } from 'vitest';
import { restoreGitHubAlertHeaders } from '../../../src/renderer/editor/github-alerts.js';

const presentations = {
  NOTE: '✏️ Note',
  TIP: '💡 Tip',
  IMPORTANT: '❗ Important',
  WARNING: '⚠️ Warning',
  CAUTION: '🚨 Caution',
} as const;

describe('GitHub alert serialization compatibility', () => {
  it('removes presentation-only default titles for every built-in alert type', () => {
    const source = Object.keys(presentations)
      .map((type) => `> [!${type}]\n> Body`)
      .join('\n');
    const serialized = Object.entries(presentations)
      .map(([type, title]) => `> [!${type}] ${title}\n>\n> Body`)
      .join('\n');

    expect(restoreGitHubAlertHeaders(serialized, source)).toBe(
      source.replaceAll('> Body', '>\n> Body'),
    );
  });

  it('removes only the presentation icon when the source supplied an alert title', () => {
    const source = '> [!NOTE] Project note\n> Body';
    const serialized = '> [!NOTE] ✏️ Project note\n>\n> Body';

    expect(restoreGitHubAlertHeaders(serialized, source)).toBe('> [!NOTE] Project note\n>\n> Body');
  });

  it('preserves a source-supplied icon in an explicit alert title', () => {
    const source = '> [!NOTE] ✏️ Project note\n> Body';
    const serialized = '> [!NOTE] ✏️ Project note\n>\n> Body';

    expect(restoreGitHubAlertHeaders(serialized, source)).toBe(serialized);
  });

  it('leaves unrelated lines and unknown presentation text unchanged', () => {
    const source = '> [!NOTE]\n> Body\n普通文本';
    const serialized = '> [!NOTE] custom\n>\n> Body\n普通文本';

    expect(restoreGitHubAlertHeaders(serialized, source)).toBe(serialized);
  });

  it('does not rewrite alert-shaped text inside fenced code', () => {
    const source = '```markdown\n> [!NOTE]\n> Body\n```';
    const serialized = '```markdown\n> [!NOTE] ✏️ Note\n> Body\n```';

    expect(restoreGitHubAlertHeaders(serialized, source)).toBe(serialized);
  });
});
