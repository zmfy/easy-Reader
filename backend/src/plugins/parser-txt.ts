import fs from 'fs';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import { ReaderPlugin } from '../types';
import { escapeHtml } from '../utils/html';

type TocEntry = { index: number; title: string; level?: number; groupTitle?: string };

interface ChapterMeta {
  index: number;
  title: string;
  startByte: number;
  endByte: number;
  /** 标题之后是否有正文（只有标题的「第 X 卷」是分卷标题） */
  hasBody?: boolean;
  /** 从本章开始的「第 X 部 名称」分组（这类行不算章节，只用于目录分组） */
  partTitle?: string;
  /** 并入本章的同编号标题行（如「第5章 …」后面的「第0005章…」），读正文时去掉 */
  mergedHeadings?: string[];
  /** 本章正文里有卷末说明（「第二卷《山水郎》结束。」）：之后的章节不再归入这一卷 */
  endsVolume?: boolean;
}

export function detectEncoding(filePath: string): string {
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

/** 文件开头 64KB 里有 CR、没有 LF：只用 CR 换行 */
function isCrOnly(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(PREVIEW_BYTES);
    const n = fs.readSync(fd, buf, 0, PREVIEW_BYTES, 0);
    const head = buf.subarray(0, n);
    return head.includes(0x0d) && !head.includes(0x0a);
  } finally {
    fs.closeSync(fd);
  }
}

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

/**
 * 以「第X章 / 回…」开头、但其实是正文句子的行（如《社戏》「第一回是民国元年我初到北京的时候，当时一个朋友对我说，北京戏」）。
 * 标题里可能有问号、感叹号（「第二十七章 赌运气？」）、结尾句号（「第一千一百三十九章神念附灵。」）、
 * 甚至两个逗号（「第二百一十四章 一个恩赐，或者，一个诅咒」），所以只认更像正文的三种：
 * 句号后面还有字；两个以上逗号且整行较长；有逗号又以句号结尾。
 */
export function looksLikeSentence(line: string): boolean {
  const text = line.trim();
  return /。\s*\S/.test(text) || ((text.match(/，/g)?.length ?? 0) >= 2 && text.length > 25)
    // 有逗号又以句号结尾（「第一回跟皇帝老爷打交道，钱俊说话都不利索了。」）
    || (text.includes('，') && /。$/.test(text));
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

/** 标题末尾作者求票等附言：「第0118章 医术高人【求月票！！…】」「第0006章挡箭牌【有推荐票的，请不吝投几张，谢谢！】」 */
const TITLE_PROMO_RE = /\s*[【\[〔（(][^】\]〕）)]*(?:票|加更|[一二三四五六七八九十\d]更|收藏|订阅|打赏|推荐|码字|存稿)[^】\]〕）)]*[】\]〕）)]\s*$/;

/** 去掉标题末尾的求票附言（去掉后为空时保留原文）；只用于判断标题和目录显示，章节内容不变 */
export function stripTitlePromo(title: string): string {
  return title.replace(TITLE_PROMO_RE, '').trim() || title;
}

/** 标题最多 60 字（UTF-8 一字最多 4 字节）再加缩进；字节数超过这个值的行不可能是标题，不解码，直接算正文 */
const MAX_HEADING_BYTES = 400;
/**
 * 可能是标题 / 分组 / 分隔线的行首（headingKey、各标题正则能识别的写法都以这些开头）。
 * 大文件加载时绝大多数正文行在这里就被排除，不再跑后面较慢的正则
 */
