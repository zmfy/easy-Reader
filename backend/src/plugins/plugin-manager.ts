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

// Cache plugin instances by book ID to avoid re-reading files on every request.
// Bounded LRU (Map keeps insertion order): parsers may hold whole books in
// memory (UTF-16 TXT, PDF pages), so an unbounded cache grows without limit.
export const PLUGIN_CACHE_MAX = 20;
const pluginCache = new Map<string, CachedPlugin>();

// In-flight loads keyed by book + mtime, so concurrent requests for the same
// book (chapters + content + assets on page open) share a single parse.
const pendingLoads = new Map<string, Promise<ReaderPlugin>>();

function createPlugin(format: string): ReaderPlugin {
  switch (format.toLowerCase()) {
    case 'txt':  return new TxtParser();
    case 'epub': return new EpubParser();
    case 'pdf':  return new PdfParser();
    case 'umd':  return new UmdParser();
    default:
      throw new Error(`不支持的文件格式: ${format}`);
  }
}

export async function getReaderPlugin(book: Book): Promise<ReaderPlugin> {
  let fileMtime = 0;
  try {
    fileMtime = fs.statSync(book.file_path).mtimeMs;
  } catch {
    // File not accessible, proceed without cache
  }

  const cached = pluginCache.get(book.id);
  if (cached && cached.mtimeMs === fileMtime && fileMtime > 0) {
    // Re-insert to mark as most recently used
    pluginCache.delete(book.id);
    pluginCache.set(book.id, cached);
    return cached.plugin;
  }

  const loadKey = `${book.id}:${fileMtime}`;
  const pending = pendingLoads.get(loadKey);
  if (pending) return pending;

  const load = (async () => {
    const plugin = createPlugin(book.file_format);
    await plugin.load(book.file_path);
    if (fileMtime > 0) {
      const replaced = pluginCache.get(book.id);
      pluginCache.delete(book.id);
      if (replaced && replaced.plugin !== plugin) replaced.plugin.dispose?.();
      pluginCache.set(book.id, { plugin, mtimeMs: fileMtime });
      while (pluginCache.size > PLUGIN_CACHE_MAX) {
        const oldest = pluginCache.keys().next().value as string;
        pluginCache.get(oldest)?.plugin.dispose?.();
        pluginCache.delete(oldest);
      }
    }
    return plugin;
  })().finally(() => pendingLoads.delete(loadKey));

  pendingLoads.set(loadKey, load);
  return load;
}
