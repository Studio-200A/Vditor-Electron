const INVALID_PERCENT_ENCODING = /%(?![0-9a-f]{2})/i;

function hasRawControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function parseValidatedUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value || value.trim() !== value) return null;
  if (hasRawControlCharacter(value) || INVALID_PERCENT_ENCODING.test(value)) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
