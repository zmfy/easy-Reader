import fs from 'fs';
import iconv from 'iconv-lite';

export type EncodingStatus = 'normal' | 'encoding_fixed' | 'garbled';

export interface EncodingResult {
  status: EncodingStatus;
  encoding: string;
}

const SAMPLE_BYTES = 64 * 1024; // 只读前 64KB 来检测（避免大文件慢）
const CHINESE_THRESHOLD = 0.5;  // 真乱码阈值

/**
 * Detect file encoding. If non-UTF-8 but recognizable, overwrite as UTF-8.
 */
export async function detectAndFixEncoding(filePath: string): Promise<EncodingResult> {
  const fullBuf = await fs.promises.readFile(filePath);
  const sample = fullBuf.length > SAMPLE_BYTES ? fullBuf.subarray(0, SAMPLE_BYTES) : fullBuf;

  // Level 1: try UTF-8
  const utf8Text = tryDecode(sample, 'utf-8');
  if (utf8Text !== null && printableRatio(utf8Text) >= 0.95) {
    return { status: 'normal', encoding: 'utf-8' };
  }

  // Level 2: try GBK / GB18030 / BIG5
  // Note: gbk is tried before gb18030 so that GBK-encoded files are reported as 'gbk'
  // (gb18030 is a superset of gbk and would match either, but gbk is more specific)
  for (const enc of ['gbk', 'gb18030', 'big5']) {
    const text = tryDecode(sample, enc);
    if (text !== null && printableRatio(text) >= 0.95) {
      // Re-decode the full file and overwrite
      const fullText = iconv.decode(fullBuf, enc);
      await fs.promises.writeFile(filePath, fullText, 'utf-8');
      return { status: 'encoding_fixed', encoding: enc };
    }
  }

  // Level 3: garbled
  // Compute against the best decoding we got
  return { status: 'garbled', encoding: 'unknown' };
}

function tryDecode(buf: Buffer, encoding: string): string | null {
  try {
    const text = iconv.decode(buf, encoding);
    // iconv-lite always returns a string — even if it's gibberish.
    // So we judge by printableRatio externally.
    return text;
  } catch {
    return null;
  }
}

/**
 * Ratio of "printable" characters (CJK, punctuation, ASCII letters/digits/whitespace)
 * over total chars in the text. Random bytes → ratio approaches 0.
 */
function printableRatio(text: string): number {
  if (text.length === 0) return 0;
  let good = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      // CJK Unified Ideographs + Extensions
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      // CJK punctuation
      (code >= 0x3000 && code <= 0x303f) ||
      // Fullwidth Forms
      (code >= 0xff00 && code <= 0xffef) ||
      // ASCII printable + tab/newline
      (code >= 0x20 && code <= 0x7e) ||
      code === 0x09 || code === 0x0a || code === 0x0d
    ) {
      good++;
    }
  }
  return good / text.length;
}

// Exported for testing
export const _internals = { printableRatio, CHINESE_THRESHOLD };
