import { randomUUID } from 'crypto';
import { getDb } from '../db';
import { getActivePluginName } from '../ai/ai-manager';
import { applySuggestion, SuggestionNotFoundError, SuggestionSelection } from './ai-suggestions';
import { addNotice } from './notices';

/**
 * 待确认页「全部采纳」的后台任务：逐本调用 applySuggestion，一次只跑一个任务、其余排队。
 * 与扫描 / 填充任务互不占锁，可同时进行。重启后未完成的任务（db.ts 改回 pending）继续跑，
 * 已采纳的书建议已删除，再遇到时计为跳过。
 */

export interface ApplyJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  batch_no: number | null;
  total: number;
  done: number;
  failed: number;
  started_by: string;
  created_at: string;
  finished_at: string | null;
  error: string | null;
}

let workerRunning = false;

export function enqueueApplyJob(items: SuggestionSelection[], userId: string, batchNo: number | null): ApplyJob {
  const db = getDb();
  const id = randomUUID();
  // 只收还在待确认、且没交给别的任务的书
  const free = db.prepare('SELECT 1 FROM ai_suggestions WHERE book_id = ? AND apply_job_id IS NULL');
  const claim = db.prepare('UPDATE ai_suggestions SET apply_job_id = ? WHERE book_id = ?');
  const accepted: SuggestionSelection[] = [];
  db.transaction(() => {
    for (const it of items) {
      if (!free.get(it.book_id)) continue;
      claim.run(id, it.book_id);
      accepted.push(it);
    }
    db.prepare(
      `INSERT INTO ai_apply_jobs (id, status, batch_no, total, items, started_by) VALUES (?, 'pending', ?, ?, ?, ?)`
    ).run(id, batchNo, accepted.length, JSON.stringify(accepted), userId);
  })();
  kickApplyWorker();
  return getApplyJob(id)!;
}

export function getApplyJob(id: string): ApplyJob | null {
  const row = getDb().prepare(
    'SELECT id, status, batch_no, total, done, failed, started_by, created_at, finished_at, error FROM ai_apply_jobs WHERE id = ?'
  ).get(id) as ApplyJob | undefined;
  return row ?? null;
}

/** 进行中 / 排队中的任务（待确认页显示进度） */
export function listActiveApplyJobs(): ApplyJob[] {
  return getDb().prepare(
    `SELECT id, status, batch_no, total, done, failed, started_by, created_at, finished_at, error
     FROM ai_apply_jobs WHERE status IN ('pending', 'running') ORDER BY created_at, rowid`
  ).all() as ApplyJob[];
}

/** 启动 worker（已在跑则什么都不做）；服务启动时也调用一次，接着跑重启前没跑完的任务 */
export function kickApplyWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  setImmediate(() => {
    void runWorker().finally(() => { workerRunning = false; });
  });
}

async function runWorker(): Promise<void> {
  const db = getDb();
  for (;;) {
    const job = db.prepare(
      "SELECT id, batch_no, items, started_by, done, failed FROM ai_apply_jobs WHERE status = 'pending' ORDER BY created_at, rowid LIMIT 1"
    ).get() as { id: string; batch_no: number | null; items: string; started_by: string; done: number; failed: number } | undefined;
    if (!job) return;
    db.prepare("UPDATE ai_apply_jobs SET status = 'running' WHERE id = ?").run(job.id);
    try {
      await runJob(job);
    } catch (err) {
      db.prepare("UPDATE ai_apply_jobs SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run((err as Error).message, job.id);
      db.prepare('UPDATE ai_suggestions SET apply_job_id = NULL WHERE apply_job_id = ?').run(job.id);
    }
  }
}

async function runJob(job: { id: string; batch_no: number | null; items: string; started_by: string }): Promise<void> {
  const db = getDb();
  const items = JSON.parse(job.items) as SuggestionSelection[];
  const generatedBy = getActivePluginName(db) ?? undefined;
  const owned = db.prepare('SELECT 1 FROM ai_suggestions WHERE book_id = ? AND apply_job_id = ?');
  const release = db.prepare('UPDATE ai_suggestions SET apply_job_id = NULL WHERE book_id = ?');
  const progress = db.prepare('UPDATE ai_apply_jobs SET done = ?, failed = ? WHERE id = ?');
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of items) {
    // 重启续跑：已采纳（建议已删除）或被重新填充覆盖的书跳过
    if (!owned.get(item.book_id, job.id)) {
      skipped++;
    } else {
      try {
        await applySuggestion(item, job.started_by, generatedBy);
        applied++;
      } catch (err) {
        if (err instanceof SuggestionNotFoundError) skipped++;
        else {
          failed++;
          release.run(item.book_id);   // 失败的回到待确认列表
        }
      }
    }
    progress.run(applied + skipped + failed, failed, job.id);
  }
  db.prepare("UPDATE ai_apply_jobs SET status = 'completed', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(job.id);
  const which = job.batch_no != null ? `第 ${job.batch_no} 批 ` : '';
  addNotice({
    kind: 'ai_apply_done', level: failed > 0 ? 'warning' : 'success',
    title: `${which}AI 建议采纳完成`,
    message: `采纳 ${applied} 本${failed > 0 ? `，失败 ${failed} 本（已放回待确认）` : ''}${skipped > 0 ? `，跳过 ${skipped} 本（已处理过）` : ''}`,
    link: failed > 0 ? '/library/ai-suggestions' + (job.batch_no != null ? `?batch=${job.batch_no}` : '') : undefined,
  });
}
