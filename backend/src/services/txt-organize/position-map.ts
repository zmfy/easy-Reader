import type Database from 'better-sqlite3';
import { TxtParser } from '../../plugins/parser-txt';
import { EpubParser } from '../../plugins/parser-epub';
import { sanitizeXmlText } from '../epub-builder';
import { decodeHtmlEntities, unescapeHtml } from '../../utils/html';
import { readTxtLines } from './lines';

export interface ReadingPos {
  chapterIndex: number;
  paragraphIndex: number;
  paragraphOffset: number;
}

interface MapRow {
  chapter_index: number;
  src_start: number;
  src_end: number;
}

/** 整理版一章：正文行在原文的字节位置 → 阅读器段落序号（升序） */
type OrganizedIndex = Array<{ byte: number; block: number }>;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(Number(n) || 0)));

/**
 * 原 TXT 与整理版 EPUB 之间的阅读位置换算（审核保留整理版时迁移读者进度 / 书签）。
 *
 * 原书第 c 章第 p 段（TxtParser.getChapterContent 的第 p 个 <p>）→ 在该章字节区间的原文行里按顺序找到这一段，
 * 得到它的字节位置 → 对照表里包含该位置的整理版章节 → 该章 EPUB 内容里对应的段落序号。
 * 整理版段落序号与阅读器一致：按 <h1>–<h6> / <p> 块计数，章首的 <h2> 标题是第 0 段。
 * 找不到的段落（前言里合成的部分、换了写法的标题段）取它前面最近一个找得到的段落，都没有则取章首；
 * 原文行在整理版里被去掉（标题、duplicate、stray_number）时，取整理版里它前面最近的一段，没有则取第 0 段。
 *
 * 一本书的所有读者一起换算：各章索引第一次用到时才建（只读该章的原文区间），之后缓存。
 * 原文件不存在 / 解析失败时退化为按章节序号比例换算，不抛错。
 */
export class PositionMapper {
  private txt: TxtParser | null = null;
  private epub: EpubParser | null = null;
  /** 原书各章起点字节（第 0 章从 0 算起：开头的书名 / 前言显示在第 0 章） */
  private originalStarts: number[] = [];
  private originalCache = new Map<number, Promise<Array<number | null>>>();
  private organizedCache = new Map<number, Promise<OrganizedIndex>>();

  private constructor(
    private originalPath: string,
    private rows: MapRow[],
    /** 比例换算用：原书章节数（未知为 0） */
    private originalCount: number,
  ) {}

  static async create(originalPath: string, organizedBookId: string, db: Database.Database): Promise<PositionMapper> {
    const rows = db.prepare(
      'SELECT chapter_index, src_start, src_end FROM txt_organize_chapter_map WHERE book_id = ? ORDER BY chapter_index'
    ).all(organizedBookId) as MapRow[];
    const book = db.prepare(
      `SELECT b.file_path, o.chapter_count AS original_count
       FROM books b LEFT JOIN books o ON o.id = b.organized_from WHERE b.id = ?`
    ).get(organizedBookId) as { file_path: string; original_count: number | null } | undefined;
    const mapper = new PositionMapper(originalPath, rows, book?.original_count ?? 0);
    if (!book || rows.length === 0) return mapper;
    try {
      const txt = new TxtParser();
      await txt.load(originalPath);
      const starts = txt.getHeadingStarts().map(s => s.byte);
      if (starts.length === 0) return mapper;
      const epub = new EpubParser();
      await epub.load(book.file_path);
      mapper.txt = txt;
      mapper.epub = epub;
      mapper.originalStarts = starts.map((s, i) => (i === 0 ? 0 : s));
      mapper.originalCount = starts.length;
    } catch {
      // 原文件已删除 / 解析失败：保持比例换算模式
    }
    return mapper;
  }

