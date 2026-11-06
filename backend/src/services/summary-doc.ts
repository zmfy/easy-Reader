// 学习总结文档模型：Tiptap JSON 的纯函数操作（构建、追加、校验、导出）

export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Array<{ type: string }>;
};

export interface ThemeBlock {
  theme: string;
  paragraphs: Array<Array<{ text: string } | { ref: string }>>;
}

type Parts = Array<{ text: string; bold?: true; italic?: true; code?: true } | { ref: string }>;
export type DocBlock =
  | { type: 'h'; level: 2 | 3; text: string }
  | { type: 'p'; parts: Parts }
  | { type: 'list'; ordered: boolean; items: Parts[] }
  | { type: 'code'; text: string };

const MAX_DEPTH = 20;
const MAX_NODES = 20000;
const REF_RE = /^(h|n):[\w-]{1,64}$/;

function paragraphOf(parts: ThemeBlock['paragraphs'][number]): DocNode {
  const content: DocNode[] = [];
  for (const part of parts) {
    if ('ref' in part) content.push({ type: 'noteRef', attrs: { ref: part.ref } });
    else if (part.text) content.push({ type: 'text', text: part.text });
  }
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function themeNodes(b: ThemeBlock): DocNode[] {
  return [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: b.theme }] },
    ...b.paragraphs.map(paragraphOf),
  ];
}

export function buildDoc(themes: ThemeBlock[]): DocNode {
  return { type: 'doc', content: themes.flatMap(themeNodes) };
}

// 行内文本（引用不输出，hardBreak 为换行）
function inlineText(n: DocNode): string {
  if (n.type === 'text') return n.text || '';
  if (n.type === 'hardBreak') return '\n';
  return (n.content || []).map(inlineText).join('');
}

function isH2(n: DocNode): boolean {
  return n.type === 'heading' && n.attrs?.level === 2;
}

export function listThemes(doc: DocNode): string[] {
  return (doc.content || []).filter(isH2).map(inlineText);
}

export function appendAdditions(doc: DocNode, additions: ThemeBlock[]): DocNode {
  const out: DocNode = JSON.parse(JSON.stringify(doc));
  const content = out.content || (out.content = []);
  for (const add of additions) {
    const key = add.theme.trim();
    const start = content.findIndex(n => isH2(n) && inlineText(n).trim() === key);
    const paras = add.paragraphs.map(paragraphOf);
    if (start < 0) {
      content.push(...themeNodes(add));
      continue;
    }
    let end = content.findIndex((n, i) => i > start && isH2(n));
    if (end < 0) end = content.length;
    content.splice(end, 0, ...paras);
  }
  return out;
}

