import Database from 'better-sqlite3';
import {
  parseExpandResult, buildExpandPrompt, expandHighlight, AiBadOutputError,
  locateHighlightParagraph, findHighlightParagraph, pdfContextRange, readingBoundary, buildExpandContext, expandContextRange, listMindNodesWithLater,
} from '../../src/services/mind-expand';
import { HIGHLIGHTS_DDL, createHighlight } from '../../src/services/highlights';
import { MIND_DDL, keepChain } from '../../src/services/mind-nodes';
import { clearBookTextCache } from '../../src/services/book-text';
import { aiManager } from '../../src/ai/ai-manager';
import { getReaderPlugin } from '../../src/plugins/plugin-manager';
import { Book } from '../../src/types';

jest.mock('../../src/ai/ai-manager', () => ({ aiManager: { chat: jest.fn() } }));
jest.mock('../../src/plugins/plugin-manager', () => ({ getReaderPlugin: jest.fn() }));

const chat = aiManager.chat as jest.Mock;
const getChapterContent = jest.fn(async (i: number) => CHAPTERS[i].html);

// 6 章；第 5 章（index 4）含「剧透」
const CHAPTERS = [
  { title: '第一章 开端', html: '<p>周明瑞醒来。</p><p>梅丽莎是他的妹妹。</p>' },
  { title: '第二章 情况', html: '<p>他了解了处境。</p>' },
  { title: '第三章 占卜', html: '<p>甲段零</p><p>甲段一：灰雾之上</p><p>甲段二</p><p>甲段三</p>' },
  { title: '第四章 聚会', html: '<p>乙段零</p><p>乙段一</p><p>乙段二：塔罗会</p><p>乙段三</p>' },
  { title: '第五章 剧透', html: '<p>剧透人物登场。剧透人物是幕后黑手。</p>' },
  { title: '第六章 尾声', html: '<p>丙段</p>' },
];

const book = { id: 'b1', title: '诡秘之主', author: null, file_path: '/x', file_format: 'txt' } as unknown as Book;
let db: Database.Database;

function setProgress(userId: string, chapterIndex: number, paragraphIndex: number) {
  db.prepare(
    `INSERT OR REPLACE INTO reading_progress (id, user_id, book_id, chapter_index, paragraph_index)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`${userId}-p`, userId, book.id, chapterIndex, paragraphIndex);
}

const hl = (userId: string, chapterIndex: number, text: string) =>
  createHighlight(db, userId, book.id, { chapterIndex, startOffset: 0, endOffset: text.length, text });

const aiJson = (items: Array<{ label: string; kind: string; summary: string }>) => JSON.stringify(items);

beforeEach(() => {
  clearBookTextCache();
  db = new Database(':memory:');
  db.exec(HIGHLIGHTS_DDL);
  db.exec(MIND_DDL);
  db.exec(`CREATE TABLE reading_progress (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, book_id TEXT NOT NULL,
    chapter_index INTEGER DEFAULT 0, paragraph_index INTEGER DEFAULT 0, UNIQUE(user_id, book_id))`);
  chat.mockReset();
  getChapterContent.mockClear();
  (getReaderPlugin as jest.Mock).mockResolvedValue({
    getChapters: async () => CHAPTERS.map((c, index) => ({ index, title: c.title })),
    getChapterContent,
  });
});

describe('parseExpandResult', () => {
  it('parseExpandResult tolerates think tags, fences and junk', () => {
    const raw = '<think>想一想 [1]</think>好的，结果如下：\n```json\n'
      + '[{"label":" 灰雾 ","kind":"concept","summary":" 神秘空间 "},{"label":"克莱恩","kind":"person","summary":"主角"}]'
      + '\n```\n以上。';
    expect(parseExpandResult(raw, [])).toEqual([
      { label: '灰雾', kind: 'concept', summary: '神秘空间' },
      { label: '克莱恩', kind: 'person', summary: '主角' },
    ]);
  });

  it('drops invalid kinds, duplicates and excluded labels', () => {
    const raw = JSON.stringify([
      { label: '中心', kind: 'concept', summary: 'x' },
      { label: '上级', kind: 'event', summary: 'x' },
      { label: 'A', kind: 'place', summary: 'x' },
      { label: '', kind: 'event', summary: 'x' },
      { label: 'B', kind: 'event', summary: 'b1' },
      { label: 'B', kind: 'person', summary: 'b2' },
      { label: '一二三四五六七八九十一二三四五六七八九十多余', kind: 'concept', summary: '字'.repeat(100) },
      'junk',
      { label: 5, kind: 'event' },
    ]);
    const r = parseExpandResult(raw, ['中心', '上级']);
    expect(r.map(c => c.label)).toEqual(['B', '一二三四五六七八九十一二三四五六七八九十']);
    expect(r[0].summary).toBe('b1');
    expect(r[1].summary).toHaveLength(80);
  });

  it('keeps at most 8 candidates', () => {
    const raw = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ label: `词${i}`, kind: 'concept', summary: '' })));
    expect(parseExpandResult(raw, [])).toHaveLength(8);
  });

  it('throws AiBadOutputError when nothing usable', () => {
    expect(() => parseExpandResult('抱歉，我无法回答', [])).toThrow(AiBadOutputError);
    expect(() => parseExpandResult('[not json]', [])).toThrow(AiBadOutputError);
    expect(() => parseExpandResult('[{"label":"中心","kind":"event","summary":""}]', ['中心'])).toThrow(AiBadOutputError);
  });
});

