import fs from 'fs';
import Database from 'better-sqlite3';
import { resolveRealPathInsideRoot } from '../../utils/path-safe';
import { removeCoverFiles } from '../../utils/cover';
import { deleteBookCascade, DeleteRequest } from '../file-deleter';
import { deleteBookRelations } from '../relation-cleanup';
import { recordSkip } from '../scan-skips';
import { writeAudit } from '../audit-log';
import type { OrganizedDuplicatePayload } from './job';
import { PositionMapper, ReadingPos } from './position-map';
import { organizedDir } from './writer';

/**
 * 整理审核的决定（审核项 organized_duplicate）：
 *  - keep_new_*：读者在原书上的进度 / 书签 / 书架 / 历史迁到整理版，整理版改回原书名并上架，原书按决定隐藏 / 删记录 / 删文件；
 *  - keep_old：删除整理版（记录、文件、封面副本、章节对照表），记住这个版本被拒绝过，原书不动。
 * 位置换算要解析原书（异步），所以先在事务外算好，事务里只写库。
 */

const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';
const ORGANIZED_SUFFIX = '（整理版）';

export const ORGANIZE_DECISIONS = ['keep_new_hide_old', 'keep_new_delete_record', 'keep_new_delete_file', 'keep_old'] as const;
export type OrganizeDecision = typeof ORGANIZE_DECISIONS[number];
export const DEFAULT_ORGANIZE_DECISION: OrganizeDecision = 'keep_new_hide_old';

export interface ApplySummary {
  decision: OrganizeDecision;
  migrated: { progress: number; bookmarks: number; shelf: number; history: number };
  /** 提交之后删文件失败等不影响结果的问题 */
  warnings: string[];
}

/** 审核项上管理员的选择：admin_payload.decision；没选时「拒绝」= 保留原书，其余默认 keep_new_hide_old */
export function organizeDecisionOf(item: { admin_decision: string | null; admin_payload: string | null }): OrganizeDecision {
  try {
    const d = item.admin_payload ? (JSON.parse(item.admin_payload) as { decision?: unknown }).decision : undefined;
    if ((ORGANIZE_DECISIONS as readonly unknown[]).includes(d)) return d as OrganizeDecision;
  } catch { /* 损坏的 admin_payload 按未选择处理 */ }
  return item.admin_decision === 'reject' ? 'keep_old' : DEFAULT_ORGANIZE_DECISION;
}

interface ProgressRow {
  id: string;
  user_id: string;
  chapter_index: number | null;
  paragraph_index: number | null;
  paragraph_offset: number | null;
  updated_at: string | null;
}

const posKey = (r: { chapter_index: number | null; paragraph_index: number | null; paragraph_offset: number | null }) =>
  `${r.chapter_index ?? 0}|${r.paragraph_index ?? 0}|${r.paragraph_offset ?? 0}`;

