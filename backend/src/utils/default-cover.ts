import { escapeHtml } from './html';

/**
 * 系统默认封面：印有书名与作者的 SVG，三种风格按分类自动选择
 * （设计：docs/superpowers/specs/2026-11-04-ai-fill-preview-design.md）。
 * - night（A 夜读）：网络小说类
 * - classic（B 古籍）：古典类
 * - modern（C 现代）：其余 / 不好判断（含「历史」「综合」、无分类）
 * 竖排文字逐字一个 <text>，不依赖 writing-mode，各浏览器显示一致。
 */
export type CoverStyle = 'night' | 'classic' | 'modern';

// 网文关键词优先：如「古代言情」属于网络小说
const WEB_NOVEL_KEYWORDS = ['玄幻', '修真', '仙侠', '奇幻', '都市', '科幻', '悬疑', '灵异', '言情', '武侠', '游戏', '竞技', '军事', '穿越'];
const CLASSIC_KEYWORDS = ['古典', '名著', '古代', '古籍', '文言', '诗词'];

export function coverStyleForCategory(category?: string | null): CoverStyle {
  const c = (category || '').trim();
  if (!c) return 'modern';
  if (WEB_NOVEL_KEYWORDS.some(k => c.includes(k))) return 'night';
  if (CLASSIC_KEYWORDS.some(k => c.includes(k))) return 'classic';
  return 'modern';
}

const W = 300;
const H = 420;
const SERIF = `'Noto Serif SC','Songti SC','SimSun',serif`;
const SANS = `'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif`;

// modern 风格的底色，按书名哈希选择（同一书名颜色固定）
const MODERN_GRADIENTS: Array<[string, string]> = [
  ['#7c5cff', '#3b2a8f'],
  ['#00a896', '#025e73'],
  ['#e76f51', '#9c2c3b'],
  ['#3a86ff', '#1d3557'],
  ['#d4a017', '#7a4e12'],
  ['#2a9d8f', '#264653'],
];

function esc(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

/** 按字符（含 emoji 等代理对）切分，并限制长度，超出时以 … 结尾 */
function clip(text: string, max: number): string[] {
  const chars = Array.from(text.trim());
  return chars.length > max ? [...chars.slice(0, max - 1), '…'] : chars;
}

function hash(text: string): number {
  let h = 5381;
  for (const ch of Array.from(text)) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return h;
}

/** 竖排：从 (x, y0) 开始每 step 一个字 */
function vertical(chars: string[], x: number, y0: number, step: number, size: number, fill: string, extra = ''): string {
  return chars
    .map((ch, i) => `<text x="${x}" y="${y0 + i * step}" font-size="${size}" fill="${fill}" text-anchor="middle"${extra}>${esc(ch)}</text>`)
    .join('');
}

function renderNight(title: string[], author: string[]): string {
  const authorChars = author.length > 0 ? [...author, '著'] : [];
  const authorY0 = 395 - (authorChars.length - 1) * 26;
  return [
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">',
    '<stop offset="0" stop-color="#1a263d"/><stop offset="0.55" stop-color="#121a2b"/><stop offset="1" stop-color="#2a1f5c"/>',
    '</linearGradient>',
    '<linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#00d4b8"/>',
    '</linearGradient>',
    '</defs>',
    `<rect width="${W}" height="${H}" fill="url(#bg)"/>`,
    `<rect x="30" y="0" width="7" height="${H}" fill="url(#bar)"/>`,
    vertical(title, 250, 70, 46, 40, '#e8e6f5', ' font-weight="700"'),
    vertical(authorChars, 62, authorY0, 26, 22, '#e8e6f5', ' fill-opacity="0.75"'),
  ].join('');
}

function renderClassic(title: string[], author: string[]): string {
  const signHeight = 24 + title.length * 36;
  const authorLine = author.length > 0 ? `${author.join('')} 著` : '';
  return [
    `<rect width="${W}" height="${H}" fill="#e9dfc8"/>`,
    `<rect x="14" y="14" width="${W - 28}" height="${H - 28}" fill="none" stroke="#8a6d3b" stroke-width="2"/>`,
    `<rect x="212" y="36" width="60" height="${signHeight}" fill="#fbf7ec" stroke="#8a6d3b" stroke-width="2"/>`,
    vertical(title, 242, 78, 36, 30, '#3b2f1e', ' font-weight="700"'),
    authorLine ? `<text x="38" y="388" font-size="20" fill="#6b5636">${esc(authorLine)}</text>` : '',
  ].join('');
}

function renderModern(titleText: string, author: string[]): string {
  const [from, to] = MODERN_GRADIENTS[hash(titleText) % MODERN_GRADIENTS.length];
  const PER_LINE = 7;
  const MAX_LINES = 4;
  const chars = Array.from(titleText.trim());
  const lines: string[] = [];
  for (let i = 0; i < chars.length && lines.length < MAX_LINES; i += PER_LINE) {
    lines.push(chars.slice(i, i + PER_LINE).join(''));
  }
  if (chars.length > PER_LINE * MAX_LINES) {
    const last = Array.from(lines[MAX_LINES - 1]);
    lines[MAX_LINES - 1] = [...last.slice(0, PER_LINE - 1), '…'].join('');
  }
  const lineY = 80 + lines.length * 46 - 16;
  return [
    '<defs>',
    '<linearGradient id="bg" x1="0" y1="0" x2="0.7" y2="1">',
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`,
    '</linearGradient>',
    '</defs>',
    `<rect width="${W}" height="${H}" fill="url(#bg)"/>`,
    lines.map((l, i) => `<text x="30" y="${80 + i * 46}" font-size="34" font-weight="700" fill="#ffffff">${esc(l)}</text>`).join(''),
    `<rect x="30" y="${lineY}" width="52" height="4" fill="#ffffff" fill-opacity="0.7"/>`,
    author.length > 0
      ? `<text x="30" y="388" font-size="20" fill="#ffffff" fill-opacity="0.85" font-family="${SANS}">${esc(author.join(''))}</text>`
      : '',
  ].join('');
}

export function renderDefaultCoverSvg(input: { title: string; author?: string | null; category?: string | null }): string {
  const titleText = (input.title || '').trim() || '未命名';
  const authorText = (input.author || '').trim();
  const style = coverStyleForCategory(input.category);

  let body: string;
  if (style === 'night') body = renderNight(clip(titleText, 7), clip(authorText, 6));
  else if (style === 'classic') body = renderClassic(clip(titleText, 8), clip(authorText, 8));
  else body = renderModern(titleText, clip(authorText, 12));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${SERIF}">${body}</svg>`;
}