describe('buildExpandPrompt', () => {
  it('includes book, chapter, excerpt, center, path and the JSON format', () => {
    const p = buildExpandPrompt({
      bookTitle: '诡秘之主', author: '爱潜水的乌贼', chapterTitle: '第三章', highlight: '灰雾之上',
      context: '甲段零\n甲段一：灰雾之上', center: '灰雾', path: ['灰雾之上'],
    });
    expect(p).toContain('《诡秘之主》');
    expect(p).toContain('爱潜水的乌贼');
    expect(p).toContain('第三章');
    expect(p).toContain('甲段零');
    expect(p).toContain('「灰雾」');
    expect(p).toContain('灰雾之上');
    expect(p).toContain('（存疑）');
    expect(p).toContain('[{"label":"","kind":"event|concept|person","summary":""}]');
  });

  it('omits author when absent', () => {
    const p = buildExpandPrompt({
      bookTitle: '书', author: null, chapterTitle: '章', highlight: '句', context: '句', center: '句', path: [],
    });
    expect(p).not.toContain('作者');
    expect(p).not.toContain('null');
  });
});

describe('boundary and context helpers', () => {
  it('locates the highlight paragraph, falling back to the first 20 chars, then 0', () => {
    const paras = ['甲', '一二三四五六七八九十一二三四五六七八九十尾', '乙一二三'];
    expect(locateHighlightParagraph(paras, '乙一')).toBe(2);
    expect(locateHighlightParagraph(paras, '一二三四五六七八九十一二三四五六七八九十尾\n乙一二三')).toBe(1);
    expect(locateHighlightParagraph(paras, '不存在')).toBe(0);
  });

  it('boundary is the later of progress and highlight', () => {
    const h = { chapterIndex: 2, paragraphIndex: 3 };
    expect(readingBoundary(null, h)).toBe(h);
    expect(readingBoundary({ chapterIndex: 2, paragraphIndex: 1 }, h)).toBe(h);
    expect(readingBoundary({ chapterIndex: 3, paragraphIndex: 0 }, h)).toEqual({ chapterIndex: 3, paragraphIndex: 0 });
  });

  it('context takes 3 before and 2 after, cut at the boundary', () => {
    const paras = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    expect(buildExpandContext(1, paras, 4, { chapterIndex: 2, paragraphIndex: 0 })).toBe('p1\np2\np3\np4\np5\np6');
    expect(buildExpandContext(1, paras, 4, { chapterIndex: 1, paragraphIndex: 5 })).toBe('p1\np2\np3\np4\np5');
    expect(buildExpandContext(1, paras, 1, { chapterIndex: 1, paragraphIndex: 1 })).toBe('p0\np1');
  });

  it('context range reports the paragraphs actually used', () => {
    expect(expandContextRange(1, 8, 4, { chapterIndex: 2, paragraphIndex: 0 })).toEqual({ from: 1, to: 6 });
    expect(expandContextRange(1, 8, 4, { chapterIndex: 1, paragraphIndex: 5 })).toEqual({ from: 1, to: 5 });
    expect(expandContextRange(1, 0, 0, { chapterIndex: 1, paragraphIndex: 0 })).toEqual({ from: 0, to: -1 });
  });
});

