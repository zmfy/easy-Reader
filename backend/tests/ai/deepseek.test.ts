import deepseekPlugin from '../../src/ai/deepseek';

type FetchArgs = { url: string; body: Record<string, unknown> };

function mockFetch(content: string): FetchArgs[] {
  const calls: FetchArgs[] = [];
  global.fetch = jest.fn(async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    };
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => { jest.restoreAllMocks(); });

describe('deepseek plugin', () => {
  it('defaults to deepseek-flash with thinking explicitly disabled (flash thinks by default)', async () => {
    const calls = mockFetch('好');
    const out = await deepseekPlugin.chat('hi', { apiKey: 'k' });

    expect(out).toBe('好');
    expect(calls[0].url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(calls[0].body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, temperature: 0.1 });
    expect(calls[0].body).not.toHaveProperty('reasoning_effort');
  });

  it('enables thinking with the chosen effort and drops temperature (ignored in thinking mode)', async () => {
    const calls = mockFetch('{"author":"x"}');
    await deepseekPlugin.fillBookInfo('text', { apiKey: 'k', thinking: 'low' });
    await deepseekPlugin.classifyBook({ title: 't' }, { apiKey: 'k', thinking: 'max' });

    expect(calls[0].body).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low' });
    expect(calls[1].body).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'max' });
    expect(calls.some(c => 'temperature' in c.body)).toBe(false);
  });

  it('keeps per-call temperature when thinking is off', async () => {
    const calls = mockFetch('{}');
    await deepseekPlugin.fillBookInfo('text', { apiKey: 'k' });
    expect(calls[0].body.temperature).toBe(0.3);
  });

  it('respects configured model and baseUrl', async () => {
    const calls = mockFetch('好');
    await deepseekPlugin.chat('hi', { apiKey: 'k', model: 'deepseek-v4-pro', baseUrl: 'https://example.com/v1' });
    expect(calls[0].url).toBe('https://example.com/v1/chat/completions');
    expect(calls[0].body.model).toBe('deepseek-v4-pro');
  });

  it('declares thinking as a select field: off by default, then low / high / max', () => {
    expect(deepseekPlugin.fields).toContain('thinking');
    expect(deepseekPlugin.options?.thinking.map(o => o.value)).toEqual(['', 'low', 'high', 'max']);
  });
});
