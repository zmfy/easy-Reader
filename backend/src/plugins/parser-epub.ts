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
  private chapters: Array<{ index: number; title: string; id: string; href: string }> = [];

  async load(filePath: string): Promise<void> {
    // epub2 v3: class is at require('epub2').EPub
    const { EPub } = require('epub2');
    this.epub = await EPub.createAsync(filePath);
    this.buildChapterList();
  }

  private buildChapterList(): void {
    const toc: Array<{ id: string; title?: string; href?: string }> = this.epub.toc || [];
    const flow: Array<{ id: string; href?: string; title?: string }> = this.epub.flow || [];

    // Build a map from href (without anchor) to flow item
    // TOC hrefs contain anchors (e.g. "text/part0004.html#section1") but flow hrefs don't
    const hrefToFlow = new Map<string, { id: string; href: string }>();
    for (const item of flow) {
      if (item.href) hrefToFlow.set(item.href, { id: item.id, href: item.href });
    }

    // Prefer TOC entries — they represent meaningful reading sections
    // TOC ids (e.g. "num_1") cannot be used with getChapterRawAsync directly;
    // resolve via href to get the actual flow id
    if (toc.length > 0) {
      const seen = new Set<string>();
      const result: Array<{ index: number; title: string; id: string; href: string }> = [];
      for (const item of toc) {
        if (!item.href) continue;
        const hrefBase = item.href.split('#')[0];
        const flowItem = hrefToFlow.get(hrefBase);
        if (!flowItem || seen.has(flowItem.id)) continue;
        seen.add(flowItem.id);
        result.push({ index: result.length, title: item.title || `第 ${result.length + 1} 章`, id: flowItem.id, href: flowItem.href });
      }
      if (result.length > 0) {
        this.chapters = result;
        return;
      }
    }

    // Fallback: use flow (spine) items, skip obvious non-text items
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

  async getChapters(): Promise<Array<{ index: number; title: string; href?: string }>> {
    return this.chapters.map(c => ({ index: c.index, title: c.title, href: c.href }));
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
