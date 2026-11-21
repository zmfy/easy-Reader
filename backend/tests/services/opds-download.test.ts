import fs from 'fs';
import os from 'os';
import path from 'path';
import iconv from 'iconv-lite';
import AdmZip from 'adm-zip';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-dl-'));
const BOOKS = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-dl-books-'));
process.env.DATA_DIR = DATA;
process.env.BOOKS_DIR = BOOKS;

/* eslint-disable @typescript-eslint/no-var-requires */
const { getDb } = require('../../src/db');
const dl = require('../../src/services/opds-download');
const { buildEpub } = require('../../src/services/epub-builder');
const { EpubParser } = require('../../src/plugins/parser-epub');
const { TxtParser } = require('../../src/plugins/parser-txt');
/* eslint-enable @typescript-eslint/no-var-requires */

const db = getDb();
const CACHE = path.join(DATA, 'opds-cache');
const TXT_TEXT = '西游记\n作者：吴承恩\n\n第一回 灵根孕育源流出\n诗曰：混沌未分天地乱。\n\n第二回 悟彻菩提真妙理\n话表美猴王得了姓名。\n';

function addBook(id: string, file: string, format: string, over: Record<string, unknown> = {}) {
  const row = { title: '西游记', author: '吴承恩', summary: null, cover_url: null, ...over };
  db.prepare('INSERT INTO books (id, title, author, summary, cover_url, file_path, file_format) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, row.title, row.author, row.summary, row.cover_url, file, format);
  return db.prepare('SELECT * FROM books WHERE id = ?').get(id);
}
const book = (id: string) => db.prepare('SELECT * FROM books WHERE id = ?').get(id);
const cacheFiles = () => (fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : []);

let gbkFile = '';
beforeAll(() => {
  gbkFile = path.join(BOOKS, 'gbk.txt');
  fs.writeFileSync(gbkFile, iconv.encode(TXT_TEXT, 'gbk'));
});
beforeEach(() => {
  db.prepare('DELETE FROM books').run();
  db.prepare('DELETE FROM book_chapter_overrides').run();
  fs.rmSync(CACHE, { recursive: true, force: true });
});

describe('可下载格式', () => {
  it('按书的格式给出下载选项', () => {
    expect(dl.availableDownloads({ file_format: 'epub' })).toEqual(['epub']);
    expect(dl.availableDownloads({ file_format: 'PDF' })).toEqual(['pdf']);
    expect(dl.availableDownloads({ file_format: 'txt' })).toEqual(['epub', 'txt']);
    expect(dl.availableDownloads({ file_format: 'umd' })).toEqual(['epub']);
    expect(dl.availableDownloads({ file_format: 'mobi' })).toEqual([]);
  });
});

describe('TXT 下载', () => {
  it('GBK 的 TXT 转成的 EPUB 有目录、无乱码', async () => {
    const b = addBook('t1', gbkFile, 'txt');
    const d = await dl.resolveDownload(b, 'epub');
    expect(d.mimeType).toBe('application/epub+zip');
    expect(d.fileName).toBe('西游记 - 吴承恩.epub');
    const txt = new TxtParser();
    await txt.load(gbkFile);
    const epub = new EpubParser();
    await epub.load(d.filePath);
    expect((await epub.getChapters()).map((c: { title: string }) => c.title))
      .toEqual((await txt.getChapters()).map((c: { title: string }) => c.title));
    expect(await epub.getChapterContent(0)).toContain('混沌未分天地乱');
    expect(await epub.getChapterContent(1)).toContain('话表美猴王');
  });

  it('原始 TXT 下载转为 UTF-8', async () => {
    const d = await dl.resolveDownload(addBook('t1', gbkFile, 'txt'), 'txt');
    expect(d.mimeType).toBe('text/plain; charset=utf-8');
    expect(fs.readFileSync(d.filePath, 'utf8')).toBe(TXT_TEXT);
  });

  it('本来就是 UTF-8 的 TXT 直接给原文件', async () => {
    const f = path.join(BOOKS, 'utf8.txt');
    fs.writeFileSync(f, TXT_TEXT);
    expect((await dl.resolveDownload(addBook('t2', f, 'txt'), 'txt')).filePath).toBe(f);
  });

  it('不支持的格式抛错', async () => {
    await expect(dl.resolveDownload(addBook('t1', gbkFile, 'txt'), 'pdf')).rejects.toThrow();
  });
});

describe('转换缓存', () => {
  it('第二次下载直接用缓存，不重新生成', async () => {
    const first = await dl.resolveDownload(addBook('t1', gbkFile, 'txt'), 'epub');
    const mtime = fs.statSync(first.filePath).mtimeMs;
    await new Promise(r => setTimeout(r, 20));
    const second = await dl.resolveDownload(book('t1'), 'epub');
    expect(second.filePath).toBe(first.filePath);
    expect(fs.statSync(second.filePath).mtimeMs).toBe(mtime);
  });

  it('改书名后重新生成，旧缓存被删除，EPUB 里是新书名', async () => {
    const first = await dl.resolveDownload(addBook('t1', gbkFile, 'txt'), 'epub');
    db.prepare("UPDATE books SET title = '西游释厄传' WHERE id = 't1'").run();
    const second = await dl.resolveDownload(book('t1'), 'epub');
    expect(second.filePath).not.toBe(first.filePath);
    expect(fs.existsSync(first.filePath)).toBe(false);
    expect(new AdmZip(second.filePath).readAsText('OEBPS/content.opf')).toContain('西游释厄传');
  });

  it('章节标题与网页阅读器一致（使用统一后的标题）', async () => {
    addBook('t1', gbkFile, 'txt');
    await dl.resolveDownload(book('t1'), 'epub');
    db.prepare("INSERT INTO book_chapter_overrides (book_id, chapter_index, normalized_title) VALUES ('t1', 1, '第2回 悟彻菩提')").run();
    const d = await dl.resolveDownload(book('t1'), 'epub');
    const epub = new EpubParser();
    await epub.load(d.filePath);
    expect((await epub.getChapters())[1].title).toBe('第2回 悟彻菩提');
  });

  it('两台设备同时首次下载只生成一次，没有临时文件残留', async () => {
    const b = addBook('t1', gbkFile, 'txt');
    const [a, c] = await Promise.all([dl.resolveDownload(b, 'epub'), dl.resolveDownload(b, 'epub')]);
    expect(a.filePath).toBe(c.filePath);
    expect(cacheFiles().filter((f: string) => f.endsWith('.epub'))).toHaveLength(1);
    expect(cacheFiles().filter((f: string) => f.includes('.tmp-'))).toHaveLength(0);
  });

  it('删除书的缓存', async () => {
    await dl.resolveDownload(addBook('t1', gbkFile, 'txt'), 'epub');
    dl.removeOpdsCache(['t1']);
    expect(cacheFiles().filter((f: string) => f.startsWith('t1-'))).toHaveLength(0);
  });

  it('删除书（清理关联数据）时一并删掉它的缓存', async () => {
    await dl.resolveDownload(addBook('t1', gbkFile, 'txt'), 'epub');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../../src/services/relation-cleanup').deleteBookRelations(db, ['t1']);
    expect(cacheFiles().filter((f: string) => f.startsWith('t1-'))).toHaveLength(0);
  });

  it('有栅格封面时放进 EPUB', async () => {
    fs.mkdirSync(path.join(DATA, 'covers'), { recursive: true });
    fs.writeFileSync(path.join(DATA, 'covers', 't1.jpg'), Buffer.from('ffd8ffe0', 'hex'));
    const d = await dl.resolveDownload(addBook('t1', gbkFile, 'txt', { cover_url: '/covers/t1.jpg?v=3' }), 'epub');
    expect(new AdmZip(d.filePath).getEntry('OEBPS/cover.jpg')).toBeTruthy();
  });
});

describe('EPUB 下载', () => {
  const sample = () => buildEpub({ id: 'e', title: '测试书', chapters: [{ title: '第一章', html: '<p>正文</p>' }] });

  it('正常的 EPUB 给原文件', async () => {
    const f = path.join(BOOKS, 'ok.epub');
    fs.writeFileSync(f, await sample());
    expect((await dl.resolveDownload(addBook('e1', f, 'epub'), 'epub')).filePath).toBe(f);
  });

  it('读取时需要修正的 EPUB 给修正后的版本', async () => {
    const buf = Buffer.from(await sample());
    const at = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    buf.writeUInt16LE(buf.readUInt16LE(at + 10) * 2, at + 8);
    const f = path.join(BOOKS, 'broken.epub');
    fs.writeFileSync(f, buf);
    const d = await dl.resolveDownload(addBook('e2', f, 'epub'), 'epub');
    expect(path.dirname(d.filePath)).toBe(CACHE);
    expect(new AdmZip(d.filePath).getEntries().length).toBeGreaterThan(0);
  });
});

describe('文件名', () => {
  it('去掉文件名里不允许的字符，没有作者时只有书名', async () => {
    const d = await dl.resolveDownload(addBook('t1', gbkFile, 'txt', { title: 'a/b:c?', author: null }), 'txt');
    expect(d.fileName).toBe('abc.txt');
  });
});
