import Database from 'better-sqlite3';
import { enqueueApplyJob, getApplyJob, kickApplyWorker } from '../../src/services/ai-apply-job';
import { applySuggestion, SuggestionNotFoundError } from '../../src/services/ai-suggestions';
import { addNotice } from '../../src/services/notices';

let _testDb: Database.Database | null = null;
jest.mock('../../src/db', () => ({ getDb: () => _testDb }));
jest.mock('../../src/ai/ai-manager', () => ({ getActivePluginName: () => 'minmax' }));
jest.mock('../../src/services/notices', () => ({ addNotice: jest.fn() }));
jest.mock('../../src/services/ai-suggestions', () => {
  const actual = jest.requireActual('../../src/services/ai-suggestions');
  return { ...actual, applySuggestion: jest.fn() };
});

const sel = (book_id: string) => ({ book_id, fields: ['author' as const], tags: false, similar: false, adaptations: false });

function makeDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE ai_suggestions (book_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, batch_no INTEGER, apply_job_id TEXT);
    CREATE TABLE ai_apply_jobs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pending', batch_no INTEGER,
      total INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
      items TEXT NOT NULL, started_by TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, finished_at DATETIME, error TEXT
    );
  `);
  for (const id of ['a', 'b', 'c', 'd']) d.prepare("INSERT INTO ai_suggestions (book_id, data, batch_no) VALUES (?, '{}', 1)").run(id);
  return d;
}

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setImmediate(r));
  expect(cond()).toBe(true);
}

beforeEach(() => {
  _testDb = makeDb();
  (applySuggestion as jest.Mock).mockReset();
  (addNotice as jest.Mock).mockClear();
});
afterEach(() => { _testDb?.close(); _testDb = null; });

it('逐本采纳：失败的放回待确认，已处理的跳过，完成后发通知', async () => {
  (applySuggestion as jest.Mock).mockImplementation(async (s: { book_id: string }) => {
    if (s.book_id === 'b') throw new Error('分类不在分类树中');
    if (s.book_id === 'c') throw new SuggestionNotFoundError();
    _testDb!.prepare('DELETE FROM ai_suggestions WHERE book_id = ?').run(s.book_id);
    return {};
  });
  const job = enqueueApplyJob([sel('a'), sel('b'), sel('c')], 'admin', 1);
  expect(job.total).toBe(3);
  // 交给任务的书不再出现在待确认里
  expect(_testDb!.prepare('SELECT COUNT(*) AS n FROM ai_suggestions WHERE apply_job_id IS NOT NULL').get()).toEqual({ n: 3 });

  await waitFor(() => getApplyJob(job.id)?.status === 'completed');
  expect(getApplyJob(job.id)).toMatchObject({ done: 3, failed: 1 });
  expect(_testDb!.prepare('SELECT apply_job_id FROM ai_suggestions WHERE book_id = ?').get('b')).toEqual({ apply_job_id: null });
  expect(addNotice).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'ai_apply_done', title: '第 1 批 AI 建议采纳完成', message: '采纳 1 本，失败 1 本（已放回待确认），跳过 1 本（已处理过）',
  }));
});

it('已交给别的任务的书不会被重复领取，任务按顺序执行', async () => {
  (applySuggestion as jest.Mock).mockResolvedValue({});
  const first = enqueueApplyJob([sel('a'), sel('b')], 'admin', 1);
  const second = enqueueApplyJob([sel('b'), sel('d')], 'admin', 1);
  expect(second.total).toBe(1);
  await waitFor(() => getApplyJob(second.id)?.status === 'completed');
  expect(getApplyJob(first.id)?.status).toBe('completed');
  expect((applySuggestion as jest.Mock).mock.calls.map(c => c[0].book_id)).toEqual(['a', 'b', 'd']);
});

it('重启后接着跑排队中的任务', async () => {
  (applySuggestion as jest.Mock).mockResolvedValue({});
  _testDb!.prepare("UPDATE ai_suggestions SET apply_job_id = 'j1' WHERE book_id = 'd'").run();
  _testDb!.prepare(
    "INSERT INTO ai_apply_jobs (id, status, total, items, started_by) VALUES ('j1', 'pending', 1, ?, 'admin')"
  ).run(JSON.stringify([sel('d')]));
  kickApplyWorker();
  await waitFor(() => getApplyJob('j1')?.status === 'completed');
  expect(applySuggestion).toHaveBeenCalledTimes(1);
});
