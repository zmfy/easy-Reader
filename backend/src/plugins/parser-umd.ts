/**
 * UMD小说格式解析器
 *
 * 格式规范（与真实样本——飞库网等工具生成的文件——逐块核对过）：
 * - 魔数：89 9B 9A DE（只校验前3字节，第4字节偶见其他值）
 * - 之后是两种块交替：
 *   - 「#」块：23 + id(2字节LE) + flag(1) + 总长度(1字节，含5字节头) + 数据
 *   - 「$」块：24 + 校验码(4) + 总长度(4字节LE，含9字节头) + 数据
 * - # 块：0x01 类型（数据首字节 1=文字版 2=漫画版）、0x02〜0x09 书名/作者/年/月/日/类型/出版者/销售商（UTF-16LE）、
 *   0x0B 正文字节数(4字节LE)、0x0C 文件结束（之后的块不再读）、0xF1 / 0x0A 夹在正文块之间（跳过）
 * - 下面这些 # 块后面紧跟一个 $ 块装它的数据：
 *   0x83 章节偏移（每章 4字节LE，正文里的字节偏移）、0x84 章节标题（[1字节字节长度] + UTF-16LE × N）、
 *   0x82 封面图片、0x81 正文块索引、0x87 分页信息
 * - 不跟在上述 # 块后面的 $ 块是正文：每块 zlib 压缩，解压后拼接为 UTF-16LE 正文（最后一块补零到 32KB，按 0x0B 的长度截断）
 * - 正文用 U+2029（段落分隔符）分段
 */

import fs from 'fs';
import zlib from 'zlib';
import crypto from 'crypto';
import { BookFileMetadata, ReaderPlugin } from '../types';
import { escapeHtml } from '../utils/html';

interface ChapterMeta {
  index: number;
  title: string;
  startChar: number;
  endChar: number;
}

export type UmdErrorKind = 'not_umd' | 'incomplete' | 'comic' | 'corrupt';

/** 文件本身的问题（不是程序错误）；message 可直接给用户看 */
export class UmdFormatError extends Error {
  constructor(public kind: UmdErrorKind, message: string) {
    super(message);
    this.name = 'UmdFormatError';
  }
}

/** 后面紧跟一个 $ 数据块的 # 块 */
const BLOCK_INDEX = 0x81;
const BLOCK_COVER = 0x82;
const BLOCK_OFFSETS = 0x83;
const BLOCK_TITLES = 0x84;
const BLOCK_PAGES = 0x87;
const DATA_BLOCK_IDS = [BLOCK_INDEX, BLOCK_COVER, BLOCK_OFFSETS, BLOCK_TITLES, BLOCK_PAGES];

/**
 * 制作网站塞进去的 logo，不是书的封面（sha1）；当作没有封面，免得 AI 填充优先采用它
 * - 飞库网（feiku.com）：飞库网生成的 UMD 都带这张 GIF
 */
export const PLACEHOLDER_COVER_SHA1 = new Set(['0c9f91a1f6df240795bcc08e8577475ad1854001']);

interface UmdStructure {
  type: number | null;
  contentLength: number | null;
  offsets: number[] | null;
  titles: string[] | null;
  cover: Buffer | null;
  contentBlocks: Buffer[];
  truncated: boolean;
  ended: boolean;
}

function tryDecompress(data: Buffer): Buffer | null {
  try { return zlib.inflateSync(data); } catch { /* empty */ }
  try { return zlib.inflateRawSync(data); } catch { /* empty */ }
  return null;
}

/**
 * 解析文件头部的书目信息块：23 + type(2字节LE) + flag(1) + 总长度(1字节，含5字节头) + UTF-16LE 数据。
 * 0x02 书名、0x03 作者、0x04/0x05 年/月、0x07 类型、0x08 出版者；遇到非 23 块即停止。
 */
export function parseUmdHeader(buf: Buffer): BookFileMetadata {
  const fields: Record<number, string> = {};
  let i = 4;
  while (i + 5 <= buf.length && i < 4096 && buf[i] === 0x23) {
    const type = buf.readUInt16LE(i + 1);
    const len = buf[i + 4];
    if (len < 5) break;
    if (type >= 0x02 && type <= 0x08) fields[type] = buf.slice(i + 5, i + len).toString('utf16le').trim();
    i += len;
  }
  const meta: BookFileMetadata = {};
  if (fields[0x02]) meta.title = fields[0x02];
  if (fields[0x03]) meta.author = fields[0x03];
  if (fields[0x08]) meta.publisher = fields[0x08];
  if (/^\d{4}$/.test(fields[0x04] ?? '')) meta.date = fields[0x04] + (/^\d{1,2}$/.test(fields[0x05] ?? '') ? `-${fields[0x05]}` : '');
  if (fields[0x07]) meta.subjects = [fields[0x07]];
  return meta;
}

