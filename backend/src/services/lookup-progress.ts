import { LookupStep } from './book-lookup-agent';

/**
 * 单本 AI 填充预览的查证进度（内存）：预览请求进行中，前端轮询这里展示查证过程。
 * 结束后保留 60 秒供最后一次轮询读取，然后删除。
 */

const KEEP_AFTER_DONE_MS = 60_000;

interface Progress {
  steps: LookupStep[];
  done: boolean;
  timer?: NodeJS.Timeout;
}

const progress = new Map<string, Progress>();

/** 清空旧记录并开始（同一本书上次结束的删除定时器一并取消） */
export function startLookupProgress(bookId: string): void {
  const old = progress.get(bookId);
  if (old?.timer) clearTimeout(old.timer);
  progress.set(bookId, { steps: [], done: false });
}

export function setLookupProgress(bookId: string, steps: LookupStep[]): void {
  const p = progress.get(bookId);
  if (p) p.steps = [...steps];
  else progress.set(bookId, { steps: [...steps], done: false });
}

export function getLookupProgress(bookId: string): { steps: LookupStep[]; done: boolean } | null {
  const p = progress.get(bookId);
  return p ? { steps: p.steps, done: p.done } : null;
}

/** 标记结束，60 秒后删除 */
export function finishLookupProgress(bookId: string): void {
  const p = progress.get(bookId);
  if (!p) return;
  p.done = true;
  if (p.timer) clearTimeout(p.timer);
  const timer = setTimeout(() => {
    if (progress.get(bookId) === p) progress.delete(bookId);
  }, KEEP_AFTER_DONE_MS);
  timer.unref?.();
  p.timer = timer;
}
