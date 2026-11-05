import fs from 'fs';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import { ReaderPlugin } from '../types';
import { escapeHtml } from '../utils/html';

interface ChapterMeta {
  index: number;
  title: string;
  startByte: number;
  endByte: number;
  /** 标题之后是否有正文（只有标题的「第 X 卷」是分卷标题） */
  hasBody?: boolean;
  /** 从本章开始的「第 X 部 名称」分组（这类行不算章节，只用于目录分组） */
  partTitle?: string;
}

function detectEncoding(filePath: string): string {
  const stat = fs.statSync(filePath);
  // 采样越大，chardet 对中文(尤其开头有大段 ASCII)的判断越准
  const sampleSize = Math.min(64 * 1024, stat.size);
  const fd = fs.openSync(filePath, 'r');
  const sample = Buffer.alloc(sampleSize);
  fs.readSync(fd, sample, 0, sampleSize, 0);
  fs.closeSync(fd);

  const detected = chardet.detect(sample) || 'UTF-8';
  const enc = detected.toLowerCase();

  if (enc.includes('utf-16') || enc.includes('utf16')) {
    // UTF-16: byte-offset chapter scanning is unsafe here (CJK code units can
    // contain a 0x0a low byte, and LF is a 2-byte unit), so callers transcode
    // these to UTF-8 in memory before scanning.
    return enc.includes('be') ? 'utf-16be' : 'utf-16le';
  }
  if (enc.includes('gb') || enc === 'big5') {
    // gb2312 / gbk / gb18030 / big5 — all handled by gb18030 (superset)
    return enc.includes('big5') ? 'big5' : 'gb18030';
  }
  // default to utf8 for everything else
  return 'utf8';
}

const PREVIEW_BYTES = 64 * 1024;

/**
 * Read the first `maxChars` characters of a TXT file, decoded with the detected
 * encoding. Only the first 64KB is read, so it is safe to call on huge files.
 */
export function readTxtPreview(filePath: string, maxChars: number): string {
  try {
    const encoding = detectEncoding(filePath);
    const size = Math.min(PREVIEW_BYTES, fs.statSync(filePath).size);
    const buffer = Buffer.alloc(size);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, size, 0);
    } finally {
      fs.closeSync(fd);
    }
    // The 64KB cut may split the last character; drop the resulting U+FFFD.
    return iconv.decode(buffer, encoding).replace(/^\uFEFF/, '').replace(/\uFFFD+$/, '').slice(0, maxChars);
  } catch {
    return '';
  }
}

