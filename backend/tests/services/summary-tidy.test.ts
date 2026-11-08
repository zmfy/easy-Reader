import Database from 'better-sqlite3';
import { STUDY_SUMMARY_DDL, writeAiResult } from '../../src/services/study-summary';
import { setStudyPrefs } from '../../src/services/study-prefs';
import {
  validateTidyContent, findThemeTitle, buildTidyPrompt, parseTidyOutput, tidySelection, TidyBusyError, TidyNotFoundError,
} from '../../src/services/summary-tidy';
import { SummaryAiOutputError } from '../../src/services/summary-ai';
import { aiManager } from '../../src/ai/ai-manager';
import { DocNode, isValidDoc, TABLE_MAX_ROWS } from '../../src/services/summary-doc';

jest.mock('../../src/ai/ai-manager');
const chat = aiManager.chat as jest.Mock;

const t = (text: string, ...marks: string[]): DocNode => (marks.length ? { type: 'text', text, marks: marks.map(type => ({ type })) } : { type: 'text', text });
const ref = (r: string): DocNode => ({ type: 'noteRef', attrs: { ref: r } });
const h = (level: number, text: string): DocNode => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const p = (...content: DocNode[]): DocNode => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });
const ul = (...items: DocNode[][]): DocNode => ({ type: 'bulletList', content: items.map(c => ({ type: 'listItem', content: c })) });

function makeDb() {
  const d = new Database(':memory:');
  d.exec(STUDY_SUMMARY_DDL);
  d.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return d;
}

const NOTES = [
  p(t('ls 列出目录内容，-l 显示详细信息'), ref('h:1')),
  p(t('chmod 改文件权限，常用 755'), ref('h:2')),
];

// 递归收集节点
function all(n: DocNode, type: string, out: DocNode[] = []): DocNode[] {
  if (n.type === type) out.push(n);
  (n.content || []).forEach(c => all(c, type, out));
  return out;
}

describe('summary-tidy validation and prompt', () => {
  it('validateTidyContent rejects h2, oversize text, empty and malformed content', () => {
    expect(validateTidyContent([])).toEqual({ ok: false, message: '请先选择要整理的内容' });
    expect(validateTidyContent('x')).toEqual({ ok: false, message: '请先选择要整理的内容' });
    expect(validateTidyContent([h(2, '主题'), p(t('a'))])).toEqual({ ok: false, message: '请在一个主题内选择' });
    expect(validateTidyContent([p(t('a'.repeat(6001)))])).toEqual({ ok: false, message: '选中的内容太多，请分段整理' });
    expect(validateTidyContent([{ type: 'evil' }]).ok).toBe(false);
    const ok = validateTidyContent([h(3, '小节'), ...NOTES]);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.refs).toEqual(['h:1', 'h:2']);
      expect(ok.nodes).toHaveLength(3);
    }
    expect(validateTidyContent([p(t('字'.repeat(6000)))]).ok).toBe(true);
  });

  it('findThemeTitle returns the nearest preceding h2', () => {
    const d = doc(h(2, 'A'), p(t('a')), h(2, '命令'), h(3, '小节'), ...NOTES);
    expect(findThemeTitle(d, [NOTES[0]])).toBe('命令');
    expect(findThemeTitle(d, [p(t('a'))])).toBe('A');
    expect(findThemeTitle(d, [p(t('不存在'))])).toBeNull();
    expect(findThemeTitle(doc(p(t('a'))), [p(t('a'))])).toBeNull();
  });

  it('buildTidyPrompt serializes refs as [[ref]], includes theme and columns, and forbids additions when disabled', () => {
    const text = validateTidyContent(NOTES);
    if (!text.ok) throw new Error('bad');
    const off = buildTidyPrompt({ mode: 'table', theme: 'Linux 命令', text: text.text, columns: ['命令', '作用'], allowAddition: false });
    expect(off).toContain('[[h:1]]');
    expect(off).toContain('Linux 命令');
    expect(off).toContain('命令、作用');
    expect(off).toContain('不新增笔记里没有的知识');
    expect(off).not.toContain('{{+');
    const on = buildTidyPrompt({ mode: 'list', theme: null, text: text.text, allowAddition: true });
    expect(on).toContain('{{+');
    expect(on).toContain('"items"');
  });

  it('serializes existing aiAdded text with markers so a re-tidy keeps them', () => {
    const v = validateTidyContent([p(t('ls 列目录'), t('，-a 显示隐藏文件', 'aiAdded'))]);
    if (!v.ok) throw new Error('bad');
    expect(v.text).toContain('{{+，-a 显示隐藏文件}}');
    const prompt = buildTidyPrompt({ mode: 'list', theme: null, text: v.text, allowAddition: false });
    expect(prompt).toContain('{{+');
  });
});