describe('expandHighlight', () => {
  it('never sends text beyond the reading boundary', async () => {
    setProgress('u1', 2, 1);
    const h = hl('u1', 2, '灰雾之上');
    chat.mockResolvedValue(aiJson([{ label: '灰雾', kind: 'concept', summary: 's' }]));
    await expandHighlight(db, book, 'u1', { highlightId: h.id });
    const prompt = chat.mock.calls[0][0] as string;
    expect(prompt).toContain('甲段零');
    expect(prompt).toContain('甲段一：灰雾之上');
    expect(prompt).not.toContain('甲段二');
    expect(prompt).not.toContain('甲段三');
    expect(prompt).not.toContain('乙段');
    expect(prompt).not.toContain('剧透');
    expect(prompt).not.toContain('丙段');
  });

  it('uses the highlight position when it is later than progress', async () => {
    setProgress('u1', 0, 0);
    const h = hl('u1', 3, '塔罗会');
    chat.mockResolvedValue(aiJson([{ label: '塔罗', kind: 'concept', summary: 's' }]));
    await expandHighlight(db, book, 'u1', { highlightId: h.id });
    const prompt = chat.mock.calls[0][0] as string;
    expect(prompt).toContain('乙段零');
    expect(prompt).toContain('乙段二：塔罗会');
    expect(prompt).not.toContain('乙段三');
    expect(prompt).toContain('第四章 聚会');
  });

  it('finds the highlight paragraph by its first 20 chars when it spans paragraphs', async () => {
    const h = hl('u1', 3, '乙段二：塔罗会\n乙段三');
    chat.mockResolvedValue(aiJson([{ label: '塔罗', kind: 'concept', summary: 's' }]));
    await expandHighlight(db, book, 'u1', { highlightId: h.id });
    const prompt = chat.mock.calls[0][0] as string;
    expect(prompt).toContain('乙段零');
  });

  it('passes center and path to the prompt and excludes them from candidates', async () => {
    const h = hl('u1', 2, '灰雾之上');
    chat.mockResolvedValue(aiJson([
      { label: '灰雾', kind: 'concept', summary: 's' },
      { label: '灰雾之上', kind: 'concept', summary: 's' },
      { label: '源堡', kind: 'concept', summary: 's' },
    ]));
    const r = await expandHighlight(db, book, 'u1', { highlightId: h.id, center: '灰雾', path: ['灰雾之上'] });
    expect(chat.mock.calls[0][0]).toContain('「灰雾」');
    expect(r!.candidates.map(c => c.label)).toEqual(['源堡']);
  });

  it('attaches sources and marks later ones', async () => {
    setProgress('u1', 2, 1);
    const h = hl('u1', 2, '灰雾之上');
    chat.mockResolvedValue(aiJson([
      { label: '梅丽莎', kind: 'person', summary: '妹妹' },
      { label: '剧透人物', kind: 'person', summary: '（存疑）' },
      { label: '全书没有', kind: 'concept', summary: 'x' },
    ]));
    const r = await expandHighlight(db, book, 'u1', { highlightId: h.id });
    expect(r!.cached).toBe(false);
    expect(r!.candidates).toEqual([
      { label: '梅丽莎', kind: 'person', summary: '妹妹', source: { chapterIndex: 0, paragraphIndex: 1, chapterTitle: '第一章 开端', later: false } },
      { label: '剧透人物', kind: 'person', summary: '（存疑）', source: { chapterIndex: 4, paragraphIndex: 0, chapterTitle: '第五章 剧透', later: true } },
      { label: '全书没有', kind: 'concept', summary: 'x', source: null },
    ]);
  });

  it('shares the cache when the context sent to AI is the same, recomputing later per user', async () => {
    // 划线在第 3 章第 3 段（最后一段）：两人的上下文都是第 0–3 段，但边界不同
    setProgress('u1', 5, 0);
    setProgress('u2', 2, 3);
    const h1 = hl('u1', 2, '甲段三');
    const h2 = hl('u2', 2, '甲段三');
    chat.mockResolvedValue(aiJson([{ label: '剧透人物', kind: 'person', summary: 's' }]));

    const first = await expandHighlight(db, book, 'u1', { highlightId: h1.id });
    expect(first!.cached).toBe(false);
    const again = await expandHighlight(db, book, 'u1', { highlightId: h1.id });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(again!.cached).toBe(true);
    expect(again!.candidates).toEqual(first!.candidates);

    const stored = db.prepare('SELECT result, ctx_from, ctx_to FROM ai_expansions').get() as { result: string; ctx_from: number; ctx_to: number };
    expect(stored.result).not.toContain('later');
    expect([stored.ctx_from, stored.ctx_to]).toEqual([0, 3]);

    const other = await expandHighlight(db, book, 'u2', { highlightId: h2.id });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(other!.cached).toBe(true);
    expect(other!.candidates[0].source!.later).toBe(true);
    expect(again!.candidates[0].source!.later).toBe(false);
  });

  it('a user with an earlier boundary does not hit a cache whose context went further', async () => {
    setProgress('u2', 5, 0);
    setProgress('u1', 2, 1);
    const h2 = hl('u2', 2, '灰雾之上');
    const h1 = hl('u1', 2, '灰雾之上');
    chat.mockResolvedValue(aiJson([{ label: '源堡', kind: 'concept', summary: 's' }]));

    await expandHighlight(db, book, 'u2', { highlightId: h2.id });
    expect(chat.mock.calls[0][0]).toContain('甲段二');
    const mine = await expandHighlight(db, book, 'u1', { highlightId: h1.id });
    expect(mine!.cached).toBe(false);
    expect(chat).toHaveBeenCalledTimes(2);
    expect(chat.mock.calls[1][0]).not.toContain('甲段二');
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_expansions').get()).toEqual({ n: 2 });
  });

  it('force bypasses and overwrites the cache', async () => {
    const h1 = hl('u1', 2, '灰雾之上');
    chat.mockResolvedValue(aiJson([{ label: '剧透人物', kind: 'person', summary: 's' }]));
    await expandHighlight(db, book, 'u1', { highlightId: h1.id });
    chat.mockResolvedValue(aiJson([{ label: '梅丽莎', kind: 'person', summary: 's' }]));
    const forced = await expandHighlight(db, book, 'u1', { highlightId: h1.id, force: true });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(forced!.cached).toBe(false);
    expect(forced!.candidates.map(c => c.label)).toEqual(['梅丽莎']);
    expect((await expandHighlight(db, book, 'u1', { highlightId: h1.id }))!.candidates.map(c => c.label)).toEqual(['梅丽莎']);
  });

  it('re-filters cached candidates by the current center and path', async () => {
    const h = hl('u1', 2, '灰雾之上');
    chat.mockResolvedValue(aiJson([
      { label: '灰雾', kind: 'concept', summary: 's' },
      { label: '梅丽莎', kind: 'person', summary: 's' },
    ]));
    await expandHighlight(db, book, 'u1', { highlightId: h.id, center: '源堡', path: ['灰雾之上'] });
    const r = await expandHighlight(db, book, 'u1', { highlightId: h.id, center: '源堡', path: ['灰雾之上', '灰雾'] });
    expect(r!.cached).toBe(true);
    expect(r!.candidates.map(c => c.label)).toEqual(['梅丽莎']);
  });

  it('treats a corrupt cache row as a miss', async () => {
    const h = hl('u1', 2, '灰雾之上');
    chat.mockResolvedValue(aiJson([{ label: '梅丽莎', kind: 'person', summary: 's' }]));
    await expandHighlight(db, book, 'u1', { highlightId: h.id });
    db.prepare("UPDATE ai_expansions SET result = '{oops'").run();
    const r = await expandHighlight(db, book, 'u1', { highlightId: h.id });
    expect(r!.cached).toBe(false);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('reads only the highlight chapter on a cache hit', async () => {
    const h = hl('u1', 2, '灰雾之上');
    chat.mockResolvedValue(aiJson([{ label: '梅丽莎', kind: 'person', summary: 's' }]));
    await expandHighlight(db, book, 'u1', { highlightId: h.id });
    clearBookTextCache();
    getChapterContent.mockClear();
    const r = await expandHighlight(db, book, 'u1', { highlightId: h.id });
    expect(r!.cached).toBe(true);
    expect(getChapterContent.mock.calls).toEqual([[2]]);
  });

  it('does not cache when AI output is unusable', async () => {
    const h = hl('u1', 2, '灰雾之上');
    chat.mockResolvedValue('无法回答');
    await expect(expandHighlight(db, book, 'u1', { highlightId: h.id })).rejects.toThrow(AiBadOutputError);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_expansions').get()).toEqual({ n: 0 });
  });

  it("returns null for another user's highlight", async () => {
    const h = hl('u1', 2, '灰雾之上');
    expect(await expandHighlight(db, book, 'u2', { highlightId: h.id })).toBeNull();
    expect(chat).not.toHaveBeenCalled();
  });
});

describe('listMindNodesWithLater', () => {
  it('marks kept nodes whose source is beyond the reading boundary', async () => {
    setProgress('u1', 2, 1);
    const h = hl('u1', 2, '灰雾之上');
    keepChain(db, 'u1', book.id, h.id, [
      { label: '梅丽莎', kind: 'person', source: { chapterIndex: 0, paragraphIndex: 1 } },
      { label: '剧透人物', kind: 'person', source: { chapterIndex: 4, paragraphIndex: 0 } },
      { label: '全书没有', kind: 'concept', source: null },
    ]);
    const nodes = await listMindNodesWithLater(db, book, 'u1');
    expect(nodes.map(n => [n.label, n.source_later])).toEqual([
      ['灰雾之上', false], ['梅丽莎', false], ['剧透人物', true], ['全书没有', false],
    ]);
    // 同一划线只读一次其所在章
    expect(getChapterContent.mock.calls).toEqual([[2]]);
  });

  it('uses the highlight position when progress is earlier', async () => {
    setProgress('u1', 0, 0);
    const h = hl('u1', 4, '幕后黑手');
    keepChain(db, 'u1', book.id, h.id, [
      { label: '剧透人物', kind: 'person', source: { chapterIndex: 4, paragraphIndex: 0 } },
      { label: '丙', kind: 'concept', source: { chapterIndex: 5, paragraphIndex: 0 } },
    ]);
    const nodes = await listMindNodesWithLater(db, book, 'u1', h.id);
    expect(nodes.map(n => n.source_later)).toEqual([false, false, true]);
  });
});

describe('pdf highlight context', () => {
  const pdfBook = { ...book, file_format: 'pdf' } as unknown as Book;

  it('findHighlightParagraph ignores whitespace differences', () => {
    const paras = ['First line of text', 'The quick brown fox jumps over', '中文 段落 内容'];
    expect(findHighlightParagraph(paras, 'quick  brown\nfox')).toBe(1);
    expect(findHighlightParagraph(paras, '中文段落')).toBe(2);
    expect(findHighlightParagraph(paras, '不存在')).toBe(-1);
    expect(locateHighlightParagraph(paras, '不存在')).toBe(0);
  });

  it('pdf highlight not found uses the whole page', () => {
    expect(pdfContextRange(7, -1)).toEqual({ from: 0, to: 6 });
    expect(pdfContextRange(10, 5)).toEqual({ from: 2, to: 7 });
    expect(pdfContextRange(3, 0)).toEqual({ from: 0, to: 2 });
  });

  it('expandHighlight on a pdf book does not cut context at the reading progress', async () => {
    setProgress('u1', 2, 0);
    const h = hl('u1', 2, '灰雾 之上');
    chat.mockResolvedValue(aiJson([{ label: '灰雾', kind: 'concept', summary: 's' }]));
    await expandHighlight(db, pdfBook, 'u1', { highlightId: h.id });
    const prompt = chat.mock.calls[0][0] as string;
    expect(prompt).toContain('甲段一：灰雾之上');
    expect(prompt).toContain('甲段三');
    expect(prompt).not.toContain('乙段');
  });

  it('expandHighlight on a pdf book uses the whole page when the text is not found', async () => {
    const h = hl('u1', 3, '页里没有的句子');
    chat.mockResolvedValue(aiJson([{ label: '塔罗', kind: 'concept', summary: 's' }]));
    await expandHighlight(db, pdfBook, 'u1', { highlightId: h.id });
    const prompt = chat.mock.calls[0][0] as string;
    for (const p of ['乙段零', '乙段一', '乙段二：塔罗会', '乙段三']) expect(prompt).toContain(p);
  });
});
