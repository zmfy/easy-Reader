import fs from 'fs';
import chardet from 'chardet';
import iconv from 'iconv-lite';
import { ReaderPlugin } from '../types';

interface ChapterMeta {
  index: number;
  title: string;
  startByte: number;
  endByte: number;
}

function detectEncoding(filePath: string): string {
  const stat = fs.statSync(filePath);
  const sampleSize = Math.min(8 * 1024, stat.size);
  const fd = fs.openSync(filePath, 'r');
  const sample = Buffer.alloc(sampleSize);
  fs.readSync(fd, sample, 0, sampleSize, 0);
  fs.closeSync(fd);

  const detected = chardet.detect(sample) || 'UTF-8';
  const enc = detected.toLowerCase();

  if (enc.includes('gb') || enc === 'big5') {
    // gb2312 / gbk / gb18030 / big5 — all handled by gb18030 (superset)
    return enc.includes('big5') ? 'big5' : 'gb18030';
  }
  // default to utf8 for everything else
  return 'utf8';
}

export class TxtParser implements ReaderPlugin {
  format = 'txt';
  private filePath = '';
  private chapters: ChapterMeta[] = [];
  private fileSize = 0;
  private encoding = 'utf8';

  async load(filePath: string): Promise<void> {
    this.filePath = filePath;
    this.fileSize = fs.statSync(filePath).size;
    this.encoding = detectEncoding(filePath);
    await this.scanChapters();
  }

  /**
   * Stream through the file in 256KB chunks to find chapter boundaries.
   * Only byte offsets are stored — no full content in memory.
   */
  private scanChapters(): Promise<void> {
    const chapterPattern = /^第[零一二三四五六七八九十百千万\d]+[章节卷集]/;
    const chapters: ChapterMeta[] = [];
    const encoding = this.encoding;

    return new Promise((resolve, reject) => {
      let processedBytes = 0;
      let remainder = Buffer.alloc(0);

      const stream = fs.createReadStream(this.filePath, { highWaterMark: 256 * 1024 });

      const checkLine = (lineBuffer: Buffer, absoluteStart: number) => {
        const lineText = iconv.decode(lineBuffer, encoding).trim();
        if (chapterPattern.test(lineText) && lineText.length < 60) {
          if (chapters.length > 0) {
            chapters[chapters.length - 1].endByte = absoluteStart;
          }
          chapters.push({
            index: chapters.length,
            title: lineText,
            startByte: absoluteStart,
            endByte: this.fileSize,
          });
        }
      };

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

        if (chapters.length === 0) {
          // No chapter headers found — split into 100KB segments
          const SEGMENT = 100 * 1024;
          let offset = 0;
          let num = 0;
          while (offset < this.fileSize) {
            chapters.push({
              index: num,
              title: `第 ${num + 1} 段`,
              startByte: offset,
              endByte: Math.min(offset + SEGMENT, this.fileSize),
            });
            offset += SEGMENT;
            num++;
          }
        }

        this.chapters = chapters;
        resolve();
      });

      stream.on('error', reject);
    });
  }

  async getChapters(): Promise<Array<{ index: number; title: string }>> {
    return this.chapters.map(c => ({ index: c.index, title: c.title }));
  }

  /**
   * Read only the bytes for the requested chapter — no full-file load.
   */
  async getChapterContent(index: number): Promise<string> {
    if (this.chapters.length === 0) return '';
    const chapter = this.chapters[index];
    if (!chapter) throw new Error(`章节 ${index} 不存在`);

    const byteLength = chapter.endByte - chapter.startByte;
    if (byteLength <= 0) return '';

    const buffer = Buffer.alloc(byteLength);
    const fd = fs.openSync(this.filePath, 'r');
    try {
      fs.readSync(fd, buffer, 0, byteLength, chapter.startByte);
    } finally {
      fs.closeSync(fd);
    }

    const text = iconv.decode(buffer, this.encoding);
    const paragraphs = text.split(/\r?\n+/).filter((p: string) => p.trim());
    return paragraphs.map((p: string) => `<p>${p.trim()}</p>`).join('\n');
  }

  async getTotalProgress(): Promise<number> {
    return this.chapters.length;
  }

  async getProgress(): Promise<number> {
    return 0;
  }
}
