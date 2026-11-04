/** Resolve a path relative to the chapter file into a path inside the EPUB archive. */
export function resolveEpubPath(chapterHref: string, src: string): string {
  const dir = chapterHref.split('/').slice(0, -1);
  const parts = [...dir, ...src.split('/')];
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

// <img src="..."> and SVG <image xlink:href="..."> / <image href="..."> (manga covers often use the latter)
const ASSET_ATTR_RE = /(<(?:img\b[^>]*?\ssrc|image\b[^>]*?\s(?:xlink:)?href)\s*=\s*)(["'])(.*?)\2/gi;

/** Replace relative image URLs in chapter HTML with API asset URLs so the browser can load them. */
export function rewriteEpubAssetUrls(content: string, bookId: string, chapterHref: string): string {
  return content.replace(ASSET_ATTR_RE, (match, pre, quote, src) => {
    if (!src || /^(https?:|data:|\/|#)/i.test(src)) return match;
    const resolved = resolveEpubPath(chapterHref, src);
    return `${pre}${quote}/api/reader/${bookId}/asset/${resolved}${quote}`;
  });
}
