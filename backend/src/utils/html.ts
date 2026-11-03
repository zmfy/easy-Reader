/** Escape plain text for safe insertion into HTML text content. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Reverse of escapeHtml (only the entities escapeHtml produces). */
export function unescapeHtml(html: string): string {
  return html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
