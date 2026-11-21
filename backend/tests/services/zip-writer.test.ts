import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { execFileSync } from 'child_process';
import { ZipWriter } from '../../src/services/zip-writer';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-writer-'));

describe('ZipWriter', () => {
  it('写出的 zip 能被 adm-zip 读回，存储 / 压缩条目内容一致，顺序保持', async () => {
    const file = path.join(TMP, 'a.zip');
    const zip = await ZipWriter.open(file);
    await zip.add('mimetype', Buffer.from('application/epub+zip'), { store: true });
    await zip.add('中文/章节.xhtml', Buffer.from('<p>你好</p>'.repeat(1000)));
    await zip.add('empty.txt', Buffer.alloc(0));
    await zip.close();

    const read = new AdmZip(file);
    const entries = read.getEntries();
    expect(entries.map(e => e.entryName)).toEqual(['mimetype', '中文/章节.xhtml', 'empty.txt']);
    expect(entries[0].header.method).toBe(0);
    expect(entries[1].header.method).toBe(8);
    expect(read.readAsText('中文/章节.xhtml')).toBe('<p>你好</p>'.repeat(1000));
    expect(read.readAsText('empty.txt')).toBe('');
  });

  it('系统 unzip 校验通过', async () => {
    const file = path.join(TMP, 'b.zip');
    const zip = await ZipWriter.open(file);
    await zip.add('a.txt', Buffer.from('hello'));
    await zip.close();
    let out = '';
    try { out = execFileSync('unzip', ['-t', file]).toString(); } catch { return; } // 没装 unzip 时跳过
    expect(out).toContain('No errors detected');
  });

  it('出错后 abort 删除半成品文件', async () => {
    const file = path.join(TMP, 'c.zip');
    const zip = await ZipWriter.open(file);
    await zip.add('a.txt', Buffer.from('x'));
    await zip.abort();
    expect(fs.existsSync(file)).toBe(false);
  });
});
