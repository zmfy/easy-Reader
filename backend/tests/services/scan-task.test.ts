import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// We construct the DB inline (skip the default getDb singleton)
// then inject it via the scan-task module's setter.
import {
  createScanTask,
  setScanProgress,
  finishScanTask,
  cancelScanTask,
  getActiveScanTask,
  getScanTaskById,
  hasRunningTask,
  _setDbForTesting,
} from '../../src/services/scan-task';

let db: Database.Database;
const TEST_DB_PATH = path.join(__dirname, '__test-scan-task.db');

beforeEach(() => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE scan_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      stage TEXT,
      total_files INTEGER DEFAULT 0,
      processed_files INTEGER DEFAULT 0,
      options TEXT,
      started_by TEXT NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      error TEXT
    );
  `);
  _setDbForTesting(db);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

describe('scan-task state machine', () => {
  it('createScanTask returns running task', () => {
    const task = createScanTask('user1', { mode: 'auto', ai_fill: false, full_rescan: false });
    expect(task.id).toBeTruthy();
    expect(task.status).toBe('running');
    expect(task.started_by).toBe('user1');
  });

  it('hasRunningTask returns true after create, false after finish', () => {
    createScanTask('user1', { mode: 'auto', ai_fill: false, full_rescan: false });
    expect(hasRunningTask()).toBe(true);
    const active = getActiveScanTask()!;
    finishScanTask(active.id, 'completed');
    expect(hasRunningTask()).toBe(false);
  });

  it('setScanProgress updates counters', () => {
    const task = createScanTask('u', { mode: 'auto', ai_fill: false, full_rescan: false });
    setScanProgress(task.id, { stage: 'fingerprinting', total_files: 100, processed_files: 42 });
    const reloaded = getScanTaskById(task.id)!;
    expect(reloaded.stage).toBe('fingerprinting');
    expect(reloaded.total_files).toBe(100);
    expect(reloaded.processed_files).toBe(42);
  });

  it('finishScanTask sets finished_at', () => {
    const task = createScanTask('u', { mode: 'auto', ai_fill: false, full_rescan: false });
    finishScanTask(task.id, 'completed');
    const reloaded = getScanTaskById(task.id)!;
    expect(reloaded.status).toBe('completed');
    expect(reloaded.finished_at).toBeTruthy();
  });

  it('cancelScanTask marks cancelled', () => {
    const task = createScanTask('u', { mode: 'auto', ai_fill: false, full_rescan: false });
    cancelScanTask(task.id);
    const reloaded = getScanTaskById(task.id)!;
    expect(reloaded.status).toBe('cancelled');
  });

  it('finishScanTask does not override a cancelled task', () => {
    const task = createScanTask('u', { mode: 'auto', ai_fill: false, full_rescan: false });
    cancelScanTask(task.id);
    finishScanTask(task.id, 'completed'); // late completion after cancel must not flip it
    const reloaded = getScanTaskById(task.id)!;
    expect(reloaded.status).toBe('cancelled');
  });

  it('createScanTask throws if another task is running', () => {
    createScanTask('u', { mode: 'auto', ai_fill: false, full_rescan: false });
    expect(() => createScanTask('u', { mode: 'auto', ai_fill: false, full_rescan: false })).toThrow(/already running/i);
  });
});
