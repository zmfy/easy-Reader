import {
  DocNode, ThemeBlock, buildDoc, listThemes, appendAdditions, extractRefs, docText,
  isValidDoc, docToBlocks, docToMarkdown,
} from '../../src/services/summary-doc';

const t = (text: string): DocNode => ({ type: 'text', text });
const ref = (r: string): DocNode => ({ type: 'noteRef', attrs: { ref: r } });
const h = (level: number, text: string): DocNode => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const p = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });
const block = (theme: string, ...paragraphs: ThemeBlock['paragraphs']): ThemeBlock => ({ theme, paragraphs });

describe('summary-doc', () => {
  it('buildDoc makes h2 per theme and inline noteRef', () => {
    const d = buildDoc([block('进程', [{ text: '进程是资源分配单位' }, { ref: 'h:12' }, { text: '。' }])]);
    expect(d).toEqual(doc(h(2, '进程'), p(t('进程是资源分配单位'), ref('h:12'), t('。'))));
    expect(isValidDoc(d)).toBe(true);
  });

  it('listThemes returns top-level h2 texts only', () => {
    const d = doc(h(2, 'A'), p(t('x')), h(3, 'A-1'), h(2, 'B'));
    expect(listThemes(d)).toEqual(['A', 'B']);
  });

  it('appendAdditions appends to the end of the matching theme section', () => {
    const d = doc(h(2, 'A'), p(t('a1')), h(3, 'A-1'), p(t('a2')), h(2, 'B'), p(t('b1')));
    const out = appendAdditions(d, [block(' A ', [{ text: '新增' }, { ref: 'n:3' }])]);
    expect(out.content).toHaveLength(7);
    const orig = d.content!;
    expect(out.content![0]).toEqual(orig[0]);
    expect(out.content![1]).toEqual(orig[1]);
    expect(out.content![2]).toEqual(orig[2]);
    expect(out.content![3]).toEqual(orig[3]);
    expect(out.content![4]).toEqual(p(t('新增'), ref('n:3')));
    expect(out.content![5]).toEqual(orig[4]);
    expect(out.content![6]).toEqual(orig[5]);
  });

  it('appendAdditions adds unknown themes at the end', () => {
    const d = doc(h(2, 'A'), p(t('a1')));
    const out = appendAdditions(d, [block('C', [{ text: 'c1' }])]);
    expect(out.content).toEqual([...d.content!, h(2, 'C'), p(t('c1'))]);
  });

  it('appendAdditions matches renamed heading by current text', () => {
    const d = doc(h(2, '进程与作业'), p(t('x')), h(2, '内存'), p(t('m')));
    const out = appendAdditions(d, [block('进程与作业', [{ text: 'y' }])]);
    expect(out.content!.map(n => n.type)).toEqual(['heading', 'paragraph', 'paragraph', 'heading', 'paragraph']);
    expect(out.content![2]).toEqual(p(t('y')));
    expect(listThemes(out)).toEqual(['进程与作业', '内存']);
  });

  it('appendAdditions does not mutate input', () => {
    const d = doc(h(2, 'A'), p(t('a1')));
    const snap = JSON.parse(JSON.stringify(d));
    appendAdditions(d, [block('A', [{ text: 'z' }]), block('N', [{ text: 'n' }])]);
    expect(d).toEqual(snap);
  });

  it('extractRefs dedupes in order', () => {
    const d = doc(h(2, 'A'), p(ref('h:2'), t('x'), ref('n:1')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(ref('h:2'), ref('h:9'))] }] });
    expect(extractRefs(d)).toEqual(['h:2', 'n:1', 'h:9']);
  });

  it('docText skips refs and joins blocks with newlines', () => {
    const d = doc(h(2, '标题'), p(t('甲'), ref('h:1'), t('乙')), { type: 'codeBlock', content: [t('x=1')] });
    expect(docText(d)).toBe('标题\n甲乙\nx=1');
  });

  it('isValidDoc rejects non-doc root, deep nesting and oversized docs', () => {
    expect(isValidDoc(null)).toBe(false);
    expect(isValidDoc('x')).toBe(false);
    expect(isValidDoc(p(t('x')))).toBe(false);
    expect(isValidDoc(doc(p(t('x'))))).toBe(true);
    let deep: DocNode = p(t('x'));
    for (let i = 0; i < 25; i++) deep = { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('x')), deep] }] };
    expect(isValidDoc(doc(deep))).toBe(false);
    let shallow: DocNode = p(t('x'));
    for (let i = 0; i < 5; i++) shallow = { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('x')), shallow] }] };
    expect(isValidDoc(doc(shallow))).toBe(true);
    const many = Array.from({ length: 20001 }, () => p());
    expect(isValidDoc(doc(...many))).toBe(false);
    expect(isValidDoc(doc(...many.slice(0, 1000)))).toBe(true);
  });

  it('isValidDoc rejects unknown node/mark types and bad ref attrs', () => {
    expect(isValidDoc(doc({ type: 'image' }))).toBe(false);
    expect(isValidDoc(doc(p({ type: 'text', text: 'a', marks: [{ type: 'link' }] })))).toBe(false);
    expect(isValidDoc(doc(p({ type: 'text', text: 'a', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'code' }] })))).toBe(true);
    expect(isValidDoc(doc(p(ref('x:1'))))).toBe(false);
    expect(isValidDoc(doc(p(ref('h:'))))).toBe(false);
    expect(isValidDoc(doc(p({ type: 'noteRef' })))).toBe(false);
    expect(isValidDoc(doc(p(ref('h:1'))))).toBe(true);
    expect(isValidDoc(doc(p(ref('n:' + 'a'.repeat(65)))))).toBe(false);
  });

  it('isValidDoc enforces attrs whitelist', () => {
    expect(isValidDoc(doc(h(1, 'x')))).toBe(false);
    expect(isValidDoc(doc(h(4, 'x')))).toBe(false);
    expect(isValidDoc(doc(h(3, 'x')))).toBe(true);
    expect(isValidDoc(doc({ type: 'heading', attrs: { level: 2, id: 'a' }, content: [t('x')] }))).toBe(false);
    expect(isValidDoc(doc({ type: 'paragraph', attrs: { class: 'x' } }))).toBe(false);
    expect(isValidDoc(doc({ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'bold', attrs: { x: 1 } } as any] }] }))).toBe(false);
    expect(isValidDoc(doc({ type: 'paragraph', content: [{ type: 'text' }] }))).toBe(false);
    expect(isValidDoc(doc({ type: 'paragraph', content: [{ type: 'text', text: 1 as any }] }))).toBe(false);
    expect(isValidDoc(doc({ type: 'codeBlock', attrs: { language: 5 } }))).toBe(false);
    expect(isValidDoc(doc({ type: 'orderedList', attrs: { start: 1.5 }, content: [] }))).toBe(false);
    expect(isValidDoc(doc({ type: 'orderedList', attrs: { start: 1, type: 3 }, content: [] }))).toBe(false);
  });

  it('isValidDoc rejects prototype-chain attr names and never throws', () => {
    for (const k of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      for (const v of ['"x"', 'null', '{"a":1}']) {
        const d = JSON.parse(`{"type":"doc","content":[{"type":"paragraph","attrs":{"${k}":${v}}}]}`);
        expect(isValidDoc(d)).toBe(false);
      }
    }
    expect(isValidDoc(JSON.parse('{"type":"doc","content":[{"type":"heading","attrs":{"level":2,"constructor":1},"content":[]}]}'))).toBe(false);
  });

  it('isValidDoc rejects null or missing heading.level and noteRef.ref', () => {
    expect(isValidDoc(doc({ type: 'heading', attrs: { level: null as any }, content: [t('x')] }))).toBe(false);
    expect(isValidDoc(doc({ type: 'heading', content: [t('x')] }))).toBe(false);
    expect(isValidDoc(doc(p({ type: 'noteRef', attrs: { ref: null as any } })))).toBe(false);
    expect(isValidDoc(doc(p({ type: 'noteRef', attrs: {} })))).toBe(false);
  });

  it('isValidDoc rejects empty text nodes', () => {
    expect(isValidDoc(doc(p({ type: 'text', text: '' })))).toBe(false);
    expect(isValidDoc(doc(h(2, '')))).toBe(false);
    expect(isValidDoc(doc({ type: 'codeBlock', content: [t('')] }))).toBe(false);
  });

  it('isValidDoc enforces the content model', () => {
    const li = (...content: DocNode[]): DocNode => ({ type: 'listItem', content });
    const ul = (...content: DocNode[]): DocNode => ({ type: 'bulletList', content });
    const br: DocNode = { type: 'hardBreak' };
    // doc 只能在根，且至少一个块
    expect(isValidDoc({ type: 'doc', content: [] })).toBe(false);
    expect(isValidDoc({ type: 'doc' })).toBe(false);
    expect(isValidDoc(doc(doc(p(t('x')))))).toBe(false);
    // doc 下只能是块级
    expect(isValidDoc(doc(t('x')))).toBe(false);
    expect(isValidDoc(doc(br))).toBe(false);
    expect(isValidDoc(doc(ref('h:1')))).toBe(false);
    expect(isValidDoc(doc(li(p(t('x')))))).toBe(false);
    // heading / paragraph 只含行内
    expect(isValidDoc(doc(p(p(t('x')))))).toBe(false);
    expect(isValidDoc(doc({ type: 'heading', attrs: { level: 2 }, content: [p(t('x'))] }))).toBe(false);
    expect(isValidDoc(doc(p(ul(li(p(t('x')))))))).toBe(false);
    // codeBlock 只含不带 marks 的 text
    expect(isValidDoc(doc({ type: 'codeBlock', content: [br] }))).toBe(false);
    expect(isValidDoc(doc({ type: 'codeBlock', content: [ref('h:1')] }))).toBe(false);
    expect(isValidDoc(doc({ type: 'codeBlock', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] }))).toBe(false);
    // 列表只含 listItem，且至少一个
    expect(isValidDoc(doc(ul()))).toBe(false);
    expect(isValidDoc(doc({ type: 'bulletList' }))).toBe(false);
    expect(isValidDoc(doc(ul(p(t('x')))))).toBe(false);
    expect(isValidDoc(doc({ type: 'orderedList', content: [p(t('x'))] }))).toBe(false);
    // listItem 第一个必须是 paragraph，之后只能是块级（不含 heading）
    expect(isValidDoc(doc(ul(li())))).toBe(false);
    expect(isValidDoc(doc(ul(li(ul(li(p(t('x'))))))))).toBe(false);
    expect(isValidDoc(doc(ul(li(h(2, 'x')))))).toBe(false);
    expect(isValidDoc(doc(ul(li(p(t('x')), h(2, 'y')))))).toBe(false);
    expect(isValidDoc(doc(ul(li(p(t('x')), t('y')))))).toBe(false);
    // 叶子节点不能有 content
    expect(isValidDoc(doc(p({ type: 'hardBreak', content: [] })))).toBe(false);
    expect(isValidDoc(doc(p({ type: 'noteRef', attrs: { ref: 'h:1' }, content: [t('x')] })))).toBe(false);
    expect(isValidDoc(doc(p({ type: 'text', text: 'x', content: [] } as any)))).toBe(false);
  });

  it('isValidDoc accepts valid nested lists, hardBreak and empty blocks', () => {
    const li = (...content: DocNode[]): DocNode => ({ type: 'listItem', content });
    const d = doc(
      h(2, '主题'),
      p(t('甲'), { type: 'hardBreak' }, { type: 'text', text: '乙', marks: [{ type: 'bold' }] }, ref('h:1')),
      p(),
      { type: 'heading', attrs: { level: 3 } },
      {
        type: 'bulletList',
        content: [
          li(p(t('一')), { type: 'orderedList', attrs: { start: 1, type: null }, content: [li(p(t('一.1'), ref('n:2')))] }, p(t('续')), { type: 'codeBlock', content: [t('c')] }),
          li(p()),
        ],
      },
      { type: 'codeBlock', attrs: { language: null } },
    );
    expect(isValidDoc(d)).toBe(true);
  });

  it('isValidDoc accepts tiptap default attrs', () => {
    const d = doc(
      { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [p(t('a'))] }] },
      { type: 'codeBlock', attrs: { language: null }, content: [t('x')] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('x')] },
    );
    expect(isValidDoc(d)).toBe(true);
  });

  it('docToBlocks flattens lists and keeps refs', () => {
    const d = doc(
      h(2, '主题'),
      p(t('正文'), { type: 'text', text: '粗', marks: [{ type: 'bold' }] }, ref('h:1')),
      {
        type: 'bulletList',
        content: [{
          type: 'listItem',
          content: [p(t('一')), { type: 'orderedList', content: [{ type: 'listItem', content: [p(t('一.1'), ref('n:2'))] }] }],
        }, { type: 'listItem', content: [p(t('二'))] }],
      },
      { type: 'codeBlock', content: [t('a\nb')] },
    );
    expect(docToBlocks(d)).toEqual([
      { type: 'h', level: 2, text: '主题' },
      { type: 'p', parts: [{ text: '正文' }, { text: '粗', bold: true }, { ref: 'h:1' }] },
      {
        type: 'list', ordered: false, items: [
          [{ text: '一' }],
          [{ text: '  ' }, { text: '一.1' }, { ref: 'n:2' }],
          [{ text: '二' }],
        ],
      },
      { type: 'code', text: 'a\nb' },
    ]);
  });

  it('docToMarkdown renders headings, lists, code and refs', () => {
    const d = doc(
      h(2, '主题'), h(3, '小节'),
      p(t('见'), { type: 'text', text: '粗', marks: [{ type: 'bold' }] }, { type: 'text', text: '斜', marks: [{ type: 'italic' }] }, { type: 'text', text: 'fn()', marks: [{ type: 'code' }] }, ref('h:1')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('甲'))] }, { type: 'listItem', content: [p(t('乙'))] }] },
      { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [p(t('一'))] }, { type: 'listItem', content: [p(t('二'))] }] },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('let a = 1;')] },
    );
    const md = docToMarkdown('三体', d, r => `第3章 ${r}`);
    expect(md).toBe([
      '# 三体 · 笔记整理', '',
      '## 主题', '',
      '### 小节', '',
      '见**粗***斜*`fn()`（出自：第3章 h:1）', '',
      '- 甲', '- 乙', '',
      '1. 一', '2. 二', '',
      '```ts', 'let a = 1;', '```', '',
    ].join('\n'));
  });

  it('docToMarkdown escapes markdown specials', () => {
    const d = doc(p(t('2*3 # a_b')));
    const md = docToMarkdown('书', d, r => r);
    expect(md).toContain('2\\*3 \\# a\\_b');
  });
});
