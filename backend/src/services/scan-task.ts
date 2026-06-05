import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDb } from '../db';
import { ScanTask, ScanOptions } from '../types';

let dbOverride: Database.Database | null = null;

/** Test-only: inject an in-memory or test DB. */
export function _setDbForTesting(db: Database.Database | null): void {
  dbOverride = db;
}

function db(): Database.Database {
  return dbOverride ?? getDb();
}

export function hasRunningTask(): boolean {
  const row = db().prepare("SELECT id FROM scan_tasks WHERE status = 'running' LIMIT 1").get();
  return !!row;
}

export function getActiveScanTask(): ScanTask | null {
  const row = db().prepare(
    "SELECT * FROM scan_tasks WHERE status = 'running' ORDER BY started_at DESC LIMIT 1"
  ).get() as ScanTask | undefined;
  return row ?? null;
}

export function getScanTaskById(id: string): ScanTask | null {
  const row = db().prepare('SELECT * FROM scan_tasks WHERE id = ?').get(id) as
    | ScanTask
    | undefined;
  return row ?? null;
}

export function createScanTask(userId: string, options: ScanOptions): ScanTask {
  if (hasRunningTask()) {
    throw new Error('A scan task is already running');
  }
  const id = uuidv4();
  db().prepare(
    `INSERT INTO scan_tasks (id, status, stage, options, started_by)
     VALUES (?, 'running', 'walking', ?, ?)`
  ).run(id, JSON.stringify(options), userId);
  return getScanTaskById(id)!;
}

export interface ProgressUpdate {
  stage?: ScanTask['stage'];
  total_files?: number;
  processed_files?: number;
}

export function setScanProgress(id: string, update: ProgressUpdate): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (update.stage !== undefined) { sets.push('stage = ?'); vals.push(update.stage); }
  if (update.total_files !== undefined) { sets.push('total_files = ?'); vals.push(update.total_files); }
  if (update.processed_files !== undefined) { sets.push('processed_files = ?'); vals.push(update.processed_files); }
  if (sets.length === 0) return;
  vals.push(id);
  db().prepare(`UPDATE scan_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function finishScanTask(id: string, status: 'completed' | 'failed', error?: string): void {
  // Only finish a still-running task: a cancelled task is terminal and a late
  // completion (after the user cancelled mid-fill) must not flip it back.
  db().prepare(
    `UPDATE scan_tasks SET status = ?, finished_at = CURRENT_TIMESTAMP, error = ? WHERE id = ? AND status = 'running'`
  ).run(status, error ?? null, id);
}

export function cancelScanTask(id: string): void {
  db().prepare(
    `UPDATE scan_tasks SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running'`
  ).run(id);
}

export function isCancelled(id: string): boolean {
  const t = getScanTaskById(id);
  return t?.status === 'cancelled';
}