/** 章节标题数据：[字节长度(1)] + [UTF-16LE] × N */
function parseTitles(data: Buffer): string[] {
  const titles: string[] = [];
  let i = 0;
  while (i < data.length) {
    const byteLen = data[i];
    i++;
    if (i + byteLen > data.length) break;
    titles.push(data.slice(i, i + byteLen).toString('utf16le').trim());
    i += byteLen;
  }
  return titles;
}

/** 按块顺序读一遍整个文件 */
function readStructure(buf: Buffer): UmdStructure {
  const s: UmdStructure = {
    type: null, contentLength: null, offsets: null, titles: null, cover: null, contentBlocks: [], truncated: false, ended: false,
  };
  let pendingData: number | null = null;   // 上一个 # 块等着接收的 $ 数据块
  let pos = 4;

  while (pos < buf.length) {
    if (buf[pos] === 0x23) {
      if (pos + 5 > buf.length) { s.truncated = true; break; }
      const id = buf.readUInt16LE(pos + 1);
      const len = buf[pos + 4];
      if (len < 5) break;
      if (pos + len > buf.length) { s.truncated = true; break; }
      const data = buf.slice(pos + 5, pos + len);
      if (id === 0x01 && data.length >= 1) s.type = data[0];
      else if (id === 0x0b && data.length >= 4) s.contentLength = data.readUInt32LE(0);
      else if (id === 0x0c) { s.ended = true; break; }
      pendingData = DATA_BLOCK_IDS.includes(id) ? id : null;
      pos += len;
    } else if (buf[pos] === 0x24) {
      if (pos + 9 > buf.length) { s.truncated = true; break; }
      const len = buf.readUInt32LE(pos + 5);
      if (len < 9) break;
      if (pos + len > buf.length) { s.truncated = true; break; }
      const data = buf.slice(pos + 9, pos + len);
      if (pendingData === BLOCK_OFFSETS) {
        s.offsets = [];
        for (let i = 0; i + 4 <= data.length; i += 4) s.offsets.push(data.readUInt32LE(i));
      } else if (pendingData === BLOCK_TITLES) {
        s.titles = parseTitles(data);
      } else if (pendingData === BLOCK_COVER) {
        s.cover = data;
      } else if (pendingData === null) {
        s.contentBlocks.push(data);
      }
      pendingData = null;
      pos += len;
    } else if (buf[pos] === 0x00) {
      // 零字节填充
      while (pos < buf.length && buf[pos] === 0x00) pos++;
    } else {
      break;
    }
  }
  return s;
}

function imageMimeType(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'image/gif';
  return null;
}

export class UmdParser implements ReaderPlugin {
  format = 'umd';
  private chapters: ChapterMeta[] = [];
  private fullText = '';
  private metadata: BookFileMetadata = {};
  private cover: { buffer: Buffer; mimeType: string } | null = null;

  async load(filePath: string): Promise<void> {
    const buf = fs.readFileSync(filePath);

    // 校验魔数（前3字节）
    if (buf.length < 4 || buf[0] !== 0x89 || buf[1] !== 0x9B || buf[2] !== 0x9A) {
      throw new UmdFormatError('not_umd', '无效的UMD文件（魔数不匹配）');
    }
    this.metadata = parseUmdHeader(buf);

    const s = readStructure(buf);
    if (s.type === 2) throw new UmdFormatError('comic', '暂不支持漫画版 UMD');
    if (s.truncated) throw new UmdFormatError('incomplete', '文件不完整');

    const chunks: Buffer[] = [];
    for (const block of s.contentBlocks) {
      const data = tryDecompress(block);
      if (!data) throw new UmdFormatError('corrupt', '正文数据解压失败');
      chunks.push(data);
    }
    let content = Buffer.concat(chunks);
    // 没有正常结尾、正文又比声明的短：多半是下载 / 复制中断在块与块之间
    if (!s.ended && s.contentLength !== null && content.length < s.contentLength) {
      throw new UmdFormatError('incomplete', '文件不完整');
    }
    // 最后一块补零到 32KB，按声明的正文长度截断
    if (s.contentLength !== null && s.contentLength <= content.length) content = content.slice(0, s.contentLength);
    this.fullText = content.toString('utf16le').replace(/\u0000+$/, '');

    if (s.cover) {
      const mimeType = imageMimeType(s.cover);
      const sha1 = crypto.createHash('sha1').update(s.cover).digest('hex');
      if (mimeType && !PLACEHOLDER_COVER_SHA1.has(sha1)) this.cover = { buffer: s.cover, mimeType };
    }

    const titles = s.titles ?? [];
    if (s.offsets && s.offsets.length > 0) this.buildChaptersFromOffsets(s.offsets, titles);
    if (this.chapters.length === 0 && titles.length > 0) this.buildChaptersByTitle(titles);
    if (this.chapters.length === 0) this.fallbackSplit();
  }

