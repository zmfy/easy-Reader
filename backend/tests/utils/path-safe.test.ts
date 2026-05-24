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
