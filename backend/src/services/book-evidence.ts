import path from 'path';
import { BookFileMetadata, ReaderPlugin } from '../types';
import { createPlugin } from '../plugins/plugin-manager';
import { readTxtPreview } from '../plugins/parser-txt';
import { extractAuthorFromName } from '../utils/title-normalizer';

/**
 * AI 填充的依据：文件内置书目信息 + 正文节选。
 * 交给模型的是「证据」，而不是只有一个书名让它凭记忆去猜（冷门书、非网文必然编造）。
 */

const EXCERPT_CHARS = 1500;
/** 非 txt 最多翻看的页/章数：开头通常是封面、目录、版权页、导读，信息最集中 */
const EXCERPT_MAX_PAGES = 12;

export interface EvidenceBook {
  id: string;
  title: string;
  file_path: string;
  file_format: string;
}

export interface BookEvidence {
  metadata: BookFileMetadata;
  excerpt: string;
  /** 交给 AI 的证据文本 */
  text: string;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h\d|li|tr|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/[ \t　]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

async function readPluginExcerpt(plugin: ReaderPlugin): Promise<string> {
  const chapters = await plugin.getChapters();
  let out = '';
  for (const ch of chapters.slice(0, EXCERPT_MAX_PAGES)) {
    let text = '';
    try { text = htmlToText(await plugin.getChapterContent(ch.index)); } catch { continue; }
    if (text.length < 20) continue;  // 封面、空白页
    out += (out ? '\n' : '') + text;
    if (out.length >= EXCERPT_CHARS) break;
  }
  return out.slice(0, EXCERPT_CHARS);
}

const METADATA_HEADINGS: Record<string, string> = {
  epub: '电子书内置书目信息',
  umd: 'UMD 文件内置信息',
  pdf: 'PDF 文档属性（常被制作软件随意填写，与文件名、正文冲突时不可信）',
};

function formatMetadata(meta: BookFileMetadata): string {
  const lines: string[] = [];
  if (meta.title) lines.push(`书名：${meta.title}`);
  if (meta.author) lines.push(`作者：${meta.author}`);
  if (meta.publisher) lines.push(`出版者：${meta.publisher}`);
  if (meta.date) lines.push(`出版日期：${meta.date}`);
  if (meta.isbn) lines.push(`ISBN：${meta.isbn}`);
  if (meta.subjects?.length) lines.push(`主题词：${meta.subjects.join('；')}`);
  if (meta.description) lines.push(`内容描述：${meta.description}`);
  return lines.join('\n');
}

/** 读不到的部分（文件缺失、格式损坏、扫描版 PDF 无文字层）留空，不抛错 */
export async function buildBookEvidence(book: EvidenceBook): Promise<BookEvidence> {
  const format = book.file_format.toLowerCase();
  let metadata: BookFileMetadata = {};
  let excerpt = '';

  if (format === 'txt') {
    excerpt = readTxtPreview(book.file_path, EXCERPT_CHARS);
  } else {
    // 不走阅读插件缓存：批量填充会挤掉正在阅读的书
    let plugin: ReaderPlugin | null = null;
    try {
      plugin = createPlugin(format);
      await plugin.load(book.file_path);
      metadata = (await plugin.getMetadata?.()) ?? {};
      excerpt = await readPluginExcerpt(plugin);
    } catch {
      // 读不了就只靠文件名
    } finally {
      plugin?.dispose?.();
    }
  }

  const fileName = path.basename(book.file_path);
  const parts = [`【文件名】${fileName}`];
  const nameAuthor = extractAuthorFromName(fileName);
  if (nameAuthor) parts.push(`【文件名标注的作者】${nameAuthor}`);
  const metaText = formatMetadata(metadata);
  if (metaText) parts.push(`【${METADATA_HEADINGS[format] ?? '文件内置信息'}】\n${metaText}`);
  parts.push(excerpt ? `【正文节选】\n${excerpt}` : '【正文节选】（无法读取正文，可能是扫描版或文件损坏）');

  return { metadata, excerpt, text: parts.join('\n') };
}
