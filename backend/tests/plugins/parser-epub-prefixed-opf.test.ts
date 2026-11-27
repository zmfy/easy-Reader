import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { EpubParser } from '../../src/plugins/parser-epub';
import { checkEpubHealth } from '../../src/services/epub-health';

// epub4j（so-novel 等工具使用）写出的 content.opf 所有元素都带 opf: 前缀：
// <opf:package><opf:manifest><opf:item …/></opf:manifest><opf:spine><opf:itemref …/></opf:spine>
// 这是合法的 XML 命名空间写法，阅读软件都能打开（issue #1）

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-prefixed-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function makePrefixedEpub(): string {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    + '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'));
  zip.addFile('OEBPS/content.opf', Buffer.from(
    "<?xml version='1.0' encoding='UTF-8'?>\n"
    + '<opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0" unique-identifier="BookId">'
    + '<opf:metadata><dc:title>赤心巡天</dc:title><dc:creator opf:role="aut">情何以甚</dc:creator><dc:language>zh</dc:language>'
    + '<dc:publisher>so-novel</dc:publisher><opf:meta name="cover" content="cover-image"/></opf:metadata>'
    + '<opf:manifest>'
    + '<opf:item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
    + '<opf:item id="cover-image" href="cover.jpg" media-type="image/jpeg"/>'
    + '<opf:item id="cover" href="cover.html" media-type="application/xhtml+xml"/>'
    + '<opf:item id="01" href="01.html" media-type="application/xhtml+xml"/>'
    + '<opf:item id="02" href="02.html" media-type="application/xhtml+xml"/>'
    + '</opf:manifest>'
    + '<opf:spine toc="ncx"><opf:itemref idref="cover" linear="no"/><opf:itemref idref="01"/><opf:itemref idref="02"/></opf:spine>'
    + '<opf:guide><opf:reference type="cover" href="cover.html" title="封面"/></opf:guide>'
    + '</opf:package>'));
  zip.addFile('OEBPS/toc.ncx', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>'
    + '<navPoint id="n0" playOrder="1"><navLabel><text>封面</text></navLabel><content src="cover.html"/></navPoint>'
    + '<navPoint id="n1" playOrder="2"><navLabel><text>第一章 开端</text></navLabel><content src="01.html"/></navPoint>'
    + '<navPoint id="n2" playOrder="3"><navLabel><text>第二章 继续</text></navLabel><content src="02.html"/></navPoint>'
    + '</navMap></ncx>'));
  zip.addFile('OEBPS/cover.html', Buffer.from('<html><body><img src="cover.jpg"/></body></html>'));
  zip.addFile('OEBPS/01.html', Buffer.from('<html><head><title>第一章</title></head><body><p>第一章正文</p></body></html>'));
  zip.addFile('OEBPS/02.html', Buffer.from('<html><head><title>第二章</title></head><body><p>第二章正文</p></body></html>'));
  const file = path.join(dir, 'prefixed.epub');
  fs.writeFileSync(file, zip.toBuffer());
  return file;
}

describe('EPUB whose content.opf uses the opf: prefix (epub4j / so-novel)', () => {
  it('lists chapters from the spine and toc', async () => {
    const parser = new EpubParser();
    await parser.load(makePrefixedEpub());
    const titles = (await parser.getChapters()).map(c => c.title);
    expect(titles).toEqual(['封面', '第一章 开端', '第二章 继续']);
    expect(await parser.getChapterContent(1)).toContain('第一章正文');
  });

  it('passes the health check', async () => {
    expect(await checkEpubHealth(makePrefixedEpub())).toEqual({ status: 'ok' });
  });
});
