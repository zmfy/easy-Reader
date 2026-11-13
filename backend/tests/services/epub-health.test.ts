import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { checkEpubHealth, classifyZipDamage } from '../../src/services/epub-health';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-health-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function makeEpub(opts: { opf?: boolean; spine?: boolean; containerPath?: string } = {}): Buffer {
  const { opf = true, spine = true, containerPath = 'OPS/book.opf' } = opts;
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    + `<rootfiles><rootfile full-path="${containerPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`));
  if (opf) {
    zip.addFile('OPS/book.opf', Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">'
      + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试书</dc:title><dc:creator>某人</dc:creator></metadata>'
      + '<manifest><item id="c1" href="c1.html" media-type="application/xhtml+xml"/>'
      + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>'
      + `<spine toc="ncx">${spine ? '<itemref idref="c1"/>' : ''}</spine></package>`));
    zip.addFile('OPS/toc.ncx', Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>'
      + (spine ? '<navPoint id="n1" playOrder="1"><navLabel><text>第一章</text></navLabel><content src="c1.html"/></navPoint>' : '')
      + '</navMap></ncx>'));
    zip.addFile('OPS/c1.html', Buffer.from('<html><head><title>第一章</title></head><body><p>正文</p></body></html>'));
  }
  return zip.toBuffer();
}

function breakEndRecord(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  const at = out.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  out.writeUInt16LE(out.readUInt16LE(at + 10) * 2, at + 8);
  return out;
}

function write(name: string, buf: Buffer): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, buf);
  return file;
}

describe('classifyZipDamage', () => {
  it('returns null for a complete zip', () => {
    expect(classifyZipDamage(makeEpub())).toBeNull();
  });
  it('flags a truncated zip', () => {
    const buf = makeEpub();
    expect(classifyZipDamage(buf.subarray(0, buf.length >> 1))).toBe('文件不完整（可能下载或复制中断）');
  });
  it('flags empty / non-zip data', () => {
    expect(classifyZipDamage(Buffer.from('hello'))).toBe('文件不完整（可能下载或复制中断）');
  });
});

describe('checkEpubHealth', () => {
  it('ok for a normal EPUB', async () => {
    expect(await checkEpubHealth(write('ok.epub', makeEpub()))).toEqual({ status: 'ok' });
  });

  it('repaired when only the zip end record is wrong', async () => {
    expect(await checkEpubHealth(write('repaired.epub', breakEndRecord(makeEpub())))).toEqual({ status: 'repaired' });
  });

  it('damaged when truncated', async () => {
    const buf = makeEpub();
    const r = await checkEpubHealth(write('trunc.epub', buf.subarray(0, buf.length >> 1)));
    expect(r).toEqual({ status: 'damaged', reason: '文件不完整（可能下载或复制中断）' });
  });

  it('damaged when content.opf is missing', async () => {
    const r = await checkEpubHealth(write('noopf.epub', makeEpub({ opf: false })));
    expect(r).toEqual({ status: 'damaged', reason: '缺少书籍目录（content.opf）' });
  });

  it('damaged when container.xml has no rootfile pointing to an existing opf', async () => {
    const r = await checkEpubHealth(write('badroot.epub', makeEpub({ containerPath: 'NOPE/x.opf' })));
    expect(r).toEqual({ status: 'damaged', reason: '缺少书籍目录（content.opf）' });
  });

  it('damaged when there are no chapters', async () => {
    const r = await checkEpubHealth(write('empty.epub', makeEpub({ spine: false })));
    expect(r).toEqual({ status: 'damaged', reason: '没有可读的章节' });
  });

  it('times out when the parser never resolves, and disposes', async () => {
    const dispose = jest.fn();
    const r = await checkEpubHealth('/x.epub', {
      timeoutMs: 50,
      createParser: () => ({ load: () => new Promise<void>(() => {}), getChapters: async () => [], dispose }),
    });
    expect(r).toEqual({ status: 'damaged', reason: '解析超时' });
    expect(dispose).toHaveBeenCalled();
  });

  it('strips absolute paths and caps the reason at 80 chars', async () => {
    const r = await checkEpubHealth(write('weird.epub', makeEpub()), {
      createParser: () => ({
        load: async () => { throw new Error(`boom at /home/someone/books/some dir/weird.epub ${'x'.repeat(200)}`); },
        getChapters: async () => [],
      }),
    });
    expect(r.status).toBe('damaged');
    const reason = (r as { reason: string }).reason;
    expect(reason.startsWith('无法解析：')).toBe(true);
    expect(reason).not.toContain('/home');
    expect(reason.length).toBeLessThanOrEqual(80);
  });
});