export async function applyOrganizeDecision(
  item: { payload: OrganizedDuplicatePayload },
  decision: OrganizeDecision,
  adminUserId: string,
  db: Database.Database,
  opts: { batchStatus?: 'applied' | 'discarded' } = {},
): Promise<ApplySummary> {
  const { job_id: jobId } = item.payload;
  const orgId = item.payload.organized.book_id;
  const origId = item.payload.original.book_id;
  const jobRow = db.prepare('SELECT src_size, src_mtime FROM txt_organize_jobs WHERE id = ?').get(jobId) as
    | { src_size: number | null; src_mtime: number | null }
    | undefined;
  if (!jobRow) throw new Error('整理任务不存在');
  const loadOriginal = () => db.prepare('SELECT id, file_path, file_size FROM books WHERE id = ?').get(origId) as
    | { id: string; file_path: string; file_size: number | null }
    | undefined;
  const original = loadOriginal();
  const srcPath = original ? resolveRealPathInsideRoot(BOOKS_DIR, original.file_path) : null;
  const srcStat = srcPath ? fs.statSync(srcPath) : null;

  const summary: ApplySummary = { decision, migrated: { progress: 0, bookmarks: 0, shelf: 0, history: 0 }, warnings: [] };

  // ---- 事务外：算好进度换算、确认删除文件的路径合法 ----
  let mapper: PositionMapper | null = null;
  const mappedProgress = new Map<string, ReadingPos>();
  let deleteReq: DeleteRequest | null = null;
  let deleteFileAfterCommit = false;
  let batchId = '';
  if (decision !== 'keep_old' && original) {
    // 原文件不在了，或整理之后被改过：对照表的字节区间对不上，按章节比例换算
    const changed = !srcStat || srcStat.size !== jobRow.src_size || srcStat.mtimeMs !== jobRow.src_mtime;
    mapper = await PositionMapper.create(srcPath ?? original.file_path, orgId, db, { forceProportional: changed });
    const rows = db.prepare(
      'SELECT id, user_id, chapter_index, paragraph_index, paragraph_offset, updated_at FROM reading_progress WHERE book_id = ?'
    ).all(origId) as ProgressRow[];
    for (const r of rows) {
      const key = posKey(r);
      if (mappedProgress.has(key)) continue;
      mappedProgress.set(key, await mapper.mapProgress({
        chapterIndex: r.chapter_index ?? 0, paragraphIndex: r.paragraph_index ?? 0, paragraphOffset: r.paragraph_offset ?? 0,
      }));
    }
    if (decision === 'keep_new_delete_record' || decision === 'keep_new_delete_file') {
      deleteReq = { file_path: original.file_path, book_id: origId, cascade_duplicate_ids: [], cascade_duplicate_paths: [], user_id: adminUserId };
      // 路径不在书库内时在改动任何数据之前就失败
      if (decision === 'keep_new_delete_file') deleteBookCascade(deleteReq, { dryRun: true });
    }
  }

  // ---- 事务：只写库 ----
  db.transaction(() => {
    const batch = db.prepare("SELECT id FROM scan_batches WHERE task_id = ? AND kind = 'organize' AND status = 'pending'").get(jobId) as
      | { id: string }
      | undefined;
    if (!batch) throw new Error('审核批次不存在或已处理');
    batchId = batch.id;

    if (decision === 'keep_old') {
      deleteBookRelations(db, [orgId]);
      db.prepare('DELETE FROM books WHERE id = ?').run(orgId);
      db.prepare('DELETE FROM txt_organize_chapter_map WHERE book_id = ?').run(orgId);
      // 记住「这本书的这个版本整理过一次被拒绝」：以整理时的原文件为准
      const size = jobRow.src_size ?? original?.file_size ?? null;
      if (loadOriginal() && size != null) {
        db.prepare(
          `INSERT INTO txt_organize_rejections (book_id, file_size, file_mtime, rejected_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(book_id, file_size) DO UPDATE SET file_mtime = excluded.file_mtime, rejected_at = CURRENT_TIMESTAMP`
        ).run(origId, size, jobRow.src_mtime);
      }
    } else {
      const orgBook = db.prepare('SELECT title FROM books WHERE id = ?').get(orgId) as { title: string } | undefined;
      if (!orgBook) throw new Error('整理版不存在');
      const title = orgBook.title.endsWith(ORGANIZED_SUFFIX) ? orgBook.title.slice(0, -ORGANIZED_SUFFIX.length) : orgBook.title;
      db.prepare("UPDATE books SET title = ?, status = 'normal', duplicate_of = NULL WHERE id = ?").run(title, orgId);
      // 审核期间原书被删了：没有可迁移的数据
      if (mapper && loadOriginal()) {
        migrateReaderData(db, origId, orgId, mapper, mappedProgress, item.payload, summary);
        // 原来是原书副本的书改为指向整理版
        db.prepare('UPDATE books SET duplicate_of = ? WHERE duplicate_of = ? AND id != ?').run(orgId, origId, orgId);
        if (decision === 'keep_new_hide_old') {
          db.prepare("UPDATE books SET status = 'duplicate', duplicate_of = ? WHERE id = ?").run(orgId, origId);
        } else if (deleteReq) {
          // 迁移完成后再删原书记录；原文件等事务提交后再删（事务回滚时文件不能已经没了）
          if (decision === 'keep_new_delete_record' && srcStat) {
            recordSkip(db, { file_path: deleteReq.file_path, file_size: srcStat.size, file_mtime: srcStat.mtimeMs });
          }
          deleteBookCascade(deleteReq, { keepFiles: true });
          deleteFileAfterCommit = decision === 'keep_new_delete_file';
        }
      }
    }

    db.prepare("UPDATE txt_organize_jobs SET status = 'done', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId);
    db.prepare(
      'UPDATE scan_batches SET status = ?, applied_at = CURRENT_TIMESTAMP, applied_by = ?, apply_summary = ? WHERE id = ?'
    ).run(opts.batchStatus ?? 'applied', adminUserId, JSON.stringify(summary), batch.id);
    writeAudit({
      user_id: adminUserId,
      action: 'organize_apply',
      resource_id: orgId,
      file_path: item.payload.organized.file_path,
      details: { ...summary, job_id: jobId, original_book_id: origId },
    });
  })();

  // ---- 提交后删文件：失败只记警告，不撤销已提交的决定 ----
  if (deleteFileAfterCommit && deleteReq) {
    const real = resolveRealPathInsideRoot(BOOKS_DIR, deleteReq.file_path);
    let deleted = false;
    if (!real) {
      summary.warnings.push(`原文件不存在：${deleteReq.file_path}`);
    } else {
      try {
        fs.rmSync(real);
        deleted = true;
      } catch (err) {
        const message = `删除原文件失败：${deleteReq.file_path}：${(err as Error).message}`;
        console.warn(`[txt-organize ${jobId}] ${message}`);
        summary.warnings.push(message);
      }
    }
    writeAudit({
      user_id: adminUserId,
      action: 'delete_book_file',
      resource_id: origId,
      file_path: deleteReq.file_path,
      details: { files_deleted: deleted ? 1 : 0, organize_job_id: jobId },
    });
    if (summary.warnings.length > 0) {
      db.prepare('UPDATE scan_batches SET apply_summary = ? WHERE id = ?').run(JSON.stringify(summary), batchId);
    }
  }

  // ---- 提交后：保留原书时删除整理版文件（只删整理版目录里的）和封面副本 ----
  if (decision === 'keep_old') {
    const real = resolveRealPathInsideRoot(organizedDir(), item.payload.organized.file_path);
    if (real) fs.rmSync(real, { force: true });
    removeCoverFiles(orgId);
  }
  return summary;
}

/** 采用整理版时从原书复制到整理版的列 */
const INHERITED_COLUMNS = [
  'is_finished', 'tags', 'rating', 'publish_date', 'finish_date', 'series_id',
  'manually_edited_fields', 'ai_fill_version', 'ai_fill_status', 'ai_reviewed_at',
];

/** 同一用户两本书都有记录时，时间较新的胜出（相同时保留整理版上的） */
const newer = (a: string | null, b: string | null) => (a ?? '') > (b ?? '');

/** 原书的进度 / 书签 / 书架 / 历史迁到整理版，复制书目信息与 AI 书目信息，删除按章节序号存的数据。在调用方事务内执行 */
function migrateReaderData(
  db: Database.Database,
  origId: string,
  orgId: string,
  mapper: PositionMapper,
  mappedProgress: Map<string, ReadingPos>,
  payload: OrganizedDuplicatePayload,
  summary: ApplySummary,
): void {
  const m = summary.migrated;
  const chapterTitle = (i: number) => payload.organized.toc[i]?.title ?? null;

  // 阅读进度：位置换算（事务外算好；事务外之后才写入的新进度按章节换算）
  const progress = db.prepare(
    'SELECT id, user_id, chapter_index, paragraph_index, paragraph_offset, updated_at FROM reading_progress WHERE book_id = ?'
  ).all(origId) as ProgressRow[];
  for (const r of progress) {
    const existing = db.prepare('SELECT id, updated_at FROM reading_progress WHERE user_id = ? AND book_id = ?').get(r.user_id, orgId) as
      | { id: string; updated_at: string | null }
      | undefined;
    if (existing && !newer(r.updated_at, existing.updated_at)) {
      db.prepare('DELETE FROM reading_progress WHERE id = ?').run(r.id);
      continue;
    }
    if (existing) db.prepare('DELETE FROM reading_progress WHERE id = ?').run(existing.id);
    const pos = mappedProgress.get(posKey(r))
      ?? { chapterIndex: mapper.mapChapter(r.chapter_index ?? 0), paragraphIndex: 0, paragraphOffset: 0 };
    db.prepare(
      `UPDATE reading_progress SET book_id = ?, chapter_index = ?, chapter_title = ?, paragraph_index = ?, paragraph_offset = ?, scroll_top = 0
       WHERE id = ?`
    ).run(orgId, pos.chapterIndex, chapterTitle(pos.chapterIndex), pos.paragraphIndex, pos.paragraphOffset, r.id);
    m.progress++;
  }

  // 书签：全部迁移到所在章节，章内位置回到章首
  const bookmarks = db.prepare('SELECT id, chapter_index FROM bookmarks WHERE book_id = ?').all(origId) as Array<{ id: string; chapter_index: number }>;
  const moveBookmark = db.prepare('UPDATE bookmarks SET book_id = ?, chapter_index = ?, scroll_top = 0 WHERE id = ?');
  for (const b of bookmarks) {
    moveBookmark.run(orgId, mapper.mapChapter(b.chapter_index), b.id);
    m.bookmarks++;
  }

  // 书架：以最近阅读（没有则加入时间）比较
  const shelf = db.prepare('SELECT id, user_id, COALESCE(last_read_at, added_at) AS t FROM shelf WHERE book_id = ?').all(origId) as
    Array<{ id: string; user_id: string; t: string | null }>;
  for (const s of shelf) {
    const existing = db.prepare('SELECT id, COALESCE(last_read_at, added_at) AS t FROM shelf WHERE user_id = ? AND book_id = ?').get(s.user_id, orgId) as
      | { id: string; t: string | null }
      | undefined;
    if (existing && !newer(s.t, existing.t)) {
      db.prepare('DELETE FROM shelf WHERE id = ?').run(s.id);
      continue;
    }
    if (existing) db.prepare('DELETE FROM shelf WHERE id = ?').run(existing.id);
    db.prepare('UPDATE shelf SET book_id = ? WHERE id = ?').run(orgId, s.id);
    m.shelf++;
  }

  // 阅读历史
  const history = db.prepare('SELECT user_id, opened_at FROM reading_history WHERE book_id = ?').all(origId) as
    Array<{ user_id: string; opened_at: string | null }>;
  for (const h of history) {
    const existing = db.prepare('SELECT opened_at FROM reading_history WHERE user_id = ? AND book_id = ?').get(h.user_id, orgId) as
      | { opened_at: string | null }
      | undefined;
    if (existing && !newer(h.opened_at, existing.opened_at)) {
      db.prepare('DELETE FROM reading_history WHERE user_id = ? AND book_id = ?').run(h.user_id, origId);
      continue;
    }
    if (existing) db.prepare('DELETE FROM reading_history WHERE user_id = ? AND book_id = ?').run(h.user_id, orgId);
    db.prepare('UPDATE reading_history SET book_id = ? WHERE user_id = ? AND book_id = ?').run(orgId, h.user_id, origId);
    m.history++;
  }

  // 整理版就是同一本书：入库时只带了书名 / 作者 / 简介 / 分类 / 封面，其余书目信息和 AI 填充状态照原书补上
  // （系列也继承；hide_old 时原书已是副本，系列里不重复显示）。AI 填充状态一并复制，免得批量填充又去处理整理版
  const inherited = INHERITED_COLUMNS.join(', ');
  db.prepare(`UPDATE books SET (${inherited}) = (SELECT ${inherited} FROM books WHERE id = ?) WHERE id = ?`).run(origId, orgId);

  // AI 书目信息复制到整理版（整理版已有的不覆盖）；按章节序号存的数据换了目录就不对了，删掉
  db.prepare(
    `INSERT OR IGNORE INTO book_ai_metadata (book_id, recommended_tags, similar_works, generated_by, generated_at, adaptations)
     SELECT ?, recommended_tags, similar_works, generated_by, generated_at, adaptations FROM book_ai_metadata WHERE book_id = ?`
  ).run(orgId, origId);
  for (const table of ['ai_recaps', 'ai_suggestions', 'book_chapter_overrides']) {
    db.prepare(`DELETE FROM ${table} WHERE book_id = ?`).run(origId);
  }
}
