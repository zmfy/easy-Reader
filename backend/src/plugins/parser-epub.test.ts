import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { EpubParser, repairZipEndRecord } from './parser-epub';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-epub-'));

function makeEpub(): Buffer {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    + '<rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'));
  zip.addFile('OPS/book.opf', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><package version="2.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">'
    + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试书</dc:title><dc:creator>某人</dc:creator></metadata>'
    + '<manifest><item id="c1" href="c1.html" media-type="application/xhtml+xml"/>'
    + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>'
    + '<spine toc="ncx"><itemref idref="c1"/></spine></package>'));
  zip.addFile('OPS/toc.ncx', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>'
    + '<navPoint id="n1" playOrder="1"><navLabel><text>第一章</text></navLabel><content src="c1.html"/></navPoint>'
    + '</navMap></ncx>'));
  zip.addFile('OPS/c1.html', Buffer.from('<html><head><title>第一章</title></head><body><p>正文</p></body></html>'));
  return zip.toBuffer();
}

/** 模拟 epubBuilder：把尾部目录记录里的「本盘条目数」写成总数的两倍 */
function breakEndRecord(buf: Buffer): Buffer {
  const out = Buffer.from(buf);
  const at = out.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  out.writeUInt16LE(out.readUInt16LE(at + 10) * 2, at + 8);
  return out;
}

describe('repairZipEndRecord', () => {
  it('returns null for a well-formed zip', () => {
    expect(repairZipEndRecord(makeEpub())).toBeNull();
  });

  it('fixes a wrong disk entry count', () => {
    const fixed = repairZipEndRecord(breakEndRecord(makeEpub()));
    expect(fixed).not.toBeNull();
    expect(new AdmZip(fixed!).getEntries().length).toBe(5);
  });
});

describe('EpubParser.load', () => {
  it('opens an EPUB whose zip end record has a wrong disk entry count', async () => {
    const file = path.join(dir, 'broken.epub');
    fs.writeFileSync(file, breakEndRecord(makeEpub()));
    const parser = new EpubParser();
    await parser.load(file);
    const chapters = await parser.getChapters();
    expect(chapters).toHaveLength(1);
    expect(await parser.getChapterContent(0)).toContain('正文');
  });
});
