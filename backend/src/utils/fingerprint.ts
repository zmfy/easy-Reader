import fs from 'fs';
import crypto from 'crypto';
import { TxtParser } from '../plugins/parser-txt';

export interface Fingerprint {
  fingerprint: string;
  first_chapter_hash: string;
  chapter_count: number;
  file_size: number;
}

const FIRST_CHAPTER_PREVIEW_CHARS = 500;

/**
 * Compute a deterministic fingerprint of a book file.
 * Currently only txt is fully supported; epub/pdf fallback to size+sha1(head).
 */
export async function computeFingerprint(
  filePath: string,
  format: string,
): Promise<Fingerprint> {
  const stat = await fs.promises.stat(filePath);

  if (format === 'txt') {
    return computeTxtFingerprint(filePath, stat.size);
  }
  return computeGenericFingerprint(filePath, stat.size);
}

async function computeTxtFingerprint(filePath: string, fileSize: number): Promise<Fingerprint> {
  const parser = new TxtParser();
  await parser.load(filePath);
  const chapters = await parser.getChapters();

  let firstContent = '';
  if (chapters.length > 0) {
    const html = await parser.getChapterContent(0);
    // Strip <p> tags
    firstContent = html.replace(/<[^>]+>/g, '').trim();
  }

  const previewText = firstContent.slice(0, FIRST_CHAPTER_PREVIEW_CHARS).trim();
  const firstChapterHash = sha1(previewText);
  const fingerprint = sha1(`${chapters.length}_${fileSize}_${firstChapterHash}`);

  return {
    fingerprint,
    first_chapter_hash: firstChapterHash,
    chapter_count: chapters.length,
    file_size: fileSize,
  };
}

async function computeGenericFingerprint(filePath: string, fileSize: number): Promise<Fingerprint> {
  // Read first 64KB to hash
  const buf = Buffer.alloc(Math.min(64 * 1024, fileSize));
  const fd = await fs.promises.open(filePath, 'r');
  try {
    await fd.read(buf, 0, buf.length, 0);
  } finally {
    await fd.close();
  }
  const headHash = sha1(buf);
  return {
    fingerprint: sha1(`0_${fileSize}_${headHash}`),
    first_chapter_hash: headHash,
    chapter_count: 0,
    file_size: fileSize,
  };
}

function sha1(input: string | Buffer): string {
  return crypto.createHash('sha1').update(input).digest('hex');
}
