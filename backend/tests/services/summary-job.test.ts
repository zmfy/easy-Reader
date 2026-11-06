import Database from 'better-sqlite3';
import { HIGHLIGHTS_DDL, createHighlight } from '../../src/services/highlights';
import { MIND_DDL } from '../../src/services/mind-nodes';
import { STUDY_SUMMARY_DDL, collectNotes, getSummary, listVersions, newNotes, saveUserDoc, writeAiResult } from '../../src/services/study-summary';
import { startSummaryJob, getCurrentJob, waitJob } from '../../src/services/summary-job';
import { aiManager } from '../../src/ai/ai-manager';
import { DocNode, docText, extractRefs } from '../../src/services/summary-doc';

jest.mock('../../src/ai/ai-manager');
const chat = aiManager.chat as jest.Mock;

function makeDb() {
  const d = new Database(':memory:');
  d.exec(HIGHLIGHTS_DDL);
  d.exec(MIND_DDL);
  d.exec(STUDY_SUMMARY_DDL);
  return d;
}

function addNotes(d: Database.Database, n: number, from = 0): string[] {
  const refs: string[] = [];
  for (let i = from; i < from + n; i++) {
    const h = createHighlight(d, 'u1', 'b1', { chapterIndex: i, startOffset: 0, endOffset: 1, text: 'hl' + i });
    refs.push('h:' + h.id);
  }
  return refs;
}

// 在 prompt 里找出送入的笔记标识，用它们造一个合法回复
function refsIn(prompt: string): string[] {
  const m = prompt.match(/\[\[h:[^\]]+\]\]/g) || [];
  return Array.from(new Set(m)).filter(x => x !== '[[h:xxx]]');
}
function reply(title: string, prompt: string): string {
  return JSON.stringify({ themes: [{ title, paragraphs: ['观点 ' + refsIn(prompt).join(' ')] }] });
}

const seedDoc = (theme: string, body: string): DocNode => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: theme }] },
    { type: 'paragraph', content: [{ type: 'text', text: body }] },
  ],
});