const HEADING_START_RE = /^(?:正文|第|[【［\[〔（(]|chapter|楔子|序|引子|前言|尾声|后记|终章|番外)/i;
const SEPARATOR_START_RE = /^[=＝\-－_*＊~～#＃─━·]/;
/** 卷末说明：「第二卷《山水郎》结束。」「第一卷 完」——是正文，不是分卷标题 */
const VOLUME_END_RE = /^第[零〇一二两三四五六七八九十百千万\d]+卷[^章节回集]*(结束|完结|终了|完)[。！!.]*$/;

/**
 * UTF-8 行首第一个字符的字节（编成一个整数），只包含 HEADING_START_RE / SEPARATOR_START_RE 可能匹配的字符。
 * UTF-8 文件（扫描时 GBK 等都会被改写成 UTF-8）可以不解码就排除绝大多数正文行
 */
const UTF8_CANDIDATE_STARTS = new Set(
  [...'正第【［[〔（(cC楔序引前尾后终番=＝-－_*＊~～#＃─━·'].map(ch => utf8CharKey(Buffer.from(ch, 'utf8'), 0)),
);

/** buf[i] 开始的一个 UTF-8 字符的字节编成整数（最多 3 字节，够区分上面的字符） */
function utf8CharKey(buf: Buffer, i: number): number {
  const b = buf[i];
  if (b < 0x80) return b;
  if (b < 0xe0) return (b << 8) | buf[i + 1];
  return (b << 16) | (buf[i + 1] << 8) | buf[i + 2];
}

/** 跳过 UTF-8 行首空白（空格、制表符、CR、不换行空格、全角空格、BOM），返回第一个非空白字节的位置 */
function skipUtf8Space(buf: Buffer, i: number, end: number): number {
  while (i < end) {
    const b = buf[i];
    if (b === 0x20 || b === 0x09 || b === 0x0d) i++;
    else if (b === 0xc2 && buf[i + 1] === 0xa0) i += 2;
    else if (b === 0xe3 && buf[i + 1] === 0x80 && buf[i + 2] === 0x80) i += 3;
    else if (b === 0xef && buf[i + 1] === 0xbb && buf[i + 2] === 0xbf) i += 3;
    else break;
  }
  return i;
}

/**
 * 标题里全部的「第 X 卷 / 章 / 回」编号，如「第二回史大郎…」→「第二回」、
 * 「第十卷魔界之战第两千一百三十章斗兽」→「第十卷第两千一百三十章」
 */
/**
 * 判断标题用的规范化文字：全角数字转半角，去掉开头的「正文」和包住编号的括号
 * （「正文 第一章 …」「【第一章】…」「第１２章」与「第一章 …」「第12章」同样处理）。标题本身显示原文
 */
export function headingKey(line: string): string {
  return line
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/^正文[\s　:：]*/, '')
    .replace(/^[【［\[〔（(]\s*(第[^】］\]〕）)]{1,12}?[章节卷集回])\s*[】］\]〕）)]/, '$1 ');
}

/** 英文「Chapter 1」「CHAPTER IV」「Chapter One」 */
const ENGLISH_CHAPTER_RE = /^chapter\s+(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i;
/** 没有编号的特殊章节：楔子、序章、番外、后记等（整行就是它，或后面跟分隔符和标题） */
const SPECIAL_CHAPTER_RE = /^(楔子|序章|序言|序幕|引子|前言|尾声|后记|终章|番外[篇\d一二三四五六七八九十]*)(?=$|[\s　:：·．.、\-—])/;

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** 编号转成数值：「0005」「５」「五」「十二」「两千一百三十」 */
export function chapterNumberValue(num: string): number {
  if (/^\d+$/.test(num)) return parseInt(num, 10);
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of num) {
    if (ch in CN_DIGITS) { digit = CN_DIGITS[ch]; continue; }
    const unit = CN_UNITS[ch];
    if (!unit) return NaN;
    if (unit === 10000) { total += (section + digit) * unit; section = 0; }
    else section += (digit || (unit === 10 ? 1 : 0)) * unit;
    digit = 0;
  }
  return total + section + digit;
}

/** 标题的编号部分（用于合并重复标题）：第X章 / Chapter N / 楔子等关键字；编号按数值比较（「第5章」「第0005章」「第五章」相同） */
const headingNumber = (title: string) => {
  const key = headingKey(title);
  return (key.match(/第[零〇一二两三四五六七八九十百千万\d]+[章节卷集回]/g) ?? [])
    .map(m => {
      const n = chapterNumberValue(m.slice(1, -1));
      return Number.isNaN(n) ? m : `第${n}${m.slice(-1)}`;
    })
    .join('')
    || key.match(ENGLISH_CHAPTER_RE)?.[0].toLowerCase().replace(/\s+/g, ' ')
    || key.match(SPECIAL_CHAPTER_RE)?.[1]
    || '';
};

/** 标题去掉编号、求票附言、结尾问号 / 叹号 / 句号后的章名部分（合并重复标题时比较用） */
const headingName = (title: string) => compact(headingKey(stripTitlePromo(title)))
  .replace(/^(第[零〇一二两三四五六七八九十百千万\d]+[章节卷集回])+/, '')
  .replace(/[？?！!。.…]+$/, '');

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

