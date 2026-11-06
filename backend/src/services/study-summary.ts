import Database from 'better-sqlite3';
import crypto from 'crypto';
import { DocNode, docText, listThemes } from './summary-doc';
import { StudyNote } from './summary-ai';
import { listHighlights } from './highlights';
import { listMindNodes, MindNode } from './mind-nodes';
import { listMindNodesWithLater } from './mind-expand';
import { Book } from '../types';

// 建表 SQL：db.ts 初始化与测试共用
export const STUDY_SUMMARY_DDL = `
  CREATE TABLE IF NOT EXISTS study_summaries (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, book_id TEXT NOT NULL,
    doc TEXT NOT NULL, included_refs TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, book_id)
  );
  CREATE TABLE IF NOT EXISTS study_summary_versions (
    id TEXT PRIMARY KEY, summary_id TEXT NOT NULL, doc TEXT NOT NULL, source TEXT NOT NULL, description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_study_summary_versions_summary ON study_summary_versions(summary_id);
  CREATE TABLE IF NOT EXISTS study_summary_jobs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, book_id TEXT NOT NULL,
    kind TEXT NOT NULL, status TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
    error TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, finished_at DATETIME
  );
  CREATE INDEX IF NOT EXISTS idx_study_summary_jobs_user_book ON study_summary_jobs(user_id, book_id);
`;

export interface StudySummary {
  id: string; book_id: string; doc: DocNode; included_refs: string[]; revision: number;
  created_at: string; updated_at: string;
}

export interface SummaryJob {
  id: string; book_id: string; kind: string; status: string; done: number; total: number;
  error: string | null; created_at: string; finished_at: string | null;
}

type SaveResult =
  | { ok: true; summary: StudySummary }
  | { ok: false; reason: 'conflict' | 'busy' | 'not_found'; summary?: StudySummary };

const MERGE_MINUTES = 30;

function clip30(s: string): string {
  return Array.from(s).slice(0, 30).join('');
}

