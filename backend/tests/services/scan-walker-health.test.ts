import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-health-data-'));
const BOOKS = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-health-books-'));
process.env.DATA_DIR = DATA;
process.env.BOOKS_DIR = BOOKS;

jest.mock('../../src/services/book-health', () => ({
  HEALTH_CHECK_VERSION: 1,
  HEALTH_FORMATS: ['epub', 'pdf', 'umd', 'txt'],
  checkBookHealth: jest.fn(),
}));
jest.mock('../../src/services/batch-builder', () => ({
  buildBatchesFromScan: jest.fn(() => []),
}));
jest.mock('../../src/services/notices', () => ({
  notifyScanReview: jest.fn(),
  notifyScanHealth: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDb } = require('../../src/db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runScanTask } = require('../../src/services/scan-walker');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createScanTask, cancelScanTask, getActiveScanTask, getScanTaskById } = require('../../src/services/scan-task');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { notifyScanHealth } = require('../../src/services/notices');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recordSkip } = require('../../src/services/scan-skips');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkBookHealth } = require('../../src/services/book-health');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildBatchesFromScan } = require('../../src/services/batch-builder');

const check = checkBookHealth as jest.Mock;
const build = buildBatchesFromScan as jest.Mock;
const notifyHealth = notifyScanHealth as jest.Mock;
let db: Database.Database;

function writeBook(name: string, content = `content of ${name}`): { file: string; size: number; mtime: number } {
  const file = path.join(BOOKS, name);
  fs.writeFileSync(file, content);
  const st = fs.statSync(file);
  return { file, size: st.size, mtime: st.mtimeMs };
}

function insertBook(id: string, b: { file: string; size: number; mtime: number }, extra: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id, title: id, file_path: b.file, file_format: path.extname(b.file).slice(1),
    file_size: b.size, file_mtime: b.mtime, fingerprint: `fp-${id}`, fingerprint_version: 2,
    status: 'normal', ...extra,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO books (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => row[c]));
}

async function scan(fullRescan = false): Promise<{ result: any; health: any }> {
  const task = createScanTask('u', { mode: 'review', ai_fill: false, full_rescan: fullRescan });
  const health = await runScanTask(task.id, { mode: 'review', ai_fill: false, full_rescan: fullRescan });
  const calls = build.mock.calls;
  return { result: calls.length ? calls[calls.length - 1][1] : null, health };
}

function bookRow(id: string): any {
  return db.prepare('SELECT status, damage_reason, health_check_version, file_size, file_mtime FROM books WHERE id = ?').get(id);
}

function dupRow(id: string): any {
  return db.prepare('SELECT status, duplicate_of FROM books WHERE id = ?').get(id);
}

const TIMEOUT = { status: 'damaged', reason: '解析超时', timedOut: true };

beforeEach(() => {
  db = getDb();
  db.exec('DELETE FROM books; DELETE FROM scan_tasks; DELETE FROM scan_skipped_files;');
  for (const f of fs.readdirSync(BOOKS)) fs.unlinkSync(path.join(BOOKS, f));
  check.mockReset();
  check.mockResolvedValue({ status: 'ok' });
  build.mockClear();
  notifyHealth.mockClear();
});

afterAll(() => {
  fs.rmSync(BOOKS, { recursive: true, force: true });
});

describe('扫描接入健康检查', () => {
  it('新文件损坏 → 进 damaged 列表，不进 new_books', async () => {
    const b = writeBook('broken.epub');
    check.mockResolvedValue({ status: 'damaged', reason: '没有可读的章节' });
    const { result } = await scan();
    expect(result.damaged).toEqual([{ file_path: b.file, file_size: b.size, file_mtime: b.mtime, reason: '没有可读的章节' }]);
    expect(result.new_books.map((n: any) => n.file_path)).not.toContain(b.file);
  });

  it('跳过记录匹配 → 不出现；文件 mtime 变化 → 再次出现', async () => {
    const b = writeBook('broken.epub');
    check.mockResolvedValue({ status: 'damaged', reason: '解析超时' });
    recordSkip(db, { file_path: b.file, file_size: b.size, file_mtime: b.mtime });
    const first = await scan();
    expect(first.result).toBeNull(); // 结果为空，不建批次

    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(b.file, later, later);
    const second = await scan();
    expect(second.result.damaged.map((d: any) => d.file_path)).toEqual([b.file]);
  });

  it('新文件被自动修正 → new_books 中 repaired: true，带检查版本，计数 repaired', async () => {
    const b = writeBook('fixed.epub');
    check.mockResolvedValue({ status: 'repaired' });
    const { result, health } = await scan();
    const nb = result.new_books.find((n: any) => n.file_path === b.file);
    expect(nb.repaired).toBe(true);
    expect(nb.health_check_version).toBe(1);
    expect(health.repaired).toBe(1);
  });

  it('已入库的书文件变化且损坏 → 直接写 damaged，无审核项', async () => {
    const b = writeBook('book.epub');
    insertBook('b1', { ...b, size: b.size + 1 }, { health_check_version: 1 });
    check.mockResolvedValue({ status: 'damaged', reason: '缺少书籍目录（content.opf）' });
    const { result, health } = await scan();
    expect(result).toBeNull();
    expect(bookRow('b1')).toEqual({
      status: 'damaged', damage_reason: '缺少书籍目录（content.opf）', health_check_version: 1,
      file_size: b.size, file_mtime: b.mtime,
    });
    expect(health.damaged_existing).toBe(1);
  });

  it('已是 damaged 的书文件变化且仍损坏 → 更新原因，不重复计数', async () => {
    const b = writeBook('book.epub');
    insertBook('b1', { ...b, size: b.size + 1 }, { status: 'damaged', damage_reason: '解析超时', health_check_version: 1 });
    check.mockResolvedValue({ status: 'damaged', reason: '没有可读的章节' });
    const { health } = await scan();
    expect(bookRow('b1').damage_reason).toBe('没有可读的章节');
    expect(health.damaged_existing).toBe(0);
  });

  it('已是 damaged 的书文件变化且现在正常 → 回 normal、清原因，并生成新书审核项', async () => {
    const b = writeBook('book.epub');
    insertBook('b1', { ...b, size: b.size + 1 }, { status: 'damaged', damage_reason: '解析超时', health_check_version: 1 });
    const { result, health } = await scan();
    expect(bookRow('b1')).toMatchObject({ status: 'normal', damage_reason: null });
    expect(health.recovered).toBe(1);
    expect(result.new_books.map((n: any) => n.file_path)).toEqual([b.file]);
  });

  it('已入库书检查版本过期且损坏 → 直接写 damaged', async () => {
    const b = writeBook('book.epub');
    insertBook('b1', b);
    check.mockResolvedValue({ status: 'damaged', reason: '没有可读的章节' });
    const { result, health } = await scan();
    expect(result).toBeNull();
    expect(bookRow('b1')).toMatchObject({ status: 'damaged', damage_reason: '没有可读的章节', health_check_version: 1 });
    expect(health.damaged_existing).toBe(1);
  });

  it('已入库 damaged 书检查版本过期且现在正常 → 回 normal、原因清空', async () => {
    const b = writeBook('book.epub');
    insertBook('b1', b, { status: 'damaged', damage_reason: '解析超时' });
    const { result, health } = await scan();
    expect(result).toBeNull();
    expect(bookRow('b1')).toMatchObject({ status: 'normal', damage_reason: null, health_check_version: 1 });
    expect(health.recovered).toBe(1);
  });

  it('已入库正常书检查版本过期且正常 → 只写检查版本', async () => {
    const b = writeBook('book.epub');
    insertBook('b1', b);
    const { result } = await scan();
    expect(result).toBeNull();
    expect(bookRow('b1')).toMatchObject({ status: 'normal', health_check_version: 1 });
  });

  it('版本最新且文件没变 → 不调用检查（含没有指纹的 damaged 书）', async () => {
    const a = writeBook('a.epub');
    const c = writeBook('c.epub');
    insertBook('a', a, { health_check_version: 1 });
    insertBook('c', c, { status: 'damaged', damage_reason: '解析超时', health_check_version: 1, fingerprint: null });
    const { result } = await scan();
    expect(check).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(bookRow('c').status).toBe('damaged');
  });

  it('已入库正常书检查版本过期、文件暂时读不了 → 保持 normal，不写检查版本', async () => {
    const b = writeBook('book.epub');
    insertBook('b1', b);
    check.mockResolvedValue({ status: 'unreadable' });
    const { result, health } = await scan();
    expect(result).toBeNull();
    expect(bookRow('b1')).toMatchObject({ status: 'normal', damage_reason: null, health_check_version: null });
    expect(health.damaged_existing).toBe(0);
  });

  it('已入库书文件变化、暂时读不了 → 状态不变，不写检查版本', async () => {
    const b = writeBook('book.epub');
    insertBook('b1', { ...b, size: b.size + 1 }, { health_check_version: 1 });
    insertBook('b2', { ...writeBook('d.epub'), size: 1 }, { status: 'damaged', damage_reason: '解析超时' });
    check.mockResolvedValue({ status: 'unreadable' });
    const { health } = await scan();
    expect(bookRow('b1')).toMatchObject({ status: 'normal', damage_reason: null });
    expect(bookRow('b2')).toMatchObject({ status: 'damaged', damage_reason: '解析超时', health_check_version: null });
    expect(health).toEqual({ damaged_existing: 0, recovered: 0, repaired: 0 });
  });

  it('新文件暂时读不了 → 不进 damaged 列表，照常走新书流程且不带检查版本', async () => {
    const b = writeBook('new.epub');
    check.mockResolvedValue({ status: 'unreadable' });
    const { result } = await scan();
    expect(result.damaged).toEqual([]);
    const nb = result.new_books.find((n: any) => n.file_path === b.file);
    expect(nb).toBeDefined();
    expect(nb.health_check_version).toBeUndefined();
  });

  it('TXT 也做检查：正常的照常入库并带检查版本', async () => {
    const b = writeBook('plain.txt', 'hello world, this is a plain text book.\n');
    const { result } = await scan();
    expect(check).toHaveBeenCalledWith(b.file, 'txt');
    expect(result.new_books).toHaveLength(1);
    expect(result.new_books[0].health_check_version).toBe(1);
  });

  it('PDF 打不开（如需要打开密码）→ 进入损坏列表，带原因', async () => {
    const b = writeBook('locked.pdf');
    check.mockResolvedValue({ status: 'damaged', reason: '需要打开密码（加密的 PDF）' });
    const { result } = await scan();
    expect(check).toHaveBeenCalledWith(b.file, 'pdf');
    expect(result.damaged).toEqual([{ file_path: b.file, file_size: b.size, file_mtime: b.mtime, reason: '需要打开密码（加密的 PDF）' }]);
    expect(result.new_books).toEqual([]);
  });

  it('已入库书检查版本过期、解析超时 → 不判损坏，不写检查版本（下次再查）', async () => {
    const b = writeBook('big.epub');
    insertBook('b1', b);
    check.mockResolvedValue(TIMEOUT);
    const { result, health } = await scan();
    expect(result).toBeNull();
    expect(bookRow('b1')).toMatchObject({ status: 'normal', damage_reason: null, health_check_version: null });
    expect(health.damaged_existing).toBe(0);
  });

  it('已入库书文件变化、解析超时 → 状态不变，不写检查版本', async () => {
    const b = writeBook('big.epub');
    insertBook('b1', { ...b, size: b.size + 1 }, { health_check_version: 1 });
    check.mockResolvedValue(TIMEOUT);
    const { health } = await scan();
    expect(bookRow('b1')).toMatchObject({ status: 'normal', damage_reason: null });
    expect(health.damaged_existing).toBe(0);
  });

  it('新文件解析超时 → 仍是 damaged 审核项「解析超时」', async () => {
    const b = writeBook('slow.epub');
    check.mockResolvedValue(TIMEOUT);
    const { result } = await scan();
    expect(result.damaged).toEqual([{ file_path: b.file, file_size: b.size, file_mtime: b.mtime, reason: '解析超时' }]);
  });

  it('重复书变损坏 → 清掉 duplicate_of；之后恢复 → normal 且 duplicate_of 为空', async () => {
    const p = writeBook('p.epub');
    const d = writeBook('d.epub');
    insertBook('p', p, { health_check_version: 1 });
    insertBook('d', d, { status: 'duplicate', duplicate_of: 'p' });
    check.mockResolvedValue({ status: 'damaged', reason: '没有可读的章节' });
    await scan();
    expect(dupRow('d')).toEqual({ status: 'damaged', duplicate_of: null });

    db.prepare('UPDATE books SET health_check_version = NULL WHERE id = ?').run('d');
    check.mockResolvedValue({ status: 'ok' });
    await scan();
    expect(dupRow('d')).toEqual({ status: 'normal', duplicate_of: null });
  });

  it('主书变损坏 → 指向它的重复书提升为 normal', async () => {
    const p = writeBook('p.epub');
    const d = writeBook('d.txt', 'duplicate text body\n');
    insertBook('p', p);
    insertBook('d', d, { status: 'duplicate', duplicate_of: 'p' });
    // 只有 EPUB 主书损坏，TXT 重复书本身正常
    check.mockImplementation(async (_f: string, fmt: string) => (fmt === 'epub' ? { status: 'damaged', reason: '没有可读的章节' } : { status: 'ok' }));
    await scan();
    expect(dupRow('p')).toEqual({ status: 'damaged', duplicate_of: null });
    expect(dupRow('d')).toEqual({ status: 'normal', duplicate_of: null });
  });

  it('文件变化的主书变损坏 → 重复书也提升为 normal', async () => {
    const p = writeBook('p.epub');
    const d = writeBook('d.txt', 'duplicate text body\n');
    insertBook('p', { ...p, size: p.size + 1 }, { health_check_version: 1 });
    insertBook('d', d, { status: 'duplicate', duplicate_of: 'p' });
    // 只有 EPUB 主书损坏，TXT 重复书本身正常
    check.mockImplementation(async (_f: string, fmt: string) => (fmt === 'epub' ? { status: 'damaged', reason: '没有可读的章节' } : { status: 'ok' }));
    await scan();
    expect(dupRow('d')).toEqual({ status: 'normal', duplicate_of: null });
  });

  it('扫描结束调用 notifyScanHealth 并带上计数', async () => {
    const b = writeBook('book.epub');
    insertBook('b1', b);
    check.mockResolvedValue({ status: 'damaged', reason: '没有可读的章节' });
    await scan();
    expect(notifyHealth).toHaveBeenCalledTimes(1);
    expect(notifyHealth).toHaveBeenCalledWith({ damaged_existing: 1, recovered: 0, repaired: 0 });
  });

  it('扫描中途取消 → 部分结果带 damaged，仍发健康提醒', async () => {
    const b = writeBook('broken.epub');
    check.mockImplementation(async () => {
      cancelScanTask(getActiveScanTask().id);
      return { status: 'damaged', reason: '没有可读的章节' };
    });
    const { result } = await scan();
    expect(result.damaged.map((x: any) => x.file_path)).toEqual([b.file]);
    expect(notifyHealth).toHaveBeenCalledTimes(1);
  });

  it('全量重扫：已是 damaged 的书仍损坏 → 保持 damaged，不重复计数、不生成审核项', async () => {
    const b = writeBook('book.epub');
    insertBook('b1', b, { status: 'damaged', damage_reason: '解析超时', health_check_version: 1, fingerprint: null });
    check.mockResolvedValue({ status: 'damaged', reason: '没有可读的章节' });
    const { result, health } = await scan(true);
    expect(result).toBeNull();
    expect(bookRow('b1')).toMatchObject({ status: 'damaged', damage_reason: '没有可读的章节' });
    expect(health).toEqual({ damaged_existing: 0, recovered: 0, repaired: 0 });
  });

  it('检查版本过期的重查每本都更新进度', async () => {
    for (const n of ['a', 'b', 'c']) insertBook(n, writeBook(`${n}.epub`));
    const seen: number[] = [];
    check.mockImplementation(async () => {
      seen.push(getScanTaskById(getActiveScanTask().id).processed_files);
      return { status: 'ok' };
    });
    await scan();
    expect(seen).toEqual([0, 1, 2]);
  });
});