export function extractRefs(doc: DocNode): string[] {
  const seen = new Set<string>();
  const walk = (n: DocNode) => {
    if (n.type === 'noteRef' && typeof n.attrs?.ref === 'string') seen.add(n.attrs.ref);
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return [...seen];
}

const CONTAINERS = new Set(['doc', 'bulletList', 'orderedList', 'listItem']);

function nodeText(n: DocNode): string {
  if (CONTAINERS.has(n.type)) return (n.content || []).map(nodeText).join('\n');
  return inlineText(n);
}

export function docText(doc: DocNode): string {
  return nodeText(doc);
}

// ---- 校验 ----

// nullable：Tiptap 默认值可能输出 null 的属性；其余属性必须有合法值
type AttrRule = { ok: (v: unknown) => boolean; nullable: boolean };
const ATTR_RULES: Record<string, Record<string, AttrRule>> = {
  heading: { level: { ok: v => v === 2 || v === 3, nullable: false } },
  orderedList: {
    start: { ok: v => Number.isInteger(v), nullable: true },
    type: { ok: v => typeof v === 'string', nullable: true },
  },
  codeBlock: { language: { ok: v => typeof v === 'string', nullable: true } },
  noteRef: { ref: { ok: v => typeof v === 'string' && REF_RE.test(v), nullable: false } },
};
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const NODE_TYPES = new Set(['doc', 'heading', 'paragraph', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'hardBreak', 'text', 'noteRef']);
const MARK_TYPES = new Set(['bold', 'italic', 'code']);
const NODE_KEYS = new Set(['type', 'attrs', 'content', 'text', 'marks']);

// 内容模型（与前端 Tiptap schema 一致）：父节点 → 允许的子节点；未列出的为叶子，不允许 content
const BLOCKS = new Set(['heading', 'paragraph', 'bulletList', 'orderedList', 'codeBlock']);
const INLINES = new Set(['text', 'hardBreak', 'noteRef']);
const LIST_ITEM_REST = new Set(['paragraph', 'bulletList', 'orderedList', 'codeBlock']);
const CHILDREN: Record<string, Set<string>> = {
  doc: BLOCKS, heading: INLINES, paragraph: INLINES, codeBlock: new Set(['text']),
  bulletList: new Set(['listItem']), orderedList: new Set(['listItem']), listItem: LIST_ITEM_REST,
};
// 至少要有一个子节点的容器
const NON_EMPTY = new Set(['doc', 'bulletList', 'orderedList', 'listItem']);

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isValidDoc(x: unknown): x is DocNode {
  try {
    return isValidDocUnsafe(x);
  } catch {
    return false;
  }
}

function isValidDocUnsafe(x: unknown): boolean {
  if (!isObj(x) || x.type !== 'doc') return false;
  let count = 0;
  const check = (n: unknown, depth: number): boolean => {
    if (depth > MAX_DEPTH || ++count > MAX_NODES) return false;
    if (!isObj(n) || typeof n.type !== 'string' || !NODE_TYPES.has(n.type)) return false;
    if (Object.keys(n).some(k => !NODE_KEYS.has(k))) return false;
    // attrs：只允许白名单属性；null / 缺省都可（Tiptap 会输出默认值）
    if (n.attrs !== undefined) {
      if (!isObj(n.attrs)) return false;
      const rules = hasOwn(ATTR_RULES, n.type) ? ATTR_RULES[n.type] : {};
      for (const k of Object.keys(n.attrs)) {
        const v = n.attrs[k];
        if (v === undefined) continue;
        if (!hasOwn(rules, k)) return false;
        const rule = rules[k];
        if (v === null ? !rule.nullable : !rule.ok(v)) return false;
      }
    }
    if (n.type === 'heading' && (!isObj(n.attrs) || n.attrs.level == null)) return false;
    if (n.type === 'noteRef' && (!isObj(n.attrs) || n.attrs.ref == null)) return false;
    if (n.type === 'text') {
      // 空文本会让 ProseMirror 抛错
      if (typeof n.text !== 'string' || n.text === '' || n.content !== undefined) return false;
    } else if (n.text !== undefined || n.marks !== undefined) {
      return false;
    }
    if (n.marks !== undefined) {
      if (!Array.isArray(n.marks)) return false;
      for (const m of n.marks) {
        if (!isObj(m) || typeof m.type !== 'string' || !MARK_TYPES.has(m.type)) return false;
        if (Object.keys(m).some(k => k !== 'type')) return false;
      }
    }
    const allowed = hasOwn(CHILDREN, n.type) ? CHILDREN[n.type] : null;
    if (n.content !== undefined) {
      if (!allowed || !Array.isArray(n.content)) return false;
      for (let i = 0; i < n.content.length; i++) {
        const c = n.content[i];
        if (!isObj(c)) return false;
        // listItem 第一个子节点必须是 paragraph
        if (n.type === 'listItem' && i === 0 ? c.type !== 'paragraph' : !allowed.has(c.type as string)) return false;
        if (n.type === 'codeBlock' && c.marks !== undefined) return false;
        if (!check(c, depth + 1)) return false;
      }
    }
    if (NON_EMPTY.has(n.type) && !(Array.isArray(n.content) && n.content.length > 0)) return false;
    return true;
  };
  return check(x, 1);
}

// ---- 导出 ----

function inlineParts(n: DocNode, out: Parts): void {
  if (n.type === 'noteRef') {
    if (typeof n.attrs?.ref === 'string') out.push({ ref: n.attrs.ref });
  } else if (n.type === 'text') {
    if (!n.text) return;
    const part: { text: string; bold?: true; italic?: true; code?: true } = { text: n.text };
    for (const m of n.marks || []) {
      if (m.type === 'bold') part.bold = true;
      else if (m.type === 'italic') part.italic = true;
      else if (m.type === 'code') part.code = true;
    }
    out.push(part);
  } else if (n.type === 'hardBreak') {
    out.push({ text: '\n' });
  } else {
    (n.content || []).forEach(c => inlineParts(c, out));
  }
}

const partsOf = (n: DocNode): Parts => {
  const out: Parts = [];
  inlineParts(n, out);
  return out;
};

type FlatItem = { depth: number; parts: Parts };

// 嵌套列表拍平，记录深度
function flattenList(list: DocNode, depth: number, out: FlatItem[]): void {
  for (const item of list.content || []) {
    for (const child of item.content || []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') flattenList(child, depth + 1, out);
      else out.push({ depth, parts: partsOf(child) });
    }
  }
}

type FlatBlock =
  | { type: 'h'; level: 2 | 3; text: string }
  | { type: 'p'; parts: Parts }
  | { type: 'list'; ordered: boolean; items: FlatItem[] }
  | { type: 'code'; text: string; language: string };

function toFlatBlocks(doc: DocNode): FlatBlock[] {
  const out: FlatBlock[] = [];
  for (const n of doc.content || []) {
    if (n.type === 'heading') out.push({ type: 'h', level: n.attrs?.level === 3 ? 3 : 2, text: inlineText(n) });
    else if (n.type === 'paragraph') out.push({ type: 'p', parts: partsOf(n) });
    else if (n.type === 'bulletList' || n.type === 'orderedList') {
      const items: FlatItem[] = [];
      flattenList(n, 0, items);
      out.push({ type: 'list', ordered: n.type === 'orderedList', items });
    } else if (n.type === 'codeBlock') out.push({ type: 'code', text: inlineText(n), language: typeof n.attrs?.language === 'string' && /^[\w+#.-]+$/.test(n.attrs.language) ? n.attrs.language : '' });
  }
  return out;
}

export function docToBlocks(doc: DocNode): DocBlock[] {
  return toFlatBlocks(doc).map((b): DocBlock => {
    if (b.type === 'code') return { type: 'code', text: b.text };
    if (b.type !== 'list') return b;
    return {
      type: 'list',
      ordered: b.ordered,
      items: b.items.map(i => (i.depth ? [{ text: '  '.repeat(i.depth) }, ...i.parts] : i.parts)),
    };
  });
}

const MD_SPECIALS = /[\\`*_[\]#<>|~]/g;
const escapeMd = (s: string) => s.replace(MD_SPECIALS, c => '\\' + c);

function partsToMd(parts: Parts, refLabel: (ref: string) => string): string {
  return parts.map(p => {
    if ('ref' in p) return `（出自：${escapeMd(refLabel(p.ref))}）`;
    if (p.code) {
      const fence = p.text.includes('`') ? '``' : '`';
      const pad = p.text.includes('`') ? ' ' : '';
      return `${fence}${pad}${p.text}${pad}${fence}`;
    }
    let s = escapeMd(p.text).replace(/\n/g, '  \n');
    if (p.italic) s = `*${s}*`;
    if (p.bold) s = `**${s}**`;
    return s;
  }).join('');
}

export function docToMarkdown(title: string, doc: DocNode, refLabel: (ref: string) => string): string {
  const lines: string[] = [`# ${title} · 笔记整理`, ''];
  for (const b of toFlatBlocks(doc)) {
    if (b.type === 'h') {
      lines.push(`${'#'.repeat(b.level)} ${escapeMd(b.text)}`, '');
    } else if (b.type === 'p') {
      lines.push(partsToMd(b.parts, refLabel), '');
    } else if (b.type === 'list') {
      let n = 0;
      for (const it of b.items) {
        const indent = '    '.repeat(it.depth);
        let marker = '- ';
        if (b.ordered && it.depth === 0) marker = `${++n}. `;
        lines.push(`${indent}${marker}${partsToMd(it.parts, refLabel)}`);
      }
      lines.push('');
    } else {
      let fence = '```';
      while (b.text.includes(fence)) fence += '`';
      lines.push(fence + b.language, b.text, fence, '');
    }
  }
  return lines.join('\n');
}