/** 去掉章节开头并入本章的同编号标题行（每个只去一次，只看开头几段） */
function dropMergedHeadings(paragraphs: string[], merged: string[] | undefined): string[] {
  if (!merged?.length) return paragraphs;
  const rest = merged.map(compact);
  const head = paragraphs.slice(0, merged.length + 3).filter(p => {
    const i = rest.indexOf(compact(p));
    if (i === -1) return true;
    rest.splice(i, 1);
    return false;
  });
  return [...head, ...paragraphs.slice(merged.length + 3)];
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
      // 只用 CR 换行（老 Mac 文本）：按 LF 找行时整本只有一行、切不出章节 → 读入内存把 CR 换成 LF。
      // 0x0D 不会出现在 UTF-8 / GBK / Big5 的多字节字符里，按字节替换安全，字节偏移不变
      if (isCrOnly(filePath)) {
        const raw = fs.readFileSync(filePath);
        for (let i = 0; i < raw.length; i++) if (raw[i] === 0x0d) raw[i] = 0x0a;
        this.memBuffer = raw;
      }
    }

    this.toc = null;
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

      // data[start, end) 是一行（不含换行符），absoluteStart 是它在文件里的字节位置。
      // 大文件加载主要花在逐行处理上：不为每行切 Buffer，长行不解码，非标题行首直接算正文
      const checkLine = (data: Buffer, start: number, end: number, absoluteStart: number) => {
        if (absoluteStart - segmentStarts[segmentStarts.length - 1] >= SEGMENT) {
          segmentStarts.push(absoluteStart);
        }
        if (end - start > MAX_HEADING_BYTES) {
          sawBody = true;
          return;
        }
        if (encoding === 'utf8') {
          const first = skipUtf8Space(data, start, end);
          if (first >= end) return;   // 空行
          if (!UTF8_CANDIDATE_STARTS.has(utf8CharKey(data, first))) {
            sawBody = true;
            return;
          }
        }
        const lineText = (encoding === 'utf8' ? data.toString('utf8', start, end) : iconv.decode(data.subarray(start, end), encoding)).trim();
        if (!lineText) return;
        if (!HEADING_START_RE.test(lineText)) {
          // 「------------」这类分隔线不算正文（卷名后面常跟一行分隔线）
          if (!(SEPARATOR_START_RE.test(lineText) && SEPARATOR_LINE_RE.test(compact(lineText)))) sawBody = true;
          return;
        }
        // 判断是不是标题时不看末尾的求票附言（附言里的逗号、感叹号会让标题像正文句子）
        const headingText = stripTitlePromo(lineText);
        const key = headingText.length < 60 ? headingKey(headingText) : '';
        if (VOLUME_END_RE.test(compact(key))) {
          sawBody = true;
          const current = chapters[chapters.length - 1];
          if (current) current.endsVolume = true;
          return;
        }
        const isHeading = key !== '' && (chapterPattern.test(key) || ENGLISH_CHAPTER_RE.test(key) || SPECIAL_CHAPTER_RE.test(key))
          && !looksLikeSentence(headingText);
        if (isHeading) {
          const prev = chapters[chapters.length - 1];
          if (prev && !sawBody && headingNumber(prev.title) === headingNumber(lineText)) {
            // 上一个标题之后没有正文，又是同一编号的标题，并为一章。网页抓取的书常把每章标题写两遍：
            // 「第二回史大郎…」+「第二回」「史大郎…」；「第5章 怎么像找对象？」+「第0005章怎么像找对象？？」。
            // 保留第一个标题；后一个是在它的章名后面接着多出文字时（「第二回」→「第二回 史大郎…」、
            // 「太极」→「太极图」）换成后一个。多出的部分以标点开头（「斗兽，到网址」这类水印）不算。
            // 编号不同（如「第七卷 倒吊人」后接「第一章 欢迎」）仍各自成章
            const prevName = headingName(prev.title);
            const nextName = headingName(lineText);
            const extendsPrev = nextName.length > prevName.length && nextName.startsWith(prevName)
              && /^[\p{L}\p{N}]/u.test(nextName.slice(prevName.length));
            if (extendsPrev) {
              (prev.mergedHeadings ??= []).push(prev.title);
              prev.title = lineText;
            } else if (compact(lineText) !== compact(prev.title)) {
              // 与标题一字不差的重复行由 dropRepeatedTitle 处理，不再记入（否则标题会被去掉两次）
              (prev.mergedHeadings ??= []).push(lineText);
            }
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
        } else if (partPattern.test(key) && lineText.length < 30 && !looksLikeSentence(lineText)) {
          // 「第一部 小丑」：记为下一章开始的分组，不拆章节（章节序号、阅读进度不变）
          pendingPart = lineText;
        } else if (!SEPARATOR_LINE_RE.test(compact(lineText))) {
          // 「------------」这类分隔线不算正文（卷名后面常跟一行分隔线）
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
          checkLine(data, searchFrom, nlPos, searchFrom);
          searchFrom = nlPos + 1;
        }
        if (searchFrom < data.length) {
          checkLine(data, searchFrom, data.length, searchFrom);
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
          checkLine(data, searchFrom, nlPos, processedBytes + searchFrom);
          searchFrom = nlPos + 1;
        }

        processedBytes += searchFrom;
        remainder = data.slice(searchFrom);
      });

      stream.on('end', () => {
        if (remainder.length > 0) {
          checkLine(remainder, 0, remainder.length, processedBytes);
        }
        finalize();
      });

      stream.on('error', reject);
    });
  }

  /** 目录（getChapters 的结果）缓存；load 时清空 */
  private toc: TocEntry[] | null = null;

  async getChapters(): Promise<TocEntry[]> {
    if (!this.toc) this.toc = this.buildToc();
    return this.toc;
  }

  private buildToc(): TocEntry[] {
    // 分卷标题：「第 X 卷」开头、不含章 / 回编号、且只有标题没有正文
    const isVolume = (c: ChapterMeta) =>
      /^第[零〇一二两三四五六七八九十百千万\d]+卷/.test(headingKey(c.title)) && !/[章节回集]/.test(headingNumber(c.title)) && !c.hasBody;
    // 目录显示的标题：去掉末尾的求票附言
    const display = (c: ChapterMeta) => stripTitlePromo(c.title);
    if (!this.chapters.some(c => c.partTitle || isVolume(c))) {
      return this.chapters.map(c => ({ index: c.index, title: display(c) }));
    }
    // 目录分两层：分卷标题 / 「第 X 部」分组在 0 层，其下章节在 1 层（第一个分组之前的章节仍为 0 层）。
    // groupTitle：从这一章开始的「第 X 部」分组标题，由前端显示为不可跳转的分组行
    let inGroup = false;
    let volumeTitle = '';
    return this.chapters.map(c => {
      if (isVolume(c)) {
        inGroup = true;
        volumeTitle = display(c);
        return { index: c.index, title: volumeTitle, level: 0 };
      }
      // 分卷下的章节标题带着卷名（「第一卷 笼中雀 第一章 惊蛰」）：卷名已在上一层显示，这里去掉
      let title = display(c);
      if (volumeTitle && title.startsWith(volumeTitle) && title.slice(volumeTitle.length).trim()) {
        title = title.slice(volumeTitle.length).trim();
      }
      let entry: TocEntry;
      if (c.partTitle) {
        inGroup = true;
        entry = { index: c.index, title, level: 1, groupTitle: c.partTitle };
      } else {
        entry = { index: c.index, title, level: inGroup ? 1 : 0 };
      }
      // 卷末说明之后、下一个分卷之前的章节（原文没写卷名）放回第一层，不挂在已结束的卷下面
      if (c.endsVolume && volumeTitle) {
        inGroup = false;
        volumeTitle = '';
      }
      return entry;
    });
  }

  /**
   * Read only the bytes for the requested chapter — no full-file load.
   */
  async getChapterContent(index: number): Promise<string> {
    if (this.chapters.length === 0) return '';
    const chapter = this.chapters[index];
    if (!chapter) throw new Error(`章节 ${index} 不存在`);
    const paragraphs = dropMergedHeadings(
      dropRepeatedTitle(this.paragraphs(chapter.startByte, chapter.endByte), chapter.title), chapter.mergedHeadings);
    // 目录标题去掉了求票附言 / 卷名：正文开头的标题行换成同样的写法，阅读器才能认出它是标题（与标题相同的首段会被隐藏）
    const shown = (await this.getChapters())[index]?.title;
    if (shown && shown !== chapter.title && paragraphs.length > 0 && compact(paragraphs[0]) === compact(chapter.title)) {
      paragraphs[0] = shown;
    }
    const body = this.toHtml(paragraphs);
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
