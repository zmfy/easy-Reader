import fs from 'fs';
import os from 'os';
import path from 'path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-auto-data-'));
const BOOKS = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-auto-books-'));
process.env.DATA_DIR = DATA;
process.env.BOOKS_DIR = BOOKS;

jest.mock('../../src/services/epub-health', () => ({
  HEALTH_CHECK_VERSION: 1,
  checkEpubHealth: jest.fn(async () => ({ status: 'damaged', reason: '没有可读的章节' })),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { getDb } = require('../../src/db');
const { runScanTask } = require('../../src/services/scan-walker');
const { createScanTask } = require('../../src/services/scan-task');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  fs.rmSync(BOOKS, { recursive: true, force: true });
  fs.rmSync(DATA, { recursive: true, force: true });
});

describe('自动模式下的损坏 EPUB', () => {
  it('新书照常入库，损坏批次保持 pending 并有待审核提醒', async () => {
    const good = path.join(BOOKS, '好书.txt');
    const bad = path.join(BOOKS, '坏书.epub');
    fs.writeFileSync(good, '第一章 开始\n这是正文内容。\n第二章 继续\n更多正文。\n');
    fs.writeFileSync(bad, 'not a zip');
    const opts = { mode: 'auto', ai_fill: false, full_rescan: false };
    const task = createScanTask('u', opts);
    await runScanTask(task.id, opts);

    const db = getDb();
    expect(db.prepare('SELECT status FROM books WHERE file_path = ?').get(good)).toEqual({ status: 'normal' });
    expect(db.prepare('SELECT id FROM books WHERE file_path = ?').get(bad)).toBeUndefined();

    const batches = db.prepare('SELECT id, status, summary_counts FROM scan_batches WHERE task_id = ?').all(task.id) as
      Array<{ id: string; status: string; summary_counts: string }>;
    const damagedBatch = batches.find(b => JSON.parse(b.summary_counts).damaged > 0)!;
    expect(damagedBatch.status).toBe('pending');
    expect(batches.filter(b => b !== damagedBatch).map(b => b.status)).toEqual(['applied']);
    const items = db.prepare('SELECT type FROM scan_batch_items WHERE batch_id = ?').all(damagedBatch.id);
    expect(items).toEqual([{ type: 'damaged' }]);
    expect(db.prepare("SELECT COUNT(*) AS c FROM notices WHERE kind = 'scan_review'").get()).toEqual({ c: 1 });
  });
});
