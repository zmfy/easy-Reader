import Database from 'better-sqlite3';
import crypto from 'crypto';
import { aiManager } from '../ai/ai-manager';
import { appendAdditions, buildDoc, DocNode, listThemes, ThemeBlock } from './summary-doc';
import {
  buildGeneratePrompt, buildUpdatePrompt, parseThemes, splitBatches, StudyNote, SummaryAiOutputError,
} from './summary-ai';
import { collectNotes, getSummary, newNotes, SummaryJob, writeAiResult } from './study-summary';

type BatchOpts = { maxNotes?: number; maxChars?: number };
type StartResult = { job: SummaryJob; started: boolean } | { error: 'no_notes' | 'no_new_notes' | 'has_summary' };

const JOB_COLS = 'id, book_id, kind, status, done, total, error, created_at, finished_at';
const running = new Map<string, Promise<void>>();

function readJob(db: Database.Database, jobId: string): SummaryJob {
  return db.prepare(`SELECT ${JOB_COLS} FROM study_summary_jobs WHERE id = ?`).get(jobId) as SummaryJob;
}

export function getCurrentJob(db: Database.Database, userId: string, bookId: string): SummaryJob | null {
  const r = db.prepare(
    `SELECT ${JOB_COLS} FROM study_summary_jobs WHERE user_id = ? AND book_id = ? ORDER BY rowid DESC LIMIT 1`
  ).get(userId, bookId) as SummaryJob | undefined;
  return r || null;
}

/** 测试用：等待某任务的后台执行结束 */
export function waitJob(jobId: string): Promise<void> {
  return running.get(jobId) || Promise.resolve();
}

function failReason(e: unknown): string {
  if (e instanceof SummaryAiOutputError) return 'AI 返回的内容无法解析，请重试';
  const msg = e instanceof Error ? e.message : String(e);
  return msg.slice(0, 200);
}

function updateDescription(target: DocNode, additions: ThemeBlock[]): string {
  const existing = new Set(listThemes(target).map(t => t.trim()));
  const hit: string[] = [];
  const created: string[] = [];
  let count = 0;
  for (const a of additions) {
    const key = a.theme.trim();
    count += a.paragraphs.length;
    const list = existing.has(key) ? hit : created;
    if (!list.includes(key)) list.push(key);
  }
  let desc = `新增 ${count} 段`;
  if (hit.length) desc += '到' + hit.map(t => `『${t}』`).join('');
  if (created.length) desc += '，新建主题' + created.map(t => `『${t}』`).join('');
  return desc;
}

async function execute(
  db: Database.Database, jobId: string, userId: string, bookId: string, bookTitle: string, kind: 'generate' | 'update',
  batches: StudyNote[][], baseDoc: DocNode | null
): Promise<void> {
  let acc: DocNode | null = baseDoc; // 累积文档，仅用于给后续批次提供主题列表
  const additions: ThemeBlock[] = [];
  const sentRefs: string[] = [];

  for (const batch of batches) {
    const prompt = acc
      ? buildUpdatePrompt(bookTitle, listThemes(acc), batch)
      : buildGeneratePrompt(bookTitle, batch);
    const raw = await aiManager.chat(prompt, db);
    const themes = parseThemes(raw, new Set(batch.map(n => n.ref)));
    additions.push(...themes);
    acc = acc ? appendAdditions(acc, themes) : buildDoc(themes);
    sentRefs.push(...batch.map(n => n.ref));
    db.prepare('UPDATE study_summary_jobs SET done = done + 1 WHERE id = ?').run(jobId);
  }

  // 写入结果与标记完成在同一事务：任一步失败都不写入。写入前以最新文档为准，避免覆盖执行期间用户保存的内容
  db.transaction(() => {
    const latest = getSummary(db, userId, bookId);
    if (kind === 'generate' && !latest) {
      writeAiResult(db, userId, bookId, acc!, sentRefs, 'ai_generate', `初版，${listThemes(acc!).length} 个主题`);
    } else {
      const target = latest ? latest.doc : baseDoc!;
      writeAiResult(db, userId, bookId, appendAdditions(target, additions), sentRefs, 'ai_update', updateDescription(target, additions));
    }
    db.prepare("UPDATE study_summary_jobs SET status = 'done', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId);
  })();
}

export function startSummaryJob(
  db: Database.Database, userId: string, bookId: string, bookTitle: string, kind: 'generate' | 'update',
  opts?: BatchOpts
): StartResult {
  const cur = db.prepare(
    `SELECT ${JOB_COLS} FROM study_summary_jobs WHERE user_id = ? AND book_id = ? AND status = 'running' LIMIT 1`
  ).get(userId, bookId) as SummaryJob | undefined;
  if (cur) return { job: cur, started: false };

  const summary = getSummary(db, userId, bookId);
  if (kind === 'generate' && summary) return { error: 'has_summary' };
  // 没有总结时的「更新」等同于生成
  const realKind: 'generate' | 'update' = summary ? 'update' : 'generate';
  const all = collectNotes(db, userId, bookId);
  if (all.length === 0) return { error: 'no_notes' };
  const notes = newNotes(all, summary);
  if (notes.length === 0) return { error: 'no_new_notes' };
  const batches = splitBatches(notes, opts);

  const id = crypto.randomUUID();
  db.prepare("INSERT INTO study_summary_jobs (id, user_id, book_id, kind, status, done, total) VALUES (?, ?, ?, ?, 'running', 0, ?)")
    .run(id, userId, bookId, realKind, batches.length);

  const p = execute(db, id, userId, bookId, bookTitle, realKind, batches, summary ? summary.doc : null)
    .catch((e) => {
      try {
        db.prepare("UPDATE study_summary_jobs SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(failReason(e), id);
      } catch (markErr) {
        // 连标记失败都做不到（数据库不可用）：只能记日志，避免未处理的 rejection
        console.error(`[study:job] job=${id} 标记失败出错`, markErr, '原始错误', e);
      }
    })
    .finally(() => { running.delete(id); });
  running.set(id, p);
  return { job: readJob(db, id), started: true };
}
