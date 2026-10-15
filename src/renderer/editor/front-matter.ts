import { JSON_SCHEMA, load, YAMLException } from 'js-yaml';

/** Presentation only: the original YAML remains owned and serialized by Vditor. */
export function createFrontMatterTable(
  source: string,
  document: Document,
): HTMLTableElement | null {
  // Bound both parsing input and expanded alias presentation for untrusted files.
  if (source.length > 128 * 1024) return null;
  let value: unknown;
  try {
    value = load(source, { schema: JSON_SCHEMA });
  } catch (error) {
    if (error instanceof YAMLException) return null;
    throw error;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const ancestors = new Set<object>();
  let remaining = 2000;
  function render(value: unknown, depth: number): HTMLElement | null {
    if (--remaining < 0 || depth > 16) return null;
    if (value === null || typeof value !== 'object') {
      const text = document.createElement('span');
      text.textContent = value === null ? '' : String(value);
      return text;
    }
    if (ancestors.has(value)) return null;
    ancestors.add(value);
    const container = document.createElement(Array.isArray(value) ? 'ul' : 'table');
    if (Array.isArray(value)) {
      for (const item of value) {
        const child = render(item, depth + 1);
        if (!child) return null;
        const entry = document.createElement('li');
        entry.append(child);
        container.append(entry);
      }
    } else {
      const body = document.createElement('tbody');
      container.append(body);
      for (const [key, item] of Object.entries(value)) {
        const child = render(item, depth + 1);
        if (!child) return null;
        const row = document.createElement('tr');
        const name = document.createElement('th');
        name.scope = 'row';
        name.textContent = key;
        const cell = document.createElement('td');
        cell.append(child);
        row.append(name, cell);
        body.append(row);
      }
    }
    ancestors.delete(value);
    return container;
  }

  const table = render(value, 0);
  const Table = document.defaultView?.HTMLTableElement;
  if (!Table || !(table instanceof Table) || !table.rows.length) return null;
  table.classList.add('app-front-matter-table');
  return table;
}
