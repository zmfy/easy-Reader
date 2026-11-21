import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import { JSDOM } from 'jsdom';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-route-'));
const BOOKS = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'opds-route-books-')));
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-route-outside-'));
process.env.DATA_DIR = DATA;
process.env.BOOKS_DIR = BOOKS;

/* eslint-disable @typescript-eslint/no-var-requires */
const opdsRoutes = require('../../src/routes/opds').default;
const { getDb } = require('../../src/db');
const { issueOpdsPassword } = require('../../src/services/opds-credentials');
/* eslint-enable @typescript-eslint/no-var-requires */

const db = getDb();
let server: Server;
let base: string;
let auth = '';
let bobAuth = '';

const TXT = '第一回 灵根孕育\n海外有一国土。\n\n第二回 悟彻菩提\n话表美猴王。\n';

function addBook(id: string, over: Record<string, unknown> = {}) {
  const row = { title: id, author: null, format: 'txt', status: 'normal', file: path.join(BOOKS, `${id}.txt`), ...over };
  if (!fs.existsSync(row.file as string)) fs.writeFileSync(row.file as string, TXT);
  db.prepare('INSERT INTO books (id, title, author, file_path, file_format, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, row.title, row.author, row.file, row.format, row.status);
}

beforeAll(async () => {
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u1', 'alice', 'x', 'user'), ('u2', 'bob', 'x', 'user')").run();
  auth = 'Basic ' + Buffer.from(`alice:${issueOpdsPassword(db, 'u1')}`).toString('base64');
  bobAuth = 'Basic ' + Buffer.from(`bob:${issueOpdsPassword(db, 'u2')}`).toString('base64');
  const app = express();
  app.use('/opds', opdsRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

beforeEach(() => {
  for (const t of ['books', 'shelf', 'reading_history']) db.prepare(`DELETE FROM ${t}`).run();
  addBook('xyj', { title: '西游记', author: '吴承恩' });
  addBook('bad', { title: '损坏的书', status: 'damaged' });
});

const get = (p: string, a = auth) => fetch(base + p, { headers: { authorization: a } });
async function feed(p: string, a = auth): Promise<Document> {
  const r = await get(p, a);
  expect(r.status).toBe(200);
  const doc = new JSDOM(await r.text(), { contentType: 'application/xml' }).window.document;
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  return doc;
}
const entryTitles = (doc: Document) => Array.from(doc.querySelectorAll('entry > title')).map(t => t.textContent);

describe('/opds 目录', () => {
  it('没有认证返回 401，认证后根目录列出 7 个入口', async () => {
    expect((await fetch(base + '/opds')).status).toBe(401);
    const r = await get('/opds');
    expect(r.headers.get('content-type')).toContain('kind=navigation');
    const doc = new JSDOM(await r.text(), { contentType: 'application/xml' }).window.document;
    expect(entryTitles(doc)).toEqual(['最新入库', '最近在读', '我的书架', '分类', '作者', '系列', '全部书籍']);
  });

  it('全部书籍分页，第 2 页带上一页链接', async () => {
    for (let i = 0; i < 50; i++) addBook(`n${String(i).padStart(2, '0')}`);
    const p1 = await feed('/opds/all');
    expect(p1.querySelector('feed > link[rel="next"]')?.getAttribute('href')).toBe('/opds/all?page=2');
    const p2 = await feed('/opds/all?page=2');
    expect(p2.querySelectorAll('entry')).toHaveLength(1);
    expect(p2.querySelector('feed > link[rel="previous"]')?.getAttribute('href')).toBe('/opds/all?page=1');
  });

  it('我的书架只有自己的书', async () => {
    db.prepare("INSERT INTO shelf (id, user_id, book_id) VALUES ('s1', 'u1', 'xyj')").run();
    expect(entryTitles(await feed('/opds/shelf'))).toEqual(['西游记']);
    expect(entryTitles(await feed('/opds/shelf', bobAuth))).toEqual([]);
  });

  it('搜索书名，损坏的书不出现', async () => {
    expect(entryTitles(await feed('/opds/search?q=' + encodeURIComponent('西游')))).toEqual(['西游记']);
    expect(entryTitles(await feed('/opds/search?q=' + encodeURIComponent('损坏')))).toEqual([]);
    expect(entryTitles(await feed('/opds/search?q='))).toEqual([]);
    expect(entryTitles(await feed('/opds/recent'))).toEqual(['西游记']);
  });

  it('TXT 书有两个下载链接，第一个是 EPUB', async () => {
    const doc = await feed('/opds/all');
    const hrefs = Array.from(doc.querySelectorAll('entry > link[rel="http://opds-spec.org/acquisition"]')).map(l => l.getAttribute('href'));
    expect(hrefs).toEqual(['/opds/books/xyj/download.epub', '/opds/books/xyj/download.txt']);
  });

  it('OpenSearch 描述文档', async () => {
    const r = await get('/opds/opensearch.xml');
    expect(r.headers.get('content-type')).toContain('application/opensearchdescription+xml');
    expect(await r.text()).toContain('/opds/search?q={searchTerms}');
  });

  it('作者、分类、系列目录可以打开', async () => {
    db.prepare("UPDATE books SET category = '小说/中国古典小说' WHERE id = 'xyj'").run();
    expect(entryTitles(await feed('/opds/authors'))).toEqual(['吴承恩']);
    expect(entryTitles(await feed('/opds/authors/books?name=' + encodeURIComponent('吴承恩')))).toEqual(['西游记']);
    expect(entryTitles(await feed('/opds/categories'))).toEqual(['小说']);
    expect(entryTitles(await feed('/opds/categories?path=' + encodeURIComponent('小说')))).toEqual(['全部（1 本）', '中国古典小说']);
    expect(entryTitles(await feed('/opds/categories/books?path=' + encodeURIComponent('小说')))).toEqual(['西游记']);
    expect(entryTitles(await feed('/opds/series'))).toEqual([]);
  });
});

describe('/opds 下载', () => {
  it('TXT 书下载转换后的 EPUB，带中文文件名', async () => {
    const r = await get('/opds/books/xyj/download.epub');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/epub+zip');
    const cd = r.headers.get('content-disposition') || '';
    expect(cd).toContain('attachment');
    expect(cd).toContain('filename="book.epub"');
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent('西游记 - 吴承恩.epub')}`);
    const buf = Buffer.from(await r.arrayBuffer());
    expect(buf.subarray(0, 2).toString()).toBe('PK');
  });

  it('损坏的书、不提供的格式、不存在的书都返回 404', async () => {
    expect((await get('/opds/books/bad/download.epub')).status).toBe(404);
    expect((await get('/opds/books/xyj/download.pdf')).status).toBe(404);
    expect((await get('/opds/books/nope/download.epub')).status).toBe(404);
  });

  it('文件在书库目录外（符号链接）时返回 404', async () => {
    const outside = path.join(OUTSIDE, 'secret.txt');
    fs.writeFileSync(outside, TXT);
    const link = path.join(BOOKS, 'link.txt');
    fs.symlinkSync(outside, link);
    addBook('lnk', { file: link });
    expect((await get('/opds/books/lnk/download.txt')).status).toBe(404);
  });

  it('下载不记入阅读历史', async () => {
    await get('/opds/books/xyj/download.txt');
    expect(db.prepare('SELECT COUNT(*) AS n FROM reading_history').get().n).toBe(0);
  });
});
