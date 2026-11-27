import fs from 'fs';
import path from 'path';
import { writeEpub, EpubTocEntry, sanitizeXmlText } from '../epub-builder';
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

/**
 * 写出与校验之间的单向通道：渲染一章就推一章的段落纯文本给 verifyVerbatim，
 * 队列超过 2 章时写出方等待，整本正文不会堆在内存里。校验方提前结束（发现不一致）后 push 直接返回 false
 */
function createChapterFeed() {
  const queue: string[] = [];
  let ended = false;
  let stopped = false;
  let wakeConsumer: (() => void) | null = null;
  let wakeProducer: (() => void) | null = null;
  const stop = () => {
    stopped = true;
    wakeProducer?.();
  };
  async function* chapters(): AsyncGenerator<string> {
    try {
      for (;;) {
        if (queue.length > 0) {
          const text = queue.shift()!;
          wakeProducer?.();
          yield text;
        } else if (ended) {
          return;
        } else {
          await new Promise<void>(r => { wakeConsumer = r; });
          wakeConsumer = null;
        }
      }
    } finally {
      stop();
    }
  }
  return {
    chapters: chapters(),
    stop,
    /** 校验方已停止时返回 false */
    async push(text: string): Promise<boolean> {
      if (stopped) return false;
      queue.push(text);
      wakeConsumer?.();
      while (queue.length > 2 && !stopped) {
        await new Promise<void>(r => { wakeProducer = r; });
        wakeProducer = null;
      }
      return !stopped;
    },
    end() {
      ended = true;
      wakeConsumer?.();
    },
  };
}

/** 前言区间里除去 dropLines 和空行后是否还有内容 */
async function hasPrefaceBody(filePath: string, structure: OrgStructure): Promise<boolean> {
  const preface = structure.preface;
  if (!preface) return false;
  for await (const line of readTxtLines(filePath)) {
    if (line.byteStart >= preface.srcEnd) break;
    if (!structure.dropLines.has(line.lineNo) && sanitizeXmlText(line.text).trim()) return true;
  }
  return false;
}

/**
 * 按结构把原 TXT 写成整理版 EPUB：前言（有内容时）+ 各部 / 卷 / 章，各一个文件。
 * 正文逐行流式读取，每行一个 <p>；只有标题的部 / 卷没有段落；正文开头与标题相同的行照样保留。
 * 写出的同时把各章段落纯文本（与写进 <p> 的同一份）流式交给 verifyVerbatim 与原文逐字比对，
 * 不一致时中止写出、删除文件并报错。
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

  // 写出与校验同时进行；原文那一边由 verifyVerbatim 自己再读一遍，控制字符按写 EPUB 的同一口径去掉
  const feed = createChapterFeed();
  const verifying = verifyVerbatim(sourcePath, structure, feed.chapters, sanitizeXmlText);
  verifying.then(feed.stop, feed.stop);
  let mismatch = false;

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
    const texts: string[] = [];
    let line: TxtLine | null;
    while (range && (line = await nextLine())) {
      if (line.byteStart >= range.srcEnd) { pending = line; break; }
      // 区间之前的行（只有标题的部 / 卷里的行、空前言）不写；真有正文被跳过时校验会发现
      if (line.byteStart < range.srcStart || structure.dropLines.has(line.lineNo)) continue;
      const t = sanitizeXmlText(line.text).trim();
      if (t) texts.push(t);
    }
    // 校验已发现不一致：中止写出（writeEpub 会删除半成品）
    if (!await feed.push(texts.join('\n'))) {
      mismatch = true;
      throw new Error('整理结果与原文不一致');
    }
    return texts.map(t => `<p>${escapeText(t)}</p>`).join('\n');
  };

  let writeError: unknown = null;
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
      keepTitleParagraph: true,
    }, filePath);
  } catch (err) {
    writeError = err;
  } finally {
    feed.end();
    await lines.return(undefined);
  }

  let verified: Awaited<ReturnType<typeof verifyVerbatim>>;
  try {
    verified = await verifying;
  } catch (err) {
    await fs.promises.rm(filePath, { force: true });
    throw err;
  }
  if (writeError && !mismatch) {
    await fs.promises.rm(filePath, { force: true });
    throw writeError;
  }
  if (!verified.ok) {
    await fs.promises.rm(filePath, { force: true });
    throw new Error('整理结果与原文不一致');
  }
  return { filePath, chapterMap };
}
