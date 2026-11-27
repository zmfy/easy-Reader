import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectAndFixEncoding, _internals } from '../../src/utils/encoding';

const SRC_DIR = path.join(__dirname, '__fixtures__/encoding');
// detectAndFixEncoding 会改写文件：在临时目录的副本上测，不改仓库里的样本
// （以前就地改写再写回，与同时读样本的 encoding-atomic.test.ts 竞争，偶尔读到写了一半的文件）
const FIX_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'encoding-test-'));
afterAll(() => fs.rmSync(FIX_DIR, { recursive: true, force: true }));

describe('detectAndFixEncoding', () => {
  beforeEach(() => {
    for (const f of fs.readdirSync(SRC_DIR)) {
      if (f.endsWith('.txt')) fs.copyFileSync(path.join(SRC_DIR, f), path.join(FIX_DIR, f));
    }
  });

  it('detects normal UTF-8 file', async () => {
    const r = await detectAndFixEncoding(path.join(FIX_DIR, 'utf8-normal.txt'));
    expect(r.status).toBe('normal');
    expect(r.encoding).toBe('utf-8');
  });

  it('fixes GBK file by overwriting as UTF-8', async () => {
    const p = path.join(FIX_DIR, 'gbk-fixable.txt');
    const r = await detectAndFixEncoding(p);
    expect(r.status).toBe('encoding_fixed');
    expect(r.encoding).toBe('gbk');
    // After fix, file should be valid UTF-8
    const after = fs.readFileSync(p, 'utf-8');
    expect(after).toContain('第一章');
  });

  it('fixes GB18030 file', async () => {
    const r = await detectAndFixEncoding(path.join(FIX_DIR, 'gb18030-fixable.txt'));
    expect(['gb18030', 'gbk']).toContain(r.encoding);
    expect(r.status).toBe('encoding_fixed');
  });

  it('fixes UTF-16 LE file (with BOM) by overwriting as UTF-8', async () => {
    const p = path.join(FIX_DIR, 'utf16le-fixable.txt');
    const r = await detectAndFixEncoding(p);
    expect(r.status).toBe('encoding_fixed');
    const after = fs.readFileSync(p, 'utf-8');
    expect(after).toContain('第一章');
    // BOM must be stripped after transcoding to UTF-8
    expect(after.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('fixes UTF-16 BE file (with BOM) by overwriting as UTF-8', async () => {
    const p = path.join(FIX_DIR, 'utf16be-fixable.txt');
    const r = await detectAndFixEncoding(p);
    expect(r.status).toBe('encoding_fixed');
    const after = fs.readFileSync(p, 'utf-8');
    expect(after).toContain('第一章');
    expect(after.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('fixes dialogue-heavy GBK novel (curly quotes, …, —) instead of flagging garbled', async () => {
    const p = path.join(FIX_DIR, 'gbk-dialogue.txt');
    const r = await detectAndFixEncoding(p);
    expect(r.status).toBe('encoding_fixed');
    const after = fs.readFileSync(p, 'utf-8');
    expect(after).toContain('“你来了。”');
  });

  it('flags random garbage as garbled', async () => {
    const r = await detectAndFixEncoding(path.join(FIX_DIR, 'garbled-random.txt'));
    expect(r.status).toBe('garbled');
  });

  describe('printableRatio counts common Chinese typographic punctuation', () => {
    it('treats curly quotes / ellipsis / em-dash as printable', () => {
      // These live in General Punctuation (U+2000–206F) and were previously
      // excluded, dragging dialogue-heavy novels below the confident threshold.
      expect(_internals.printableRatio('“”‘’……——')).toBe(1);
    });

    it('treats CJK compatibility (vertical) punctuation forms as printable', () => {
      expect(_internals.printableRatio('﹁﹂﹃﹄')).toBe(1);
    });

    it('treats Japanese kana as printable', () => {
      expect(_internals.printableRatio('ひらがなカタカナ')).toBe(1);
    });

    it('treats no-break space as printable', () => {
      expect(_internals.printableRatio('第一章  测试')).toBe(1);
    });

    it('still rates random bytes far below the garbled threshold', () => {
      // Regression guard: the broader whitelist must NOT let real garbage pass.
      const buf = require('fs').readFileSync(path.join(FIX_DIR, 'garbled-random.txt'));
      const ratios = ['utf-8', 'gbk', 'big5'].map((e) =>
        _internals.printableRatio(require('iconv-lite').decode(buf, e)),
      );
      for (const r of ratios) expect(r).toBeLessThan(_internals.SUSPICIOUS_RATIO);
    });
  });
});
