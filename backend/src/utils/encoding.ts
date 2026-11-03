import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';

export type EncodingStatus = 'normal' | 'encoding_fixed' | 'garbled' | 'uncertain';

export interface EncodingResult {
  status: EncodingStatus;
  encoding: string;
  /** When status='uncertain', a sample of the best-decoded text for AI review. */
  sample?: string;
  /** Best ratio observed across all encoding attempts. */
  best_ratio?: number;
}

const SAMPLE_BYTES = 64 * 1024;
const CONFIDENT_RATIO = 0.95;     // 高于此 = 一定是正常文本
const SUSPICIOUS_RATIO = 0.7;     // 介于此与 CONFIDENT 之间 = 灰色区，需要 AI 复核
// 低于 SUSPICIOUS_RATIO = 确定乱码（不必请 AI）

async function readSample(filePath: string): Promise<Buffer> {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(SAMPLE_BYTES);
    const { bytesRead } = await fd.read(buf, 0, SAMPLE_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}

/**
 * Replace a user's book file with a UTF-8 transcoding of it, atomically:
 * write a temp file next to it, fsync, then rename over the original. A crash
 * mid-write leaves the original untouched instead of truncated. Mode and
 * (when permitted) owner are carried over, so a NAS file doesn't silently
 * become root-owned just because the container runs as root.
 */
async function rewriteAsUtf8(filePath: string, encoding: string): Promise<void> {
  const original = await fs.promises.stat(filePath);
  const text = iconv.decode(await fs.promises.readFile(filePath), encoding);
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const fd = await fs.promises.open(tmpPath, 'wx', original.mode & 0o777);
    try {
      await fd.writeFile(text, 'utf-8');
      await fd.sync();
    } finally {
      await fd.close();
    }
    await fs.promises.chmod(tmpPath, original.mode & 0o777);
    await fs.promises.chown(tmpPath, original.uid, original.gid).catch(() => { /* not permitted as non-root */ });
    await fs.promises.rename(tmpPath, filePath);
  } catch (err) {
    await fs.promises.unlink(tmpPath).catch(() => { /* temp file may not exist */ });
    throw err;
  }
}

/**
 * Detect file encoding. If non-UTF-8 but recognizable, overwrite as UTF-8.
 * Three-tier classification:
 *   ratio >= 0.95          → confident normal / encoding_fixed
 *   0.7 <= ratio < 0.95    → "uncertain" — caller should ask AI to verify
 *   ratio < 0.7            → confident garbled (no AI needed)
 */
export async function detectAndFixEncoding(filePath: string): Promise<EncodingResult> {
  // Only the first 64KB is needed to classify; the whole file is read only when it must be rewritten
  const sample = await readSample(filePath);

  // Level 0: UTF-16 BOM is unambiguous. The byte-ratio path below would
  // misjudge UTF-16 (its interleaved 0x00 bytes drag every 8-bit decode into
  // the gray zone → "uncertain"), so detect it here and transcode to UTF-8,
  // matching parser-txt's encoding handling. iconv strips the BOM on decode.
  const bomEnc =
    sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe
      ? 'utf-16le'
      : sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff
        ? 'utf-16be'
        : null;
  if (bomEnc) {
    await rewriteAsUtf8(filePath, bomEnc);
    return { status: 'encoding_fixed', encoding: bomEnc };
  }

  // Level 1: try UTF-8
  const utf8Text = tryDecode(sample, 'utf-8');
  const utf8Ratio = utf8Text !== null ? printableRatio(utf8Text) : 0;
  if (utf8Text !== null && utf8Ratio >= CONFIDENT_RATIO) {
    return { status: 'normal', encoding: 'utf-8' };
  }

  // Level 2: try GBK / GB18030 / BIG5
  let bestEnc = 'utf-8';
  let bestText = utf8Text;
  let bestRatio = utf8Ratio;
  for (const enc of ['gbk', 'gb18030', 'big5']) {
    const text = tryDecode(sample, enc);
    if (text === null) continue;
    const r = printableRatio(text);
    if (r >= CONFIDENT_RATIO) {
      // confident — fix immediately
      await rewriteAsUtf8(filePath, enc);
      return { status: 'encoding_fixed', encoding: enc };
    }
    if (r > bestRatio) {
      bestRatio = r;
      bestText = text;
      bestEnc = enc;
    }
  }

  // Level 3: uncertain or definitely garbled
  if (bestRatio >= SUSPICIOUS_RATIO && bestText) {
    // Gray zone — let the caller decide (typically via AI verification)
    return {
      status: 'uncertain',
      encoding: bestEnc,
      sample: bestText.slice(0, 512),
      best_ratio: bestRatio,
    };
  }
  return { status: 'garbled', encoding: 'unknown', best_ratio: bestRatio };
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
      // CJK punctuation + Hiragana + Katakana (U+3040-30FF) — novels set in
      // Japan carry plenty of kana, which is legitimate text.
      (code >= 0x3000 && code <= 0x30ff) ||
      // General Punctuation — Chinese novels are dense with these: curly
      // quotes “”‘’ (U+2018-201D), ellipsis … (U+2026), em/en dash —– .
      // Omitting them dragged dialogue-heavy GBK books below the confident
      // ratio and got them misclassified as garbled.
      (code >= 0x2000 && code <= 0x206f) ||
      // CJK Compatibility Forms — vertical-text punctuation ﹁﹂﹃﹄ etc.
      (code >= 0xfe10 && code <= 0xfe4f) ||
      // Fullwidth Forms
      (code >= 0xff00 && code <= 0xffef) ||
      // ASCII printable + tab/newline
      (code >= 0x20 && code <= 0x7e) ||
      // No-break space (U+00A0) — some files use it for indentation.
      code === 0xa0 ||
      code === 0x09 || code === 0x0a || code === 0x0d
    ) {
      good++;
    }
  }
  return good / text.length;
}

// Exported for testing
export const _internals = { printableRatio, CONFIDENT_RATIO, SUSPICIOUS_RATIO };
