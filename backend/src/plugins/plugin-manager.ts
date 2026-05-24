import fs from 'fs';
import { Book, ReaderPlugin } from '../types';
import { TxtParser } from './parser-txt';
import { EpubParser } from './parser-epub';
import { PdfParser } from './parser-pdf';
import { UmdParser } from './parser-umd';

interface CachedPlugin {
  plugin: ReaderPlugin;
  mtimeMs: number;
}

// Cache plugin instances by book ID to avoid re-reading files on every request
const pluginCache = new Map<string, CachedPlugin>();

export async function getReaderPlugin(book: Book): Promise<ReaderPlugin> {
  let fileMtime = 0;
  try {
    fileMtime = fs.statSync(book.file_path).mtimeMs;
  } catch {
    // File not accessible, proceed without cache
  }

  const cached = pluginCache.get(book.id);
  if (cached && cached.mtimeMs === fileMtime && fileMtime > 0) {
    return cached.plugin;
  }

  let plugin: ReaderPlugin;
  switch (book.file_format.toLowerCase()) {
    case 'txt':  plugin = new TxtParser();  break;
    case 'epub': plugin = new EpubParser(); break;
    case 'pdf':  plugin = new PdfParser();  break;
    case 'umd':  plugin = new UmdParser();  break;
    default:
      throw new Error(`不支持的文件格式: ${book.file_format}`);
  }

  await plugin.load(book.file_path);
  pluginCache.set(book.id, { plugin, mtimeMs: fileMtime });
  return plugin;
}
