import Database from 'better-sqlite3';
import crypto from 'crypto';

// 建表 SQL：db.ts 初始化与测试共用
export const MIND_DDL = `
  CREATE TABLE IF NOT EXISTS mind_nodes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, book_id TEXT NOT NULL, parent_id TEXT,
    chapter_index INTEGER NOT NULL, highlight_id TEXT, label TEXT NOT NULL, kind TEXT NOT NULL,
    summary TEXT, note TEXT, source_chapter INTEGER, source_paragraph INTEGER,
    sort INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_mind_nodes_user_book ON mind_nodes(user_id, book_id);
  -- ctx_from / ctx_to：实际送给 AI 的上下文段落范围（防止边界更早的用户命中含后文的缓存）
  CREATE TABLE IF NOT EXISTS ai_expansions (
    book_id TEXT NOT NULL, center TEXT NOT NULL, chapter_index INTEGER NOT NULL,
    ctx_from INTEGER NOT NULL, ctx_to INTEGER NOT NULL,
    result TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (book_id, center, chapter_index, ctx_from, ctx_to)
  );
`;

/** 建表前迁移：旧版 ai_expansions 缺 ctx_from 列时直接删除重建（只是缓存） */
export function migrateMindTables(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info('ai_expansions')").all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some(c => c.name === 'ctx_from')) db.exec('DROP TABLE ai_expansions');
}

export type MindKind = 'highlight' | 'event' | 'concept' | 'person' | 'custom';

export interface MindNode {
  id: string; user_id: string; book_id: string; parent_id: string | null; chapter_index: number;
  highlight_id: string | null; label: string; kind: MindKind; summary: string | null; note: string | null;
  source_chapter: number | null; source_paragraph: number | null; sort: number; created_at: string;
}

export interface ChainItem {
  label: string;
  kind: Exclude<MindKind, 'highlight' | 'custom'>;
  summary?: string;
  source?: { chapterIndex: number; paragraphIndex: number } | null;
}

/** 某用户在某本书的导图节点；传 highlightId 时只取该划线下的节点 */
export function listMindNodes(db: Database.Database, userId: string, bookId: string, highlightId?: string): MindNode[] {
  if (highlightId) {
    return db
      .prepare('SELECT * FROM mind_nodes WHERE user_id = ? AND book_id = ? AND highlight_id = ? ORDER BY sort, created_at')
      .all(userId, bookId, highlightId) as MindNode[];
  }
  return db
    .prepare('SELECT * FROM mind_nodes WHERE user_id = ? AND book_id = ? ORDER BY sort, created_at')
    .all(userId, bookId) as MindNode[];
}

function nextSort(db: Database.Database, userId: string, bookId: string): number {
  return (db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM mind_nodes WHERE user_id = ? AND book_id = ?')
    .get(userId, bookId) as { n: number }).n;
}

/**
 * 找到或创建划线根节点，再沿 chain 逐级「同父同 label」找或建；返回整条链（含根）。
 * 划线不存在或非本人 → null
 */
