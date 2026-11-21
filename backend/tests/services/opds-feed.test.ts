import { JSDOM } from 'jsdom';
import {
  acquisitionFeed, navigationFeed, openSearchDescription, BookEntry, FeedLinks, OPDS_ACQ_TYPE,
} from '../../src/services/opds-feed';

const links: FeedLinks = { self: '/opds/all?page=2', start: '/opds', search: '/opds/opensearch.xml' };

function parse(xml: string): Document {
  const doc = new JSDOM(xml, { contentType: 'application/xml' }).window.document;
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  return doc;
}

const book = (over: Partial<BookEntry> = {}): BookEntry => ({
  id: 'b1', title: '西游记', author: '吴承恩', updated: '2026-11-21T00:00:00Z',
  acquisitions: [{ href: '/opds/books/b1/download.epub', type: 'application/epub+zip' }], ...over,
});

describe('OPDS feed', () => {
  it('书名、作者里的 & < > 引号会转义，解析后取回原文', () => {
    const xml = acquisitionFeed({
      id: 'urn:easyreader:all', title: '全部', updated: '2026-11-21T00:00:00Z', links,
      entries: [book({ title: 'a & b <c> "d"', author: "O'Neil" })], total: 1, pageSize: 50, startIndex: 1,
    });
    const doc = parse(xml);
    const entry = doc.getElementsByTagName('entry')[0];
    expect(entry.getElementsByTagName('title')[0].textContent).toBe('a & b <c> "d"');
    expect(entry.getElementsByTagName('name')[0].textContent).toBe("O'Neil");
  });

  it('有下一页时输出 next 链接，没有则不输出', () => {
    const base = { id: 'x', title: 't', updated: '2026-11-21T00:00:00Z', entries: [], total: 0, pageSize: 50, startIndex: 1 };
    const withNext = parse(acquisitionFeed({ ...base, links: { ...links, next: '/opds/all?page=3' } }));
    expect(withNext.querySelector('feed > link[rel="next"]')?.getAttribute('href')).toBe('/opds/all?page=3');
    const without = parse(acquisitionFeed({ ...base, links }));
    expect(without.querySelector('feed > link[rel="next"]')).toBeNull();
  });

  it('SVG 封面不输出，栅格封面输出 image 和 thumbnail 两个链接', () => {
    const svg = parse(acquisitionFeed({ id: 'x', title: 't', updated: 'u', links, entries: [book({ coverUrl: '/covers/x.svg' })], total: 1, pageSize: 50, startIndex: 1 }));
    expect(svg.querySelectorAll('entry > link[rel^="http://opds-spec.org/image"]').length).toBe(0);
    const jpg = parse(acquisitionFeed({ id: 'x', title: 't', updated: 'u', links, entries: [book({ coverUrl: '/covers/x.jpg?v=2' })], total: 1, pageSize: 50, startIndex: 1 }));
    const rels = Array.from(jpg.querySelectorAll('entry > link[rel^="http://opds-spec.org/image"]')).map(l => l.getAttribute('rel'));
    expect(rels).toEqual(['http://opds-spec.org/image', 'http://opds-spec.org/image/thumbnail']);
  });

  it('多个下载链接按顺序输出，带类型和标题', () => {
    const doc = parse(acquisitionFeed({
      id: 'x', title: 't', updated: 'u', links, total: 1, pageSize: 50, startIndex: 1,
      entries: [book({ acquisitions: [
        { href: '/opds/books/b1/download.epub', type: 'application/epub+zip' },
        { href: '/opds/books/b1/download.txt', type: 'text/plain; charset=utf-8', title: '原始 TXT' },
      ] })],
    }));
    const acq = Array.from(doc.querySelectorAll('entry > link[rel="http://opds-spec.org/acquisition"]'));
    expect(acq.map(l => l.getAttribute('href'))).toEqual(['/opds/books/b1/download.epub', '/opds/books/b1/download.txt']);
    expect(acq[1].getAttribute('type')).toBe('text/plain; charset=utf-8');
    expect(acq[1].getAttribute('title')).toBe('原始 TXT');
  });

  it('简介只输出纯文本，并带分页总数', () => {
    const doc = parse(acquisitionFeed({
      id: 'x', title: 't', updated: 'u', links, total: 51, pageSize: 50, startIndex: 51,
      entries: [book({ summary: '<p>一个<b>猴子</b>的故事</p>' })],
    }));
    expect(doc.querySelector('entry > summary')?.textContent).toBe('一个猴子的故事');
    expect(doc.getElementsByTagName('opensearch:totalResults')[0].textContent).toBe('51');
    expect(doc.getElementsByTagName('opensearch:startIndex')[0].textContent).toBe('51');
  });

  it('导航 feed 的每个入口指向子目录并可带书数', () => {
    const doc = parse(navigationFeed({
      id: 'urn:easyreader:root', title: '简单书房', updated: 'u', links,
      entries: [{ id: 'urn:easyreader:recent', title: '最新入库', href: '/opds/recent', kind: 'acquisition', count: 3 }],
    }));
    const link = doc.querySelector('entry > link');
    expect(link?.getAttribute('href')).toBe('/opds/recent');
    expect(link?.getAttribute('type')).toBe(OPDS_ACQ_TYPE);
    expect(link?.getAttribute('thr:count')).toBe('3');
    expect(doc.querySelector('feed > link[rel="search"]')?.getAttribute('href')).toBe('/opds/opensearch.xml');
  });

  it('OpenSearch 描述文档带搜索模板', () => {
    const doc = parse(openSearchDescription('/opds/search?q={searchTerms}'));
    const url = doc.getElementsByTagName('Url')[0];
    expect(url.getAttribute('type')).toBe(OPDS_ACQ_TYPE);
    expect(url.getAttribute('template')).toBe('/opds/search?q={searchTerms}');
  });
});
