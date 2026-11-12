import fs from 'fs';
import path from 'path';
import { BookFileMetadata, ReaderPlugin } from '../types';

/** Extract <body> inner HTML from a full XHTML/HTML document string */
function extractBodyContent(html: string): string {
  if (!html) return '';
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();
  // Fallback: strip outer document wrappers
  return html
    .replace(/<html[^>]*>/gi, '').replace(/<\/html>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\?xml[^?]*\?>/gi, '')
    .trim();
}

/**
 * 有的制作工具（如 epubBuilder）把 zip 尾部目录记录里的「本盘条目数」写错（大于总条目数），
 * unzip 等工具只看总数能打开，adm-zip 却按它校验直接报错。把它改成总条目数；无需修正时返回 null。
 */
export function repairZipEndRecord(buf: Buffer): Buffer | null {
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const at = buf.lastIndexOf(sig);
  if (at < 0 || at + 22 > buf.length) return null;
  const diskEntries = buf.readUInt16LE(at + 8);
  const totalEntries = buf.readUInt16LE(at + 10);
  if (diskEntries === totalEntries) return null;
  const fixed = Buffer.from(buf);
  fixed.writeUInt16LE(totalEntries, at + 8);
  return fixed;
}

interface EpubChapter { index: number; title: string; id: string; href: string; level?: number; groupTitle?: string }

/** 目录页里指向书内页面的链接（相对路径按页面位置解析，去掉锚点；外链忽略） */
export function extractIndexLinks(html: string, pageHref: string): Array<{ title: string; href: string }> {
  const links: Array<{ title: string; href: string }> = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].split('#')[0];
    const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!href || !title || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    links.push({ title, href: path.posix.normalize(path.posix.join(path.posix.dirname(pageHref), href)) });
  }
  return links;
}

/**
 * 套装书的目录常把几十册的条目全部平铺（只靠重复出现的「封面」区分），但书内的
 * 「总目录」页列着每册书名并链接到各册第一页。满足以下条件时，用这些链接文字作分组：
 * 至少 3 个、按阅读顺序递增、目标在同一层；平均每组 ≥ 2 条且多数组内有同层条目
 * （即原目录确实没分组）。不满足就原样返回，普通书的「目录」页与已分层的目录不受影响。
 */
export function groupByIndexPage<T extends { href: string; level?: number }>(
  chapters: T[], links: Array<{ title: string; href: string }>,
): Array<T & { groupTitle?: string }> {
  const firstByHref = new Map<string, number>();
  chapters.forEach((c, i) => { if (!firstByHref.has(c.href)) firstByHref.set(c.href, i); });
  const targets: Array<{ pos: number; title: string }> = [];
  for (const link of links) {
    const pos = firstByHref.get(link.href);
    if (pos !== undefined) targets.push({ pos, title: link.title });
  }
  if (targets.length < 3 || targets.length < links.length * 0.8) return chapters;
  const level = (i: number) => chapters[i].level ?? 0;
  const L = level(targets[0].pos);
  for (let k = 0; k < targets.length; k++) {
    if (level(targets[k].pos) !== L) return chapters;
    if (k > 0 && targets[k].pos <= targets[k - 1].pos) return chapters;
  }
  // 最后一组延伸到出现更浅层级的条目或结尾
  let end = targets[targets.length - 1].pos + 1;
  while (end < chapters.length && level(end) >= L) end++;
  const bounds = targets.map((t, k) => [t.pos, k + 1 < targets.length ? targets[k + 1].pos : end]);
  for (const [from, to] of bounds) for (let i = from; i < to; i++) if (level(i) < L) return chapters;
  const flatGroups = bounds.filter(([from, to]) => {
    for (let i = from + 1; i < to; i++) if (level(i) === L) return true;
    return false;
  }).length;
  if ((end - targets[0].pos) / targets.length < 2 || flatGroups < targets.length / 2) return chapters;

  const out: Array<T & { groupTitle?: string }> = chapters.map(c => ({ ...c }));
  bounds.forEach(([from, to], k) => {
    for (let i = from; i < to; i++) out[i].level = level(i) + 1;
    out[from].groupTitle = targets[k].title;
  });
  return out;
}

export class EpubParser implements ReaderPlugin {
  format = 'epub';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private epub: any = null;
  private chapters: EpubChapter[] = [];
  private manifestByHref = new Map<string, { id: string; mediaType: string }>();

