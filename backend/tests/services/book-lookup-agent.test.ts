import {
  parseLookupAction, normalizeDoubanAuthor, runBookLookup, LOOKUP_LIMITS, LookupDeps, LookupInput,
} from '../../src/services/book-lookup-agent';

const LOTR_HIT = { title: '魔戒', author: '[英] J.R.R.托尔金 / 丁棣 译', year: '2013', pic: 'https://img1.doubanio.com/view/subject/s/public/s1.jpg', url: 'https://book.douban.com/subject/20427187/' };
const LOTR_DETAIL = {
  author: '[英] J.R.R.托尔金', translator: '丁棣', publisher: '译林出版社', year: '2013',
  intro: '长'.repeat(300), tags: ['奇幻'], rating: 9.1,
};
const MOVIE = { source: 'douban' as const, title: '指环王1：护戒使者', year: '2001', url: 'https://movie.douban.com/subject/1291571/' };

const INPUT: LookupInput = { fileName: '魔戒全集.txt', title: '魔戒全集', author: '托尔金', bookType: '奇幻小说', summary: '中土世界的故事。' };

function makeDeps(answers: string[], over: Partial<LookupDeps> = {}): LookupDeps & { chat: jest.Mock } {
  const chat = jest.fn();
  for (const a of answers) chat.mockResolvedValueOnce(a);
  return {
    chat,
    searchBook: jest.fn().mockResolvedValue([]),
    openBook: jest.fn().mockResolvedValue({ tags: [] }),
    searchMovie: jest.fn().mockResolvedValue([]),
    searchDrama: jest.fn().mockResolvedValue([]),
    ...over,
  } as LookupDeps & { chat: jest.Mock };
}

const j = (o: unknown) => JSON.stringify(o);

describe('parseLookupAction', () => {
  const known = new Set(['B1', 'B2', 'M1', 'D1']);

  it('recognises identify-phase actions', () => {
    expect(parseLookupAction(j({ action: 'search_book', query: ' 魔戒 ', why: '换词' }), 'identify', known))
      .toEqual({ action: 'search_book', query: '魔戒', why: '换词' });
    expect(parseLookupAction(j({ action: 'open_book', id: 'B1' }), 'identify', known)).toEqual({ action: 'open_book', id: 'B1' });
    expect(parseLookupAction(j({ action: 'confirm_book', id: 'B2', title: '魔戒', author: '托尔金', why: '一致' }), 'identify', known))
      .toEqual({ action: 'confirm_book', id: 'B2', title: '魔戒', author: '托尔金', why: '一致' });
    expect(parseLookupAction(j({ action: 'no_book', why: '网文' }), 'identify', known)).toEqual({ action: 'no_book', why: '网文' });
  });

  it('recognises adapt-phase actions', () => {
    expect(parseLookupAction(j({ action: 'search_movie', query: '指环王' }), 'adapt', known)).toEqual({ action: 'search_movie', query: '指环王' });
    expect(parseLookupAction(j({ action: 'search_drama', query: '魔戒' }), 'adapt', known)).toEqual({ action: 'search_drama', query: '魔戒' });
    expect(parseLookupAction(j({ action: 'pick_adaptations', ids: ['M1', 'D1'], types: { M1: '电影' } }), 'adapt', known))
      .toEqual({ action: 'pick_adaptations', ids: ['M1', 'D1'], types: { M1: '电影' } });
    expect(parseLookupAction(j({ action: 'done' }), 'adapt', known)).toEqual({ action: 'done' });
  });

  it('rejects actions not allowed in the current phase', () => {
    expect(parseLookupAction(j({ action: 'search_movie', query: 'x' }), 'identify', known)).toBeNull();
    expect(parseLookupAction(j({ action: 'done' }), 'identify', known)).toBeNull();
    expect(parseLookupAction(j({ action: 'search_book', query: 'x' }), 'adapt', known)).toBeNull();
    expect(parseLookupAction(j({ action: 'confirm_book', id: 'B1' }), 'adapt', known)).toBeNull();
    expect(parseLookupAction(j({ action: 'fly' }), 'identify', known)).toBeNull();
  });

  it('rejects unknown ids for open/confirm, drops unknown ids in pick', () => {
    expect(parseLookupAction(j({ action: 'open_book', id: 'B9' }), 'identify', known)).toBeNull();
    expect(parseLookupAction(j({ action: 'confirm_book', id: 'B9' }), 'identify', known)).toBeNull();
    expect(parseLookupAction(j({ action: 'open_book', id: 'M1' }), 'identify', known)).toBeNull();
    expect(parseLookupAction(j({ action: 'pick_adaptations', ids: ['M1', 'M7', 'B1'] }), 'adapt', known))
      .toEqual({ action: 'pick_adaptations', ids: ['M1'], types: {} });
  });

  it('parses JSON wrapped in a code block; empty query or garbage → null', () => {
    expect(parseLookupAction('好的：\n```json\n{"action":"search_book","query":"指环王"}\n```', 'identify', known))
      .toEqual({ action: 'search_book', query: '指环王' });
    expect(parseLookupAction(j({ action: 'search_book', query: '   ' }), 'identify', known)).toBeNull();
    expect(parseLookupAction(j({ action: 'search_drama' }), 'adapt', known)).toBeNull();
    expect(parseLookupAction('不知道', 'identify', known)).toBeNull();
  });
});

