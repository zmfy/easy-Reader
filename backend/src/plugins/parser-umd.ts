/**
 * UMD小说格式解析器
 *
 * 格式规范（通过二进制分析确认）：
 * - 魔数：前3字节为 89 9B 9A（第4字节可为 9C 或 DE 等，忽略）
 * - 块头：23 + type(1字节) + 3字节大端总长度（含5字节头部）
 * - 章节标题块(0x84)：
 *     数据头(13字节): id1(4) + 标记(1) + id2(4) + titleDataLen(4字节LE)
 *     标题列表: [1字节字节长度] + [UTF-16 LE字节] × N
 * - 正文内容块：24 + ID(4字节) + totalSize(4字节LE) + zlib压缩数据
 *     zlib数据长度 = totalSize - 9
 *     下一块zlib位置 = 当前zlib位置 + totalSize
 * - 多节内容之间可能有 23-XX 分隔块或零字节填充
 */

import fs from 'fs';
import zlib from 'zlib';
import { ReaderPlugin } from '../types';

interface ChapterMeta {
  index: number;
  title: string;
  startChar: number;
  endChar: number;
}

function readUInt24BE(buf: Buffer, offset: number): number {
  return (buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
}

function tryDecompress(data: Buffer): Buffer | null {
  try { return zlib.inflateSync(data); } catch { /* empty */ }
  try { return zlib.inflateRawSync(data); } catch { /* empty */ }
  return null;
}

/**
 * 解析章节标题块(0x84)数据。
 * 数据头13字节: id1(4) + marker(1) + id2(4) + titleDataLen(4 LE)
 * 之后: [字节长度(1)] + [UTF-16 LE字节] × N
 * 返回标题列表和标题数据总长度。
 */
function parseChapterTitles(buf: Buffer, dataStart: number): { titles: string[]; titleDataLen: number } {
  if (dataStart + 13 > buf.length) return { titles: [], titleDataLen: 0 };

  const titleDataLen = buf.readUInt32LE(dataStart + 9);
  const titlesStart = dataStart + 13;
  const titlesEnd = titlesStart + titleDataLen;

  const titles: string[] = [];
  let i = titlesStart;

  while (i < titlesEnd && i < buf.length) {
    const byteLen = buf[i];
    i++;
    if (byteLen === 0) continue;
    if (i + byteLen > titlesEnd) break;  // 不超出标题数据区域
    titles.push(buf.slice(i, i + byteLen).toString('utf16le').trim());
    i += byteLen;
  }

  return { titles, titleDataLen };
}

/**
 * 读取所有zlib压缩的正文内容块，拼接后解码为UTF-16 LE字符串。
 * contentStart: 第一个zlib数据的字节位置（即第一个0x24标记往后9字节）。
 *
 * 循环处理4种情况：
 *   1. buf[pos-9] === 0x24：当前位置为zlib数据起始，读取并解压一个块
 *   2. buf[pos] === 0x24：当前位置为0x24标记，跳过9字节头部
 *   3. buf[pos] === 0x23：当前位置为分隔块，跳过整个块
 *   4. buf[pos] === 0x00：零字节填充，直接跳过
 */
function readAllContent(buf: Buffer, contentStart: number): string {
  const decompressedChunks: Buffer[] = [];
  let pos = contentStart;

  while (pos < buf.length) {
    if (pos >= 9 && buf[pos - 9] === 0x24) {
      // 情况1：当前位置是zlib数据
      const totalSize = buf.readUInt32LE(pos - 4);
      if (totalSize < 9 || pos + totalSize - 9 > buf.length) break;

      const compressed = buf.slice(pos, pos + totalSize - 9);
      const decompressed = tryDecompress(compressed);
      if (decompressed) decompressedChunks.push(decompressed);

      pos += totalSize;
    } else if (buf[pos] === 0x24) {
      // 情况2：当前位置是0x24标记，跳过9字节到达zlib数据
      pos += 9;
    } else if (buf[pos] === 0x23) {
      // 情况3：23-XX分隔块，跳过
      if (pos + 5 > buf.length) break;
      const blockLen = readUInt24BE(buf, pos + 2);
      if (blockLen < 5 || pos + blockLen > buf.length) break;
      pos += blockLen;
    } else if (buf[pos] === 0x00) {
      // 情况4：零字节填充，跳过
      while (pos < buf.length && buf[pos] === 0x00) pos++;
    } else {
      break;
    }
  }

  if (decompressedChunks.length === 0) return '';
  return Buffer.concat(decompressedChunks).toString('utf16le');
}

export class UmdParser implements ReaderPlugin {
  format = 'umd';
  private chapters: ChapterMeta[] = [];
  private fullText = '';

  async load(filePath: string): Promise<void> {
    const buf = fs.readFileSync(filePath);

    // 校验魔数（前3字节）
    if (buf.length < 4 || buf[0] !== 0x89 || buf[1] !== 0x9B || buf[2] !== 0x9A) {
      throw new Error('无效的UMD文件（魔数不匹配）');
    }

    // 在文件前部搜索 23 84 块，获取章节标题和正文起始位置
    let chapterTitles: string[] = [];
    let contentStart = -1;

    for (let i = 4; i + 5 < buf.length; i++) {
      if (buf[i] === 0x23 && buf[i + 1] === 0x84) {
        const { titles, titleDataLen } = parseChapterTitles(buf, i + 5);
        if (titles.length > 0 || titleDataLen > 0) {
          chapterTitles = titles;
          contentStart = i + 5 + 13 + titleDataLen;
          break;
        }
      }
    }

    if (contentStart < 9 || contentStart >= buf.length) {
      throw new Error('无法定位UMD文件正文起始位置');
    }

    this.fullText = readAllContent(buf, contentStart);

    if (chapterTitles.length > 0) {
      this.buildChapters(chapterTitles);
    }

    if (this.chapters.length === 0) {
      this.fallbackSplit();
    }
  }

  /**
   * 根据章节标题在全文中定位章节边界。
   * 若精确匹配失败，尝试去掉"附："等前缀后再次搜索。
   */
  private buildChapters(titles: string[]): void {
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
      .map(line => `<p>${line}</p>`)
      .join('\n');
  }

  async getTotalProgress(): Promise<number> {
    return this.chapters.length;
  }

  async getProgress(): Promise<number> {
    return 0;
  }
}
