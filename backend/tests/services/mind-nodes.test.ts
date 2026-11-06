import Database from 'better-sqlite3';
import { HIGHLIGHTS_DDL, createHighlight } from '../../src/services/highlights';
import { MIND_DDL, keepChain, listMindNodes, deleteMindSubtree, migrateMindTables, addCustomNode, updateMindNode } from '../../src/services/mind-nodes';

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

  it('adds a custom node under a chapter', () => {
    const { d } = setup();
    const a = addCustomNode(d, 'u1', 'b1', { chapterIndex: 2, label: '我的想法', note: '备注' })!;
    const b = addCustomNode(d, 'u1', 'b1', { chapterIndex: 2, label: '另一个' })!;
    expect(a).toMatchObject({ parent_id: null, highlight_id: null, kind: 'custom', chapter_index: 2, label: '我的想法', note: '备注' });
    expect(b.note).toBeNull();
    expect(b.sort).toBe(a.sort + 1);
  });

  it('adds under a kept node inheriting chapter and highlight', () => {
    const { d, h } = setup();
    const nodes = keepChain(d, 'u1', 'b1', h.id, chainA)!;
    const c = addCustomNode(d, 'u1', 'b1', { parentId: nodes[1].id, label: '补充' })!;
    expect(c).toMatchObject({ parent_id: nodes[1].id, chapter_index: 3, highlight_id: h.id, kind: 'custom' });
  });

  it('rejects a parent of another user', () => {
    const { d, h } = setup();
    const nodes = keepChain(d, 'u1', 'b1', h.id, chainA)!;
    expect(addCustomNode(d, 'u2', 'b1', { parentId: nodes[1].id, label: 'x' })).toBeNull();
    expect(addCustomNode(d, 'u1', 'b1', { parentId: 'nope', label: 'x' })).toBeNull();
  });

  it('updates label and note, empty note clears', () => {
    const { d } = setup();
    const a = addCustomNode(d, 'u1', 'b1', { chapterIndex: 0, label: '旧' })!;
    expect(updateMindNode(d, 'u1', 'b1', a.id, { label: '新', note: '批注' })).toMatchObject({ label: '新', note: '批注' });
    expect(updateMindNode(d, 'u1', 'b1', a.id, { note: '' })).toMatchObject({ label: '新', note: null });
  });

  it('refuses renaming a highlight root', () => {
    const { d, h } = setup();
    const root = keepChain(d, 'u1', 'b1', h.id, chainA)![0];
    expect(updateMindNode(d, 'u1', 'b1', root.id, { label: '改名' })).toBe('FORBIDDEN');
    // 划线节点的批注就是划线批注，不另存节点批注；清空（旧数据）仍允许
    expect(updateMindNode(d, 'u1', 'b1', root.id, { note: '批注' })).toBe('FORBIDDEN');
    d.prepare('UPDATE mind_nodes SET note = ? WHERE id = ?').run('旧批注', root.id);
    expect(updateMindNode(d, 'u1', 'b1', root.id, { note: '' })).toMatchObject({ note: null, label: root.label });
    expect(updateMindNode(d, 'u1', 'b1', root.id, { note: null })).toMatchObject({ note: null });
  });

  it("cannot update others' nodes", () => {
    const { d } = setup();
    const a = addCustomNode(d, 'u1', 'b1', { chapterIndex: 0, label: '旧' })!;
    expect(updateMindNode(d, 'u2', 'b1', a.id, { label: '新' })).toBeNull();
    expect(updateMindNode(d, 'u1', 'b1', 'nope', { label: '新' })).toBeNull();
  });
});