describe('normalizeDoubanAuthor', () => {
  it('keeps nationality, drops translators and 著', () => {
    expect(normalizeDoubanAuthor('[英] J.R.R.托尔金 / 丁棣 译')).toBe('[英] J.R.R.托尔金');
    expect(normalizeDoubanAuthor('刘慈欣')).toBe('刘慈欣');
    expect(normalizeDoubanAuthor('[美] 乔治·R.R.马丁 著')).toBe('[美] 乔治·R.R.马丁');
  });
});

describe('runBookLookup', () => {
  it('魔戒全集: re-searches, opens, confirms, then picks adaptations', async () => {
    const deps = makeDeps([
      j({ action: 'search_book', query: '魔戒全集' }),
      j({ action: 'search_book', query: '魔戒', why: '全集搜不到' }),
      j({ action: 'open_book', id: 'B1' }),
      j({ action: 'confirm_book', id: 'B1', title: '魔戒全集', author: '[英] J.R.R.托尔金 / 丁棣 译', why: '作者一致' }),
      j({ action: 'search_movie', query: '指环王' }),
      j({ action: 'pick_adaptations', ids: ['M1'], types: { M1: '电影' } }),
      j({ action: 'done' }),
    ], {
      searchBook: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([LOTR_HIT]),
      openBook: jest.fn().mockResolvedValue(LOTR_DETAIL),
      searchMovie: jest.fn().mockResolvedValue([MOVIE]),
    });
    const r = await runBookLookup(INPUT, deps);
    expect(r.status).toBe('ok');
    expect(r.noBook).toBe(false);
    expect(r.confirmed?.hit.url).toBe(LOTR_HIT.url);
    expect(r.confirmed?.title).toBe('魔戒全集');
    expect(r.confirmed?.author).toBe('[英] J.R.R.托尔金');
    expect(r.confirmed?.doubanAuthor).toBe('[英] J.R.R.托尔金 / 丁棣 译');
    expect(r.confirmed?.why).toBe('作者一致');
    expect(r.confirmed?.detail).toEqual(LOTR_DETAIL);
    expect(r.seenBooks).toEqual([LOTR_HIT]);
    expect(r.adaptations).toEqual([{ type: '电影', title: MOVIE.title, year: '2001', source: 'douban', url: MOVIE.url }]);
    expect(r.adaptations[0].type).toBe('电影');
    expect(r.steps.map(s => s.kind)).toEqual(['search_book', 'search_book', 'open_book', 'confirm_book', 'search_movie', 'pick_adaptations']);
    expect(r.steps[0]).toEqual({ kind: 'search_book', query: '魔戒全集', count: 0 });
    expect(r.steps[1]).toEqual({ kind: 'search_book', query: '魔戒', count: 1 });
    expect(r.steps[5]).toEqual({ kind: 'pick_adaptations', count: 1 });
    expect(deps.searchMovie).toHaveBeenCalledWith('指环王');
    expect(deps.openBook).toHaveBeenCalledWith(LOTR_HIT.url);
  });

  it('prompts: one numbered line per candidate, intro ≤150 chars, contains book info', async () => {
    const deps = makeDeps([
      j({ action: 'search_book', query: '魔戒' }),
      j({ action: 'open_book', id: 'B2' }),
      j({ action: 'confirm_book', id: 'B1' }),
      j({ action: 'done' }),
    ], {
      searchBook: jest.fn().mockResolvedValue([LOTR_HIT, { title: '魔戒（插图本）', author: '托尔金', url: 'https://book.douban.com/subject/2/' }]),
      openBook: jest.fn().mockResolvedValue(LOTR_DETAIL),
    });
    await runBookLookup(INPUT, deps);
    const first = deps.chat.mock.calls[0][0] as string;
    expect(first).toContain('魔戒全集.txt');
    expect(first).toContain('魔戒全集');
    expect(first).toContain('托尔金');
    const third = deps.chat.mock.calls[2][0] as string;
    const b1Lines = third.split('\n').filter(l => l.includes('[B1]'));
    expect(b1Lines).toHaveLength(1);
    expect(b1Lines[0]).toContain('魔戒');
    expect(b1Lines[0]).toContain('2013');
    expect(third.split('\n').filter(l => l.includes('[B2]'))).toHaveLength(1);
    expect(third).toContain('译林出版社');
    expect(third).toContain('长'.repeat(150));
    expect(third).not.toContain('长'.repeat(151));
  });

  it('identify phase ends after 5 operations; total never exceeds 8', async () => {
    const answers = [
      ...Array.from({ length: 5 }, (_, i) => j({ action: 'search_book', query: `词${i}` })),
      ...Array.from({ length: 10 }, (_, i) => j({ action: 'search_movie', query: `影${i}` })),
    ];
    const deps = makeDeps(answers);
    const r = await runBookLookup(INPUT, deps);
    expect(LOOKUP_LIMITS).toEqual({ total: 8, identify: 5 });
    expect(r.status).toBe('ok');
    expect(r.confirmed).toBeUndefined();
    expect(r.noBook).toBe(false);
    expect(deps.chat).toHaveBeenCalledTimes(8);
    expect(deps.searchBook).toHaveBeenCalledTimes(5);
    expect(deps.searchMovie).toHaveBeenCalledTimes(3);
  });

  it('no_book → noBook true, then adapt phase runs as usual', async () => {
    const deps = makeDeps([
      j({ action: 'search_book', query: '某网文' }),
      j({ action: 'no_book', why: '网络小说' }),
      j({ action: 'search_drama', query: '某网文' }),
      j({ action: 'pick_adaptations', ids: ['D1'] }),
    ], {
      searchDrama: jest.fn().mockResolvedValue([{ source: 'missevan', title: '某网文 第一季', url: 'https://www.missevan.com/mdrama/1' }]),
    });
    const r = await runBookLookup(INPUT, deps);
    expect(r.status).toBe('ok');
    expect(r.noBook).toBe(true);
    expect(r.confirmed).toBeUndefined();
    expect(r.adaptations).toEqual([{ type: '广播剧', title: '某网文 第一季', source: 'missevan', url: 'https://www.missevan.com/mdrama/1' }]);
    expect(r.steps.map(s => s.kind)).toEqual(['search_book', 'no_book', 'search_drama', 'pick_adaptations']);
    expect(r.steps[1]).toEqual({ kind: 'no_book', why: '网络小说' });
  });

  it('two consecutive invalid answers → failed', async () => {
    const deps = makeDeps(['胡言乱语', j({ action: 'open_book', id: 'B5' }), j({ action: 'no_book' })]);
    const r = await runBookLookup(INPUT, deps);
    expect(r.status).toBe('failed');
    expect(deps.chat).toHaveBeenCalledTimes(2);
    expect(r.steps).toEqual([{ kind: 'invalid' }, { kind: 'invalid' }]);
  });

  it('an invalid answer followed by a valid one resets the counter', async () => {
    const deps = makeDeps([
      '胡言乱语',
      j({ action: 'search_book', query: '魔戒' }),
      '还是胡言乱语',
      j({ action: 'no_book' }),
      j({ action: 'done' }),
    ]);
    const r = await runBookLookup(INPUT, deps);
    expect(r.status).toBe('ok');
    expect(r.noBook).toBe(true);
    expect(r.steps.map(s => s.kind)).toEqual(['invalid', 'search_book', 'invalid', 'no_book']);
  });

  it('a failing book search is recorded and the loop continues', async () => {
    const deps = makeDeps([
      j({ action: 'search_book', query: '魔戒' }),
      j({ action: 'no_book' }),
      j({ action: 'done' }),
    ], { searchBook: jest.fn().mockRejectedValue(new Error('timeout')) });
    const r = await runBookLookup(INPUT, deps);
    expect(r.status).toBe('ok');
    expect(r.steps[0]).toEqual({ kind: 'search_book', query: '魔戒', count: 0, error: true });
    expect(r.steps[1].kind).toBe('no_book');
  });

  it('calls onStep once per completed step with all steps so far', async () => {
    const onStep = jest.fn();
    const deps = makeDeps([
      j({ action: 'search_book', query: '魔戒' }),
      'xx',
      j({ action: 'no_book' }),
      j({ action: 'done' }),
    ], { onStep });
    const r = await runBookLookup(INPUT, deps);
    expect(onStep).toHaveBeenCalledTimes(3);
    expect(onStep.mock.calls[0][0]).toHaveLength(1);
    expect(onStep.mock.calls[1][0]).toHaveLength(2);
    expect(onStep.mock.calls[2][0]).toEqual(r.steps);
  });

  it('chat error → failed, unless isFatal says to rethrow', async () => {
    const quota = new Error('quota');
    const deps = makeDeps([], { chat: jest.fn().mockRejectedValue(quota) });
    await expect(runBookLookup(INPUT, deps)).resolves.toMatchObject({ status: 'failed' });

    const fatal = makeDeps([], { chat: jest.fn().mockRejectedValue(quota), isFatal: (e: unknown) => e === quota });
    await expect(runBookLookup(INPUT, fatal)).rejects.toBe(quota);

    const notFatal = makeDeps([], { chat: jest.fn().mockRejectedValue(new Error('net')), isFatal: (e: unknown) => e === quota });
    await expect(runBookLookup(INPUT, notFatal)).resolves.toMatchObject({ status: 'failed' });
  });
});
