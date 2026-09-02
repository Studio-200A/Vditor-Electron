export function escapeHTML(value: unknown): string {
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fileName(filePath: string): string {
  if (!filePath) return '';
  return filePath.replace(/\\/g, '/').split('/').pop() ?? '';
}

export function stripExtension(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '');
}
