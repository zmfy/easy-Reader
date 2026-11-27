import Database from 'better-sqlite3';
import { aiManager } from '../../../src/ai/ai-manager';
import { Candidate } from '../../../src/services/txt-organize/candidates';
import { judgeCandidates, JUDGE_BATCH_SIZE, JUDGE_OVERLAP } from '../../../src/services/txt-organize/judge';

const db = new Database(':memory:');
const book = { title: '测试书', author: '某作者' };

const makeCands = (n: number): Candidate[] => Array.from({ length: n }, (_, i) => ({
  id: i, lineNo: i * 10, byteStart: i * 100, byteEnd: i * 100 + 50, text: `第${i}章 标题${i}`,
  bodyChars: 1000, bodyLines: 10, prevSnippet: '前文', nextSnippet: '后文', ruleHint: 'heading' as const,
}));

/** 候选行在提示词里形如 `#12\t...`，从中取出本次提示词包含的 id */
const idsIn = (prompt: string) => [...prompt.matchAll(/^#(\d+)\t/gm)].map(m => Number(m[1]));
const chapterJson = (ids: number[], mark = '') => JSON.stringify({
  labels: ids.map(id => ({ id, type: 'chapter', title: `章${id}${mark}` })), notes: [],
});

afterEach(() => jest.restoreAllMocks());

describe('judgeCandidates', () => {
  it('分批：700 个候选分 3 批，相邻批重叠 20 行，重叠部分以后一批为准', async () => {
    expect(JUDGE_BATCH_SIZE).toBe(300);
    expect(JUDGE_OVERLAP).toBe(20);
    const prompts: string[] = [];
    let call = 0;
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      call++;
      return chapterJson(idsIn(prompt), `-b${call}`);
    });
    const res = await judgeCandidates(makeCands(700), book, db);
    expect(res.batches).toBe(3);
    expect(prompts).toHaveLength(3);
    expect(idsIn(prompts[0])).toHaveLength(300);
    expect(idsIn(prompts[1])).toEqual(Array.from({ length: 320 }, (_, i) => 280 + i));
    expect(idsIn(prompts[2])).toEqual(Array.from({ length: 120 }, (_, i) => 580 + i));
    expect(res.labels).toHaveLength(700);
    expect(res.labels.map(l => l.id)).toEqual(Array.from({ length: 700 }, (_, i) => i));
    expect(res.labels[279].title).toBe('章279-b1');
    expect(res.labels[280].title).toBe('章280-b2');
    expect(res.labels[599].title).toBe('章599-b3');
    expect(res.labels[600].title).toBe('章600-b3');
  });

  it('每批提示词带上一批的结构摘要', async () => {
    const prompts: string[] = [];
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      const ids = idsIn(prompt);
      return JSON.stringify({
        labels: ids.map(id => id === 0
          ? { id, type: 'volume', title: '第一卷 起' }
          : { id, type: 'chapter', title: `章${id}` }),
        notes: [],
      });
    });
    await judgeCandidates(makeCands(400), book, db);
    expect(prompts[0]).toContain('测试书');
    expect(prompts[0]).toContain('某作者');
    expect(prompts[1]).toContain('章299');
    expect(prompts[1]).toContain('第一卷 起');
  });

  it('返回非 JSON 时重试一次后成功', async () => {
    const spy = jest.spyOn(aiManager, 'chat')
      .mockResolvedValueOnce('抱歉，我无法处理')
      .mockImplementationOnce(async (prompt: string) => chapterJson(idsIn(prompt)));
    const res = await judgeCandidates(makeCands(5), book, db);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.labels).toHaveLength(5);
    expect(res.batches).toBe(1);
  });

  it('两次都缺 id → 抛错，错误信息含批号', async () => {
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      const ids = idsIn(prompt);
      // 第二批永远缺一个 id
      return chapterJson(ids[0] >= 280 ? ids.slice(1) : ids);
    });
    await expect(judgeCandidates(makeCands(400), book, db)).rejects.toThrow('AI 判定失败：第 2 批');
  });

  it('type 非法 / part 无 title / noise 无 noiseKind 都算本批无效', async () => {
    const bad = (label: object) => JSON.stringify({ labels: [{ id: 0, type: 'chapter', title: 'a' }, { id: 1, ...label }], notes: [] });
    for (const label of [{ type: 'bogus' }, { type: 'part', title: ' ' }, { type: 'noise' }, { type: 'chapter', title: 'x' }]) {
      const spy = jest.spyOn(aiManager, 'chat').mockResolvedValue(bad(label));
      if (label.type === 'chapter') {
        await expect(judgeCandidates(makeCands(2), book, db)).resolves.toBeDefined();
      } else {
        await expect(judgeCandidates(makeCands(2), book, db)).rejects.toThrow('AI 判定失败：第 1 批');
        expect(spy).toHaveBeenCalledTimes(2);
      }
      spy.mockRestore();
    }
  });

  it('没有任何 chapter → 抛错', async () => {
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => JSON.stringify({
      labels: idsIn(prompt).map(id => ({ id, type: 'noise', noiseKind: 'text' })), notes: [],
    }));
    await expect(judgeCandidates(makeCands(3), book, db)).rejects.toThrow(/chapter|章节/);
  });

  it('第一个非 noise 标签是 duplicate → 抛错', async () => {
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => JSON.stringify({
      labels: idsIn(prompt).map(id => id === 0
        ? { id, type: 'noise', noiseKind: 'text' }
        : id === 1 ? { id, type: 'duplicate' } : { id, type: 'chapter', title: `章${id}` }),
      notes: [],
    }));
    await expect(judgeCandidates(makeCands(4), book, db)).rejects.toThrow(/duplicate/);
  });

  it('notes 汇总各批', async () => {
    let call = 0;
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      call++;
      return JSON.stringify({
        labels: idsIn(prompt).map(id => ({ id, type: 'chapter', title: `章${id}` })), notes: [`备注${call}`],
      });
    });
    const res = await judgeCandidates(makeCands(400), book, db);
    expect(res.notes).toEqual(['备注1', '备注2']);
  });

  it('onBatch 回调按批报告进度', async () => {
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => chapterJson(idsIn(prompt)));
    const calls: Array<[number, number]> = [];
    await judgeCandidates(makeCands(700), book, db, (done, total) => calls.push([done, total]));
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });
});
