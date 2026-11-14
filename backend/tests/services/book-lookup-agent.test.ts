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

describe('parseLookupAction on the last operation of a phase', () => {
  const known = new Set(['B1', 'M1']);
  it('identify: only confirm_book / no_book', () => {
    expect(parseLookupAction(j({ action: 'search_book', query: '魔戒' }), 'identify', known, true)).toBeNull();
    expect(parseLookupAction(j({ action: 'open_book', id: 'B1' }), 'identify', known, true)).toBeNull();
    expect(parseLookupAction(j({ action: 'confirm_book', id: 'B1' }), 'identify', known, true)).toEqual({ action: 'confirm_book', id: 'B1' });
    expect(parseLookupAction(j({ action: 'no_book' }), 'identify', known, true)).toEqual({ action: 'no_book' });
  });
  it('adapt: only pick_adaptations / done', () => {
    expect(parseLookupAction(j({ action: 'search_movie', query: '指环王' }), 'adapt', known, true)).toBeNull();
    expect(parseLookupAction(j({ action: 'search_drama', query: '魔戒' }), 'adapt', known, true)).toBeNull();
    expect(parseLookupAction(j({ action: 'pick_adaptations', ids: [] }), 'adapt', known, true)).toEqual({ action: 'pick_adaptations', ids: [], types: {} });
    expect(parseLookupAction(j({ action: 'done' }), 'adapt', known, true)).toEqual({ action: 'done' });
  });
});

describe('prompt rules', () => {
  it('identify rules: prefix-match search without author, file title as-is first, prefer the whole set', async () => {
    const deps = makeDeps([j({ action: 'no_book' }), j({ action: 'done' })]);
    await runBookLookup(INPUT, deps);
    const p = deps.chat.mock.calls[0][0] as string;
    expect(p).toContain('前缀');
    expect(p).toContain('不要加作者名');
    expect(p).toContain('原样');
    expect(p).toContain('整套');
    expect(p).toContain('保留文件里的整套名');
    expect(p).not.toContain('加上作者名');
  });
  it('adapt rules: one search per source, no repeated query, pick (may be empty) when done searching', async () => {
    const deps = makeDeps([j({ action: 'no_book' }), j({ action: 'done' })]);
    await runBookLookup(INPUT, deps);
    const p = deps.chat.mock.calls[1][0] as string;
    expect(p).toContain('每个来源最多搜一次');
    expect(p).toContain('不要加作者名');
    expect(p).toContain('不要重复');
    expect(p).toContain('空数组');
  });
});

