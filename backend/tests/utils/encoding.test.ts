import fs from 'fs';
import path from 'path';
import { detectAndFixEncoding } from '../../src/utils/encoding';

const FIX_DIR = path.join(__dirname, '__fixtures__/encoding');

describe('detectAndFixEncoding', () => {
  // Snapshot original bytes so we can restore (since the function may overwrite)
  const backups = new Map<string, Buffer>();
  beforeAll(() => {
    for (const f of fs.readdirSync(FIX_DIR)) {
      if (f.endsWith('.txt')) {
        const p = path.join(FIX_DIR, f);
        backups.set(p, fs.readFileSync(p));
      }
    }
  });
  afterEach(() => {
    for (const [p, buf] of backups) fs.writeFileSync(p, buf);
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

  it('flags random garbage as garbled', async () => {
    const r = await detectAndFixEncoding(path.join(FIX_DIR, 'garbled-random.txt'));
    expect(r.status).toBe('garbled');
  });
});
