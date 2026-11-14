import fs from 'fs';
import path from 'path';
import http from 'http';
import { AddressInfo } from 'net';
import {
  parseDoubanRating, parseDoubanSuggestList, pickDoubanBook, doubanFallbackQuery, isAllowedDoubanImageUrl, isAllowedDoubanSubjectUrl, isAllowedCoverImageUrl, request,
  parseDoubanBookHits, parseDoubanSubjectDetail, fetchDoubanSubjectDetail,
} from '../../src/utils/cover';

describe('parseDoubanRating', () => {
  it('extracts the rating number from a douban subject page', () => {
    const html = '<div><strong class="ll rating_num" property="v:average"> 8.5 </strong></div>';
    expect(parseDoubanRating(html)).toBe(8.5);
  });
  it('extracts rating from real douban markup (space in class attr)', () => {
    // Live douban renders: <strong class="ll rating_num " property="v:average"> 8.9 </strong>
    const html = '<span typeof="v:Rating">\n  <strong class="ll rating_num " property="v:average"> 8.9 </strong>';
    expect(parseDoubanRating(html)).toBe(8.9);
  });
  it('returns undefined when no rating present', () => {
    expect(parseDoubanRating('<div class="rating_num"></div>')).toBeUndefined();
    expect(parseDoubanRating('no rating here')).toBeUndefined();
  });
  it('returns undefined for a zero rating (douban shows 0 when unrated)', () => {
    const html = '<strong class="ll rating_num" property="v:average"> 0.0 </strong>';
    expect(parseDoubanRating(html)).toBeUndefined();
  });
});

describe('parseDoubanSuggestList', () => {
  const json = JSON.stringify([
    { title: '三国演义', author_name: '罗贯中', year: '1998', pic: 'https://img1.doubanio.com/view/subject/s/public/s1.jpg', url: 'https://book.douban.com/subject/1019568/' },
    { title: '三国演义(无图)', pic: 'https://img9.doubanio.com/f/book-default-lpic.gif', url: 'https://book.douban.com/subject/2/' },
    { title: '三国志', url: 'https://book.douban.com/subject/3/' },
  ]);

  it('keeps only items with a real cover and maps fields', () => {
    expect(parseDoubanSuggestList(json)).toEqual([
      { title: '三国演义', author: '罗贯中', year: '1998', pic: 'https://img1.doubanio.com/view/subject/s/public/s1.jpg', subjectUrl: 'https://book.douban.com/subject/1019568/' },
    ]);
  });

  it('respects the limit', () => {
    const many = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ title: `t${i}`, pic: `https://img1.doubanio.com/view/subject/s/public/s${i}.jpg` })));
    expect(parseDoubanSuggestList(many, 6)).toHaveLength(6);
    expect(parseDoubanSuggestList(many, 2)).toHaveLength(2);
  });

  it('returns [] for invalid or non-array JSON', () => {
    expect(parseDoubanSuggestList('not json')).toEqual([]);
    expect(parseDoubanSuggestList('{"a":1}')).toEqual([]);
  });
});

describe('豆瓣联想结果只取书，不取作者', () => {
  const mixed = [
    { title: '南怀瑾', type: 'a', pic: 'https://img1.doubanio.com/view/personage/m/public/x.jpg', url: 'https://book.douban.com/author/4503235/' },
    { title: '金刚经说什么', type: 'b', pic: 'https://img9.doubanio.com/view/subject/s/public/s1.jpg', url: 'https://book.douban.com/subject/26785340/' },
  ];
  it('pickDoubanBook 跳过作者条目', () => {
    expect(pickDoubanBook(mixed)?.title).toBe('金刚经说什么');
    expect(pickDoubanBook([mixed[0]])).toBeUndefined();
    expect(pickDoubanBook('x')).toBeUndefined();
  });
  it('封面候选里没有作者照片', () => {
    expect(parseDoubanSuggestList(JSON.stringify(mixed)).map(c => c.title)).toEqual(['金刚经说什么']);
  });
  it('没有 type 字段的条目照旧当作书', () => {
    expect(pickDoubanBook([{ title: '西游记', pic: 'https://img9.doubanio.com/view/subject/s/public/s2.jpg' }])?.title).toBe('西游记');
  });
});

describe('doubanFallbackQuery：搜不到时去掉合集后缀再搜', () => {
  it('去掉全集 / 合集 / 套装 / 系列 / 三部曲 / 全 N 册', () => {
    expect(doubanFallbackQuery('魔戒全集')).toBe('魔戒');
    expect(doubanFallbackQuery('指环王 全集')).toBe('指环王');
    expect(doubanFallbackQuery('冰与火之歌合集')).toBe('冰与火之歌');
    expect(doubanFallbackQuery('哈利波特套装')).toBe('哈利波特');
    expect(doubanFallbackQuery('三体系列')).toBe('三体');
    expect(doubanFallbackQuery('魔戒三部曲')).toBe('魔戒');
    expect(doubanFallbackQuery('明朝那些事儿（全7册）')).toBe('明朝那些事儿');
    expect(doubanFallbackQuery('明朝那些事儿全九册')).toBe('明朝那些事儿');
  });
  it('没有合集后缀、或去掉后为空时不重搜', () => {
    expect(doubanFallbackQuery('魔戒')).toBeUndefined();
    expect(doubanFallbackQuery('全集')).toBeUndefined();
    expect(doubanFallbackQuery('全集与选集之争')).toBeUndefined();
  });
});

describe('isAllowedCoverImageUrl', () => {
  it.each([
    ['https://img3.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg', true],
    ['https://static.maoercdn.com/dramacovers/201906/13/a.png', true],
    ['http://static.maoercdn.com/a.png', false],
    ['https://static.maoercdn.com.evil.com/a.png', false],
    ['https://maoercdn.com/a.png', false],
  ])('%s → %s', (url, ok) => {
    expect(isAllowedCoverImageUrl(url)).toBe(ok);
  });
});

