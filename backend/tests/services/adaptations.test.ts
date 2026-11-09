import { parseDoubanMovieSuggest, parseMissevanSearch, isAllowedAdaptationUrl, searchDoubanMovies, searchMissevanDramas } from '../../src/utils/adaptation-sources';
import { buildAdaptationPrompt, parseAdaptationResponse, findAdaptations, looksLikeShortDrama } from '../../src/services/adaptations';
import { aiManager } from '../../src/ai/ai-manager';

jest.mock('../../src/utils/adaptation-sources', () => ({
  ...jest.requireActual('../../src/utils/adaptation-sources'),
  searchDoubanMovies: jest.fn(),
  searchMissevanDramas: jest.fn(),
}));
jest.mock('../../src/ai/ai-manager', () => ({ aiManager: { chat: jest.fn() } }));

const douban = searchDoubanMovies as jest.Mock;
const missevan = searchMissevanDramas as jest.Mock;
const chat = aiManager.chat as jest.Mock;

const CANDIDATES = [
  { source: 'douban' as const, title: '鬼吹灯之精绝古城', year: '2016', episodes: '21', url: 'https://movie.douban.com/subject/26298935/' },
  { source: 'douban' as const, title: '寻龙诀', year: '2015', url: 'https://movie.douban.com/subject/3077412/' },
  { source: 'missevan' as const, title: '鬼吹灯之精绝古城', url: 'https://www.missevan.com/mdrama/1' },
];

describe('adaptation sources', () => {
  it('parses douban movie suggest into candidates with canonical subject urls', () => {
    const json = JSON.stringify([
      { episode: '18', title: '龙岭迷窟', url: 'https://movie.douban.com/subject/30488569/?suggest=x', type: 'movie', year: '2020', id: '30488569' },
      { title: '寻龙诀', year: '2015', id: '3077412', episode: '' },
      { title: 'bad id', id: 'x' },
    ]);
    expect(parseDoubanMovieSuggest(json)).toEqual([
      { source: 'douban', title: '龙岭迷窟', year: '2020', episodes: '18', url: 'https://movie.douban.com/subject/30488569/' },
      { source: 'douban', title: '寻龙诀', year: '2015', url: 'https://movie.douban.com/subject/3077412/' },
    ]);
    expect(parseDoubanMovieSuggest('not json')).toEqual([]);
  });

  it('parses missevan search with author and short abstract', () => {
    const json = JSON.stringify({ info: { Datas: [
      { id: 22755, name: '庆余年 第一季', author: '猫腻', abstract: '阅文集团，猫腻原著。\n猫耳FM出品。' },
      { id: 'x', name: '无效' },
    ] } });
    expect(parseMissevanSearch(json)).toEqual([
      { source: 'missevan', title: '庆余年 第一季', author: '猫腻', abstract: '阅文集团，猫腻原著。 猫耳FM出品。', url: 'https://www.missevan.com/mdrama/22755' },
    ]);
    expect(parseMissevanSearch('{}')).toEqual([]);
  });

  it('only allows douban subject / missevan drama urls', () => {
    expect(isAllowedAdaptationUrl('https://movie.douban.com/subject/123/')).toBe(true);
    expect(isAllowedAdaptationUrl('https://www.missevan.com/mdrama/22755')).toBe(true);
    expect(isAllowedAdaptationUrl('http://movie.douban.com/subject/123/')).toBe(false);
    expect(isAllowedAdaptationUrl('https://evil.com/subject/123/')).toBe(false);
    expect(isAllowedAdaptationUrl('https://movie.douban.com/subject/123/../../x')).toBe(false);
    expect(isAllowedAdaptationUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('adaptation judgement', () => {
  it('flags long, recent douban series as possible short dramas', () => {
    const short = { source: 'douban' as const, title: '我在八零年代当后妈', year: '2024', episodes: '82', url: 'https://movie.douban.com/subject/9/' };
    const oldSeries = { source: 'douban' as const, title: '三国演义', year: '1994', episodes: '84', url: 'https://movie.douban.com/subject/1/' };
    expect(looksLikeShortDrama(short)).toBe(true);
    expect(looksLikeShortDrama(oldSeries)).toBe(false);
    expect(looksLikeShortDrama({ ...short, episodes: '36' })).toBe(false);
    expect(looksLikeShortDrama({ ...short, source: 'missevan' as const })).toBe(false);
    const p = buildAdaptationPrompt({ title: '我在八零年代当后妈' }, [short, oldSeries]);
    expect(p).toContain('[#0] 我在八零年代当后妈 | 豆瓣影视 | 2024年 | 82集 | 集数多且年份新，可能是短剧');
    expect(p).not.toContain('84集 | 集数多');
    expect(parseAdaptationResponse('{"adaptations":[{"index":0,"type":"短剧"}]}', [short])[0].type).toBe('短剧');
  });

  it('prompt lists candidates with source, year and episodes', () => {
    const p = buildAdaptationPrompt({ title: '鬼吹灯', author: '天下霸唱' }, CANDIDATES);
    expect(p).toContain('《鬼吹灯》 作者：天下霸唱');
    expect(p).toContain('[#0] 鬼吹灯之精绝古城 | 豆瓣影视 | 2016年 | 21集');
    expect(p).toContain('[#2] 鬼吹灯之精绝古城 | 猫耳FM广播剧');
  });

  it('keeps only valid candidate indexes; missevan is always 广播剧', () => {
    const raw = '思考…{"adaptations":[{"index":0,"type":"电视剧"},{"index":1,"type":"奇怪"},{"index":2,"type":"电影"},{"index":0},{"index":9},{"index":"1"}]}';
    expect(parseAdaptationResponse(raw, CANDIDATES)).toEqual([
      { type: '电视剧', title: '鬼吹灯之精绝古城', year: '2016', source: 'douban', url: CANDIDATES[0].url },
      { type: '其他', title: '寻龙诀', year: '2015', source: 'douban', url: CANDIDATES[1].url },
      { type: '广播剧', title: '鬼吹灯之精绝古城', source: 'missevan', url: CANDIDATES[2].url },
    ]);
    expect(parseAdaptationResponse('no json', CANDIDATES)).toEqual([]);
  });

  it('findAdaptations: skips AI when there are no candidates, swallows AI errors', async () => {
    const db = {} as never;
    douban.mockResolvedValue([]); missevan.mockResolvedValue([]);
    expect(await findAdaptations({ title: '温暖的人皮' }, db)).toEqual([]);
    expect(chat).not.toHaveBeenCalled();

    douban.mockResolvedValue([CANDIDATES[1]]);
    chat.mockResolvedValueOnce('{"adaptations":[{"index":0,"type":"电影"}]}');
    expect(await findAdaptations({ title: '鬼吹灯' }, db)).toEqual([
      { type: '电影', title: '寻龙诀', year: '2015', source: 'douban', url: CANDIDATES[1].url },
    ]);
    expect(chat.mock.calls[0][2]).toEqual({ reasoningEffort: 'low' });

    chat.mockRejectedValueOnce(new Error('boom'));
    expect(await findAdaptations({ title: '鬼吹灯' }, db)).toEqual([]);
  });
});
