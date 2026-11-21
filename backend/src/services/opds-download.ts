import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import iconv from 'iconv-lite';
import pLimit from 'p-limit';
import { Book } from '../types';
import { getReaderPlugin } from '../plugins/plugin-manager';
import { repairZipEndRecord } from '../plugins/parser-epub';
import { detectEncoding } from '../plugins/parser-txt';
import { getOverridesMap } from './chapter-normalize';
import { buildEpub, EpubInput } from './epub-builder';
import { cleanBookTitle } from '../utils/book-title';

// OPDS 下载：EPUB / PDF 给原文件（读取时需要修正的 EPUB 给修正版），TXT / UMD 转成 EPUB，
// TXT 另外提供转成 UTF-8 的原文。转换结果缓存在 DATA_DIR/opds-cache。

export type DownloadKind = 'epub' | 'pdf' | 'txt';
/** 转换逻辑改了就加 1，旧缓存自然失效 */
export const CONVERTER_VERSION = 1;

export interface Download { filePath: string; mimeType: string; fileName: string }

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const CACHE_DIR = path.join(DATA_DIR, 'opds-cache');
const COVERS_DIR = path.join(DATA_DIR, 'covers');

const MIME: Record<DownloadKind, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
};

// 转换很耗 CPU / 内存：全局最多同时 2 本；同一缓存文件的并发请求共用一次生成
const convertLimit = pLimit(2);
const pending = new Map<string, Promise<string>>();

export function availableDownloads(book: Pick<Book, 'file_format'>): DownloadKind[] {
  switch (book.file_format.toLowerCase()) {
    case 'epub': return ['epub'];
    case 'pdf': return ['pdf'];
    case 'txt': return ['epub', 'txt'];
    case 'umd': return ['epub'];
    default: return [];
  }
}

function downloadFileName(book: Book, ext: string): string {
  const clean = (s: string) => s.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').trim();
  const title = clean(cleanBookTitle(book.title)) || 'book';
  const author = book.author ? clean(book.author) : '';
  return `${author ? `${title} - ${author}` : title}.${ext}`;
}

/** 缓存键：文件内容、书目信息、统一后的章节标题、转换器版本任一变化都会换一个缓存文件 */
function cacheName(book: Book, ext: string, withOverrides: boolean): string {
  const stat = fs.statSync(book.file_path);
  const overrides = withOverrides ? JSON.stringify([...getOverridesMap(book.id)]) : '';
  const key = [CONVERTER_VERSION, ext, stat.mtimeMs, stat.size, book.title, book.author ?? '', book.summary ?? '', book.cover_url ?? '', overrides].join('\n');
  return `${book.id}-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 12)}.${ext}`;
}

/** 生成缓存文件（先写临时文件再改名），生成后删除同一本书同类型的旧缓存 */
function ensureCached(book: Book, name: string, produce: () => Promise<Buffer>): Promise<string> {
  const target = path.join(CACHE_DIR, name);
  if (fs.existsSync(target)) return Promise.resolve(target);
  const running = pending.get(target);
  if (running) return running;

  const job = convertLimit(async () => {
    if (fs.existsSync(target)) return target;
    const data = await produce();
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmp = `${target}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
    const ext = path.extname(name);
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (f !== name && f.startsWith(`${book.id}-`) && f.endsWith(ext)) fs.rmSync(path.join(CACHE_DIR, f), { force: true });
    }
    return target;
  }).finally(() => pending.delete(target));
  pending.set(target, job);
  return job;
}

function readCover(coverUrl: string | null | undefined): EpubInput['cover'] {
  const m = coverUrl?.match(/^\/covers\/([^/?#]+\.(jpe?g|png|webp|gif))(?:[?#].*)?$/i);
  if (!m) return null;
  const file = path.join(COVERS_DIR, m[1]);
  if (!fs.existsSync(file)) return null;
  const ext = m[2].toLowerCase();
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  return { data: fs.readFileSync(file), mimeType };
}

async function convertToEpub(book: Book): Promise<Buffer> {
  const plugin = await getReaderPlugin(book);
  const chapters = await plugin.getChapters();
  const overrides = getOverridesMap(book.id);
  const out: EpubInput['chapters'] = [];
  for (const c of chapters) {
    out.push({
      title: overrides.get(c.index) ?? c.title,
      html: await plugin.getChapterContent(c.index),
      groupTitle: c.groupTitle,
    });
  }
  return buildEpub({
    id: book.id,
    title: cleanBookTitle(book.title),
    author: book.author,
    summary: book.summary,
    cover: readCover(book.cover_url),
    chapters: out,
  });
}

/**
 * book.file_path 必须是调用方已校验过（在书库目录内）的真实路径。
 * kind 不在 availableDownloads(book) 内时抛错。
 */
export async function resolveDownload(book: Book, kind: DownloadKind): Promise<Download> {
  if (!availableDownloads(book).includes(kind)) throw new Error(`这本书不提供 ${kind} 格式下载`);
  const format = book.file_format.toLowerCase();
  const result = (filePath: string): Download => ({ filePath, mimeType: MIME[kind], fileName: downloadFileName(book, kind) });

  if (kind === 'pdf') return result(book.file_path);

  if (kind === 'txt') {
    const encoding = detectEncoding(book.file_path);
    if (encoding === 'utf8') return result(book.file_path);
    const file = await ensureCached(book, cacheName(book, 'txt', false), async () =>
      Buffer.from(iconv.decode(fs.readFileSync(book.file_path), encoding).replace(/^﻿/, ''), 'utf8'));
    return result(file);
  }

  if (format === 'epub') {
    const plugin = await getReaderPlugin(book) as unknown as { repaired?: boolean };
    if (!plugin.repaired) return result(book.file_path);
    const file = await ensureCached(book, cacheName(book, 'epub', false), async () => {
      const fixed = repairZipEndRecord(fs.readFileSync(book.file_path));
      if (!fixed) throw new Error('无法修正这本 EPUB');
      return fixed;
    });
    return result(file);
  }

  // TXT / UMD → EPUB
  return result(await ensureCached(book, cacheName(book, 'epub', true), () => convertToEpub(book)));
}

export function removeOpdsCache(bookIds: string[]): void {
  if (bookIds.length === 0 || !fs.existsSync(CACHE_DIR)) return;
  const prefixes = bookIds.map(id => `${id}-`);
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (prefixes.some(p => f.startsWith(p))) fs.rmSync(path.join(CACHE_DIR, f), { force: true });
  }
}