  /**
   * 按章节偏移表（字节偏移，正文是 UTF-16 所以除以 2）切分；偏移不递增或越界时放弃，改按标题定位。
   * 标题比偏移少时，缺的按「第 N 章」补。
   */
  private buildChaptersFromOffsets(offsets: number[], titles: string[]): void {
    const total = this.fullText.length;
    const starts = offsets.map(o => Math.floor(o / 2));
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] >= total || (i > 0 && starts[i] < starts[i - 1])) return;
    }
    this.chapters = starts.map((start, i) => ({
      index: i,
      title: titles[i] || `第 ${i + 1} 章`,
      startChar: start,
      endChar: i + 1 < starts.length ? starts[i + 1] : total,
    }));
  }

  /**
   * 没有可用的偏移表时，根据章节标题在全文中定位章节边界。
   * 若精确匹配失败，尝试去掉"附："等前缀后再次搜索。
   */
  private buildChaptersByTitle(titles: string[]): void {
    const text = this.fullText;
    const chapters: ChapterMeta[] = [];
    let searchFrom = 0;

    for (const rawTitle of titles) {
      let pos = text.indexOf(rawTitle, searchFrom);

      // 精确匹配失败时，去掉常见前缀后再尝试
      if (pos === -1) {
        const stripped = rawTitle.replace(/^[\u9644\u524d\u540e\u5916\u5c0f\u9644\u5f55]+[\uff1a:]\s*/, '');
        if (stripped !== rawTitle && stripped.length > 0) {
          pos = text.indexOf(stripped, searchFrom);
        }
      }

      if (pos === -1) continue;

      if (chapters.length > 0) {
        chapters[chapters.length - 1].endChar = pos;
      }

      chapters.push({
        index: chapters.length,
        title: rawTitle,
        startChar: pos,
        endChar: text.length,
      });

      searchFrom = pos + 1;
    }

    this.chapters = chapters;
  }

  /**
   * 无章节结构时，按字符数均匀分割。
   */
  private fallbackSplit(): void {
    const CHUNK_CHARS = 3000;
    const total = this.fullText.length;
    for (let i = 0; i * CHUNK_CHARS < total; i++) {
      this.chapters.push({
        index: i,
        title: `第 ${i + 1} 段`,
        startChar: i * CHUNK_CHARS,
        endChar: Math.min((i + 1) * CHUNK_CHARS, total),
      });
    }
  }

  async getChapters(): Promise<Array<{ index: number; title: string }>> {
    return this.chapters.map(c => ({ index: c.index, title: c.title }));
  }

  async getChapterContent(index: number): Promise<string> {
    const ch = this.chapters[index];
    if (!ch) return '<p>章节不存在</p>';

    const text = this.fullText.slice(ch.startChar, ch.endChar);
    // UMD正文以 U+2029（段落分隔符）分隔段落，每段以全角空格缩进
    return text
      .split(/[\r\n\u2029\u2028]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => `<p>${escapeHtml(line)}</p>`)
      .join('\n');
  }

  async getTotalProgress(): Promise<number> {
    return this.chapters.length;
  }

  async getProgress(): Promise<number> {
    return 0;
  }

  async getMetadata(): Promise<BookFileMetadata> {
    return this.metadata;
  }

  async getCoverImage(): Promise<{ buffer: Buffer; mimeType: string } | null> {
    return this.cover;
  }
}
