import path from 'path';
import { isPathInsideRoot } from '../../src/utils/path-safe';

describe('isPathInsideRoot', () => {
  it('returns true for path inside root', () => {
    expect(isPathInsideRoot('/app/books', '/app/books/foo.txt')).toBe(true);
    expect(isPathInsideRoot('/app/books', '/app/books/sub/foo.txt')).toBe(true);
  });

  it('returns false for path traversal attempt', () => {
    expect(isPathInsideRoot('/app/books', '/app/books/../etc/passwd')).toBe(false);
    expect(isPathInsideRoot('/app/books', '/app/secrets/foo')).toBe(false);
  });

  it('returns false for root path itself (must be strictly inside)', () => {
    expect(isPathInsideRoot('/app/books', '/app/books')).toBe(false);
  });

  it('handles trailing slash in root', () => {
    expect(isPathInsideRoot('/app/books/', '/app/books/foo.txt')).toBe(true);
  });
});

import fs from 'fs';
import os from 'os';
import { resolveRealPathInsideRoot } from '../../src/utils/path-safe';

describe('resolveRealPathInsideRoot', () => {
  let base: string;
  let root: string;
  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'realpath-'));
    root = path.join(base, 'books');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'a.txt'), 'x');
    fs.writeFileSync(path.join(base, 'secret.txt'), 'x');
    fs.symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'link.txt'));
  });
  afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

  it('returns the real path for a file inside root', () => {
    expect(resolveRealPathInsideRoot(root, path.join(root, 'a.txt'))).toBe(fs.realpathSync(path.join(root, 'a.txt')));
  });
  it('rejects a file outside root', () => {
    expect(resolveRealPathInsideRoot(root, path.join(base, 'secret.txt'))).toBeNull();
  });
  it('rejects a symlink inside root that points outside', () => {
    expect(resolveRealPathInsideRoot(root, path.join(root, 'link.txt'))).toBeNull();
  });
  it('rejects a missing file', () => {
    expect(resolveRealPathInsideRoot(root, path.join(root, 'nope.txt'))).toBeNull();
  });
});