const SEPARATOR_LINE_RE = /^[=＝\-－_*＊~～#＃─━·]{5,}$/;
const URL_RE = /https?:\/\/|www\.|[a-z0-9-]+\.(com|cn|net|org|me|cc|top|xyz|info|vip|la|co)\b/i;
const PROMO_RE = /尽在.{0,15}下载|免费.{0,6}(txt|小说)|txt小说|小说下载|资源库|喜欢的就?去看看/i;

/**
 * 第一个章节标题之前常见的盗版站推广：网址、「更多小说尽在…下载」、分隔线。
 * 只用于前言（书名 / 作者 / 简介所在部分），章节正文不过滤。
 */
export function isPreambleAdLine(line: string): boolean {
  const text = line.replace(/\s+/g, '');
  if (!text) return false;
  return SEPARATOR_LINE_RE.test(text) || URL_RE.test(text) || PROMO_RE.test(text);
}

const compact = (s: string) => s.replace(/\s+/g, '');

/**
 * 标题里全部的「第 X 卷 / 章 / 回」编号，如「第二回史大郎…」→「第二回」、
 * 「第十卷魔界之战第两千一百三十章斗兽」→「第十卷第两千一百三十章」
 */
const headingNumber = (title: string) =>
  (title.match(/第[零〇一二两三四五六七八九十百千万\d]+[章节卷集回]/g) ?? []).join('');

/**
 * 章节开头重复的标题只留一份：完整的标题行，或拆成「第二回」「史大郎…」几行、
 * 拼起来等于标题的部分都算重复。留下的一份由阅读器标题区去重隐藏。
 */
export function dropRepeatedTitle(paragraphs: string[], title: string): string[] {
  const t = compact(title);
  if (!t) return paragraphs;
  let acc = '';
  let consumed = 0;   // 到最后一份完整标题为止的段落数
  for (let i = 0; i < paragraphs.length; i++) {
    const p = compact(paragraphs[i]);
    if (p === t) { consumed = i + 1; acc = ''; continue; }
    if (t.startsWith(acc + p)) {
      acc += p;
      if (acc === t) { consumed = i + 1; acc = ''; }
      continue;
    }
    break;
  }
  if (consumed <= 1 && compact(paragraphs[0] ?? '') === t) return paragraphs;
  return consumed > 0 ? [title, ...paragraphs.slice(consumed)] : paragraphs;
}

export class TxtParser implements ReaderPlugin {
  format = 'txt';
  private filePath = '';
  private chapters: ChapterMeta[] = [];
  private fileSize = 0;
  private encoding = 'utf8';
  /**
   * When the source file is UTF-16, it is transcoded to UTF-8 once at load
   * time and kept here. All byte offsets and reads then operate on this buffer
   * instead of the file on disk, so the rest of the parser stays UTF-8-only.
   */
  private memBuffer: Buffer | null = null;
  /**
   * End byte of visible text before the first chapter header (book title,
   * intro, preface), or 0 if there is none. Shown at the top of chapter 0 when
   * reading; chapter boundaries and fingerprint input are left unchanged.
   */
  private leadingTextEnd = 0;

  async load(filePath: string): Promise<void> {
    this.filePath = filePath;
    this.fileSize = fs.statSync(filePath).size;
    const detected = detectEncoding(filePath);

    if (detected === 'utf-16le' || detected === 'utf-16be') {
      const raw = fs.readFileSync(filePath);
      this.memBuffer = Buffer.from(iconv.decode(raw, detected), 'utf8');
      this.fileSize = this.memBuffer.length;
      this.encoding = 'utf8';
    } else {
      this.encoding = detected;
    }

    await this.scanChapters();
  }

  /**
   * Stream through the file in 256KB chunks to find chapter boundaries.
   * Only byte offsets are stored — no full content in memory.
   */
  private scanChapters(): Promise<void> {
    // 章 / 节 / 卷 / 集，以及古典章回体小说的「回」（如《西游记》「第一回 灵根育孕源流出」）
    const chapterPattern = /^第[零一二三四五六七八九十百千万\d]+[章节卷集回]/;
    const chapters: ChapterMeta[] = [];
    const encoding = this.encoding;
    // Fallback segmenting (used only when no chapter headers are found):
    // remember a line start roughly every SEGMENT bytes, so segments never cut
    // through a multi-byte character. 0x0a never occurs inside a UTF-8 /
    // GB18030 / Big5 multi-byte sequence, so any line start is a safe boundary.
    const SEGMENT = 100 * 1024;
    const segmentStarts: number[] = [0];

    return new Promise((resolve, reject) => {
      let processedBytes = 0;
      let remainder = Buffer.alloc(0);
      // 当前章节标题之后是否出现过正文
      let sawBody = false;
      // 「第 X 部 名称」（编号后有空格，排除「第一部总结」「第二部分是…」这类正文）
      const partPattern = /^第[零〇一二两三四五六七八九十百千万\d]+部\s+\S/;
      let pendingPart: string | null = null;

      const checkLine = (lineBuffer: Buffer, absoluteStart: number) => {
        if (absoluteStart - segmentStarts[segmentStarts.length - 1] >= SEGMENT) {
          segmentStarts.push(absoluteStart);
        }
        const lineText = iconv.decode(lineBuffer, encoding).trim();
        if (chapterPattern.test(lineText) && lineText.length < 60) {
          const prev = chapters[chapters.length - 1];
          if (prev && !sawBody && headingNumber(prev.title) === headingNumber(lineText)) {
            // 上一个标题之后没有正文，又是同一编号的标题（网页抓取的书常把每回标题写两遍：
            // 「第二回史大郎…」+「第二回」「史大郎…」），并为一章，保留较完整的标题。
            // 编号不同（如「第七卷 倒吊人」后接「第一章 欢迎」）仍各自成章
            if (lineText.length > prev.title.length) prev.title = lineText;
            return;
          }
          if (prev) {
            prev.endByte = absoluteStart;
            prev.hasBody = sawBody;
          }
          sawBody = false;
          chapters.push({
            index: chapters.length,
            title: lineText,
            startByte: absoluteStart,
            endByte: this.fileSize,
            ...(pendingPart ? { partTitle: pendingPart } : {}),
          });
          pendingPart = null;
        } else if (partPattern.test(lineText) && lineText.length < 30) {
          // 「第一部 小丑」：记为下一章开始的分组，不拆章节（章节序号、阅读进度不变）
          pendingPart = lineText;
        } else if (lineText) {
          sawBody = true;
        }
      };

      const finalize = () => {
        if (chapters.length === 0 && this.fileSize > 0) {
          // No chapter headers found — split into ~100KB segments on line starts
          segmentStarts.forEach((start, num) => {
            chapters.push({
              index: num,
              title: `第 ${num + 1} 段`,
              startByte: start,
              endByte: segmentStarts[num + 1] ?? this.fileSize,
            });
          });
        }

        if (chapters.length > 0) chapters[chapters.length - 1].hasBody = sawBody;
        this.chapters = chapters;
        const firstStart = chapters[0]?.startByte ?? 0;
        this.leadingTextEnd = firstStart > 0 && this.hasVisiblePreamble(firstStart) ? firstStart : 0;
        resolve();
      };

      // UTF-16 sources are already transcoded to a UTF-8 buffer in memory;
      // scan that directly instead of re-reading the (still UTF-16) file.
      if (this.memBuffer) {
        const data = this.memBuffer;
        let searchFrom = 0;
        let nlPos: number;
        while ((nlPos = data.indexOf(0x0a, searchFrom)) !== -1) {
          checkLine(data.slice(searchFrom, nlPos), searchFrom);
          searchFrom = nlPos + 1;
        }
        if (searchFrom < data.length) {
          checkLine(data.slice(searchFrom), searchFrom);
        }
        finalize();
        return;
      }

      const stream = fs.createReadStream(this.filePath, { highWaterMark: 256 * 1024 });

      stream.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
        const data = Buffer.concat([remainder, buf]);

        let searchFrom = 0;
        let nlPos: number;

        while ((nlPos = data.indexOf(0x0a, searchFrom)) !== -1) {
          const lineBytes = data.slice(searchFrom, nlPos);
          checkLine(lineBytes, processedBytes + searchFrom);
          searchFrom = nlPos + 1;
        }

        processedBytes += searchFrom;
        remainder = data.slice(searchFrom);
      });

      stream.on('end', () => {
        if (remainder.length > 0) {
          checkLine(remainder, processedBytes);
        }
        finalize();
      });

      stream.on('error', reject);
    });
  }

  async getChapters(): Promise<Array<{ index: number; title: string; level?: number; groupTitle?: string }>> {
    // 分卷标题：「第 X 卷」开头、不含章 / 回编号、且只有标题没有正文
    const isVolume = (c: ChapterMeta) =>
      /^第[零〇一二两三四五六七八九十百千万\d]+卷/.test(c.title) && !/[章节回集]/.test(headingNumber(c.title)) && !c.hasBody;
    if (!this.chapters.some(c => c.partTitle || isVolume(c))) {
      return this.chapters.map(c => ({ index: c.index, title: c.title }));
    }
    // 目录分两层：分卷标题 / 「第 X 部」分组在 0 层，其下章节在 1 层（第一个分组之前的章节仍为 0 层）。
    // groupTitle：从这一章开始的「第 X 部」分组标题，由前端显示为不可跳转的分组行
    let inGroup = false;
    return this.chapters.map(c => {
      if (isVolume(c)) {
        inGroup = true;
        return { index: c.index, title: c.title, level: 0 };
      }
      if (c.partTitle) {
        inGroup = true;
        return { index: c.index, title: c.title, level: 1, groupTitle: c.partTitle };
      }
      return { index: c.index, title: c.title, level: inGroup ? 1 : 0 };
    });
  }

  /**
   * Read only the bytes for the requested chapter — no full-file load.
   */
  async getChapterContent(index: number): Promise<string> {
    if (this.chapters.length === 0) return '';
    const chapter = this.chapters[index];
    if (!chapter) throw new Error(`章节 ${index} 不存在`);
    const body = this.toHtml(dropRepeatedTitle(this.paragraphs(chapter.startByte, chapter.endByte), chapter.title));
    // 第 0 章带上第一个标题之前的书名 / 简介 / 前言（去掉推广行）
    if (index === 0 && this.leadingTextEnd > 0) {
      const preamble = this.paragraphs(0, this.leadingTextEnd).filter(p => !isPreambleAdLine(p));
      return [this.toHtml(preamble), body].filter(Boolean).join('\n');
    }
    return body;
  }

  /**
   * Chapter content starting at its header, WITHOUT the leading text merged
   * into chapter 0. Used for fingerprints so they stay identical to those
   * computed before leading text was shown (no forced full rescan).
   */
  async getChapterContentForFingerprint(index: number): Promise<string> {
    if (this.chapters.length === 0) return '';
    const chapter = this.chapters[index];
    if (!chapter) throw new Error(`章节 ${index} 不存在`);
    return this.renderRange(chapter.startByte, chapter.endByte);
  }

  private readRange(start: number, end: number): string {
    const byteLength = end - start;
    if (byteLength <= 0) return '';
    const buffer = Buffer.alloc(byteLength);
    if (this.memBuffer) {
      this.memBuffer.copy(buffer, 0, start, end);
    } else {
      const fd = fs.openSync(this.filePath, 'r');
      try {
        fs.readSync(fd, buffer, 0, byteLength, start);
      } finally {
        fs.closeSync(fd);
      }
    }
    return iconv.decode(buffer, this.encoding);
  }

  private paragraphs(start: number, end: number): string[] {
    return this.readRange(start, end).split(/\r?\n+/).filter((p: string) => p.trim());
  }

  private toHtml(paragraphs: string[]): string {
    return paragraphs.map((p: string) => `<p>${escapeHtml(p.trim())}</p>`).join('\n');
  }

  private renderRange(start: number, end: number): string {
    return this.toHtml(this.paragraphs(start, end));
  }

  /** 第一个标题之前是否有去掉推广行后仍可见的文字 */
  private hasVisiblePreamble(end: number): boolean {
    return this.paragraphs(0, Math.min(end, 64 * 1024)).some(p => !isPreambleAdLine(p));
  }

  async getTotalProgress(): Promise<number> {
    return this.chapters.length;
  }

  async getProgress(): Promise<number> {
    return 0;
  }
}