describe('douban url allowlists', () => {
  it.each([
    ['https://img1.doubanio.com/view/subject/s/public/s1.jpg', true],
    ['https://img9.doubanio.com/view/subject/l/public/s1.jpg', true],
    ['http://img1.doubanio.com/view/subject/s/public/s1.jpg', false],
    ['https://img1.doubanio.com.evil.com/a.jpg', false],
    ['https://evil.com/?img1.doubanio.com', false],
    ['https://doubanio.com/a.jpg', false],
    ['https://user@img1.doubanio.com/a.jpg', false],
    ['not a url', false],
  ])('image %s → %s', (url, ok) => {
    expect(isAllowedDoubanImageUrl(url)).toBe(ok);
  });

  it.each([
    ['https://book.douban.com/subject/1234567/', true],
    ['https://book.douban.com/subject/1234567', true],
    ['http://book.douban.com/subject/1234567/', false],
    ['https://book.douban.com/people/x/', false],
    ['https://movie.douban.com/subject/1/', false],
    ['https://book.douban.com.evil.com/subject/1/', false],
  ])('subject %s → %s', (url, ok) => {
    expect(isAllowedDoubanSubjectUrl(url)).toBe(ok);
  });
});

describe('request host guard', () => {
  let server: http.Server;
  let port: number;
  beforeAll(done => {
    server = http.createServer((req, res) => {
      if (req.url === '/a') { res.writeHead(302, { Location: `http://127.0.0.1:${port}/b` }); res.end(); return; }
      res.end('ok');
    }).listen(0, () => { port = (server.address() as AddressInfo).port; done(); });
  });
  afterAll(done => { server.close(() => done()); });

  it('rejects a redirect to a host that is not allowed', async () => {
    await expect(request(`http://localhost:${port}/a`, {}, 4, h => h === 'localhost')).rejects.toThrow(/host/i);
  });

  it('rejects the initial url when its host is not allowed', async () => {
    await expect(request(`http://127.0.0.1:${port}/b`, {}, 4, h => h === 'localhost')).rejects.toThrow(/host/i);
  });

  it('follows redirects when no guard is given (existing behaviour)', async () => {
    expect((await request(`http://localhost:${port}/a`)).toString()).toBe('ok');
  });
});

describe('parseDoubanBookHits', () => {
  const json = JSON.stringify([
    { title: '托尔金', url: 'https://book.douban.com/author/1/', pic: 'https://img/a.jpg', type: 'a' },
    { title: '魔戒', url: 'https://book.douban.com/subject/1/', pic: 'https://img/s1.jpg', author_name: '托尔金', year: '2013', type: 'b' },
    { title: '无封面', url: 'https://book.douban.com/subject/2/', pic: 'https://img/book-default-s.gif', type: 'b' },
    { title: '第三本', url: 'https://book.douban.com/subject/3/', pic: 'https://img/s3.jpg', type: 'b' },
  ]);

  it('过滤作者条目，保留书条目', () => {
    const hits = parseDoubanBookHits(json);
    expect(hits.map(h => h.title)).toEqual(['魔戒', '无封面', '第三本']);
    expect(hits[0]).toEqual({ title: '魔戒', author: '托尔金', year: '2013', pic: 'https://img/s1.jpg', url: 'https://book.douban.com/subject/1/' });
  });
  it('book-default 封面的条目保留但没有 pic', () => {
    expect(parseDoubanBookHits(json)[1]).not.toHaveProperty('pic');
  });
  it('limit 生效', () => {
    expect(parseDoubanBookHits(json, 2)).toHaveLength(2);
  });
  it('非 JSON 返回 []', () => {
    expect(parseDoubanBookHits('<html>')).toEqual([]);
  });
});

describe('parseDoubanSubjectDetail', () => {
  const html = fs.readFileSync(path.join(__dirname, '../fixtures/douban-subject-lotr.html'), 'utf-8');

  it('解析真实条目页', () => {
    const d = parseDoubanSubjectDetail(html);
    expect(d.author).toContain('托尔金');
    expect(d.translator).toContain('邓嘉宛');
    expect(d.publisher).toBeTruthy();
    expect(d.year).toBe('2013');
    expect(d.intro).toBeTruthy();
    expect(d.intro!.length).toBeLessThanOrEqual(150);
    expect(d.intro).not.toMatch(/[<>]|text-indent/);
    expect(d.tags.length).toBeGreaterThan(0);
    expect(typeof d.rating).toBe('number');
  });
  it('优先读 #db-tags-section 的标签', () => {
    const d = parseDoubanSubjectDetail('<div id="db-tags-section"><div class="indent"><span><a class="  tag" href="/tag/奇幻">奇幻</a><a class="  tag" href="/tag/小说">小说</a></span></div></div>');
    expect(d.tags).toEqual(['奇幻', '小说']);
  });
  it('短简介未折叠时只取简介本身，不越界读后面的页面文字', () => {
    const d = parseDoubanSubjectDetail('<div class="indent" id="link-report"><div class="intro"><p>一段短简介。</p></div></div>'
      + '<h2>作者简介</h2><div>作者介绍文字</div><script>var x = "脚本文字";</script>');
    expect(d.intro).toBe('一段短简介。');
  });
  it('空页面不抛错', () => {
    expect(parseDoubanSubjectDetail('<html></html>')).toEqual({ tags: [] });
  });
});

describe('fetchDoubanSubjectDetail', () => {
  it('非豆瓣条目页 URL 抛错', async () => {
    await expect(fetchDoubanSubjectDetail('http://127.0.0.1/subject/1/')).rejects.toThrow();
  });
});
