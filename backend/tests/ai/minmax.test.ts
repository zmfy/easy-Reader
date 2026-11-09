import minmaxPlugin from '../../src/ai/minmax';

type FetchArgs = { url: string; body: Record<string, unknown>; auth: string };

function mockFetch(content: string): FetchArgs[] {
  const calls: FetchArgs[] = [];
  global.fetch = jest.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => { jest.restoreAllMocks(); });

describe('minmax plugin', () => {
  it('still parses fill info when the model repeats the JSON object twice', async () => {
    mockFetch('{"author":"忘语","category":"小说/网络小说/仙侠修真"}{"author":"忘语","category":"小说/网络小说/仙侠修真"}');
    expect(await minmaxPlugin.fillBookInfo('text', { apiKey: 'k' })).toEqual({ author: '忘语', category: '小说/网络小说/仙侠修真' });
  });

  it('uses the current OpenAI-compatible endpoint and a still-available default model', async () => {
    const calls = mockFetch('好');
    const out = await minmaxPlugin.chat('hi', { apiKey: 'k' });

    expect(out).toBe('好');
    expect(calls[0].url).toBe('https://api.minimax.cn/v1/chat/completions');
    expect(calls[0].auth).toBe('Bearer k');
    // MiniMax-M2 已下线（2069 model is no longer available）
    expect(calls[0].body.model).toBe('MiniMax-M3.1-Flash');
  });

  it('sends reasoning_effort only when configured', async () => {
    const calls = mockFetch('好');
    await minmaxPlugin.chat('hi', { apiKey: 'k' });
    await minmaxPlugin.chat('hi', { apiKey: 'k', reasoningEffort: 'low' });
    await minmaxPlugin.fillBookInfo('text', { apiKey: 'k', reasoningEffort: 'medium' });
    await minmaxPlugin.classifyBook({ title: 't' }, { apiKey: 'k', reasoningEffort: 'high' });

    expect(calls[0].body).not.toHaveProperty('reasoning_effort');
    expect(calls.slice(1).map(c => c.body.reasoning_effort)).toEqual(['low', 'medium', 'high']);
  });

  it('declares reasoningEffort as a select field with the API-accepted values', () => {
    expect(minmaxPlugin.fields).toContain('reasoningEffort');
    const values = minmaxPlugin.options?.reasoningEffort.map(o => o.value);
    // 空值 = 不传，使用官方默认（max）；其余为接口允许的取值
    expect(values).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('uses the configured model for fill and classify', async () => {
    const calls = mockFetch('{"author":"x"}');
    await minmaxPlugin.fillBookInfo('text', { apiKey: 'k', model: 'MiniMax-M3' });
    await minmaxPlugin.classifyBook({ title: 't' }, { apiKey: 'k', model: 'MiniMax-M3' });

    expect(calls.map(c => c.body.model)).toEqual(['MiniMax-M3', 'MiniMax-M3']);
    expect(calls.every(c => c.url === 'https://api.minimax.cn/v1/chat/completions')).toBe(true);
  });

  describe('configWarning', () => {
    it.each([
      ['MiniMax-M2'],
      [' minimax-m2.5 '],
    ])('warns for the retired M2 series model %p', (model) => {
      const w = minmaxPlugin.configWarning!({ apiKey: 'k', model });
      expect(w).toContain('MiniMax-M2 系列模型已下线');
      expect(w).toContain('MiniMax-M3.1-Flash');
    });

    it.each([['MiniMax-M3'], ['MiniMax-M3.1-Flash'], ['']])('no warning for %p', (model) => {
      expect(minmaxPlugin.configWarning!({ apiKey: 'k', model })).toBeNull();
    });

    it('no warning when model is not configured at all', () => {
      expect(minmaxPlugin.configWarning!({ apiKey: 'k' })).toBeNull();
    });
  });

  describe('API errors', () => {
    function mockError(status: number, body: string) {
      global.fetch = jest.fn(async () => ({ ok: false, status, text: async () => body })) as unknown as typeof fetch;
    }
    const body2069 = '{"base_resp":{"status_code":2069,"status_msg":"model is no longer available"}}';

    it('turns 2069 into a readable message naming the model, on all three calls', async () => {
      mockError(400, body2069);
      const cfg = { apiKey: 'k', model: 'MiniMax-M2' };
      for (const run of [
        () => minmaxPlugin.chat('hi', cfg),
        () => minmaxPlugin.fillBookInfo('t', cfg),
        () => minmaxPlugin.classifyBook({ title: 't' }, cfg),
      ]) {
        await expect(run()).rejects.toThrow('MiniMax 模型「MiniMax-M2」已下线或不可用，请到「设置 → AI 插件」重新选择模型');
      }
    });

    it('names the default model when none configured', async () => {
      mockError(400, body2069);
      await expect(minmaxPlugin.chat('hi', { apiKey: 'k' })).rejects.toThrow('「MiniMax-M3.1-Flash」');
    });

    it('does not mistake an unrelated 2069 in the body for the offline-model error', async () => {
      const body = '{"base_resp":{"status_code":1004},"trace_id":"abc-2069-def"}';
      mockError(401, body);
      await expect(minmaxPlugin.chat('hi', { apiKey: 'k' })).rejects.toThrow(`MiniMax API error: 401 - ${body}`);
    });

    it('keeps the original format for other errors', async () => {
      mockError(401, '{"base_resp":{"status_code":1004}}');
      await expect(minmaxPlugin.chat('hi', { apiKey: 'k' }))
        .rejects.toThrow('MiniMax API error: 401 - {"base_resp":{"status_code":1004}}');
    });
  });
});
