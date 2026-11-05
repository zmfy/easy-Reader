import Database from 'better-sqlite3';
import { HIGHLIGHTS_DDL, createHighlight } from '../../src/services/highlights';
import { MIND_DDL, keepChain, listMindNodes, deleteMindSubtree, migrateMindTables } from '../../src/services/mind-nodes';

function setup() {
  const d = new Database(':memory:');
  d.exec(HIGHLIGHTS_DDL);
  d.exec(MIND_DDL);
  const h = createHighlight(d, 'u1', 'b1', { chapterIndex: 3, startOffset: 0, endOffset: 5, text: '项羽在鸿门宴上放走了刘邦' });
  return { d, h };
}
const chainA = [
  { label: '楚汉之争', kind: 'event' as const },
  { label: '鸿门宴', kind: 'event' as const, summary: '项羽放走刘邦', source: { chapterIndex: 2, paragraphIndex: 7 } },
];

describe('mind-nodes service', () => {
  it('keepChain creates root and chain', () => {
    const { d, h } = setup();
    const nodes = keepChain(d, 'u1', 'b1', h.id, chainA)!;
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({ kind: 'highlight', parent_id: null, chapter_index: 3, label: '项羽在鸿门宴上放走了刘邦' });
    expect(nodes[1].parent_id).toBe(nodes[0].id);
    expect(nodes[2].parent_id).toBe(nodes[1].id);
    expect(nodes[2]).toMatchObject({ source_chapter: 2, source_paragraph: 7, summary: '项羽放走刘邦' });
  });

  it('keepChain is idempotent and shares ancestors', () => {
    const { d, h } = setup();
    keepChain(d, 'u1', 'b1', h.id, chainA);
    keepChain(d, 'u1', 'b1', h.id, chainA);
    expect(listMindNodes(d, 'u1', 'b1')).toHaveLength(3);
    keepChain(d, 'u1', 'b1', h.id, [{ label: '楚汉之争', kind: 'event' }, { label: '刘邦', kind: 'person' }]);
    const all = listMindNodes(d, 'u1', 'b1', h.id);
    expect(all).toHaveLength(4);
    const clash = all.find(n => n.label === '楚汉之争')!;
    expect(all.find(n => n.label === '刘邦')!.parent_id).toBe(clash.id);
  });

  it("keepChain rejects others' highlight", () => {
    const { d, h } = setup();
    expect(keepChain(d, 'u2', 'b1', h.id, chainA)).toBeNull();
    expect(keepChain(d, 'u1', 'b2', h.id, chainA)).toBeNull();
  });

  it('deleteMindSubtree removes descendants only', () => {
    const { d, h } = setup();
    keepChain(d, 'u1', 'b1', h.id, chainA);
    keepChain(d, 'u1', 'b1', h.id, [{ label: '楚汉之争', kind: 'event' }, { label: '刘邦', kind: 'person' }]);
    const clash = listMindNodes(d, 'u1', 'b1').find(n => n.label === '楚汉之争')!;
    expect(deleteMindSubtree(d, 'u2', 'b1', clash.id)).toBe(0);
    expect(deleteMindSubtree(d, 'u1', 'b1', clash.id)).toBe(3);
    const left = listMindNodes(d, 'u1', 'b1');
    expect(left).toHaveLength(1);
    expect(left[0].kind).toBe('highlight');
  });

  it('migrateMindTables drops an old ai_expansions without ctx columns', () => {
    const d = new Database(':memory:');
    d.exec(`CREATE TABLE ai_expansions (book_id TEXT, center TEXT, chapter_index INTEGER, result TEXT,
      PRIMARY KEY (book_id, center, chapter_index))`);
    migrateMindTables(d);
    d.exec(MIND_DDL);
    const cols = (d.prepare("PRAGMA table_info('ai_expansions')").all() as Array<{ name: string }>).map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['ctx_from', 'ctx_to']));
    d.prepare("INSERT INTO ai_expansions (book_id, center, chapter_index, ctx_from, ctx_to, result) VALUES ('b', 'c', 0, 0, 1, '[]')").run();
    migrateMindTables(d); // 新表不动
    expect(d.prepare('SELECT COUNT(*) AS n FROM ai_expansions').get()).toEqual({ n: 1 });
  });
});