export function keepChain(
  db: Database.Database, userId: string, bookId: string, highlightId: string, chain: ChainItem[]
): MindNode[] | null {
  const hl = db
    .prepare('SELECT chapter_index, text FROM highlights WHERE id = ? AND user_id = ? AND book_id = ?')
    .get(highlightId, userId, bookId) as { chapter_index: number; text: string } | undefined;
  if (!hl) return null;

  const findStmt = db.prepare(
    `SELECT * FROM mind_nodes WHERE user_id = ? AND book_id = ? AND highlight_id = ? AND label = ?
       AND parent_id IS ? ORDER BY created_at LIMIT 1`
  );
  const insertStmt = db.prepare(
    `INSERT INTO mind_nodes (id, user_id, book_id, parent_id, chapter_index, highlight_id, label, kind,
       summary, source_chapter, source_paragraph, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const getStmt = db.prepare('SELECT * FROM mind_nodes WHERE id = ?');

  const run = db.transaction((): MindNode[] => {
    const result: MindNode[] = [];
    let parentId: string | null = null;
    const items = [
      { label: Array.from(hl.text).slice(0, 30).join(''), kind: 'highlight' as MindKind, summary: undefined, source: null },
      ...chain,
    ] as Array<Omit<ChainItem, 'kind'> & { kind: MindKind }>;
    for (const item of items) {
      let node = findStmt.get(userId, bookId, highlightId, item.label, parentId) as MindNode | undefined;
      if (!node) {
        const id = crypto.randomUUID();
        const sort = nextSort(db, userId, bookId);
        insertStmt.run(
          id, userId, bookId, parentId, hl.chapter_index, highlightId, item.label, item.kind,
          item.summary ?? null, item.source?.chapterIndex ?? null, item.source?.paragraphIndex ?? null, sort
        );
        node = getStmt.get(id) as MindNode;
      }
      result.push(node);
      parentId = node.id;
    }
    return result;
  });
  return run();
}

/** 删除节点及其全部后代，返回删除条数（0 = 不存在或非本人） */
export function deleteMindSubtree(db: Database.Database, userId: string, bookId: string, nodeId: string): number {
  const r = db.prepare(
    `WITH RECURSIVE sub(id) AS (
       SELECT id FROM mind_nodes WHERE id = ? AND user_id = ? AND book_id = ?
       UNION ALL
       SELECT m.id FROM mind_nodes m JOIN sub ON m.parent_id = sub.id WHERE m.user_id = ? AND m.book_id = ?
     )
     DELETE FROM mind_nodes WHERE id IN (SELECT id FROM sub)`
  ).run(nodeId, userId, bookId, userId, bookId);
  return r.changes;
}

export function deleteMindNodesOfHighlight(db: Database.Database, userId: string, bookId: string, highlightId: string): void {
  db.prepare('DELETE FROM mind_nodes WHERE user_id = ? AND book_id = ? AND highlight_id = ?').run(userId, bookId, highlightId);
}

/**
 * 手动添加节点（kind 'custom'）。parentId 给定：挂在该节点下（须属于本人本书），chapter_index/highlight_id 继承父节点；
 * 否则挂在 chapterIndex 章下（parent_id null、highlight_id null）。父节点不存在/非本人 → null
 */
export function addCustomNode(
  db: Database.Database, userId: string, bookId: string,
  input: { parentId?: string; chapterIndex?: number; label: string; note?: string }
): MindNode | null {
  let parentId: string | null = null;
  let chapterIndex = input.chapterIndex ?? 0;
  let highlightId: string | null = null;
  if (input.parentId) {
    const parent = db.prepare('SELECT * FROM mind_nodes WHERE id = ? AND user_id = ? AND book_id = ?')
      .get(input.parentId, userId, bookId) as MindNode | undefined;
    if (!parent) return null;
    parentId = parent.id;
    chapterIndex = parent.chapter_index;
    highlightId = parent.highlight_id;
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO mind_nodes (id, user_id, book_id, parent_id, chapter_index, highlight_id, label, kind, note, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'custom', ?, ?)`
  ).run(id, userId, bookId, parentId, chapterIndex, highlightId, input.label, input.note || null, nextSort(db, userId, bookId));
  return db.prepare('SELECT * FROM mind_nodes WHERE id = ?').get(id) as MindNode;
}

/**
 * 改 label / note（note '' → null）。划线根节点（kind 'highlight'）不能改名，也不能写节点批注
 * （它的批注就是划线批注，在划线上编辑），尝试时返回 'FORBIDDEN'；清空批注仍允许。
 * 不存在/非本人 → null
 */
export function updateMindNode(
  db: Database.Database, userId: string, bookId: string, id: string,
  patch: { label?: string; note?: string | null }
): MindNode | null | 'FORBIDDEN' {
  const node = db.prepare('SELECT * FROM mind_nodes WHERE id = ? AND user_id = ? AND book_id = ?')
    .get(id, userId, bookId) as MindNode | undefined;
  if (!node) return null;
  if (node.kind === 'highlight') {
    if (patch.label !== undefined && patch.label !== node.label) return 'FORBIDDEN';
    if (patch.note) return 'FORBIDDEN';
  }
  const label = patch.label ?? node.label;
  const note = patch.note === undefined ? node.note : (patch.note || null);
  db.prepare('UPDATE mind_nodes SET label = ?, note = ? WHERE id = ?').run(label, note, id);
  return db.prepare('SELECT * FROM mind_nodes WHERE id = ?').get(id) as MindNode;
}
