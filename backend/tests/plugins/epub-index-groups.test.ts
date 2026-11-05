import { groupByIndexPage, extractIndexLinks } from '../../src/plugins/parser-epub';

const ch = (index: number, href: string, level: number, title = `c${index}`) => ({ index, title, href, level, id: `id${index}` });

// 套装书：总目录(0) 下 3 册全部平铺，每册以「封面」开头
const SET = [
  ch(0, 'T/p0.xhtml', 0, '总目录'),
  ch(1, 'T/p1.xhtml', 1, '封面'), ch(2, 'T/p2.xhtml', 1, '目录'), ch(3, 'T/p3.xhtml', 1, '第一章'),
  ch(4, 'T/p4.xhtml', 1, '封面'), ch(5, 'T/p5.xhtml', 1, '第一章'), ch(6, 'T/p6.xhtml', 1, '第二章'),
  ch(7, 'T/p7.xhtml', 1, '封面'), ch(8, 'T/p8.xhtml', 2, '一'), ch(9, 'T/p9.xhtml', 1, '后记'),
];
const LINKS = [{ title: '秦腔', href: 'T/p1.xhtml' }, { title: '三里湾', href: 'T/p4.xhtml' }, { title: '白鹿原', href: 'T/p7.xhtml' }];

describe('groupByIndexPage', () => {
  it('groups the flat entries of a box set under the titles listed on its index page', () => {
    const out = groupByIndexPage(SET, LINKS);
    expect(out.map(c => [c.title, c.level, c.groupTitle])).toEqual([
      ['总目录', 0, undefined],
      ['封面', 2, '秦腔'], ['目录', 2, undefined], ['第一章', 2, undefined],
      ['封面', 2, '三里湾'], ['第一章', 2, undefined], ['第二章', 2, undefined],
      ['封面', 2, '白鹿原'], ['一', 3, undefined], ['后记', 2, undefined],
    ]);
  });

  it('leaves the list unchanged when the index page just lists every chapter (ordinary 目录 page)', () => {
    const flat = [ch(0, 'a.xhtml', 0), ch(1, 'b.xhtml', 0), ch(2, 'c.xhtml', 0), ch(3, 'd.xhtml', 0)];
    const links = [{ title: 'b', href: 'b.xhtml' }, { title: 'c', href: 'c.xhtml' }, { title: 'd', href: 'd.xhtml' }];
    expect(groupByIndexPage(flat, links)).toBe(flat);
  });

  it('leaves an already structured TOC unchanged', () => {
    const nested = [ch(0, 'a.xhtml', 0), ch(1, 'b.xhtml', 1), ch(2, 'c.xhtml', 1), ch(3, 'd.xhtml', 0), ch(4, 'e.xhtml', 1), ch(5, 'f.xhtml', 0), ch(6, 'g.xhtml', 1)];
    const links = [{ title: 'A', href: 'a.xhtml' }, { title: 'D', href: 'd.xhtml' }, { title: 'F', href: 'f.xhtml' }];
    expect(groupByIndexPage(nested, links)).toBe(nested);
  });

  it('needs at least 3 links in reading order that point at chapters on the same level', () => {
    expect(groupByIndexPage(SET, LINKS.slice(0, 2))).toBe(SET);
    expect(groupByIndexPage(SET, [LINKS[1], LINKS[0], LINKS[2]])).toBe(SET);
    expect(groupByIndexPage(SET, [LINKS[0], LINKS[1], { title: 'x', href: 'T/p8.xhtml' }])).toBe(SET);
  });
});

describe('extractIndexLinks', () => {
  it('resolves relative links against the page and drops anchors', () => {
    const html = '<ul><li><a href="part0001.xhtml">秦腔</a></li><li><a href="../Text/part0012.xhtml#x"><span>三里湾</span></a></li><li><a href="http://x.com">外链</a></li></ul>';
    expect(extractIndexLinks(html, 'OEBPS/Text/part0000.xhtml')).toEqual([
      { title: '秦腔', href: 'OEBPS/Text/part0001.xhtml' },
      { title: '三里湾', href: 'OEBPS/Text/part0012.xhtml' },
    ]);
  });
});