  /** 阅读进度：原书章节 + 段落 → 整理版章节 + 段落；paragraphOffset 原样保留 */
  async mapProgress(pos: ReadingPos): Promise<ReadingPos> {
    if (this.rows.length === 0) return { chapterIndex: 0, paragraphIndex: 0, paragraphOffset: 0 };
    if (!this.txt) return { chapterIndex: this.mapChapter(pos.chapterIndex), paragraphIndex: 0, paragraphOffset: 0 };
    try {
      const c = clamp(pos.chapterIndex, 0, this.originalStarts.length - 1);
      const positions = await this.originalIndex(c);
      let byte: number | null = null;
      if (positions.length > 0) {
        for (let p = clamp(pos.paragraphIndex, 0, positions.length - 1); p >= 0 && byte === null; p--) byte = positions[p];
      }
      if (byte === null) byte = this.originalStarts[c];
      const k = this.organizedChapterAt(byte);
      return { chapterIndex: k, paragraphIndex: await this.organizedParagraphAt(k, byte), paragraphOffset: pos.paragraphOffset };
    } catch {
      // 原文件在换算途中被删 / 改动等：退回按章节比例
      return { chapterIndex: this.mapChapter(pos.chapterIndex), paragraphIndex: 0, paragraphOffset: 0 };
    }
  }

  /** 书签：原章节开头 → 整理版中包含它的章节 */
  mapChapter(chapterIndex: number): number {
    const organizedCount = this.rows.length;
    if (organizedCount === 0) return 0;
    if (this.txt) {
      return this.organizedChapterAt(this.originalStarts[clamp(chapterIndex, 0, this.originalStarts.length - 1)]);
    }
    if (this.originalCount <= 0) return clamp(chapterIndex, 0, organizedCount - 1);
    const c = clamp(chapterIndex, 0, this.originalCount - 1);
    return clamp((c * organizedCount) / this.originalCount, 0, organizedCount - 1);
  }

  /** 包含该字节的整理版章节；落在区间之间（只有标题的部 / 卷所在行等）时取起点不超过它的最后一章 */
  private organizedChapterAt(byte: number): number {
    let fallback = 0;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      if (r.src_start <= byte && byte < r.src_end) return i;
      if (r.src_start <= byte) fallback = i;
    }
    return fallback;
  }

  private async organizedParagraphAt(chapter: number, byte: number): Promise<number> {
    const index = await this.organizedIndex(chapter);
    let block = 0;
    for (const e of index) {
      if (e.byte > byte) break;
      block = e.block;
    }
    return block;
  }

  /** 原书第 c 章各段落在原文的字节位置；找不到的段落为 null（不重新实现解析器的去重规则，只按顺序匹配原文行） */
  private originalIndex(c: number): Promise<Array<number | null>> {
    let cached = this.originalCache.get(c);
    if (!cached) {
      cached = (async () => {
        const html = await this.txt!.getChapterContent(c);
        const paragraphs = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(m => unescapeHtml(m[1]).trim());
        const lines: Array<{ byte: number; text: string }> = [];
        for await (const line of readTxtLines(this.originalPath, { start: this.originalStarts[c], end: this.originalStarts[c + 1] })) {
          const text = line.text.trim();
          if (text) lines.push({ byte: line.byteStart, text });
        }
        let cursor = 0;
        return paragraphs.map(p => {
          for (let i = cursor; i < lines.length; i++) {
            if (lines[i].text === p) {
              cursor = i + 1;
              return lines[i].byte;
            }
          }
          return null;
        });
      })();
      this.originalCache.set(c, cached);
    }
    return cached;
  }

  /** 整理版第 k 章：其区间内原文行按顺序对上 EPUB 里的 <p>，对不上的行是写出时去掉的行 */
  private organizedIndex(k: number): Promise<OrganizedIndex> {
    let cached = this.organizedCache.get(k);
    if (!cached) {
      cached = (async () => {
        const row = this.rows[k];
        if (row.src_end <= row.src_start) return [];
        const html = await this.epub!.getChapterContent(k);
        const blocks = [...html.matchAll(/<(p|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m, block) => ({
          block,
          isParagraph: m[1].toLowerCase() === 'p',
          text: decodeHtmlEntities(m[2].replace(/<[^>]*>/g, '')).trim(),
        })).filter(b => b.isParagraph);
        const index: OrganizedIndex = [];
        let cursor = 0;
        for await (const line of readTxtLines(this.originalPath, { start: row.src_start, end: row.src_end })) {
          if (cursor >= blocks.length) break;
          const text = sanitizeXmlText(line.text).trim();
          if (text && text === blocks[cursor].text) {
            index.push({ byte: line.byteStart, block: blocks[cursor].block });
            cursor++;
          }
        }
        return index;
      })();
      this.organizedCache.set(k, cached);
    }
    return cached;
  }
}
