import Database from 'better-sqlite3';
import { getDb } from '../db';
import { AI_FILL_VERSION } from './scan-versions';
import { batchFill, BatchFillResult, FillBatchSummary, resetAllFills, selectFillCandidates } from './ai-batch-fill';
import { isCancelled, pauseScanTask, setScanProgress } from './scan-task';
import { addNotice, notifyFillBatch } from './notices';
import { ScanTask } from '../types';

/**
 * 后台 AI 填充任务（「批量填充」接口与扫描的填充阶段共用）：
 * 每满一批发通知去确认；额度用完 / 连续失败时暂停任务并通知，再次启动即从未完成的书继续（未完成的书没有版本戳）。
 */

export interface FillProgress {
  /** 参与填充的书（正常、非重复） */
  total: number;
  /** 已按当前版本处理过 */
  done: number;
  remaining: number;
}

export function getFillProgress(db: Database.Database = getDb()): FillProgress {
  const row = db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN ai_fill_version >= ? THEN 1 ELSE 0 END) AS done
     FROM books WHERE status = 'normal' AND (duplicate_of IS NULL OR duplicate_of = '')`
  ).get(AI_FILL_VERSION) as { total: number; done: number | null };
  const done = row.done ?? 0;
  return { total: row.total, done, remaining: row.total - done };
}

/** 最近一次带 AI 填充的任务（看是否暂停、暂停原因） */
export function getLastFillTask(db: Database.Database = getDb()): ScanTask | null {
  const row = db.prepare(
    "SELECT * FROM scan_tasks WHERE stage = 'ai_fill' ORDER BY started_at DESC, rowid DESC LIMIT 1"
  ).get() as ScanTask | undefined;
  return row ?? null;
}

/** 一批的结果，如「第 3 批 500 本：自动写入 320 本，待确认 180 本」 */
export function batchLine(s: FillBatchSummary): string {
  const parts = [`自动写入 ${s.auto_filled} 本`, `待确认 ${s.suggested} 本`];
  if (s.failed > 0) parts.push(`失败 ${s.failed} 本`);
  return `第 ${s.batch_no} 批 ${s.processed} 本：${parts.join('，')}`;
}

export async function runAiFill(
  taskId: string, userId: string, opts: { force?: boolean; batchSize?: number } = {},
): Promise<BatchFillResult | null> {
  const db = getDb();
  setScanProgress(taskId, { stage: 'ai_fill' });
  // 强制重填 = 先清掉全部版本戳再按普通模式跑，这样中途暂停后也能接着跑
  if (opts.force) resetAllFills(db);
  const toFill = selectFillCandidates(db, false);
  if (toFill.length === 0) {
    setScanProgress(taskId, { total_files: 0, processed_files: 0 });
    return null;
  }

  const result = await batchFill({
    taskId, user_id: userId, books: toFill, batchSize: opts.batchSize,
    // 前面的批还没确认完时，合并进同一条「去确认」提醒
    onBatchDone: (s) => notifyFillBatch(batchLine(s), 'success', db),
  });

  const p = getFillProgress(db);
  if (result.paused) {
    pauseScanTask(taskId, result.paused.message);
    addNotice({
      kind: 'ai_fill_paused', level: 'warning',
      title: result.paused.reason === 'quota' ? 'AI 额度已用完，填充已暂停'
        : result.paused.reason === 'auth' ? 'AI 密钥无效，填充已暂停' : 'AI 填充已暂停',
      message: `${result.paused.message}。已完成 ${p.done} / ${p.total} 本，还剩 ${p.remaining} 本；`
        + (result.paused.reason === 'auth' ? '到「设置 → AI 插件」检查密钥后' : result.paused.reason === 'quota' ? '额度恢复后' : '稍后')
        + '点「继续填充」从这里接着处理。',
      action: 'resume_fill',
    });
  } else if (!isCancelled(taskId)) {
    addNotice({
      kind: 'ai_fill_done', level: 'success', title: 'AI 填充完成',
      message: `本次处理 ${toFill.length} 本；全书库已完成 ${p.done} / ${p.total} 本。`,
      link: '/library/ai-suggestions',
    });
  }
  return result;
}
