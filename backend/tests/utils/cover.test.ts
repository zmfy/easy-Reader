import http from 'http';
import { AddressInfo } from 'net';
import {
  parseDoubanRating, parseDoubanSuggestList, isAllowedDoubanImageUrl, isAllowedDoubanSubjectUrl, isAllowedCoverImageUrl, request,
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
