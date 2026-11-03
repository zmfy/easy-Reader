import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectAndFixEncoding } from '../../src/utils/encoding';

const FIX_DIR = path.join(__dirname, '__fixtures__/encoding');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('detectAndFixEncoding atomic rewrite', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enc-atomic-')); });
  afterEach(() => {
    fs.chmodSync(dir, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function copyFixture(name: string, mode = 0o640): string {
    const p = path.join(dir, name);
    fs.copyFileSync(path.join(FIX_DIR, name), p);
    fs.chmodSync(p, mode);
    return p;
  }

  it('rewrites as UTF-8, keeps file mode, and leaves no temp file behind', async () => {
    const p = copyFixture('gbk-fixable.txt', 0o640);
    const r = await detectAndFixEncoding(p);
    expect(r.status).toBe('encoding_fixed');
    expect(fs.readFileSync(p, 'utf-8')).toContain('第一章');
    expect(fs.statSync(p).mode & 0o777).toBe(0o640);
    expect(fs.readdirSync(dir)).toEqual(['gbk-fixable.txt']);
  });

  (isRoot ? it.skip : it)('leaves the original file intact when the rewrite cannot complete', async () => {
    const p = copyFixture('gbk-fixable.txt');
    const original = fs.readFileSync(p);
    fs.chmodSync(dir, 0o555); // cannot create the temp file next to it
    await expect(detectAndFixEncoding(p)).rejects.toThrow();
    expect(fs.readFileSync(p).equals(original)).toBe(true);
  });

  it('does not touch UTF-8 files', async () => {
    const p = copyFixture('utf8-normal.txt');
    const before = fs.statSync(p).mtimeMs;
    const r = await detectAndFixEncoding(p);
    expect(r.status).toBe('normal');
    expect(fs.statSync(p).mtimeMs).toBe(before);
  });
});
