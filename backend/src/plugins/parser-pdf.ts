import fs from 'fs';
import { ReaderPlugin } from '../types';
import { escapeHtml } from '../utils/html';

/** Text item as returned by pdf.js getTextContent(). transform = [a, b, c, d, x, y]. */
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
}

interface Fragment { str: string; x: number; y: number; right: number; size: number }
interface Line { y: number; size: number; fragments: Fragment[]; x: number; right: number; text: string }

const CJK_RE = /[⺀-鿿豈-﫿＀-￯　-〿]/;

/** No space between two pieces when either side is CJK (Chinese text has no word spaces). */
function joinPieces(a: string, b: string): string {
  if (!a) return b;
  if (CJK_RE.test(a[a.length - 1]) || CJK_RE.test(b[0]) || /\s$/.test(a) || /^\s/.test(b)) return a + b;
  return `${a} ${b}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Rebuild readable page text from pdf.js text items: one paragraph per line of output.
 * - Fake-bold text (same string drawn several times within ~1pt) is kept once.
 * - Fragments on the same line are joined by position; a space is added only for a real gap.
 * - Wrapped lines are merged; a new paragraph starts on a larger line gap, after a short line,
 *   on an indented line, or when the font size changes.
 */
export function buildPageText(items: PdfTextItem[]): string {
  const fragments: Fragment[] = [];
  // Copies may be drawn a whole line (or page) apart, so look up by string across the page
  const byStr = new Map<string, Fragment[]>();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, x, y] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || 1;
    const same = byStr.get(it.str) || [];
    if (same.some(f => Math.abs(f.x - x) < 1 && Math.abs(f.y - y) < 1)) continue;
    const frag = { str: it.str, x, y, right: x + (it.width || 0), size };
    fragments.push(frag);
    same.push(frag);
    byStr.set(it.str, same);
  }
  if (fragments.length === 0) return '';

  // Group into lines by baseline (content streams may draw lines out of order, e.g. footer first)
  const lines: Line[] = [];
  for (const f of fragments) {
    const line = lines.find(l => Math.abs(l.y - f.y) < Math.min(l.size, f.size) * 0.5);
    if (line) line.fragments.push(f);
    else lines.push({ y: f.y, size: f.size, fragments: [f], x: 0, right: 0, text: '' });
  }
  lines.sort((p, q) => q.y - p.y);
  for (const line of lines) {
    line.fragments.sort((p, q) => p.x - q.x);
    line.x = line.fragments[0].x;
    let text = '';
    let prevRight = -Infinity;
    for (const f of line.fragments) {
      const gap = f.x - prevRight;
      text = gap > f.size * 0.1 ? joinPieces(text, f.str) : text + f.str;
      prevRight = Math.max(prevRight, f.right);
    }
    line.right = prevRight;
    line.text = text.trim();
  }

  const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).filter(g => g > 0);
  const lineGap = gaps.length > 0 ? median(gaps) : 0;
  const minX = Math.min(...lines.map(l => l.x));
  const maxRight = Math.max(...lines.map(l => l.right));

  const paragraphs: string[] = [lines[0].text];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const cur = lines[i];
    const newParagraph =
      prev.y - cur.y > lineGap * 1.3 ||
      prev.right < maxRight - cur.size * 2 ||
      cur.x > minX + cur.size * 1.5 ||
      Math.abs(cur.size - prev.size) > prev.size * 0.15;
    if (newParagraph) paragraphs.push(cur.text);
    else paragraphs[paragraphs.length - 1] = joinPieces(paragraphs[paragraphs.length - 1], cur.text);
  }
  return paragraphs.join('\n');
}

export class PdfParser implements ReaderPlugin {
  format = 'pdf';
  private pages: string[] = [];

  async load(filePath: string): Promise<void> {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer, {
      pagerender: (pageData: Record<string, unknown>) => {
        return (pageData.getTextContent as () => Promise<{ items: PdfTextItem[] }>)().then(textContent => {
          const text = buildPageText(textContent.items);
          this.pages.push(text);
          return text;
        });
      }
    });
    if (this.pages.length === 0 && data.text) {
      // Fallback: split by estimated page size
      const chunkSize = 2000;
      for (let i = 0; i < data.text.length; i += chunkSize) {
        this.pages.push(data.text.slice(i, i + chunkSize));
      }
    }
  }

  async getChapters(): Promise<Array<{ index: number; title: string }>> {
    return this.pages.map((_, i) => ({ index: i, title: `第 ${i + 1} 页` }));
  }

  async getChapterContent(index: number): Promise<string> {
    const page = this.pages[index];
    if (page === undefined) throw new Error(`页面 ${index} 不存在`);
    const paragraphs = page.split(/\n+/).filter(p => p.trim());
    return paragraphs.map(p => `<p>${escapeHtml(p.trim())}</p>`).join('\n');
  }

  async getTotalProgress(): Promise<number> {
    return this.pages.length;
  }

  async getProgress(): Promise<number> {
    return 0;
  }
}
