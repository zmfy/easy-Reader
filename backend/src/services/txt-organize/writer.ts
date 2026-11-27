import fs from 'fs';
import path from 'path';
import { writeEpub, EpubTocEntry } from '../epub-builder';
import { EpubParser } from '../../plugins/parser-epub';
import { readTxtLines, TxtLine } from './lines';
import { OrgStructure, verifyVerbatim } from './structure';

/** 整理版 EPUB 的存放目录（DATA_DIR 取法同 utils/cover.ts）；不存在时创建 */
export function organizedDir(): string {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../../data');
  const dir = path.join(dataDir, 'organized');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export interface WriteResult {
  filePath: string;
  /** 只含有正文文件的章节（含前言）；chapterIndex 与 EpubParser 读回后的序号一致 */
  chapterMap: Array<{ chapterIndex: number; srcStart: number; srcEnd: number }>;
}

export interface WriteOrganizedInput {
  newBookId: string;
  sourcePath: string;
  structure: OrgStructure;
  title: string;
  author?: string | null;
  summary?: string | null;
  cover?: { buffer: Buffer; mimeType: string } | null;
}

const COVER_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
type CoverMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

const escapeText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** EPUB 章节 HTML 里的段落 → 纯文本（只还原 epub-builder 会写出的实体） */
function paragraphText(html: string): string {
  const out: string[] = [];
  for (const m of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    out.push(m[1].replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&amp;/g, '&'));
  }
  return out.join('\n');
}

/** 读回写好的 EPUB，逐章给出段落纯文本：校验的是文件里实际的内容 */
async function* readBackChapters(filePath: string): AsyncGenerator<string> {
  const parser = new EpubParser();
  await parser.load(filePath);
  for (const c of await parser.getChapters()) yield paragraphText(await parser.getChapterContent(c.index));
}

/** 前言区间里除去 dropLines 和空行后是否还有内容 */
async function hasPrefaceBody(filePath: string, structure: OrgStructure): Promise<boolean> {
  const preface = structure.preface;
  if (!preface) return false;
  for await (const line of readTxtLines(filePath)) {
    if (line.byteStart >= preface.srcEnd) break;
    if (!structure.dropLines.has(line.lineNo) && line.text.trim()) return true;
  }
  return false;
}

/**
 * 按结构把原 TXT 写成整理版 EPUB：前言（有内容时）+ 各部 / 卷 / 章，各一个文件。
 * 正文逐行流式读取，每行一个 <p>；只有标题的部 / 卷没有段落。
 * 写完读回文件与原文逐字校验，不一致时删除文件并报错。
 */
export async function writeOrganizedEpub(input: WriteOrganizedInput): Promise<WriteResult> {
  const { structure, sourcePath } = input;
  const filePath = path.join(organizedDir(), `${input.newBookId}.epub`);

  // 各条目：目录项 + 正文区间（null = 只有标题）+ chapterMap 区间
  type Range = { srcStart: number; srcEnd: number };
  const entries: Array<{ toc: EpubTocEntry; range: Range | null; mapRange: Range }> = [];
  if (structure.preface && await hasPrefaceBody(sourcePath, structure)) {
    entries.push({ toc: { title: '前言', level: 0 }, range: structure.preface, mapRange: structure.preface });
  }
  for (const s of structure.sections) {
    const range = { srcStart: s.srcStart, srcEnd: s.srcEnd };
    // 只有标题的部 / 卷：区间为空，落在标题行开头
    entries.push({ toc: { title: s.title, level: s.level }, range: s.groupOnly ? null : range, mapRange: s.groupOnly ? { srcStart: s.srcStart, srcEnd: s.srcStart } : range });
  }
  const chapterMap = entries.map((e, i) => ({ chapterIndex: i, srcStart: e.mapRange.srcStart, srcEnd: e.mapRange.srcEnd }));

  // 整本只走一遍原文：writeEpub 按顺序取各章，lines 依次往后读；不属于当前章的行留给下一章
  const lines = readTxtLines(sourcePath);
  let pending: TxtLine | null = null;
  const nextLine = async (): Promise<TxtLine | null> => {
    if (pending) { const l = pending; pending = null; return l; }
    const r = await lines.next();
    return r.done ? null : r.value;
  };
  const chapterHtml = async (index: number): Promise<string> => {
    const range = entries[index].range;
    if (!range) return '';
    const parts: string[] = [];
    let line: TxtLine | null;
    while ((line = await nextLine())) {
      if (line.byteStart >= range.srcEnd) { pending = line; break; }
      // 区间之前的行（只有标题的部 / 卷里的行、空前言）不写；真有正文被跳过时校验会发现
      if (line.byteStart < range.srcStart || structure.dropLines.has(line.lineNo)) continue;
      const t = line.text.trim();
      if (t) parts.push(`<p>${escapeText(t)}</p>`);
    }
    return parts.join('\n');
  };

  try {
    await writeEpub({
      id: input.newBookId,
      title: input.title,
      author: input.author,
      summary: input.summary,
      cover: input.cover && COVER_MIME.includes(input.cover.mimeType)
        ? { data: input.cover.buffer, mimeType: input.cover.mimeType as CoverMime } : null,
      toc: entries.map(e => e.toc),
      chapterHtml,
    }, filePath);
  } finally {
    await lines.return(undefined);
  }

  let verified: Awaited<ReturnType<typeof verifyVerbatim>>;
  try {
    verified = await verifyVerbatim(sourcePath, structure, readBackChapters(filePath));
  } catch (err) {
    await fs.promises.rm(filePath, { force: true });
    throw err;
  }
  if (!verified.ok) {
    await fs.promises.rm(filePath, { force: true });
    throw new Error('整理结果与原文不一致');
  }
  return { filePath, chapterMap };
}
