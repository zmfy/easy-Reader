import Database from 'better-sqlite3';
import { HIGHLIGHTS_DDL, createHighlight } from '../../src/services/highlights';
import { MIND_DDL, keepChain } from '../../src/services/mind-nodes';
import {
  STUDY_SUMMARY_DDL, collectNotes, getSummary, newNotes, writeAiResult, saveUserDoc, listVersions, getVersion,
  restoreVersion, deleteSummary, listSummaryOverview, failStaleSummaryJobs,
} from '../../src/services/study-summary';
import { DocNode } from '../../src/services/summary-doc';

function makeDb() {
  const d = new Database(':memory:');
  d.exec(HIGHLIGHTS_DDL);
  d.exec(MIND_DDL);
  d.exec(STUDY_SUMMARY_DDL);
  d.exec('CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT)');
  return d;
}

const doc = (theme: string, body = ''): DocNode => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: theme }] },
    { type: 'paragraph', content: body ? [{ type: 'text', text: body }] : undefined },
  ],
});

function startJob(d: Database.Database, userId = 'u1', bookId = 'b1', status = 'running') {
  d.prepare("INSERT INTO study_summary_jobs (id, user_id, book_id, kind, status, done, total) VALUES (?,?,?,?,?,0,1)")
    .run('j' + Math.random(), userId, bookId, 'generate', status);
}