const count = (d: Database.Database, t: string) => (d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;

describe('summary-job', () => {
  beforeEach(() => { chat.mockReset(); });

  it('generate writes one doc and one version after all batches', async () => {
    const d = makeDb();
    const refs = addNotes(d, 3);
    chat.mockImplementation(async (p: string) => reply('主题' + chat.mock.calls.length, p));
    const r = startSummaryJob(d, 'u1', 'b1', '书', 'generate', { maxNotes: 1 });
    expect('job' in r && r.started).toBe(true);
    const job = (r as { job: { id: string; status: string; total: number; done: number } }).job;
    expect(job).toMatchObject({ status: 'running', total: 3, done: 0 });
    await waitJob(job.id);
    expect(chat).toHaveBeenCalledTimes(3);
    const s = getSummary(d, 'u1', 'b1')!;
    expect(s.included_refs.sort()).toEqual([...refs].sort());
    const vs = listVersions(d, 'u1', 'b1');
    expect(vs).toHaveLength(1);
    expect(vs[0].source).toBe('ai_generate');
    expect(vs[0].description).toBe('初版，3 个主题');
    expect(getCurrentJob(d, 'u1', 'b1')).toMatchObject({ status: 'done', done: 3 });
  });

  it('update appends only and keeps existing nodes', async () => {
    const d = makeDb();
    const old = addNotes(d, 1);
    const base = seedDoc('旧主题', '旧内容');
    writeAiResult(d, 'u1', 'b1', base, old, 'ai_generate', '初版');
    const fresh = addNotes(d, 2, 1);
    chat.mockImplementation(async (p: string) => {
      expect(refsIn(p).sort()).toEqual(fresh.map(r => `[[${r}]]`).sort());
      return JSON.stringify({ themes: [
        { title: '旧主题', paragraphs: ['补充 ' + refsIn(p).join(' ')] },
        { title: '新主题', paragraphs: ['新段'] },
      ] });
    });
    const r = startSummaryJob(d, 'u1', 'b1', '书', 'update') as { job: { id: string } };
    await waitJob(r.job.id);
    const s = getSummary(d, 'u1', 'b1')!;
    expect(s.revision).toBe(2);
    expect(docText(s.doc)).toContain('旧内容');
    expect(s.doc.content![0]).toEqual(base.content![0]);
    expect(s.doc.content![1]).toEqual(base.content![1]);
    expect(extractRefs(s.doc).sort()).toEqual([...fresh].sort());
    expect(s.included_refs.sort()).toEqual([...old, ...fresh].sort());
    const v = listVersions(d, 'u1', 'b1')[0];
    expect(v.source).toBe('ai_update');
    expect(v.description).toBe('新增 2 条到『旧主题』，新建主题『新主题』');
  });

  it('same book job is not started twice', async () => {
    const d = makeDb();
    addNotes(d, 1);
    let release!: () => void;
    chat.mockImplementation((p: string) => new Promise<string>(res => { release = () => res(reply('T', p)); }));
    const a = startSummaryJob(d, 'u1', 'b1', '书', 'generate') as { job: { id: string }; started: boolean };
    const b = startSummaryJob(d, 'u1', 'b1', '书', 'generate') as { job: { id: string }; started: boolean };
    expect(a.started).toBe(true);
    expect(b.started).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(count(d, 'study_summary_jobs')).toBe(1);
    release();
    await waitJob(a.job.id);
  });

  it('a failing batch fails the job and writes nothing', async () => {
    const d = makeDb();
    const old = addNotes(d, 1);
    writeAiResult(d, 'u1', 'b1', seedDoc('旧', 'x'), old, 'ai_generate', '初版');
    addNotes(d, 3, 1);
    let n = 0;
    chat.mockImplementation(async (p: string) => {
      if (++n === 2) throw new Error('额度不足 ' + 'x'.repeat(300));
      return reply('旧', p);
    });
    const r = startSummaryJob(d, 'u1', 'b1', '书', 'update', { maxNotes: 1 }) as { job: { id: string } };
    await waitJob(r.job.id);
    const s = getSummary(d, 'u1', 'b1')!;
    expect(s.revision).toBe(1);
    expect(s.included_refs).toEqual(old);
    expect(listVersions(d, 'u1', 'b1')).toHaveLength(1);
    const job = getCurrentJob(d, 'u1', 'b1')!;
    expect(job.status).toBe('failed');
    expect(job.done).toBe(1);
    expect(job.error!.startsWith('额度不足')).toBe(true);
    expect(job.error!.length).toBe(200);
  });

  it('unparsable AI output gives a readable error', async () => {
    const d = makeDb();
    addNotes(d, 1);
    chat.mockResolvedValue('not json');
    const r = startSummaryJob(d, 'u1', 'b1', '书', 'generate') as { job: { id: string } };
    await waitJob(r.job.id);
    expect(getCurrentJob(d, 'u1', 'b1')).toMatchObject({ status: 'failed', error: 'AI 返回的内容无法解析，请重试' });
    expect(getSummary(d, 'u1', 'b1')).toBeNull();
  });

  it('refs not sent to AI are not marked included', async () => {
    const d = makeDb();
    addNotes(d, 3);
    let n = 0;
    chat.mockImplementation(async (p: string) => {
      if (++n === 3) throw new Error('boom');
      return reply('T', p);
    });
    const r = startSummaryJob(d, 'u1', 'b1', '书', 'generate', { maxNotes: 1 }) as { job: { id: string } };
    await waitJob(r.job.id);
    expect(getSummary(d, 'u1', 'b1')).toBeNull();
    expect(count(d, 'study_summary_versions')).toBe(0);
  });

  it('refs outside the current batch are dropped by parse', async () => {
    const d = makeDb();
    const refs = addNotes(d, 2);
    // 每批都引用第 1 条笔记；第 2 批里它不在本批，应被丢弃
    chat.mockImplementation(async (p: string) => JSON.stringify({ themes: [{ title: 'T', paragraphs: [`观点 [[${refs[0]}]] 文字`] }] }));
    const r = startSummaryJob(d, 'u1', 'b1', '书', 'generate', { maxNotes: 1 }) as { job: { id: string } };
    await waitJob(r.job.id);
    const s = getSummary(d, 'u1', 'b1')!;
    expect(extractRefs(s.doc).filter(x => x === refs[0])).toHaveLength(1);
    expect(extractRefs(s.doc)).not.toContain(refs[1]);
  });

  it('update keeps edits the user saved while the job was running', async () => {
    const d = makeDb();
    const old = addNotes(d, 1);
    const base = seedDoc('旧主题', '旧内容');
    const s0 = writeAiResult(d, 'u1', 'b1', base, old, 'ai_generate', '初版');
    addNotes(d, 1, 1);
    chat.mockImplementation(async (p: string) => {
      // 执行中用户保存（此时任务为 running，saveUserDoc 会 busy，故直接模拟其写入）
      d.prepare("UPDATE study_summary_jobs SET status = 'paused'").run();
      const r = saveUserDoc(d, 'u1', 'b1', seedDoc('旧主题', '用户改动'), s0.revision);
      expect(r.ok).toBe(true);
      d.prepare("UPDATE study_summary_jobs SET status = 'running'").run();
      return reply('旧主题', p);
    });
    const r = startSummaryJob(d, 'u1', 'b1', '书', 'update') as { job: { id: string } };
    await waitJob(r.job.id);
    const s = getSummary(d, 'u1', 'b1')!;
    const text = docText(s.doc);
    expect(text).toContain('用户改动');
    expect(text).not.toContain('旧内容');
    expect(text).toContain('观点');
  });

  it('notes added while the job runs are not marked included', async () => {
    const d = makeDb();
    const refs = addNotes(d, 1);
    let late: string[] = [];
    chat.mockImplementation(async (p: string) => {
      late = addNotes(d, 1, 5);
      return reply('T', p);
    });
    const r = startSummaryJob(d, 'u1', 'b1', '书', 'generate') as { job: { id: string } };
    await waitJob(r.job.id);
    expect(getCurrentJob(d, 'u1', 'b1')!.status).toBe('done');
    const s = getSummary(d, 'u1', 'b1')!;
    expect(s.included_refs).toEqual(refs);
    expect(s.included_refs).not.toContain(late[0]);
    expect(newNotes(collectNotes(d, 'u1', 'b1'), s).map(n => n.ref)).toEqual(late);
  });

  it('a failing write marks the job failed and leaves no summary', async () => {
    const d = makeDb();
    addNotes(d, 1);
    chat.mockImplementation(async (p: string) => {
      d.exec('DROP TABLE study_summary_versions');
      return reply('T', p);
    });
    const r = startSummaryJob(d, 'u1', 'b1', '书', 'generate') as { job: { id: string } };
    await waitJob(r.job.id);
    const job = getCurrentJob(d, 'u1', 'b1')!;
    expect(job.status).toBe('failed');
    expect(job.error).toBeTruthy();
    expect(job.finished_at).toBeTruthy();
    expect(getSummary(d, 'u1', 'b1')).toBeNull();
  });

  it('if marking done fails, the AI result is rolled back and the job is failed', async () => {
    const d = makeDb();
    addNotes(d, 1);
    d.exec(`CREATE TRIGGER no_done BEFORE UPDATE OF status ON study_summary_jobs WHEN NEW.status = 'done'
            BEGIN SELECT RAISE(ABORT, 'done blocked'); END`);
    chat.mockImplementation(async (p: string) => reply('T', p));
    const r = startSummaryJob(d, 'u1', 'b1', '书', 'generate') as { job: { id: string } };
    await waitJob(r.job.id);
    expect(getCurrentJob(d, 'u1', 'b1')).toMatchObject({ status: 'failed', error: 'done blocked' });
    expect(getSummary(d, 'u1', 'b1')).toBeNull();
    expect(count(d, 'study_summary_versions')).toBe(0);
  });

  it('logs when the job cannot even be marked failed', async () => {
    const d = makeDb();
    addNotes(d, 1);
    d.exec(`CREATE TRIGGER no_status BEFORE UPDATE OF status ON study_summary_jobs
            BEGIN SELECT RAISE(ABORT, 'status blocked'); END`);
    chat.mockRejectedValue(new Error('boom'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const r = startSummaryJob(d, 'u1', 'b1', '书', 'generate') as { job: { id: string } };
      await waitJob(r.job.id);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('generate refuses when summary exists', () => {
    const d = makeDb();
    addNotes(d, 1);
    writeAiResult(d, 'u1', 'b1', seedDoc('A', 'b'), [], 'ai_generate', '初版');
    expect(startSummaryJob(d, 'u1', 'b1', '书', 'generate')).toEqual({ error: 'has_summary' });
    expect(chat).not.toHaveBeenCalled();
  });

  it('no_notes and no_new_notes', () => {
    const d = makeDb();
    expect(startSummaryJob(d, 'u1', 'b1', '书', 'generate')).toEqual({ error: 'no_notes' });
    const refs = addNotes(d, 1);
    writeAiResult(d, 'u1', 'b1', seedDoc('A', 'b'), refs, 'ai_generate', '初版');
    expect(startSummaryJob(d, 'u1', 'b1', '书', 'update')).toEqual({ error: 'no_new_notes' });
  });
});