describe('confirm_book title guard', () => {
  const run = async (hit: { title: string; author?: string; url: string }, title: string | undefined, input: LookupInput = INPUT) => {
    const deps = makeDeps([
      j({ action: 'search_book', query: 'x' }),
      j({ action: 'confirm_book', id: 'B1', ...(title !== undefined ? { title } : {}) }),
      j({ action: 'done' }),
    ], { searchBook: jest.fn().mockResolvedValue([hit, { title: '老人与海图解版', url: 'https://book.douban.com/subject/99/' }]) });
    return (await runBookLookup(input, deps)).confirmed;
  };
  const OLD_MAN: LookupInput = { fileName: '老人与海.海明威.txt', title: '老人与海', author: '海明威' };
  const HIT = { title: '老人与海', author: '[美] 海明威', url: 'https://book.douban.com/subject/1/' };

  it('marketing brackets are stripped when the rest equals the confirmed entry title', async () => {
    const c = await run(HIT, '老人与海（作家榜插图珍藏版•全新未删减畅销足本）(作家榜经典文库)', OLD_MAN);
    expect(c?.title).toBe('老人与海');
    expect(c?.hit.url).toBe(HIT.url);
  });

  it('a title of another entry falls back to the input title, keeping the confirmation', async () => {
    const c = await run(HIT, '老人与海图解版', OLD_MAN);
    expect(c?.title).toBe('老人与海');
    expect(c?.hit.url).toBe(HIT.url);
  });

  it('volume markers like （1-10） are dropped', async () => {
    const input: LookupInput = { fileName: '理智与情感.txt', title: '凡人修仙传', author: '忘语', mismatchReason: '正文是凡人修仙传' };
    const c = await run({ title: '凡人修仙传（1-10）', author: '忘语', url: 'https://book.douban.com/subject/3/' }, '凡人修仙传（1-10）', input);
    expect(c?.title).toBe('凡人修仙传');
  });

  it('a set title equal to the input title is kept even when a single volume was confirmed', async () => {
    const c = await run({ title: '魔戒（第一部）', author: '托尔金', url: 'https://book.douban.com/subject/4/' }, '《魔戒全集》');
    expect(c?.title).toBe('魔戒全集');
  });

  it('a title equal to the cleaned file name title is accepted', async () => {
    const input: LookupInput = { fileName: '三体全集【精校】.txt', title: '三体', author: '刘慈欣' };
    const c = await run({ title: '三体', author: '刘慈欣', url: 'https://book.douban.com/subject/5/' }, '三体全集', input);
    expect(c?.title).toBe('三体全集');
  });

  it('a title that matches nothing → input title; no title → the confirmed entry title without brackets', async () => {
    expect((await run({ title: '魔戒（第一部）', url: 'https://book.douban.com/subject/4/' }, '魔戒：护戒同盟'))?.title).toBe('魔戒全集');
    expect((await run({ title: '魔戒（第一部）', url: 'https://book.douban.com/subject/4/' }, undefined))?.title).toBe('魔戒');
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

  it('identify phase ends after 5 operations (the 5th only accepts confirm/no_book); adapt ≤3; total ≤8', async () => {
    const answers = [
      ...Array.from({ length: 5 }, (_, i) => j({ action: 'search_book', query: `词${i}` })),
      ...Array.from({ length: 10 }, (_, i) => j({ action: 'search_movie', query: `影${i}` })),
    ];
    const deps = makeDeps(answers);
    const r = await runBookLookup(INPUT, deps);
    expect(LOOKUP_LIMITS).toEqual({ total: 8, identify: 5, adapt: 3 });
    expect(r.status).toBe('ok');
    expect(r.confirmed).toBeUndefined();
    expect(r.noBook).toBe(false);
    expect(deps.chat).toHaveBeenCalledTimes(8);
    // 第 5 次认书回了搜索 → 无效；改编第 3 次回了搜索 → 无效
    expect(deps.searchBook).toHaveBeenCalledTimes(4);
    expect(deps.searchMovie).toHaveBeenCalledTimes(2);
    expect(r.steps.map(s => s.kind)).toEqual([
      'search_book', 'search_book', 'search_book', 'search_book', 'invalid', 'search_movie', 'search_movie', 'invalid',
    ]);
  });

  it('tells the AI when it is the last identify / adapt operation', async () => {
    const deps = makeDeps([
      ...Array.from({ length: 4 }, (_, i) => j({ action: 'search_book', query: `词${i}` })),
      j({ action: 'no_book' }),
      j({ action: 'search_movie', query: '影' }),
      j({ action: 'search_drama', query: '剧' }),
      j({ action: 'pick_adaptations', ids: [] }),
    ]);
    const r = await runBookLookup(INPUT, deps);
    expect(r.status).toBe('ok');
    expect(r.noBook).toBe(true);
    expect(r.steps.map(s => s.kind)).toEqual([
      'search_book', 'search_book', 'search_book', 'search_book', 'no_book', 'search_movie', 'search_drama', 'pick_adaptations',
    ]);
    const prompts = deps.chat.mock.calls.map(c => c[0] as string);
    expect(prompts[3]).not.toContain('最后一次');
    expect(prompts[4]).toContain('最后一次');
    expect(prompts[4]).toMatch(/confirm_book.*no_book/);
    expect(prompts[5]).not.toContain('最后一次');
    expect(prompts[7]).toContain('最后一次');
    expect(prompts[7]).toMatch(/pick_adaptations.*done/);
  });

  it('adapt phase after a quick no_book is still capped at 3 operations', async () => {
    const deps = makeDeps([
      j({ action: 'search_book', query: '开局签到荒古圣体' }),
      j({ action: 'no_book', why: '网文' }),
      ...Array.from({ length: 6 }, () => j({ action: 'search_drama', query: '开局签到荒古圣体' })),
    ]);
    const r = await runBookLookup(INPUT, deps);
    expect(deps.chat).toHaveBeenCalledTimes(5);
    expect(deps.searchDrama).toHaveBeenCalledTimes(2);
    expect(r.adaptations).toEqual([]);
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

  describe('failures after a conclusion / at a phase end', () => {
    const hitDeps = (answers: string[], over: Partial<LookupDeps> = {}) => makeDeps(answers, {
      searchBook: jest.fn().mockResolvedValue([LOTR_HIT]), ...over,
    });
    const confirmAnswers = [j({ action: 'search_book', query: '魔戒' }), j({ action: 'confirm_book', id: 'B1', title: '魔戒全集' })];

    it('confirm → adapt garbage → last op searches → ok with the confirmation kept', async () => {
      const deps = hitDeps([
        ...confirmAnswers,
        j({ action: 'search_movie', query: '指环王' }),
        '胡言乱语',
        j({ action: 'search_movie', query: '魔戒' }),
      ]);
      const r = await runBookLookup(INPUT, deps);
      expect(r.status).toBe('ok');
      expect(r.confirmed?.title).toBe('魔戒全集');
      expect(r.adaptations).toEqual([]);
      expect(deps.searchMovie).toHaveBeenCalledTimes(1);
      expect(r.steps.map(s => s.kind)).toEqual(['search_book', 'confirm_book', 'search_movie', 'invalid', 'invalid']);
    });

    it('a non-conclusion on the last op is explained to the AI and does not count as garbage', async () => {
      const deps = hitDeps([
        ...confirmAnswers,
        '胡言乱语',
        j({ action: 'search_movie', query: '指环王' }),
        j({ action: 'search_movie', query: '魔戒' }),
      ]);
      const r = await runBookLookup(INPUT, deps);
      expect(r.status).toBe('ok');
      expect(r.steps.map(s => s.kind)).toEqual(['search_book', 'confirm_book', 'invalid', 'search_movie', 'invalid']);
    });

    it('two consecutive garbage answers in the adapt phase after a confirmation → ok with the confirmation', async () => {
      const deps = hitDeps([...confirmAnswers, '胡言乱语', '还是胡言乱语', j({ action: 'done' })]);
      const r = await runBookLookup(INPUT, deps);
      expect(r.status).toBe('ok');
      expect(r.confirmed?.hit.url).toBe(LOTR_HIT.url);
      expect(deps.chat).toHaveBeenCalledTimes(4);
    });

    it('a chat error in the adapt phase after no_book → ok, noBook kept', async () => {
      const chat = jest.fn()
        .mockResolvedValueOnce(j({ action: 'no_book' }))
        .mockRejectedValueOnce(new Error('net'));
      const r = await runBookLookup(INPUT, makeDeps([], { chat }));
      expect(r.status).toBe('ok');
      expect(r.noBook).toBe(true);
    });

    it('identify last op searches, then one adapt garbage → not failed just from crossing phases', async () => {
      const deps = makeDeps([
        ...Array.from({ length: 5 }, (_, i) => j({ action: 'search_book', query: `词${i}` })),
        '胡言乱语',
        j({ action: 'done' }),
      ]);
      const r = await runBookLookup(INPUT, deps);
      expect(r.status).toBe('ok');
      expect(r.steps.map(s => s.kind)).toEqual([
        'search_book', 'search_book', 'search_book', 'search_book', 'invalid', 'invalid',
      ]);
      const sixth = deps.chat.mock.calls[5][0] as string;
      expect(sixth).toContain('最后一次只能给结论');
    });

    it('identify garbage at op 4 and 5 still fails (no conclusion yet)', async () => {
      const deps = makeDeps([
        ...Array.from({ length: 3 }, (_, i) => j({ action: 'search_book', query: `词${i}` })),
        '胡言乱语', '还是胡言乱语', j({ action: 'done' }),
      ]);
      expect((await runBookLookup(INPUT, deps)).status).toBe('failed');
    });
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
