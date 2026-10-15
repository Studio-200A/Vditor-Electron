// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createFrontMatterTable } from '../../../src/renderer/editor/front-matter.js';

describe('front matter presentation', () => {
  it('renders row headers and literal values without interpreting Markdown or HTML', () => {
    const table = createFrontMatterTable(
      'name: Example\ndescription: |\n  First line\n  <img src=x onerror=alert(1)> **text**\ndate: 2026-10-15\nenabled: false\ncount: 0\nempty: null',
      document,
    )!;
    expect([...table.rows].map((row) => row.cells[0].textContent)).toEqual([
      'name',
      'description',
      'date',
      'enabled',
      'count',
      'empty',
    ]);
    expect(table.rows[1].cells[1].textContent).toBe(
      'First line\n<img src=x onerror=alert(1)> **text**\n',
    );
    expect(table.rows[2].cells[1].textContent).toBe('2026-10-15');
    expect(table.rows[3].cells[1].textContent).toBe('false');
    expect(table.rows[4].cells[1].textContent).toBe('0');
    expect(table.rows[5].cells[1].textContent).toBe('');
    expect(table.querySelector('img,strong')).toBeNull();
    expect(table.querySelector('th')?.scope).toBe('row');
    expect(table.querySelector('thead')).toBeNull();
  });

  it('renders nested mappings and sequences and permits shared nonrecursive aliases', () => {
    const table = createFrontMatterTable(
      'tags: [one, two]\nauthor: &author\n  name: Alice\nreviewer: *author',
      document,
    )!;
    expect([...table.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['one', 'two']);
    expect(table.querySelectorAll('td table')).toHaveLength(2);
    expect(table.rows[1].cells[1].textContent).toBe('nameAlice');
    expect(table.rows[2].cells[1].textContent).toBe('nameAlice');
  });

  it.each([
    '',
    '# comment',
    '[]',
    'hello',
    'name: [unfinished',
    'name: one\nname: two',
    'name: !unknown value',
    'loop: &loop\n  self: *loop',
  ])('falls back to source for unsupported YAML %j', (source) => {
    expect(createFrontMatterTable(source, document)).toBeNull();
  });

  it('bounds parsing input and expanded alias output', () => {
    expect(createFrontMatterTable(`name: ${'x'.repeat(128 * 1024)}`, document)).toBeNull();
    const source = [
      'a: &a [x, x, x, x, x, x, x, x, x, x]',
      'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]',
      'c: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b]',
    ].join('\n');
    expect(createFrontMatterTable(source, document)).toBeNull();
  });
});
