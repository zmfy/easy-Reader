import ollamaPlugin from '../../src/ai/ollama';

type FetchArgs = { url: string; body: Record<string, unknown> };

function mockFetch(content: string, ok = true, status = 200): FetchArgs[] {
  const calls: FetchArgs[] = [];
  global.fetch = jest.fn(async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok,
      status,
      json: async () => ({ message: { content } }),
    };
  }) as unknown as typeof fetch;
  return calls;
}

afterEach(() => { jest.restoreAllMocks(); });

describe('ollama plugin', () => {
  it('chat posts to /api/chat with a non-streaming message payload', async () => {
    const calls = mockFetch('hello');
    const out = await ollamaPlugin.chat('hi', { baseUrl: 'http://h:11434', model: 'qwen2.5' });

    expect(out).toBe('hello');
    expect(calls[0].url).toBe('http://h:11434/api/chat');
    expect(calls[0].body).toMatchObject({
      model: 'qwen2.5',
      stream: false,
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('strips a trailing slash from baseUrl', async () => {
    const calls = mockFetch('x');
    await ollamaPlugin.chat('hi', { baseUrl: 'http://h:11434/' });
    expect(calls[0].url).toBe('http://h:11434/api/chat');
  });

  it('falls back to localhost and llama3 when unconfigured', async () => {
    const calls = mockFetch('x');
    await ollamaPlugin.chat('hi', {});
    expect(calls[0].url).toBe('http://localhost:11434/api/chat');
    expect(calls[0].body.model).toBe('llama3');
  });

  it('fillBookInfo extracts JSON embedded in prose', async () => {
    mockFetch('好的：\n{"title":"雪中悍刀行","author":"烽火戏诸侯"}\n以上。');
    const book = await ollamaPlugin.fillBookInfo('正文', {}, { title: '雪中' });
    expect(book).toEqual({ title: '雪中悍刀行', author: '烽火戏诸侯' });
  });

  it('fillBookInfo returns {} when the model emits no JSON', async () => {
    mockFetch('我不知道');
    expect(await ollamaPlugin.fillBookInfo('正文', {})).toEqual({});
  });

  it('fillBookInfo returns {} on malformed JSON instead of throwing', async () => {
    mockFetch('{"title": broken}');
    expect(await ollamaPlugin.fillBookInfo('正文', {})).toEqual({});
  });

  it('classifyBook trims the answer and defaults to 综合 when empty', async () => {
    mockFetch('  玄幻 \n');
    expect(await ollamaPlugin.classifyBook({ title: 'A' }, {})).toBe('玄幻');
    mockFetch('');
    expect(await ollamaPlugin.classifyBook({ title: 'A' }, {})).toBe('综合');
  });

  it('throws on a non-2xx response', async () => {
    mockFetch('', false, 500);
    await expect(ollamaPlugin.chat('hi', {})).rejects.toThrow('Ollama API error: 500');
  });
});
