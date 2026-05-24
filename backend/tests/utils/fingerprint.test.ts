import path from 'path';
import { computeFingerprint } from '../../src/utils/fingerprint';

const FIX = path.join(__dirname, '__fixtures__/fingerprint');

describe('computeFingerprint (txt)', () => {
  it('returns deterministic fingerprint for same content', async () => {
    const a = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    const a2 = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    expect(a.fingerprint).toBe(a2.fingerprint);
  });

  it('returns same fingerprint for identical content', async () => {
    const a = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    const b = await computeFingerprint(path.join(FIX, 'book-b.txt'), 'txt');
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.first_chapter_hash).toBe(b.first_chapter_hash);
  });

  it('returns different fingerprint for different content', async () => {
    const a = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    const c = await computeFingerprint(path.join(FIX, 'book-c.txt'), 'txt');
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it('returns same first_chapter_hash for files with same chapter 1 but different rest', async () => {
    const a = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    const c = await computeFingerprint(path.join(FIX, 'book-c.txt'), 'txt');
    expect(a.first_chapter_hash).toBe(c.first_chapter_hash);
  });

  it('returns positive chapter_count', async () => {
    const a = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    expect(a.chapter_count).toBeGreaterThan(0);
  });
});