describe('study-summary', () => {
  it('collectNotes excludes highlight-kind nodes and orders by chapter', () => {
    const d = makeDb();
    const h2 = createHighlight(d, 'u1', 'b1', { chapterIndex: 2, startOffset: 0, endOffset: 3, text: 'late highlight', note: '批注' });
    const h0 = createHighlight(d, 'u1', 'b1', { chapterIndex: 0, startOffset: 0, endOffset: 3, text: 'x'.repeat(40) });
    keepChain(d, 'u1', 'b1', h0.id, [{ label: '概念甲', kind: 'concept', summary: '说明' }]);
    const notes = collectNotes(d, 'u1', 'b1');
    expect(notes.map(n => n.chapterIndex)).toEqual([0, 0, 2]);
    expect(notes.some(n => n.kind === 'highlight' && n.ref === 'h:' + h0.id)).toBe(true);
    const c = notes.find(n => n.text === '概念甲')!;
    expect(c.ref.startsWith('n:')).toBe(true);
    expect(c.summary).toBe('说明');
    expect(c.note).toBeUndefined();
    expect(c.parentLabel).toBe('x'.repeat(30));
    expect(notes.find(n => n.ref === 'h:' + h2.id)!.note).toBe('批注');
    // 划线根节点（kind=highlight）不作为 n: 笔记出现
    expect(notes.filter(n => n.ref.startsWith('n:'))).toHaveLength(1);
    expect(collectNotes(d, 'u2', 'b1')).toEqual([]);
  });

  it('newNotes is everything not in included_refs', () => {
    const d = makeDb();
    const notes = [
      { ref: 'h:1', kind: 'highlight' as const, chapterIndex: 0, text: 'a' },
      { ref: 'h:2', kind: 'highlight' as const, chapterIndex: 0, text: 'b' },
    ];
    expect(newNotes(notes, null)).toHaveLength(2);
    const s = writeAiResult(d, 'u1', 'b1', doc('T'), ['h:1'], 'ai_generate', '初版');
    expect(newNotes(notes, s).map(n => n.ref)).toEqual(['h:2']);
  });

  it('writeAiResult creates summary, bumps revision, unions refs and adds a version', () => {
    const d = makeDb();
    const s1 = writeAiResult(d, 'u1', 'b1', doc('A'), ['h:1', 'h:2'], 'ai_generate', '初版');
    expect(s1.revision).toBe(1);
    const s2 = writeAiResult(d, 'u1', 'b1', doc('A', 'more'), ['h:2', 'h:3'], 'ai_update', '追加');
    expect(s2.revision).toBe(2);
    expect(s2.included_refs.sort()).toEqual(['h:1', 'h:2', 'h:3']);
    expect(s2.doc).toEqual(JSON.parse(JSON.stringify(doc('A', 'more'))));
    expect(listVersions(d, 'u1', 'b1').map(v => v.source)).toEqual(['ai_update', 'ai_generate']);
    expect(getSummary(d, 'u1', 'b1')!.revision).toBe(2);
  });

  it('saveUserDoc rejects stale revision with latest summary', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    const r = saveUserDoc(d, 'u1', 'b1', doc('B'), 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('conflict');
      expect(r.summary!.revision).toBe(1);
    }
    const ok = saveUserDoc(d, 'u1', 'b1', doc('B'), 1);
    expect(ok.ok && ok.summary.revision).toBe(2);
    const nf = saveUserDoc(d, 'u1', 'nope', doc('B'), 1);
    expect(nf).toEqual({ ok: false, reason: 'not_found' });
  });

  it('saveUserDoc is busy while a job is running', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    startJob(d);
    const r = saveUserDoc(d, 'u1', 'b1', doc('B'), 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('busy');
  });

  it('saveUserDoc merges saves within 30 minutes into one user version', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    saveUserDoc(d, 'u1', 'b1', doc('B'), 1);
    saveUserDoc(d, 'u1', 'b1', doc('C'), 2);
    let vs = listVersions(d, 'u1', 'b1');
    expect(vs.map(v => v.source)).toEqual(['user', 'ai_generate']);
    expect(vs[0].description).toBe('手动修改');
    expect(getVersion(d, 'u1', 'b1', vs[0].id)!.doc).toEqual(JSON.parse(JSON.stringify(doc('C'))));
    d.prepare("UPDATE study_summary_versions SET updated_at = datetime('now', '-31 minutes') WHERE source = 'user'").run();
    saveUserDoc(d, 'u1', 'b1', doc('D'), 3);
    vs = listVersions(d, 'u1', 'b1');
    expect(vs.map(v => v.source)).toEqual(['user', 'user', 'ai_generate']);
  });

  it('versions are user-scoped', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    const v = listVersions(d, 'u1', 'b1')[0];
    expect(getVersion(d, 'u1', 'b1', v.id)).not.toBeNull();
    expect(getVersion(d, 'u2', 'b1', v.id)).toBeNull();
    expect(listVersions(d, 'u2', 'b1')).toEqual([]);
  });

  it('deleteSummary removes versions and refuses while running', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    startJob(d);
    expect(deleteSummary(d, 'u1', 'b1')).toBe(false);
    d.prepare("UPDATE study_summary_jobs SET status = 'done'").run();
    expect(deleteSummary(d, 'u1', 'b1')).toBe(true);
    expect(getSummary(d, 'u1', 'b1')).toBeNull();
    expect((d.prepare('SELECT COUNT(*) AS n FROM study_summary_versions').get() as { n: number }).n).toBe(0);
    expect(deleteSummary(d, 'u1', 'b1')).toBe(false);
  });

  it('deleteSummary also removes finished job records', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    startJob(d, 'u1', 'b1', 'done');
    startJob(d, 'u1', 'b2', 'done');
    expect(deleteSummary(d, 'u1', 'b1')).toBe(true);
    const rows = d.prepare('SELECT book_id FROM study_summary_jobs').all() as Array<{ book_id: string }>;
    expect(rows.map(r => r.book_id)).toEqual(['b2']);
  });

  it('listSummaryOverview includes books with notes but no summary and deleted books with summary', () => {
    const d = makeDb();
    d.prepare("INSERT INTO books (id, title) VALUES ('b1', '书一')").run();
    createHighlight(d, 'u1', 'b1', { chapterIndex: 0, startOffset: 0, endOffset: 1, text: 'hl' });
    writeAiResult(d, 'u1', 'gone', doc('主题'), [], 'ai_generate', '初版');
    const list = listSummaryOverview(d, 'u1');
    expect(list.map(o => o.bookId)).toEqual(['gone', 'b1']);
    const gone = list[0];
    expect(gone.bookTitle).toBeNull();
    expect(gone.hasSummary).toBe(true);
    expect(gone.themes).toEqual(['主题']);
    expect(gone.lastSource).toBe('ai_generate');
    const b1 = list[1];
    expect(b1.bookTitle).toBe('书一');
    expect(b1.hasSummary).toBe(false);
    expect(b1.noteCount).toBe(1);
    expect(b1.newNoteCount).toBe(1);
    expect(b1.updatedAt).toBeNull();
    expect(b1.job).toBeNull();
  });

  it('listSummaryOverview skips deleted books that have notes but no summary', () => {
    const d = makeDb();
    d.prepare("INSERT INTO books (id, title) VALUES ('b1', '书一')").run();
    createHighlight(d, 'u1', 'b1', { chapterIndex: 0, startOffset: 0, endOffset: 1, text: 'hl' });
    createHighlight(d, 'u1', 'orphan', { chapterIndex: 0, startOffset: 0, endOffset: 1, text: 'hl' });
    writeAiResult(d, 'u1', 'gone', doc('主题'), [], 'ai_generate', '初版');
    expect(listSummaryOverview(d, 'u1').map(o => o.bookId).sort()).toEqual(['b1', 'gone']);
  });

  it('listSummaryOverview filters by title and doc text', () => {
    const d = makeDb();
    d.prepare("INSERT INTO books (id, title) VALUES ('b1', 'Alpha 传'), ('b2', '别的书')").run();
    writeAiResult(d, 'u1', 'b1', doc('甲', 'hello'), [], 'ai_generate', '初版');
    writeAiResult(d, 'u1', 'b2', doc('乙', 'Needle inside'), [], 'ai_generate', '初版');
    expect(listSummaryOverview(d, 'u1', 'alpha').map(o => o.bookId)).toEqual(['b1']);
    expect(listSummaryOverview(d, 'u1', 'needle').map(o => o.bookId)).toEqual(['b2']);
    expect(listSummaryOverview(d, 'u1', 'zzz')).toEqual([]);
  });

  it('failStaleSummaryJobs marks running jobs failed', () => {
    const d = makeDb();
    startJob(d);
    failStaleSummaryJobs(d);
    const r = d.prepare('SELECT status, error, finished_at FROM study_summary_jobs').get() as any;
    expect(r.status).toBe('failed');
    expect(r.error).toBeTruthy();
    expect(r.finished_at).toBeTruthy();
  });

  it('restoreVersion writes a restore version and keeps history', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    saveUserDoc(d, 'u1', 'b1', doc('B'), 1);
    const first = listVersions(d, 'u1', 'b1').find(v => v.source === 'ai_generate')!;
    const r = restoreVersion(d, 'u1', 'b1', first.id, 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.revision).toBe(3);
      expect(r.summary.doc).toEqual(JSON.parse(JSON.stringify(doc('A'))));
    }
    const vs = listVersions(d, 'u1', 'b1');
    expect(vs.map(v => v.source)).toEqual(['restore', 'user', 'ai_generate']);
    expect(vs[0].description).toBe('恢复到『AI 生成』版本');
    // 恢复后紧接着的手动保存不合并进 restore 版本
    saveUserDoc(d, 'u1', 'b1', doc('E'), 3);
    expect(listVersions(d, 'u1', 'b1').map(v => v.source)).toEqual(['user', 'restore', 'user', 'ai_generate']);
    // 各来源标签
    const userVer = listVersions(d, 'u1', 'b1').find(v => v.source === 'user')!;
    restoreVersion(d, 'u1', 'b1', userVer.id, 4);
    expect(listVersions(d, 'u1', 'b1')[0].description).toBe('恢复到『我』版本');
    const restoreVer = listVersions(d, 'u1', 'b1').find(v => v.source === 'restore')!;
    restoreVersion(d, 'u1', 'b1', restoreVer.id, 5);
    expect(listVersions(d, 'u1', 'b1')[0].description).toBe('恢复到『恢复』版本');
    writeAiResult(d, 'u1', 'b1', doc('U'), [], 'ai_update', '补充');
    const upd = listVersions(d, 'u1', 'b1')[0];
    restoreVersion(d, 'u1', 'b1', upd.id, 7);
    expect(listVersions(d, 'u1', 'b1')[0].description).toBe('恢复到『AI 补充』版本');
  });

  it('restoreVersion rejects stale revision and running job', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    const v = listVersions(d, 'u1', 'b1')[0];
    const stale = restoreVersion(d, 'u1', 'b1', v.id, 0);
    expect(stale.ok === false && stale.reason).toBe('conflict');
    startJob(d);
    const busy = restoreVersion(d, 'u1', 'b1', v.id, 1);
    expect(busy.ok === false && busy.reason).toBe('busy');
    expect(restoreVersion(d, 'u2', 'b1', v.id, 1).ok).toBe(false);
  });
});