  async load(filePath: string): Promise<void> {
    // epub2 v3: class is at require('epub2').EPub
    const { EPub } = require('epub2');
    try {
      this.epub = await EPub.createAsync(filePath);
    } catch (err) {
      // zip 结构有小毛病（如尾部目录条目数写错）时，在内存里修正后再试一次；原文件不动
      const fixed = repairZipEndRecord(fs.readFileSync(filePath));
      if (!fixed) throw err;
      this.epub = await EPub.createAsync(fixed);
    }
    this.buildManifestMap();
    this.buildChapterList();
    await this.applyIndexPageGroups();
  }

  /** 前 3 页里若有列出各册书名的「总目录」页，按它给平铺的套装目录分组（见 groupByIndexPage） */
  private async applyIndexPageGroups(): Promise<void> {
    if (this.chapters.length < 6 || typeof this.epub.getChapterRawAsync !== 'function') return;
    for (const chapter of this.chapters.slice(0, 3)) {
      let html = '';
      try { html = await this.epub.getChapterRawAsync(chapter.id); } catch { continue; }
      const grouped = groupByIndexPage(this.chapters, extractIndexLinks(html || '', chapter.href));
      if (grouped !== this.chapters) {
        this.chapters = grouped;
        return;
      }
    }
  }

  private buildManifestMap(): void {
    this.manifestByHref.clear();
    const manifest: Record<string, any> = this.epub.manifest || {};
    for (const [id, item] of Object.entries(manifest)) {
      if (item.href) {
        this.manifestByHref.set(item.href, { id, mediaType: item['media-type'] || 'application/octet-stream' });
      }
    }
  }

  async getAsset(path: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const item = this.manifestByHref.get(path);
    if (!item) return null;
    try {
      // getImageAsync returns [Buffer, mimeType]; use it for images, fall back to getFile callback for others
      if (item.mediaType.startsWith('image/') && typeof this.epub.getImageAsync === 'function') {
        const [buf, mime] = await this.epub.getImageAsync(item.id) as [Buffer, string];
        return { buffer: Buffer.from(buf), mimeType: mime || item.mediaType };
      }
      const buf = await new Promise<Buffer>((resolve, reject) => {
        this.epub.getFile(item.id, (err: Error | null, data: Buffer) => {
          if (err) reject(err); else resolve(data);
        });
      });
      return { buffer: Buffer.from(buf), mimeType: item.mediaType };
    } catch {
      return null;
    }
  }

  private buildChapterList(): void {
    const toc: Array<{ id: string; title?: string; href?: string; level?: number }> = this.epub.toc || [];
    const flow: Array<{ id: string; href?: string; title?: string }> = this.epub.flow || [];

    // Build href → flow item map (TOC hrefs may carry anchors; flow hrefs don't)
    const hrefToFlow = new Map<string, { id: string; href: string }>();
    for (const item of flow) {
      if (item.href) hrefToFlow.set(item.href, { id: item.id, href: item.href });
    }

    // Build flow-id → TOC title map (used to annotate full-flow chapters)
    const flowIdToTitle = new Map<string, string>();
    const flowIdToLevel = new Map<string, number>();
    for (const item of toc) {
      if (!item.href || !item.title) continue;
      const flowItem = hrefToFlow.get(item.href.split('#')[0]);
      if (flowItem) {
        flowIdToTitle.set(flowItem.id, item.title);
        if (!flowIdToLevel.has(flowItem.id)) flowIdToLevel.set(flowItem.id, item.level ?? 0);
      }
    }

    // Try TOC-based chapter list (works well for text books)
    if (toc.length > 0) {
      const seen = new Set<string>();
      const result: Array<{ index: number; title: string; id: string; href: string; level?: number }> = [];
      for (const item of toc) {
        if (!item.href) continue;
        const hrefBase = item.href.split('#')[0];
        const flowItem = hrefToFlow.get(hrefBase);
        if (!flowItem || seen.has(flowItem.id)) continue;
        seen.add(flowItem.id);
        // level：原书目录层级（套装书的「书 → 部分 → 篇」），供阅读器折叠显示
        result.push({ index: result.length, title: item.title || `第 ${result.length + 1} 章`, id: flowItem.id, href: flowItem.href, level: item.level ?? 0 });
      }
      // 单层目录不带 level，与原来一致
      if (!result.some(c => (c.level ?? 0) > 0)) result.forEach(c => delete c.level);

      // For manga/image-heavy books, TOC only covers chapter dividers and the
      // bulk of pages (individual manga frames) have no TOC entry.
      // If TOC covers ≥ 30% of the flow, it's a text book — use TOC.
      // Otherwise fall through to full-flow mode so no page is skipped.
      const validFlowCount = flow.filter(f => f.id && f.href).length;
      const tocCoverage = validFlowCount > 0 ? result.length / validFlowCount : 1;
      if (result.length > 0 && tocCoverage >= 0.3) {
        this.chapters = result;
        return;
      }
    }

    // Full-flow mode: use every spine page (manga, image books, low-TOC-coverage EPUBs).
    // Annotate with TOC titles where available; leave other pages with empty titles
    // so the frontend can display page numbers instead.
    const validFlow = flow.filter(item => !!item.id && !!item.href);
    if (validFlow.length > 0) {
      // 有标题的页沿用原书目录层级；没有标题的页挂在前面最近一个有标题的条目下面
      // （漫画：卷 → 话 → 各页），目录里默认收起，不再与章节标题平铺
      let lastTitledLevel: number | null = null;
      this.chapters = validFlow.map((item, idx) => {
        const title = flowIdToTitle.get(item.id) || '';
        let level: number;
        if (title) {
          level = flowIdToLevel.get(item.id) ?? 0;
          lastTitledLevel = level;
        } else {
          level = lastTitledLevel === null ? 0 : lastTitledLevel + 1;
        }
        return { index: idx, title, id: item.id, href: item.href!, level };
      });
      if (!this.chapters.some(c => (c.level ?? 0) > 0)) this.chapters.forEach(c => delete c.level);
      return;
    }

    // Last resort: flow without href filtering, skip obvious non-text items
    const skipPatterns = /cover|titlepage|toc|nav|copyright|ncx/i;
    const candidate = flow.filter(item => item.id && !skipPatterns.test(item.id));
    const source = candidate.length > 0 ? candidate : flow;
    this.chapters = source
      .filter(item => !!item.id)
      .map((item, idx) => ({
        index: idx,
        title: item.title || `第 ${idx + 1} 章`,
        id: item.id,
        href: item.href || '',
      }));
  }

