import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkBookHealth, REASON_PDF_PASSWORD } from '../../src/services/book-health';

const PDF = path.join(__dirname, '../fixtures/pdf-tools');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'book-health-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(name: string, data: Buffer | string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
}

describe('checkBookHealth · PDF', () => {
  it.each(['reportlab-ttf.pdf', 'reportlab-cid.pdf', 'qpdf-owner.pdf', 'chrome.pdf', 'calibre.pdf'])('%s → ok', async file => {
    expect(await checkBookHealth(path.join(PDF, file), 'pdf')).toEqual({ status: 'ok' });
  });

  it('扫描版（有页、没有文字）→ ok', async () => {
    expect(await checkBookHealth(path.join(PDF, 'scanned.pdf'), 'pdf')).toEqual({ status: 'ok' });
  });

  it('需要打开密码 → 损坏，原因说明要密码', async () => {
    expect(await checkBookHealth(path.join(PDF, 'qpdf-user.pdf'), 'pdf')).toEqual({ status: 'damaged', reason: REASON_PDF_PASSWORD });
  });

  it('被截断 → 文件不完整', async () => {
    const buf = fs.readFileSync(path.join(PDF, 'reportlab-ttf.pdf'));
    const file = write('truncated.pdf', buf.subarray(0, buf.length >> 1));
    expect(await checkBookHealth(file, 'pdf')).toEqual({ status: 'damaged', reason: '文件不完整（可能下载或复制中断）' });
  });

  it('不是 PDF → 损坏', async () => {
    expect(await checkBookHealth(write('fake.pdf', 'hello, not a pdf'), 'pdf')).toMatchObject({ status: 'damaged' });
  });

  it('文件不存在 → unreadable（不算损坏）', async () => {
    expect(await checkBookHealth(path.join(dir, 'missing.pdf'), 'pdf')).toEqual({ status: 'unreadable' });
  });
});

describe('checkBookHealth · UMD', () => {
  it('不是 UMD → 不是有效的 UMD 文件', async () => {
    expect(await checkBookHealth(write('fake.umd', 'plain text, not umd'), 'umd')).toEqual({ status: 'damaged', reason: '不是有效的 UMD 文件' });
  });

  it('只有文件头、后面是乱码 → 损坏', async () => {
    const file = write('broken.umd', Buffer.concat([Buffer.from([0x89, 0x9b, 0x9a, 0xde]), Buffer.alloc(200, 0x41)]));
    expect(await checkBookHealth(file, 'umd')).toMatchObject({ status: 'damaged' });
  });
});

describe('checkBookHealth · TXT', () => {
  it('空文件 → 损坏', async () => {
    expect(await checkBookHealth(write('empty.txt', ''), 'txt')).toEqual({ status: 'damaged', reason: '文件是空的' });
  });

  it('有内容 → ok', async () => {
    expect(await checkBookHealth(write('ok.txt', '第一章 开始\n正文\n'), 'txt')).toEqual({ status: 'ok' });
  });
});
