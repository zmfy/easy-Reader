import Database from 'better-sqlite3';
import { HIGHLIGHTS_DDL, createHighlight } from '../../src/services/highlights';
import { MIND_DDL, keepChain } from '../../src/services/mind-nodes';
import { STUDY_SUMMARY_DDL, resolveRef } from '../../src/services/study-summary';

function makeDb() {
  const d = new Database(':memory:');
  d.exec(HIGHLIGHTS_DDL);
  d.exec(MIND_DDL);
  d.exec(STUDY_SUMMARY_DDL);
  d.exec('CREATE TABLE reading_progress (user_id TEXT, book_id TEXT, chapter_index INTEGER, paragraph_index INTEGER)');
  return d;
}

// 书文件不存在：判断后文的读取失败被吞掉，later 为 false
const fakeBook = { id: 'b1', file_path: '/nonexistent/x.txt', file_format: 'txt' } as any;

describe('resolveRef', () => {
  it('resolveRef returns highlight target', async () => {
    const d = makeDb();
    const h = createHighlight(d, 'u1', 'b1', { chapterIndex: 2, startOffset: 0, endOffset: 3, text: '划线原文' });
    const r = await resolveRef(d, 'u1', 'b1', fakeBook, 'h:' + h.id);
    expect(r).toEqual({ exists: true, type: 'highlight', text: '划线原文', target: { highlight: h.id }, later: false, canOpen: true });
  });

  it('resolveRef returns chapter+find for node with source', async () => {
    const d = makeDb();
    const h = createHighlight(d, 'u1', 'b1', { chapterIndex: 0, startOffset: 0, endOffset: 3, text: '原文' });
    const [, node] = keepChain(d, 'u1', 'b1', h.id, [
      { label: '概念甲', kind: 'concept', summary: '说明', source: { chapterIndex: 5, paragraphIndex: 2 } },
    ])!;
    const r: any = await resolveRef(d, 'u1', 'b1', fakeBook, 'n:' + node.id);
    expect(r.exists).toBe(true);
    expect(r.type).toBe('node');
    expect(r.text).toBe('概念甲：说明');
    expect(r.target).toEqual({ chapter: 5, find: '概念甲' });
    expect(r.later).toBe(true); // 出处第 5 章在划线所在第 0 章之后
  });

  it('resolveRef falls back to chapter_index for node without source', async () => {
    const d = makeDb();
    const h = createHighlight(d, 'u1', 'b1', { chapterIndex: 3, startOffset: 0, endOffset: 3, text: '原文' });
    const [, node] = keepChain(d, 'u1', 'b1', h.id, [{ label: '概念乙', kind: 'concept' }])!;
    const r: any = await resolveRef(d, 'u1', 'b1', fakeBook, 'n:' + node.id);
    expect(r.target).toEqual({ chapter: 3 });
    expect(r.text).toBe('概念乙');
    expect(r.later).toBe(false);
  });

  it('resolveRef reports exists=false for deleted or others\' notes', async () => {
    const d = makeDb();
    const h = createHighlight(d, 'u1', 'b1', { chapterIndex: 0, startOffset: 0, endOffset: 3, text: '原文' });
    expect(await resolveRef(d, 'u2', 'b1', fakeBook, 'h:' + h.id)).toEqual({ exists: false });
    expect(await resolveRef(d, 'u1', 'b1', fakeBook, 'h:nope')).toEqual({ exists: false });
    expect(await resolveRef(d, 'u1', 'b1', fakeBook, 'bad-ref')).toEqual({ exists: false });
    expect(await resolveRef(d, 'u1', 'b1', fakeBook, 'n:' + h.id)).toEqual({ exists: false });
  });

  it('resolveRef canOpen=false when book is missing', async () => {
    const d = makeDb();
    const h = createHighlight(d, 'u1', 'b1', { chapterIndex: 0, startOffset: 0, endOffset: 3, text: '原文' });
    const r: any = await resolveRef(d, 'u1', 'b1', null, 'h:' + h.id);
    expect(r.exists).toBe(true);
    expect(r.canOpen).toBe(false);
    expect(r.later).toBe(false);
    // 书为 null 时也只认本书的笔记：其他书的 ref 不可解析
    expect(await resolveRef(d, 'u1', 'other', null, 'h:' + h.id)).toEqual({ exists: false });
  });
});