  async getChapters(): Promise<Array<{ index: number; title: string; href?: string; level?: number; groupTitle?: string }>> {
    return this.chapters.map(c => ({
      index: c.index, title: c.title, href: c.href,
      ...(c.level !== undefined ? { level: c.level } : {}),
      ...(c.groupTitle ? { groupTitle: c.groupTitle } : {}),
    }));
  }

  async getChapterContent(index: number): Promise<string> {
    const chapter = this.chapters[index];
    if (!chapter) throw new Error(`章节 ${index} 不存在`);

    // epub2 v3 uses promise-based getChapterRawAsync / getChapterAsync
    let rawHtml = '';
    if (typeof this.epub.getChapterRawAsync === 'function') {
      rawHtml = await this.epub.getChapterRawAsync(chapter.id);
    } else if (typeof this.epub.getChapterAsync === 'function') {
      rawHtml = await this.epub.getChapterAsync(chapter.id);
    } else {
      // Legacy callback fallback (epub2 v2)
      rawHtml = await new Promise<string>((resolve, reject) => {
        this.epub.getChapter(chapter.id, (err: Error | null, text: string) => {
          if (err) reject(err); else resolve(text || '');
        });
      });
    }

    return extractBodyContent(rawHtml);
  }

  async getTotalProgress(): Promise<number> {
    return this.chapters.length;
  }

  async getProgress(): Promise<number> {
    return 0;
  }

  /** OPF 书目信息（epub2 解析的 metadata；subject 可能是字符串或数组，description 可能带 HTML） */
  async getMetadata(): Promise<BookFileMetadata> {
    return epubMetadata(this.epub?.metadata);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function epubMetadata(m: any): BookFileMetadata {
  if (!m || typeof m !== 'object') return {};
  const text = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return t || undefined;
  };
  const meta: BookFileMetadata = {};
  const title = text(m.title); if (title) meta.title = title;
  const author = text(m.creator); if (author) meta.author = author;
  const publisher = text(m.publisher); if (publisher) meta.publisher = publisher;
  const date = text(m.date); if (date) meta.date = date.slice(0, 10);
  const description = text(m.description); if (description) meta.description = description.slice(0, 500);
  const isbn = text(m.ISBN); if (isbn) meta.isbn = isbn;
  const subjects = (Array.isArray(m.subject) ? m.subject : [m.subject]).map(text).filter((s: string | undefined): s is string => !!s);
  if (subjects.length) meta.subjects = subjects.slice(0, 10);
  return meta;
}
