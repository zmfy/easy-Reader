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
});
