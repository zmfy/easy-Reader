import { ReaderPlugin } from '../types';

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

export class EpubParser implements ReaderPlugin {
  format = 'epub';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private epub: any = null;
  private chapters: Array<{ index: number; title: string; id: string; href: string; level?: number }> = [];
  private manifestByHref = new Map<string, { id: string; mediaType: string }>();

  async load(filePath: string): Promise<void> {
    // epub2 v3: class is at require('epub2').EPub
    const { EPub } = require('epub2');
    this.epub = await EPub.createAsync(filePath);
    this.buildManifestMap();
    this.buildChapterList();
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

  async getChapters(): Promise<Array<{ index: number; title: string; href?: string; level?: number }>> {
    return this.chapters.map(c => (c.level === undefined
      ? { index: c.index, title: c.title, href: c.href }
      : { index: c.index, title: c.title, href: c.href, level: c.level }));
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
}