/** 收集某本书的全部笔记：划线 + 非划线类导图节点，按章节再按创建时间排序 */
export function collectNotes(db: Database.Database, userId: string, bookId: string): StudyNote[] {
  const highlights = listHighlights(db, userId, bookId);
  const nodes = listMindNodes(db, userId, bookId);
  const hlById = new Map(highlights.map(h => [h.id, h]));
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const items: Array<{ note: StudyNote; createdAt: string }> = [];

  for (const h of highlights) {
    const note: StudyNote = { ref: 'h:' + h.id, kind: 'highlight', chapterIndex: h.chapter_index, text: h.text };
    if (h.note) note.note = h.note;
    items.push({ note, createdAt: h.created_at });
  }
  for (const n of nodes) {
    if (n.kind === 'highlight') continue;
    const note: StudyNote = { ref: 'n:' + n.id, kind: n.kind, chapterIndex: n.chapter_index, text: n.label };
    if (n.summary) note.summary = n.summary;
    if (n.note) note.note = n.note;
    const parent = n.parent_id ? nodeById.get(n.parent_id) : undefined;
    if (parent) {
      if (parent.kind === 'highlight') {
        const hl = parent.highlight_id ? hlById.get(parent.highlight_id) : undefined;
        note.parentLabel = clip30(hl ? hl.text : parent.label);
      } else {
        note.parentLabel = parent.label;
      }
    }
    items.push({ note, createdAt: n.created_at });
  }
  items.sort((a, b) =>
    a.note.chapterIndex - b.note.chapterIndex || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return items.map(i => i.note);
}

interface SummaryRow {
  id: string; book_id: string; doc: string; included_refs: string; revision: number; created_at: string; updated_at: string;
}

function toSummary(r: SummaryRow): StudySummary {
  return {
    id: r.id, book_id: r.book_id, doc: JSON.parse(r.doc), included_refs: JSON.parse(r.included_refs),
    revision: r.revision, created_at: r.created_at, updated_at: r.updated_at,
  };
}

export function getSummary(db: Database.Database, userId: string, bookId: string): StudySummary | null {
  const r = db.prepare('SELECT * FROM study_summaries WHERE user_id = ? AND book_id = ?').get(userId, bookId) as SummaryRow | undefined;
  return r ? toSummary(r) : null;
}

export function newNotes(notes: StudyNote[], summary: StudySummary | null): StudyNote[] {
  if (!summary) return notes;
  const included = new Set(summary.included_refs);
  return notes.filter(n => !included.has(n.ref));
}

function insertVersion(db: Database.Database, summaryId: string, doc: string, source: string, description: string): void {
  db.prepare('INSERT INTO study_summary_versions (id, summary_id, doc, source, description) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), summaryId, doc, source, description);
}

export function writeAiResult(
  db: Database.Database, userId: string, bookId: string, doc: DocNode, sentRefs: string[],
  source: 'ai_generate' | 'ai_update', description: string
): StudySummary {
  return db.transaction((): StudySummary => {
    const docJson = JSON.stringify(doc);
    const cur = getSummary(db, userId, bookId);
    let id: string;
    if (cur) {
      id = cur.id;
      const refs = Array.from(new Set([...cur.included_refs, ...sentRefs]));
      db.prepare('UPDATE study_summaries SET doc = ?, included_refs = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(docJson, JSON.stringify(refs), id);
    } else {
      id = crypto.randomUUID();
      db.prepare('INSERT INTO study_summaries (id, user_id, book_id, doc, included_refs, revision) VALUES (?, ?, ?, ?, ?, 1)')
        .run(id, userId, bookId, docJson, JSON.stringify(Array.from(new Set(sentRefs))));
    }
    insertVersion(db, id, docJson, source, description);
    return getSummary(db, userId, bookId)!;
  })();
}

function hasRunningJob(db: Database.Database, userId: string, bookId: string): boolean {
  return !!db.prepare("SELECT 1 FROM study_summary_jobs WHERE user_id = ? AND book_id = ? AND status = 'running' LIMIT 1").get(userId, bookId);
}

export function saveUserDoc(
  db: Database.Database, userId: string, bookId: string, doc: DocNode, baseRevision: number
): SaveResult {
  return db.transaction((): SaveResult => {
    const cur = getSummary(db, userId, bookId);
    if (!cur) return { ok: false, reason: 'not_found' };
    if (hasRunningJob(db, userId, bookId)) return { ok: false, reason: 'busy' };
    if (cur.revision !== baseRevision) return { ok: false, reason: 'conflict', summary: cur };
    const docJson = JSON.stringify(doc);
    db.prepare('UPDATE study_summaries SET doc = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(docJson, cur.id);
    const last = db.prepare(
      'SELECT id, source, updated_at > datetime(\'now\', ?) AS fresh FROM study_summary_versions WHERE summary_id = ? ORDER BY rowid DESC LIMIT 1'
    ).get(`-${MERGE_MINUTES} minutes`, cur.id) as { id: string; source: string; fresh: number } | undefined;
    if (last && last.source === 'user' && last.fresh) {
      db.prepare('UPDATE study_summary_versions SET doc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(docJson, last.id);
    } else {
      insertVersion(db, cur.id, docJson, 'user', '手动修改');
    }
    return { ok: true, summary: getSummary(db, userId, bookId)! };
  })();
}

export function listVersions(db: Database.Database, userId: string, bookId: string) {
  return db.prepare(
    `SELECT v.id, v.source, v.description, v.created_at, v.updated_at FROM study_summary_versions v
       JOIN study_summaries s ON s.id = v.summary_id
      WHERE s.user_id = ? AND s.book_id = ? ORDER BY v.rowid DESC`
  ).all(userId, bookId) as Array<{ id: string; source: string; description: string; created_at: string; updated_at: string }>;
}

export function getVersion(db: Database.Database, userId: string, bookId: string, versionId: string) {
  const r = db.prepare(
    `SELECT v.id, v.doc, v.source, v.description, v.updated_at FROM study_summary_versions v
       JOIN study_summaries s ON s.id = v.summary_id
      WHERE s.user_id = ? AND s.book_id = ? AND v.id = ?`
  ).get(userId, bookId, versionId) as { id: string; doc: string; source: string; description: string; updated_at: string } | undefined;
  return r ? { ...r, doc: JSON.parse(r.doc) as DocNode } : null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function restoreVersion(
  db: Database.Database, userId: string, bookId: string, versionId: string, baseRevision: number
): SaveResult {
  return db.transaction((): SaveResult => {
    const cur = getSummary(db, userId, bookId);
    const ver = getVersion(db, userId, bookId, versionId);
    if (!cur || !ver) return { ok: false, reason: 'not_found' };
    if (hasRunningJob(db, userId, bookId)) return { ok: false, reason: 'busy' };
    if (cur.revision !== baseRevision) return { ok: false, reason: 'conflict', summary: cur };
    const docJson = JSON.stringify(ver.doc);
    db.prepare('UPDATE study_summaries SET doc = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(docJson, cur.id);
    // updated_at 为 UTC，按服务器本地时区显示
    const t = new Date(ver.updated_at.replace(' ', 'T') + 'Z');
    insertVersion(db, cur.id, docJson, 'restore',
      `恢复到 ${pad2(t.getMonth() + 1)}-${pad2(t.getDate())} ${pad2(t.getHours())}:${pad2(t.getMinutes())} 的版本`);
    return { ok: true, summary: getSummary(db, userId, bookId)! };
  })();
}

export function deleteSummary(db: Database.Database, userId: string, bookId: string): boolean {
  return db.transaction((): boolean => {
    const cur = getSummary(db, userId, bookId);
    if (!cur || hasRunningJob(db, userId, bookId)) return false;
    db.prepare('DELETE FROM study_summary_versions WHERE summary_id = ?').run(cur.id);
    db.prepare('DELETE FROM study_summaries WHERE id = ?').run(cur.id);
    db.prepare("DELETE FROM study_summary_jobs WHERE user_id = ? AND book_id = ? AND status != 'running'").run(userId, bookId);
    return true;
  })();
}

export function listSummaryOverview(db: Database.Database, userId: string, q?: string) {
  const ids = db.prepare(
    `SELECT book_id FROM highlights WHERE user_id = ?
     UNION SELECT book_id FROM mind_nodes WHERE user_id = ? AND kind != 'highlight'
     UNION SELECT book_id FROM study_summaries WHERE user_id = ?`
  ).all(userId, userId, userId) as Array<{ book_id: string }>;
  const titleStmt = db.prepare('SELECT title FROM books WHERE id = ?');
  const jobStmt = db.prepare(
    `SELECT id, book_id, kind, status, done, total, error, created_at, finished_at FROM study_summary_jobs
      WHERE user_id = ? AND book_id = ? ORDER BY (status = 'running') DESC, rowid DESC LIMIT 1`
  );
  const needle = q ? q.trim().toLowerCase() : '';
  const out: Array<{
    bookId: string; bookTitle: string | null; hasSummary: boolean; themes: string[]; noteCount: number;
    newNoteCount: number; updatedAt: string | null; lastSource: string | null; job: SummaryJob | null;
  }> = [];

  for (const { book_id: bookId } of ids) {
    const bookRow = titleStmt.get(bookId) as { title: string } | undefined;
    const bookTitle = bookRow ? bookRow.title : null;
    const summary = getSummary(db, userId, bookId);
    if (needle) {
      const hit = (bookTitle || '').toLowerCase().includes(needle)
        || (summary ? docText(summary.doc).toLowerCase().includes(needle) : false);
      if (!hit) continue;
    }
    const notes = collectNotes(db, userId, bookId);
    const last = summary
      ? db.prepare('SELECT source FROM study_summary_versions WHERE summary_id = ? ORDER BY rowid DESC LIMIT 1').get(summary.id) as { source: string } | undefined
      : undefined;
    out.push({
      bookId, bookTitle, hasSummary: !!summary,
      themes: summary ? listThemes(summary.doc) : [],
      noteCount: notes.length, newNoteCount: newNotes(notes, summary).length,
      updatedAt: summary ? summary.updated_at : null,
      lastSource: last ? last.source : null,
      job: (jobStmt.get(userId, bookId) as SummaryJob | undefined) || null,
    });
  }
  out.sort((a, b) => {
    if (a.updatedAt === b.updatedAt) return 0;
    if (a.updatedAt === null) return 1;
    if (b.updatedAt === null) return -1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
  return out;
}

/** 启动恢复：服务重启时遗留的 running 任务标记失败 */
export function failStaleSummaryJobs(db: Database.Database): void {
  db.prepare("UPDATE study_summary_jobs SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE status = 'running'")
    .run('service restarted while task was running');
}

const REF_PARSE = /^(h|n):([\w-]{1,64})$/;
const clip200 = (s: string) => Array.from(s).slice(0, 200).join('');

/** 引用指向的笔记：划线或导图节点；不存在 / 非本人本书 → null。chapterIndex 为笔记所在章（0 起） */
export function findRefNote(
  db: Database.Database, userId: string, bookId: string, ref: string
): { type: 'highlight'; text: string; chapterIndex: number; id: string } | { type: 'node'; text: string; chapterIndex: number; node: MindNode } | null {
  const m = REF_PARSE.exec(ref);
  if (!m) return null;
  if (m[1] === 'h') {
    const h = db.prepare('SELECT id, chapter_index, text FROM highlights WHERE id = ? AND user_id = ? AND book_id = ?')
      .get(m[2], userId, bookId) as { id: string; chapter_index: number; text: string } | undefined;
    return h ? { type: 'highlight', text: h.text, chapterIndex: h.chapter_index, id: h.id } : null;
  }
  const n = db.prepare('SELECT * FROM mind_nodes WHERE id = ? AND user_id = ? AND book_id = ?')
    .get(m[2], userId, bookId) as MindNode | undefined;
  return n ? { type: 'node', text: n.summary ? `${n.label}：${n.summary}` : n.label, chapterIndex: n.chapter_index, node: n } : null;
}

export type ResolvedRef =
  | { exists: false }
  | {
    exists: true; type: 'highlight' | 'node'; text: string;
    target: { highlight: string } | { chapter: number; find?: string }; later: boolean; canOpen: boolean;
  };

/**
 * 解析总结中的引用标识（h:划线id / n:节点id）。
 * book 为 null（书已删除或文件不存在）→ canOpen=false；later 仅在书可读时判断（读书文件失败按 false）。
 */
export async function resolveRef(
  db: Database.Database, userId: string, bookId: string, book: Book | null, ref: string
): Promise<ResolvedRef> {
  const note = findRefNote(db, userId, bookId, ref);
  if (!note) return { exists: false };
  const canOpen = !!book;
  if (note.type === 'highlight') {
    return { exists: true, type: 'highlight', text: clip200(note.text), target: { highlight: note.id }, later: false, canOpen };
  }
  const n = note.node;
  const target = n.source_chapter != null ? { chapter: n.source_chapter, find: n.label } : { chapter: n.chapter_index };
  let later = false;
  if (book && n.source_chapter != null) {
    try {
      const nodes = await listMindNodesWithLater(db, book, userId, n.highlight_id || undefined);
      later = !!nodes.find(x => x.id === n.id)?.source_later;
    } catch (err) {
      console.error(`[study-summary] resolveRef later book=${book.id}`, err);
    }
  }
  return { exists: true, type: 'node', text: clip200(note.text), target, later, canOpen };
}
