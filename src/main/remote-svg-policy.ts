export type ImageRequestType = 'image' | Exclude<string, 'image'>;

function isHttpUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isRemoteSvgImageUrl(rawUrl: string, resourceType: ImageRequestType): boolean {
  if (resourceType !== 'image' || !isHttpUrl(rawUrl)) return false;
  try {
    return new URL(rawUrl).pathname.toLowerCase().endsWith('.svg');
  } catch {
    return false;
  }
}

export function hasSvgImageContentType(responseHeaders?: Record<string, string[]>): boolean {
  const contentType = Object.entries(responseHeaders || {}).find(
    ([name]) => name.toLowerCase() === 'content-type',
  )?.[1];
  return (
    contentType?.some((value) => value.split(';', 1)[0].trim().toLowerCase() === 'image/svg+xml') ||
    false
  );
}

export function shouldBlockRemoteSvgImage(
  rawUrl: string,
  resourceType: ImageRequestType,
  allowSvgImages: boolean,
  responseHeaders?: Record<string, string[]>,
): boolean {
  if (allowSvgImages || resourceType !== 'image' || !isHttpUrl(rawUrl)) return false;
  return isRemoteSvgImageUrl(rawUrl, resourceType) || hasSvgImageContentType(responseHeaders);
}
