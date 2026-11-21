// OPDS 1.2（Atom）与 OpenSearch 的 XML 生成。链接一律是以 / 开头的路径，由客户端按 feed 地址补全主机。

export const OPDS_NAV_TYPE = 'application/atom+xml;profile=opds-catalog;kind=navigation';
export const OPDS_ACQ_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';

export interface FeedLinks {
  self: string;
  start: string;
  up?: string;
  next?: string;
  previous?: string;
  first?: string;
  search: string;
}

export interface NavEntry {
  id: string;
  title: string;
  href: string;
  /** 指向的子目录类型，默认 navigation */
  kind?: 'navigation' | 'acquisition';
  content?: string;
  count?: number;
}

export interface Acquisition { href: string; type: string; title?: string }

export interface BookEntry {
  id: string;
  title: string;
  author?: string | null;
  summary?: string | null;
  category?: string | null;
  updated: string;
  coverUrl?: string | null;
  acquisitions: Acquisition[];
}

export function escapeXml(s: string): string {
  return s
    // XML 1.0 不允许的控制字符直接去掉
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function link(rel: string, href: string, type: string, extra = ''): string {
  return `<link rel="${escapeXml(rel)}" href="${escapeXml(href)}" type="${escapeXml(type)}"${extra}/>`;
}

function feedHead(id: string, title: string, updated: string, links: FeedLinks, selfType: string): string {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog"'
      + ' xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:dc="http://purl.org/dc/terms/"'
      + ' xmlns:thr="http://purl.org/syndication/thread/1.0">',
    `<id>${escapeXml(id)}</id>`,
    `<title>${escapeXml(title)}</title>`,
    `<updated>${escapeXml(updated)}</updated>`,
    '<author><name>easyReader</name></author>',
    link('self', links.self, selfType),
    link('start', links.start, OPDS_NAV_TYPE),
    link('search', links.search, 'application/opensearchdescription+xml'),
  ];
  if (links.up) parts.push(link('up', links.up, OPDS_NAV_TYPE));
  if (links.first) parts.push(link('first', links.first, selfType));
  if (links.previous) parts.push(link('previous', links.previous, selfType));
  if (links.next) parts.push(link('next', links.next, selfType));
  return parts.join('\n');
}

export function navigationFeed(o: { id: string; title: string; updated: string; links: FeedLinks; entries: NavEntry[] }): string {
  const entries = o.entries.map(e => {
    const type = e.kind === 'acquisition' ? OPDS_ACQ_TYPE : OPDS_NAV_TYPE;
    const count = e.count !== undefined ? ` thr:count="${e.count}"` : '';
    return [
      '<entry>',
      `<id>${escapeXml(e.id)}</id>`,
      `<title>${escapeXml(e.title)}</title>`,
      `<updated>${escapeXml(o.updated)}</updated>`,
      e.content ? `<content type="text">${escapeXml(e.content)}</content>` : '',
      link('subsection', e.href, type, count),
      '</entry>',
    ].filter(Boolean).join('\n');
  });
  return [feedHead(o.id, o.title, o.updated, o.links, OPDS_NAV_TYPE), ...entries, '</feed>'].join('\n');
}

function isRasterCover(url: string): boolean {
  return /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
}

function bookEntry(b: BookEntry): string {
  const parts = [
    '<entry>',
    `<id>urn:easyreader:book:${escapeXml(b.id)}</id>`,
    `<title>${escapeXml(b.title)}</title>`,
    `<updated>${escapeXml(b.updated)}</updated>`,
    '<dc:language>zh</dc:language>',
  ];
  if (b.author) parts.push(`<author><name>${escapeXml(b.author)}</name></author>`);
  if (b.category) parts.push(`<category term="${escapeXml(b.category)}" label="${escapeXml(b.category)}"/>`);
  if (b.summary) {
    const text = plainText(b.summary);
    if (text) parts.push(`<summary type="text">${escapeXml(text)}</summary>`);
  }
  if (b.coverUrl && isRasterCover(b.coverUrl)) {
    const type = /\.png/i.test(b.coverUrl) ? 'image/png' : /\.webp/i.test(b.coverUrl) ? 'image/webp' : /\.gif/i.test(b.coverUrl) ? 'image/gif' : 'image/jpeg';
    parts.push(link('http://opds-spec.org/image', b.coverUrl, type));
    parts.push(link('http://opds-spec.org/image/thumbnail', b.coverUrl, type));
  }
  for (const a of b.acquisitions) {
    parts.push(link('http://opds-spec.org/acquisition', a.href, a.type, a.title ? ` title="${escapeXml(a.title)}"` : ''));
  }
  parts.push('</entry>');
  return parts.join('\n');
}

export function acquisitionFeed(o: {
  id: string; title: string; updated: string; links: FeedLinks; entries: BookEntry[];
  total: number; pageSize: number; startIndex: number;
}): string {
  return [
    feedHead(o.id, o.title, o.updated, o.links, OPDS_ACQ_TYPE),
    `<opensearch:totalResults>${o.total}</opensearch:totalResults>`,
    `<opensearch:itemsPerPage>${o.pageSize}</opensearch:itemsPerPage>`,
    `<opensearch:startIndex>${o.startIndex}</opensearch:startIndex>`,
    ...o.entries.map(bookEntry),
    '</feed>',
  ].join('\n');
}

export function openSearchDescription(searchTemplate: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
    '<ShortName>easyReader</ShortName>',
    '<Description>搜索书名或作者</Description>',
    '<InputEncoding>UTF-8</InputEncoding>',
    '<OutputEncoding>UTF-8</OutputEncoding>',
    `<Url type="${OPDS_ACQ_TYPE}" template="${escapeXml(searchTemplate)}"/>`,
    '</OpenSearchDescription>',
  ].join('\n');
}
