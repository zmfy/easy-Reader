import { ReaderPlugin } from '../types';
import { createPlugin } from '../plugins/plugin-manager';
import { saveCoverFile } from '../utils/cover';

/**
 * 文件内置封面（目前只有 EPUB 提供）。AI 填充时优先于豆瓣封面：
 * 批量填充直接采用，单本填充作为候选之一。
 */

export interface EmbeddedCover {
  buffer: Buffer;
  mimeType: string;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
};

/** 预览里以 data URI 返回，过大的图片不给（避免预览响应过大） */
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

/** 从已加载的插件取封面；插件不支持、找不到或出错时返回 null，不抛错 */
export async function readPluginCover(plugin: ReaderPlugin): Promise<EmbeddedCover | null> {
  try {
    const cover = (await plugin.getCoverImage?.()) ?? null;
    return cover && EXT_BY_MIME[cover.mimeType.toLowerCase()] ? cover : null;
  } catch {
    return null;
  }
}

/** 直接读书文件里的封面（不走阅读插件缓存，免得挤掉正在阅读的书） */
export async function readEmbeddedCover(book: { file_path: string; file_format: string }): Promise<EmbeddedCover | null> {
  const format = book.file_format.toLowerCase();
  if (format === 'txt') return null;   // TXT 没有封面，免得整本加载
  let plugin: ReaderPlugin | null = null;
  try {
    plugin = createPlugin(format);
    await plugin.load(book.file_path);
    return await readPluginCover(plugin);
  } catch {
    return null;
  } finally {
    plugin?.dispose?.();
  }
}

/** 保存为这本书的封面文件，返回 /covers/… */
export function saveEmbeddedCover(bookId: string, cover: EmbeddedCover): string {
  return saveCoverFile(bookId, cover.buffer, EXT_BY_MIME[cover.mimeType.toLowerCase()] ?? 'jpg');
}

/** 预览用 data URI；过大时返回 undefined */
export function embeddedCoverDataUri(cover: EmbeddedCover | null): string | undefined {
  if (!cover || cover.buffer.length > PREVIEW_MAX_BYTES) return undefined;
  const mime = cover.mimeType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : cover.mimeType.toLowerCase();
  return `data:${mime};base64,${cover.buffer.toString('base64')}`;
}
