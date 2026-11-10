import Database from 'better-sqlite3';
import { addNotice, listNotices, notifyFillBatch, notifyScanReview } from '../../src/services/notices';

let db: Database.Database;
jest.mock('../../src/db', () => ({ getDb: () => db }));

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notices (id TEXT PRIMARY KEY, kind TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL,
      message TEXT, link TEXT, action TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, read_at DATETIME);
    CREATE TABLE books (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'normal');
    CREATE TABLE ai_suggestions (book_id TEXT PRIMARY KEY, data TEXT NOT NULL, batch_no INTEGER, apply_job_id TEXT);
    CREATE TABLE scan_batches (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', summary_counts TEXT);
  `);
});
afterEach(() => db.close());

function suggest(batch: number, ...ids: string[]): void {
  for (const id of ids) {
    db.prepare('INSERT INTO books (id) VALUES (?)').run(id);
    db.prepare("INSERT INTO ai_suggestions (book_id, data, batch_no) VALUES (?, '{}', ?)").run(id, batch);
  }
}

describe('AI 填充待确认提醒', () => {
  it('前一批没确认时，后一批合并进同一条提醒', () => {
    suggest(1, 'a', 'b');
    notifyFillBatch('第 1 批 5 本：自动写入 3 本，待确认 2 本', 'success');
    suggest(2, 'c');
    notifyFillBatch('第 2 批 5 本：自动写入 4 本，待确认 1 本', 'success');

    const { items, unread } = listNotices();
    expect(items).toHaveLength(1);
    expect(unread).toBe(1);
    expect(items[0]).toMatchObject({
      title: 'AI 填充第 1–2 批有 3 本待确认',
      message: '最近完成第 2 批 5 本：自动写入 4 本，待确认 1 本',
      link: '/library/ai-suggestions',
    });
  });

  it('已读但还没确认的提醒也会被合并，合并后重新变成未读', () => {
    suggest(1, 'a');
    notifyFillBatch('第 1 批', 'success');
    db.prepare('UPDATE notices SET read_at = CURRENT_TIMESTAMP').run();
    suggest(2, 'b');
    notifyFillBatch('第 2 批', 'success');
    const { items, unread } = listNotices();
    expect(items).toHaveLength(1);
    expect(unread).toBe(1);
  });

  it('确认一部分后本数更新，全部确认后提醒消失', () => {
    suggest(1, 'a', 'b');
    suggest(2, 'c');
    notifyFillBatch('第 2 批', 'success');
    addNotice({ kind: 'ai_apply_done', title: '采纳完成', link: '/library/ai-suggestions?batch=1' });

    db.prepare("DELETE FROM ai_suggestions WHERE batch_no = 1").run();
    expect(listNotices().items.find(n => n.kind === 'ai_fill_batch')?.title).toBe('AI 填充第 2 批有 1 本待确认');

    // 交给后台采纳的也算已确认
    db.prepare("UPDATE ai_suggestions SET apply_job_id = 'job'").run();
    const { items, unread } = listNotices();
    expect(items.map(n => n.kind)).toEqual(['ai_apply_done']);
    expect(items[0].link).toBeNull();
    expect(unread).toBe(1);
  });

  it('旧版每批一条的待确认提醒收拢成一条', () => {
    suggest(1, 'a');
    suggest(2, 'b');
    addNotice({ kind: 'ai_fill_batch', title: '第 1 批 AI 填充完成', link: '/library/ai-suggestions?batch=1' });
    addNotice({ kind: 'ai_fill_batch', title: '第 2 批 AI 填充完成', link: '/library/ai-suggestions?batch=2' });
    const { items, unread } = listNotices();
    expect(items).toHaveLength(1);
    expect(unread).toBe(1);
    expect(items[0]).toMatchObject({ title: 'AI 填充第 1–2 批有 2 本待确认', link: '/library/ai-suggestions' });
  });

  it('没有要确认的批次只发普通完成通知，不会被当作待确认删除', () => {
    notifyFillBatch('第 1 批 5 本：自动写入 5 本，待确认 0 本', 'success');
    const { items } = listNotices();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'AI 填充一批完成', link: null });
  });
});

describe('扫描待审核提醒', () => {
  const batch = (id: string, n: number) =>
    db.prepare('INSERT INTO scan_batches (id, summary_counts) VALUES (?, ?)').run(id, JSON.stringify({ new: n }));

  it('多次扫描的待审核合并成一条，全部审核后消失', () => {
    batch('s1', 500);
    notifyScanReview();
    batch('s2', 20);
    notifyScanReview();
    let { items } = listNotices();
    expect(items).toHaveLength(1);
    expect(items[0].message).toBe('共 2 批待审核，新书 520 本，可逐批审核');

    db.prepare("UPDATE scan_batches SET status = 'applied' WHERE id = 's1'").run();
    ({ items } = listNotices());
    expect(items[0].message).toBe('新书 20 本，请审核后入库');

    db.prepare("UPDATE scan_batches SET status = 'discarded' WHERE id = 's2'").run();
    expect(listNotices()).toEqual({ items: [], unread: 0 });
  });
});