describe('parseTidyOutput', () => {
  const opts = { validRefs: new Set(['h:1', 'h:2']), allowAddition: false };

  it('builds a table with header row, code and bold marks', () => {
    const raw = '```json\n{"columns":["命令","作用"],"rows":[["`ls`","列出目录 **常用** [[h:1]]"]]}\n```';
    const r = parseTidyOutput(raw, 'table', opts);
    expect(r.columns).toEqual(['命令', '作用']);
    expect(r.nodes).toHaveLength(1);
    const table = r.nodes[0];
    expect(table.type).toBe('table');
    expect(table.content![0].content!.map(c => c.type)).toEqual(['tableHeader', 'tableHeader']);
    expect(table.content![1].content!.map(c => c.type)).toEqual(['tableCell', 'tableCell']);
    expect(table.content![1].content![0].content![0].content).toEqual([t('ls', 'code')]);
    expect(table.content![1].content![1].content![0].content).toEqual([t('列出目录 '), t('常用', 'bold'), t(' '), ref('h:1')]);
    expect(r.missingRefs).toEqual(['h:2']);
    expect(isValidDoc(doc(...r.nodes))).toBe(true);
  });

  it('parseTidyOutput normalizes ragged and oversized tables', () => {
    const cols = Array.from({ length: 10 }, (_, i) => 'c' + i);
    const rows = Array.from({ length: 250 }, (_, i) => (i % 2 ? ['a'] : Array.from({ length: 12 }, () => 'x')));
    const r = parseTidyOutput(JSON.stringify({ columns: cols, rows }), 'table', opts);
    expect(r.columns).toHaveLength(6);
    const table = r.nodes[0];
    expect(table.content).toHaveLength(TABLE_MAX_ROWS);
    for (const row of table.content!) expect(row.content).toHaveLength(6);
    expect(table.content![2].content![1]).toEqual({ type: 'tableCell', content: [p()] });
    expect(isValidDoc(doc(...r.nodes))).toBe(true);
  });

  it('uses user columns over AI columns and rejects fewer than 2 AI columns', () => {
    const r = parseTidyOutput('{"columns":["x","y","z"],"rows":[["1","2","3"]]}', 'table', { ...opts, columns: ['命令', '作用'] });
    expect(r.columns).toEqual(['命令', '作用']);
    expect(r.nodes[0].content![1].content).toHaveLength(2);
    expect(() => parseTidyOutput('{"columns":["x"],"rows":[["1"]]}', 'table', opts)).toThrow(SummaryAiOutputError);
    expect(() => parseTidyOutput('{"columns":["x","y"],"rows":[]}', 'table', opts)).toThrow(SummaryAiOutputError);
  });

  it('parseTidyOutput drops refs not in the selection', () => {
    const r = parseTidyOutput('{"items":["甲 [[h:1]] [[h:999]] [[n:abc]]"]}', 'list', opts);
    expect(all(r.nodes[0], 'noteRef')).toEqual([ref('h:1')]);
  });

  it('parseTidyOutput marks {{+…}} as aiAdded only when allowed and counts them', () => {
    const raw = '{"items":["ls 列目录{{+，-a 显示隐藏文件}} [[h:1]]"]}';
    const on = parseTidyOutput(raw, 'list', { ...opts, allowAddition: true });
    expect(on.aiAddedCount).toBe(1);
    expect(all(on.nodes[0], 'text')).toEqual([t('ls 列目录'), t('，-a 显示隐藏文件', 'aiAdded'), t(' ')]);
    const off = parseTidyOutput(raw, 'list', opts);
    expect(off.aiAddedCount).toBe(0);
    expect(all(off.nodes[0], 'text')).toEqual([t('ls 列目录，-a 显示隐藏文件 ')]);
    const broken = parseTidyOutput('{"items":["{{+没闭合"]}', 'list', { ...opts, allowAddition: true });
    expect(all(broken.nodes[0], 'text')).toEqual([t('没闭合')]);
    const codeAi = parseTidyOutput('{"items":["{{+`ls -a`}}"]}', 'list', { ...opts, allowAddition: true });
    expect(all(codeAi.nodes[0], 'text')).toEqual([t('ls -a', 'code', 'aiAdded')]);
  });

  it('keeps markers that were already in the selection even when additions are off', () => {
    const r = parseTidyOutput('{"items":["ls{{+，-a 显示隐藏文件}}{{+新编的}}"]}', 'list', { ...opts, existingAiText: '，-a 显示隐藏文件' });
    expect(all(r.nodes[0], 'text')).toEqual([t('ls'), t('，-a 显示隐藏文件', 'aiAdded'), t('新编的')]);
    expect(r.aiAddedCount).toBe(1);
  });

  it('parseTidyOutput builds a bullet list for list mode and throws on garbage', () => {
    const r = parseTidyOutput('<think>想想</think>{"items":["一 [[h:1]]","  ","二"]}', 'list', opts);
    expect(r.nodes).toEqual([ul([p(t('一 '), ref('h:1'))], [p(t('二'))])]);
    expect(r.columns).toEqual([]);
    expect(() => parseTidyOutput('不是 JSON', 'list', opts)).toThrow(SummaryAiOutputError);
    expect(() => parseTidyOutput('{"items":[]}', 'list', opts)).toThrow(SummaryAiOutputError);
    expect(() => parseTidyOutput('{"rows":[["a","b"]]}', 'list', opts)).toThrow(SummaryAiOutputError);
  });
});