describe('study-summary ai_tidy saves', () => {
  it('saveUserDoc with ai_tidy always creates a new version and never merges', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    saveUserDoc(d, 'u1', 'b1', doc('B'), 1);
    const r = saveUserDoc(d, 'u1', 'b1', doc('C'), 2, { source: 'ai_tidy', description: '整理成表格（3 列 5 行）' });
    expect(r.ok).toBe(true);
    let vs = listVersions(d, 'u1', 'b1');
    expect(vs.map(v => v.source)).toEqual(['ai_tidy', 'user', 'ai_generate']);
    expect(vs[0].description).toBe('整理成表格（3 列 5 行）');
    saveUserDoc(d, 'u1', 'b1', doc('D'), 3);
    vs = listVersions(d, 'u1', 'b1');
    expect(vs.map(v => v.source)).toEqual(['user', 'ai_tidy', 'user', 'ai_generate']);
    expect(getVersion(d, 'u1', 'b1', vs[1].id)!.doc).toEqual(JSON.parse(JSON.stringify(doc('C'))));
  });

  it('saveUserDoc ai_tidy defaults description to AI 整理 and still checks revision', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    const stale = saveUserDoc(d, 'u1', 'b1', doc('B'), 0, { source: 'ai_tidy' });
    expect(stale.ok === false && stale.reason).toBe('conflict');
    saveUserDoc(d, 'u1', 'b1', doc('B'), 1, { source: 'ai_tidy' });
    expect(listVersions(d, 'u1', 'b1')[0].description).toBe('AI 整理');
  });

  it('restore of an ai_tidy version describes it as AI 整理', () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc('A'), [], 'ai_generate', '初版');
    saveUserDoc(d, 'u1', 'b1', doc('B'), 1, { source: 'ai_tidy' });
    const v = listVersions(d, 'u1', 'b1')[0];
    restoreVersion(d, 'u1', 'b1', v.id, 2);
    expect(listVersions(d, 'u1', 'b1')[0].description).toBe('恢复到『AI 整理』版本');
  });
});
