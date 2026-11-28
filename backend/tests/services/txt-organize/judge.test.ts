import Database from 'better-sqlite3';
import { aiManager } from '../../../src/ai/ai-manager';
import { Candidate } from '../../../src/services/txt-organize/candidates';
import { judgeCandidates, judgeRetry, JUDGE_BATCH_SIZE, JUDGE_OVERLAP } from '../../../src/services/txt-organize/judge';

const db = new Database(':memory:');
const book = { title: '测试书', author: '某作者' };

const makeCands = (n: number): Candidate[] => Array.from({ length: n }, (_, i) => ({
  id: i, lineNo: i * 10, byteStart: i * 100, byteEnd: i * 100 + 50, text: `第${i}章 标题${i}`,
  bodyChars: 1000, bodyLines: 10, prevSnippet: '前文', nextSnippet: '后文', ruleHint: 'heading' as const,
}));

/** 候选行在提示词里形如 `#12\t...`，从中取出本次提示词包含的 id */
const idsIn = (prompt: string) => [...prompt.matchAll(/^#(\d+)\t/gm)].map(m => Number(m[1]));
const chapterJson = (ids: number[], type = 'chapter') => JSON.stringify({
  labels: ids.map(id => ({ id, type })), notes: [],
});
/** 区分是哪一次调用返回的标签：按调用次数轮换 type */
const callType = (call: number) => ['chapter', 'volume', 'part'][(call - 1) % 3];

// 临时错误的重试间隔改成 0，测试不真等
const realDelays = judgeRetry.delaysMs;
beforeEach(() => { judgeRetry.delaysMs = [0, 0, 0]; jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { judgeRetry.delaysMs = realDelays; jest.restoreAllMocks(); });

describe('judgeCandidates', () => {
  it('分批：700 个候选分 3 批，相邻批重叠 20 行，重叠部分以后一批为准', async () => {
    expect(JUDGE_BATCH_SIZE).toBe(300);
    expect(JUDGE_OVERLAP).toBe(20);
    const prompts: string[] = [];
    let call = 0;
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      call++;
      return chapterJson(idsIn(prompt), callType(call));
    });
    const res = await judgeCandidates(makeCands(700), book, db);
    expect(res.batches).toBe(3);
    expect(prompts).toHaveLength(3);
    expect(idsIn(prompts[0])).toHaveLength(300);
    expect(idsIn(prompts[1])).toEqual(Array.from({ length: 320 }, (_, i) => 280 + i));
    expect(idsIn(prompts[2])).toEqual(Array.from({ length: 120 }, (_, i) => 580 + i));
    expect(res.labels).toHaveLength(700);
    expect(res.labels.map(l => l.id)).toEqual(Array.from({ length: 700 }, (_, i) => i));
    expect(res.labels[279].type).toBe('chapter');
    expect(res.labels[280].type).toBe('volume');
    expect(res.labels[599].type).toBe('part');
    expect(res.labels[600].type).toBe('part');
  });

  it('每批提示词带上一批的结构摘要', async () => {
    const prompts: string[] = [];
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      prompts.push(prompt);
      const ids = idsIn(prompt);
      return JSON.stringify({
        labels: ids.map(id => id === 0
          ? { id, type: 'volume' }
          : { id, type: 'chapter' }),
        notes: [],
      });
    });
    const cands = makeCands(400);
    cands[0].text = '第一卷 起';
    await judgeCandidates(cands, book, db);
    expect(prompts[0]).toContain('测试书');
    expect(prompts[0]).toContain('某作者');
    expect(prompts[1]).toContain('第299章 标题299');
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

  it('type 非法 → 本批无效；noise 无 noiseKind 按保守方式补全', async () => {
    const bad = (label: object) => JSON.stringify({ labels: [{ id: 0, type: 'chapter' }, { id: 1, ...label }], notes: [] });
    for (const label of [{ type: 'bogus' }, { type: 'noise' }]) {
      const spy = jest.spyOn(aiManager, 'chat').mockResolvedValue(bad(label));
      if (label.type === 'bogus') {
        await expect(judgeCandidates(makeCands(2), book, db)).rejects.toThrow('AI 判定失败：第 1 批（id 1 的 type 无效：bogus）');
        expect(spy).toHaveBeenCalledTimes(2);
      } else {
        const res = await judgeCandidates(makeCands(2), book, db);
        expect(res.labels[1].noiseKind).toBe('text');
      }
      spy.mockRestore();
    }
  });

  it('noise 缺 noiseKind 补 text，notes 加一条提示；AI 多给的 title 忽略', async () => {
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => JSON.stringify({
      labels: idsIn(prompt).map(id => id === 1 ? { id, type: 'noise' }
        : id === 2 ? { id, type: 'chapter', title: '第五百章 被改的标题' }
        : { id, type: 'chapter' }),
      notes: ['原备注'],
    }));
    const res = await judgeCandidates(makeCands(4), book, db);
    expect(res.labels[1]).toEqual({ id: 1, type: 'noise', noiseKind: 'text' });
    expect(res.labels[2]).toEqual({ id: 2, type: 'chapter' });
    expect(res.notes).toEqual(['原备注', '第 1 批有 1 条标签格式不全，已按保守方式处理']);
  });

  it('一批两次缺 id → 对半拆分，两半都成功则整体成功，进度仍按原批数', async () => {
    let call = 0;
    const prompts: string[] = [];
    const spy = jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      call++;
      prompts.push(prompt);
      const ids = idsIn(prompt);
      return chapterJson(call <= 2 ? ids.slice(1) : ids, callType(call));
    });
    const progress: Array<[number, number]> = [];
    const res = await judgeCandidates(makeCands(500), book, db, (d, t) => progress.push([d, t]));
    // 第 1 批（0..299）失败两次后拆成 0..149 / 150..299；第 2 批正常
    expect(spy).toHaveBeenCalledTimes(5);
    expect(idsIn(prompts[2])).toEqual(Array.from({ length: 150 }, (_, i) => i));
    expect(idsIn(prompts[3])).toEqual(Array.from({ length: 150 }, (_, i) => 150 + i));
    expect(res.labels).toHaveLength(500);
    expect(res.labels.map(l => l.id)).toEqual(Array.from({ length: 500 }, (_, i) => i));
    expect(res.labels[0].type).toBe('part');
    expect(res.labels[279].type).toBe('chapter');
    expect(res.labels[299].type).toBe('volume'); // 重叠部分以第 2 批为准
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
    expect(halves[0]).toContain('最近章节标题：第295章 标题295 / 第296章 标题296 / 第297章 标题297 / 第298章 标题298 / 第299章 标题299');
    expect(halves[1]).toContain('最近章节标题：第295章 标题295 / 第296章 标题296 / 第297章 标题297 / 第298章 标题298 / 第299章 标题299');
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

  it('AI 调用临时出错：同批重试，前 2 次 fetch failed、第 3 次正常 → 成功，不计入无效重试也不拆分', async () => {
    const spy = jest.spyOn(aiManager, 'chat')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockImplementation(async (prompt: string) => chapterJson(idsIn(prompt)));
    const res = await judgeCandidates(makeCands(200), book, db);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(res.labels).toHaveLength(200);
    // 每次提示词都是整批（没有拆分）
    for (const call of spy.mock.calls) expect(idsIn(call[0] as string)).toHaveLength(200);
  });

  it('网络错误与无效输出混合：网络重试不占用两次无效尝试', async () => {
    const spy = jest.spyOn(aiManager, 'chat')
      .mockResolvedValueOnce('抱歉')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockImplementation(async (prompt: string) => chapterJson(idsIn(prompt)));
    const res = await judgeCandidates(makeCands(10), book, db);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(res.labels).toHaveLength(10);
  });

  it('AI 调用一直出错 → 重试 3 次后失败，错误信息带批号和原始错误', async () => {
    const spy = jest.spyOn(aiManager, 'chat').mockRejectedValue(new TypeError('fetch failed'));
    await expect(judgeCandidates(makeCands(200), book, db)).rejects.toThrow('AI 调用失败：第 1 批（重试 3 次后仍失败：fetch failed）');
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('fetch failed 的错误信息带上 cause 里的真正原因', async () => {
    jest.spyOn(aiManager, 'chat').mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }),
    );
    await expect(judgeCandidates(makeCands(10), book, db)).rejects.toThrow('fetch failed（原因：UND_ERR_HEADERS_TIMEOUT）');
  });

  it('按间隔递增等待后重试', async () => {
    judgeRetry.delaysMs = [5, 15, 30];
    const timeout = jest.spyOn(global, 'setTimeout');
    jest.spyOn(aiManager, 'chat').mockRejectedValue(new TypeError('fetch failed'));
    await expect(judgeCandidates(makeCands(10), book, db)).rejects.toThrow('fetch failed');
    expect(timeout.mock.calls.map(c => c[1])).toEqual([5, 15, 30]);
  });

  it('未配置 AI 插件不重试', async () => {
    const spy = jest.spyOn(aiManager, 'chat').mockRejectedValue(new Error('未配置 AI 插件'));
    await expect(judgeCandidates(makeCands(200), book, db)).rejects.toThrow('未配置 AI 插件');
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
        : id === 1 ? { id, type: 'duplicate' } : { id, type: 'chapter' }),
      notes: [],
    }));
    await expect(judgeCandidates(makeCands(4), book, db)).rejects.toThrow(/duplicate/);
  });

  it('notes 汇总各批', async () => {
    let call = 0;
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
      call++;
      return JSON.stringify({
        labels: idsIn(prompt).map(id => ({ id, type: 'chapter' })), notes: [`备注${call}`],
      });
    });
    const res = await judgeCandidates(makeCands(400), book, db);
    expect(res.notes).toEqual(['备注1', '备注2']);
  });

  describe('volumeTitle', () => {
    /** 给指定 id 的标签附加额外字段，其余为 chapter */
    const withExtra = (extra: Record<number, object>) => async (prompt: string) => JSON.stringify({
      labels: idsIn(prompt).map(id => ({ id, type: 'chapter', ...(extra[id] || {}) })),
      notes: [],
    });

    it('volumeTitle 合法保留', async () => {
      jest.spyOn(aiManager, 'chat').mockImplementation(withExtra({ 1: { volumeTitle: '云南虫谷' } }));
      const cands = makeCands(3);
      cands[1].text = '《鬼吹灯之云南虫谷》 第一百章 人皮地图';
      const res = await judgeCandidates(cands, book, db);
      expect(res.labels[1]).toEqual({ id: 1, type: 'chapter', volumeTitle: '云南虫谷' });
      expect(res.notes).toEqual([]);
    });

    it('不在原行中 → 丢弃并计入补全', async () => {
      jest.spyOn(aiManager, 'chat').mockImplementation(withExtra({ 1: { volumeTitle: '昆仑神宫' } }));
      const cands = makeCands(3);
      cands[1].text = '《鬼吹灯之云南虫谷》 第一百章 人皮地图';
      const res = await judgeCandidates(cands, book, db);
      expect(res.labels[1]).toEqual({ id: 1, type: 'chapter' });
      expect(res.notes.some(n => n.includes('标签格式不全，已按保守方式处理'))).toBe(true);
    });

    it('非 chapter 带 volumeTitle → 静默丢弃，不计入补全', async () => {
      jest.spyOn(aiManager, 'chat').mockImplementation(withExtra({ 1: { type: 'noise', noiseKind: 'text', volumeTitle: '云南虫谷' } }));
      const cands = makeCands(3);
      cands[1].text = '《鬼吹灯之云南虫谷》 结束了';
      const res = await judgeCandidates(cands, book, db);
      expect(res.labels[1]).toEqual({ id: 1, type: 'noise', noiseKind: 'text' });
      expect(res.labels[1]).not.toHaveProperty('volumeTitle');
      expect(res.notes).toEqual([]);
    });

    it('非字符串 → 丢弃并计入补全；null / 空白视为没给不计入；原行有空白时按去空白比较', async () => {
      jest.spyOn(aiManager, 'chat').mockImplementation(withExtra({
        0: { volumeTitle: 123 }, 1: { volumeTitle: '  ' }, 2: { volumeTitle: ' 云南 虫谷 ' },
        3: { volumeTitle: null }, 4: { volumeTitle: { name: '云南虫谷' } }, 5: { volumeTitle: '' },
      }));
      const cands = makeCands(6);
      cands[2].text = '《鬼吹灯之云南虫 谷》 第一百章 人皮地图';
      const res = await judgeCandidates(cands, book, db);
      for (const i of [0, 1, 3, 4, 5]) expect(res.labels[i]).toEqual({ id: i, type: 'chapter' });
      expect(res.labels[2]).toEqual({ id: 2, type: 'chapter', volumeTitle: '云南 虫谷' });
      // 只有 123 和对象计入
      expect(res.notes).toEqual(['第 1 批有 2 条标签格式不全，已按保守方式处理']);
    });

    it('全部 chapter 都带 null → 不产生补全提示', async () => {
      jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => JSON.stringify({
        labels: idsIn(prompt).map(id => ({ id, type: 'chapter', volumeTitle: null })), notes: [],
      }));
      const res = await judgeCandidates(makeCands(5), book, db);
      expect(res.notes).toEqual([]);
      expect(res.labels.every(l => !('volumeTitle' in l))).toBe(true);
    });

    it('卷切换行落在重叠区：下一批重标为 chapter 但没给 volumeTitle → 保留前一批的', async () => {
      let call = 0;
      jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
        call++;
        return withExtra(call === 1 ? { 290: { volumeTitle: '云南虫谷' } } : {})(prompt);
      });
      const cands = makeCands(400);
      cands[290].text = '《鬼吹灯之云南虫谷》 第一百章 人皮地图';
      const res = await judgeCandidates(cands, book, db);
      expect(call).toBe(2);
      expect(res.labels[290]).toEqual({ id: 290, type: 'chapter', volumeTitle: '云南虫谷' });
    });

    it('卷切换行落在重叠区：下一批改判为 noise → 不保留 volumeTitle', async () => {
      let call = 0;
      jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
        call++;
        return withExtra(call === 1 ? { 290: { volumeTitle: '云南虫谷' } } : { 290: { type: 'noise', noiseKind: 'text' } })(prompt);
      });
      const cands = makeCands(400);
      cands[290].text = '《鬼吹灯之云南虫谷》 第一百章 人皮地图';
      const res = await judgeCandidates(cands, book, db);
      expect(res.labels[290]).toEqual({ id: 290, type: 'noise', noiseKind: 'text' });
    });

    it('拆半合并：后一半重标上文为 chapter 但没给 volumeTitle → 保留前一半的', async () => {
      // 第二批（上文 280–299 + 本批 300–399）两次缺 id → 拆成两半，前一半给 290 带 volumeTitle，后一半不给
      let call = 0;
      jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
        call++;
        const ids = idsIn(prompt);
        if (call === 2 || call === 3) return chapterJson(ids.slice(1));
        const extra: Record<number, object> = call === 4 ? { 290: { volumeTitle: '云南虫谷' } } : {};
        return JSON.stringify({ labels: ids.map(id => ({ id, type: 'chapter', ...(extra[id] || {}) })), notes: [] });
      });
      const cands = makeCands(400);
      cands[290].text = '《鬼吹灯之云南虫谷》 第一百章 人皮地图';
      const res = await judgeCandidates(cands, book, db);
      expect(call).toBe(5);
      expect(res.labels[290]).toEqual({ id: 290, type: 'chapter', volumeTitle: '云南虫谷' });
    });

    it('提示词含新说明', async () => {
      const prompts: string[] = [];
      jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => { prompts.push(prompt); return chapterJson(idsIn(prompt)); });
      await judgeCandidates(makeCands(2), book, db);
      expect(prompts[0]).toContain('183 古格银眼');
      expect(prompts[0]).toContain('volumeTitle');
      expect(prompts[0]).toContain('"volumeTitle":"云南虫谷"');
    });

    it('下一批摘要的当前卷为推断卷', async () => {
      const prompts: string[] = [];
      jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => {
        prompts.push(prompt);
        return withExtra({ 0: { type: 'volume' }, 100: { volumeTitle: '云南虫谷' } })(prompt);
      });
      const cands = makeCands(400);
      cands[0].text = '第一卷 精绝古城';
      cands[100].text = '《鬼吹灯之云南虫谷》 第一百章 人皮地图';
      await judgeCandidates(cands, book, db);
      expect(prompts[1]).toMatch(/当前卷：[^\n]*云南虫谷/);
      expect(prompts[1]).not.toMatch(/当前卷：[^\n]*精绝古城/);
    });
  });

  it('onBatch 回调按批报告进度', async () => {
    jest.spyOn(aiManager, 'chat').mockImplementation(async (prompt: string) => chapterJson(idsIn(prompt)));
    const calls: Array<[number, number]> = [];
    await judgeCandidates(makeCands(700), book, db, (done, total) => calls.push([done, total]));
    expect(calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });
});
