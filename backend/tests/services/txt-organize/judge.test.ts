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
    // 第 2 批只有 100 个新候选：拆成 50 / 50，其中前半仍缺 id → 失败
    await expect(judgeCandidates(makeCands(400), book, db)).rejects.toThrow('AI 判定失败：第 2 批（缺少 id：280）');
  });

  it('type 非法 → 本批无效；part 空 title / noise 无 noiseKind 按保守方式补全', async () => {
    const bad = (label: object) => JSON.stringify({ labels: [{ id: 0, type: 'chapter', title: 'a' }, { id: 1, ...label }], notes: [] });
    for (const label of [{ type: 'bogus' }, { type: 'part', title: ' ' }, { type: 'noise' }, { type: 'chapter', title: 'x' }]) {
      const spy = jest.spyOn(aiManager, 'chat').mockResolvedValue(bad(label));
      if (label.type === 'bogus') {
        await expect(judgeCandidates(makeCands(2), book, db)).rejects.toThrow('AI 判定失败：第 1 批（id 1 的 type 无效：bogus）');
        expect(spy).toHaveBeenCalledTimes(2);
      } else {
        const res = await judgeCandidates(makeCands(2), book, db);
        if (label.type === 'part') expect(res.labels[1].title).toBe('第1章 标题1');
        if (label.type === 'noise') expect(res.labels[1].noiseKind).toBe('text');
      }
      spy.mockRestore();
    }
  });

  it('单条标签不全：noise 缺 noiseKind 补 text、chapter 缺 title 用原文，notes 加一条提示', async () => {
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => JSON.stringify({
      labels: idsIn(prompt).map(id => id === 1 ? { id, type: 'noise' }
        : id === 2 ? { id, type: 'chapter' }
        : { id, type: 'chapter', title: `章${id}` }),
      notes: ['原备注'],
    }));
    const res = await judgeCandidates(makeCands(4), book, db);
    expect(res.labels[1]).toEqual({ id: 1, type: 'noise', noiseKind: 'text' });
    expect(res.labels[2]).toEqual({ id: 2, type: 'chapter', title: '第2章 标题2' });
    expect(res.labels[3].title).toBe('章3');
    expect(res.notes).toEqual(['原备注', '第 1 批有 2 条标签格式不全，已按保守方式处理']);
  });

  it('一批两次缺 id → 对半拆分，两半都成功则整体成功，进度仍按原批数', async () => {
    let call = 0;
    const prompts: string[] = [];
    const spy = jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      call++;
      prompts.push(prompt);
      const ids = idsIn(prompt);
      return chapterJson(call <= 2 ? ids.slice(1) : ids, `-c${call}`);
    });
    const progress: Array<[number, number]> = [];
    const res = await judgeCandidates(makeCands(500), book, db, (d, t) => progress.push([d, t]));
    // 第 1 批（0..299）失败两次后拆成 0..149 / 150..299；第 2 批正常
    expect(spy).toHaveBeenCalledTimes(5);
    expect(idsIn(prompts[2])).toEqual(Array.from({ length: 150 }, (_, i) => i));
    expect(idsIn(prompts[3])).toEqual(Array.from({ length: 150 }, (_, i) => 150 + i));
    expect(res.labels).toHaveLength(500);
    expect(res.labels.map(l => l.id)).toEqual(Array.from({ length: 500 }, (_, i) => i));
    expect(res.labels[0].title).toBe('章0-c3');
    expect(res.labels[279].title).toBe('章279-c4');
    expect(res.labels[299].title).toBe('章299-c5'); // 重叠部分以第 2 批为准
    expect(res.batches).toBe(2);
    expect(progress).toEqual([[1, 2], [2, 2]]);
  });

  it('单批：两次缺 id 后拆半，两半都成功 → chat 共调用 4 次', async () => {
    let call = 0;
    const spy = jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      call++;
      const ids = idsIn(prompt);
      return chapterJson(call <= 2 ? ids.slice(1) : ids);
    });
    const res = await judgeCandidates(makeCands(200), book, db);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(res.labels.map(l => l.id)).toEqual(Array.from({ length: 200 }, (_, i) => i));
    expect(res.batches).toBe(1);
  });

  it('拆出的半批带原批的重叠上文和结构摘要', async () => {
    const prompts: string[] = [];
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      const ids = idsIn(prompt);
      // 第 2 批（含上文共 320 个 id）永远缺 id；拆分后的半批正常
      if (ids.length === 320) return chapterJson(ids.slice(1));
      return chapterJson(ids);
    });
    const res = await judgeCandidates(makeCands(600), book, db);
    expect(prompts).toHaveLength(1 + 2 + 2);
    const halves = prompts.slice(3);
    expect(idsIn(halves[0])).toEqual(Array.from({ length: 170 }, (_, i) => 280 + i));
    expect(idsIn(halves[1])).toEqual([...Array.from({ length: 20 }, (_, i) => 280 + i), ...Array.from({ length: 150 }, (_, i) => 450 + i)]);
    expect(halves[0]).toContain('章299');
    expect(halves[1]).toContain('章299');
    expect(res.labels).toHaveLength(600);
  });

  it('一直失败到 50 行下限 → 抛错，带批号和原因', async () => {
    const spy = jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => chapterJson(idsIn(prompt).slice(0, -1)));
    await expect(judgeCandidates(makeCands(300), book, db)).rejects.toThrow(/^AI 判定失败：第 1 批（缺少 id：\d+）$/);
    // 300 → 150 → 75（75 不能再拆成两个 ≥50 的半批）：每级 2 次
    expect(spy).toHaveBeenCalledTimes(6);
  });

  it('缺少 id 的错误信息列出 id', async () => {
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => chapterJson(idsIn(prompt).slice(3)));
    await expect(judgeCandidates(makeCands(10), book, db)).rejects.toThrow('AI 判定失败：第 1 批（缺少 id：0、1、2）');
  });

  it('缺少 id 很多时只列前几个并给出总数', async () => {
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => chapterJson(idsIn(prompt).slice(8)));
    await expect(judgeCandidates(makeCands(10), book, db)).rejects.toThrow('AI 判定失败：第 1 批（缺少 id：0、1、2、3、4 等 8 个）');
  });

  it('无法解析 JSON 的错误信息', async () => {
    jest.spyOn(aiManager, 'chat').mockResolvedValue('抱歉');
    await expect(judgeCandidates(makeCands(10), book, db)).rejects.toThrow('AI 判定失败：第 1 批（无法解析 JSON）');
  });

  it('AI 调用本身出错不重试', async () => {
    const spy = jest.spyOn(aiManager, 'chat').mockRejectedValue(new Error('网络错误'));
    await expect(judgeCandidates(makeCands(200), book, db)).rejects.toThrow('网络错误');
    expect(spy).toHaveBeenCalledTimes(1);
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