describe('tidySelection', () => {
  beforeEach(() => chat.mockReset());

  it('reports missingRefs, sends the theme, and uses the user preference', async () => {
    const d = makeDb();
    writeAiResult(d, 'u1', 'b1', doc(h(2, 'Linux 命令'), ...NOTES), ['h:1', 'h:2'], 'ai_generate', '初版');
    chat.mockResolvedValue('{"columns":["命令","作用"],"rows":[["ls","列目录 [[h:1]]"]]}');
    const r = await tidySelection(d, 'u1', 'b1', { mode: 'table', content: NOTES });
    expect(r.missingRefs).toEqual(['h:2']);
    expect(chat.mock.calls[0][0]).toContain('Linux 命令');
    expect(chat.mock.calls[0][0]).not.toContain('{{+');
    setStudyPrefs(d, 'u1', { allowAiAddition: true });
    await tidySelection(d, 'u1', 'b1', { mode: 'table', content: NOTES });
    expect(chat.mock.calls[1][0]).toContain('{{+');
  });

  it('tidySelection refuses while a summary job is running or without a summary', async () => {
    const d = makeDb();
    await expect(tidySelection(d, 'u1', 'b1', { mode: 'list', content: NOTES })).rejects.toBeInstanceOf(TidyNotFoundError);
    writeAiResult(d, 'u1', 'b1', doc(h(2, 'A'), ...NOTES), [], 'ai_generate', '初版');
    d.prepare("INSERT INTO study_summary_jobs (id, user_id, book_id, kind, status, done, total) VALUES ('j','u1','b1','update','running',0,1)").run();
    await expect(tidySelection(d, 'u1', 'b1', { mode: 'list', content: NOTES })).rejects.toBeInstanceOf(TidyBusyError);
    expect(chat).not.toHaveBeenCalled();
  });
});
