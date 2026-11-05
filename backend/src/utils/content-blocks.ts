import { JSDOM } from 'jsdom';

/**
 * 章节内容的结构化格式，供第三方客户端（手机 / 桌面 App）自行排版，不必解析 HTML。
 * h: 标题（level 1–6）；p: 段落（text 内的 \n 是原文的换行 <br>）；img: 图片（src 与网页版相同，相对服务器地址）
 * anchor: 该块在网页版阅读器段落计数中的序号（阅读进度 paragraphIndex 用它，网页与 App 之间同步位置一致）
 */
export type ContentBlock = { anchor: number } & (
  | { type: 'h'; level: number; text: string }
  | { type: 'p'; text: string }
  | { type: 'img'; src: string; alt?: string }
);

/** 与网页版 Reader.vue 的 ANCHOR_SELECTOR 一致：这些元素按文档顺序计数，作为阅读进度的段落序号 */
const ANCHOR_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'img', 'figure', 'table']);

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const SKIP_TAGS = new Set(['head', 'script', 'style', 'template', 'title', 'noscript']);

/** 把章节 HTML（已经过清理）转成内容块：块级元素分段，行内元素合并文字，图片单独成块 */
export function htmlToBlocks(html: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  let buffer = '';
  // 当前文字所属的标题层级（0 为普通段落）
  let headingLevel = 0;
  // 段落计数：nextAnchor 为下一个计数元素的序号，enclosing 为包住当前文字的最内层计数元素（-1 为没有）
  let nextAnchor = 0;
  let enclosing = -1;
  const textAnchor = () => (enclosing >= 0 ? enclosing : Math.max(0, nextAnchor - 1));
  let bufferAnchor = 0;

  const flush = () => {
    const text = buffer
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n');
    buffer = '';
    if (!text) return;
    const anchor = bufferAnchor;
    blocks.push(headingLevel ? { type: 'h', level: headingLevel, text, anchor } : { type: 'p', text, anchor });
  };

  const walk = (node: Node, inPre: boolean) => {
    if (node.nodeType === 3) {
      const text = node.textContent || '';
      if (!buffer.trim()) bufferAnchor = textAnchor();
      // 源码里的换行、缩进只是排版空白；全角空格属于正文，保留
      buffer += inPre ? text : text.replace(/[ \t\n\r\f\v]+/g, ' ');
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;

    if (tag === 'br') { buffer += '\n'; return; }
    if (tag === 'img' || tag === 'image') {
      // SVG 的 <image> 不在网页版计数内，沿用当前位置
      const anchor = tag === 'img' ? nextAnchor++ : textAnchor();
      const src = tag === 'img' ? el.getAttribute('src') : (el.getAttribute('xlink:href') || el.getAttribute('href'));
      if (src) {
        flush();
        const alt = el.getAttribute('alt')?.trim();
        blocks.push(alt ? { type: 'img', src, alt, anchor } : { type: 'img', src, anchor });
      }
      return;
    }
    if (tag === 'svg') {
      // 漫画页常用 <svg><image/></svg>：只取图片，SVG 内的文字不当正文
      el.querySelectorAll('image').forEach(img => walk(img, inPre));
      return;
    }

    const heading = /^h([1-6])$/.exec(tag);
    if (heading || BLOCK_TAGS.has(tag)) {
      flush();
      const outer = headingLevel;
      const outerEnclosing = enclosing;
      if (heading) headingLevel = Number(heading[1]);
      if (ANCHOR_TAGS.has(tag)) enclosing = nextAnchor++;
      el.childNodes.forEach(child => walk(child, inPre || tag === 'pre'));
      flush();
      headingLevel = outer;
      enclosing = outerEnclosing;
      return;
    }
    el.childNodes.forEach(child => walk(child, inPre));
  };

  JSDOM.fragment(html).childNodes.forEach(child => walk(child, false));
  flush();
  return blocks;
}
