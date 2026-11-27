import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { BookFileMetadata, ReaderPlugin } from '../types';
import { decodeHtmlEntities } from '../utils/html';

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

const RASTER_MIME = /^image\/(jpeg|jpg|png|gif|webp)$/i;
const COVER_MIN_BYTES = 1024;
const IMAGE_EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
};

/** 按扩展名判断光栅图片的 MIME；不是图片返回 undefined */
export function imageMimeByExt(name: string): string | undefined {
  return IMAGE_EXT_MIME[(name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()];
}

/**
 * 章节文件按自身声明的编码解码：BOM → XML 声明 encoding → <meta charset>，都没有按 UTF-8。
 * epub2 一律按 UTF-8 读，早期国内制作的 EPUB 有用 GBK 的，会整章乱码。
 */
export function decodeHtmlBuffer(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf-8');
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return iconv.decode(buf.subarray(2), 'utf-16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return iconv.decode(buf.subarray(2), 'utf-16be');
  const head = buf.subarray(0, 1024).toString('latin1');
  const declared = head.match(/<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/i)?.[1]
    || head.match(/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i)?.[1];
  const enc = declared?.toLowerCase();
  if (enc && !/^utf-?8$/.test(enc) && iconv.encodingExists(enc)) return iconv.decode(buf, enc);
  return buf.toString('utf-8');
}

/**
 * EPUB3 导航文档（nav.xhtml）里的目录：取 epub:type="toc" 的 <nav>（没有就整页），
 * 按 <ol> 嵌套层数给出 level，href 按导航文档位置解析成 zip 内路径（保留锚点，与 NCX 解析结果一致）
 */
export function extractNavToc(html: string, navHref: string): Array<{ title: string; href: string; level: number }> {
  const tocNav = html.match(/<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1] ?? html;
  const out: Array<{ title: string; href: string; level: number }> = [];
  let depth = 0;
  for (const m of tocNav.matchAll(/<(\/?)ol\b[^>]*>|<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (m[2] === undefined) { depth += m[1] ? -1 : 1; continue; }
    const title = m[3].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!title || /^[a-z][a-z0-9+.-]*:/i.test(m[2])) continue;
    const [file, anchor] = m[2].split('#');
    const href = path.posix.normalize(path.posix.join(path.posix.dirname(navHref), file));
    out.push({ title, href: anchor ? `${href}#${anchor}` : href, level: Math.max(0, depth - 1) });
  }
  return out;
}

/** 逐页取标题时最多打开的页数 */
const PAGE_HEADING_SCAN_LIMIT = 2000;

/** 页面里第一个 h1–h3 的文字；没有或太长（不像标题）时返回空串 */
export function firstHeading(html: string): string {
  const m = html.match(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/i);
  if (!m) return '';
  const text = decodeHtmlEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  return text.length <= 60 ? text : '';
}

interface EpubChapter { index: number; title: string; id: string; href: string; level?: number; groupTitle?: string }

/** XML 元素名去掉命名空间前缀：opf:item → item（同 xml2js 的 processors.stripPrefix） */
const stripPrefix = (name: string): string => name.replace(/^.*:/, '');

/**
 * 按 zip 里实际存在的条目名找文件：先精确匹配，再试 URL 解码、去掉开头的 ./、不区分大小写。
 * 有的制作工具 manifest 里写的路径和打包时的文件名大小写不一致，阅读软件大多照样能打开。
 */
export function resolveZipName(names: string[], name: string): string {
  if (names.includes(name)) return name;
  const variants = new Set<string>([name.replace(/^(\.\/)+/, '')]);
  try { variants.add(decodeURIComponent(name).replace(/^(\.\/)+/, '')); } catch { /* 不是合法的 URL 编码 */ }
  for (const v of variants) if (names.includes(v)) return v;
  for (const v of variants) {
    const lower = v.toLowerCase();
    const hit = names.find(n => n.toLowerCase() === lower);
    if (hit) return hit;
  }
  return name;
}

/**
 * epub2 的容错子类（只覆盖少数几个方法，不改 node_modules）：
 * - epub4j（so-novel 等工具）写出的 content.opf 全部元素带 opf: 前缀（<opf:manifest><opf:item …/>），
 *   epub2 只去掉最外层元素的前缀，条目一个都读不到 → 解析 XML 时统一去掉元素名前缀
 * - 读 zip 条目时按 resolveZipName 容忍大小写 / URL 编码 / ./ 前缀不一致
 * - container.xml 的 full-path 带 ./ 前缀时 epub2 找不到 content.opf → 读出时去掉
 * - 没有 mimetype 文件时 epub2 直接报错 → 跳过这项检查（mimetype 只是格式标记，不影响内容）
 * - manifest 只有一个条目时 xml2js 不生成数组，epub2 一条都读不到 → 先转成数组
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tolerantEPub: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEPubClass(): any {
  if (!tolerantEPub) {
    // epub2 v3: class is at require('epub2').EPub；静态 xml2jsOptions 由 _getStatic() 按实际类读取
    const { EPub } = require('epub2');
    tolerantEPub = class extends EPub {
      // open() 建好 zip 后立即调用 checkMimeType()，在这里接管 zip 的读取
      checkMimeType(): void {
        const zip = this.zip;
        const names: string[] = zip.names || [];
        const readFile = zip.readFile.bind(zip);
        zip.readFile = (name: string, cb: (err: Error | null, data?: Buffer) => void) => {
          readFile(resolveZipName(names, name), (err: Error | null, data?: Buffer) => {
            if (!err && data && /^meta-inf\/container\.xml$/i.test(name)) {
              data = Buffer.from(data.toString('utf-8').replace(/(full-path\s*=\s*["'])(?:\.\/)+/gi, '$1'));
            }
            cb(err, data);
          });
        };
        if (!names.some(n => n.toLowerCase() === 'mimetype')) {
          this.getRootFiles();
          return;
        }
        super.checkMimeType();
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parseManifest(manifest: any): void {
        if (manifest && manifest.item && !Array.isArray(manifest.item)) manifest.item = [manifest.item];
        super.parseManifest(manifest);
      }
    };
    tolerantEPub.xml2jsOptions = { ...EPub.xml2jsOptions, tagNameProcessors: [stripPrefix] };
  }
  return tolerantEPub;
}

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
  /** load 第一次失败、内存修正 zip 尾部后才打开成功时为 true */
  repaired = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private epub: any = null;
  private chapters: EpubChapter[] = [];
  /** buildChapterList 用了逐页模式（目录覆盖不到 30% 的页面） */
  private fullFlow = false;
  private manifestByHref = new Map<string, { id: string; mediaType: string }>();

  async load(filePath: string): Promise<void> {
    const EPub = getEPubClass();
    this.repaired = false;
    try {
      this.epub = await EPub.createAsync(filePath);
    } catch (err) {
      // zip 结构有小毛病（如尾部目录条目数写错）时，在内存里修正后再试一次；原文件不动
      const fixed = repairZipEndRecord(fs.readFileSync(filePath));
      if (!fixed) throw err;
      this.epub = await EPub.createAsync(fixed);
      this.repaired = true;
    }
    this.buildManifestMap();
    await this.useNavWhenNoNcx();
    this.buildChapterList();
    const headings = await this.collectPageHeadings();
    if (headings.size > 0) this.buildChapterList(headings);
    await this.applyIndexPageGroups();
  }

  /**
   * 逐页模式下目录里没有标题的页，取页内第一个 h1–h3 作标题。
   * 目录残缺的书（如 Calibre 默认转换中文书，只生成一条「Start」）不至于整本只显示页码；
   * 页数过多时（多为漫画）不逐页打开
   */
  private async collectPageHeadings(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const untitled = this.chapters.filter(c => !c.title);
    if (!this.fullFlow || untitled.length === 0 || untitled.length > PAGE_HEADING_SCAN_LIMIT) return out;
    for (const c of untitled) {
      let html = '';
      try { html = await this.readChapterHtml(c.id); } catch { continue; }
      const heading = firstHeading(html);
      if (heading) out.set(c.id, heading);
    }
    return out;
  }

  /** 没有 NCX 目录（纯 EPUB3）时，用 manifest 里 properties="nav" 的导航文档作目录；epub2 只认 NCX */
  private async useNavWhenNoNcx(): Promise<void> {
    if (Array.isArray(this.epub.toc) && this.epub.toc.length > 0) return;
    const manifest: Record<string, { href?: string; properties?: string }> = this.epub.manifest || {};
    const navId = Object.keys(manifest).find(id => /(^|\s)nav(\s|$)/.test(manifest[id].properties || ''));
    if (!navId || !manifest[navId].href) return;
    try {
      const toc = extractNavToc(await this.readChapterHtml(navId), manifest[navId].href!);
      if (toc.length) this.epub.toc = toc;
    } catch {
      // 导航文档读不出来就按无目录处理
    }
  }

  /** 前 3 页里若有列出各册书名的「总目录」页，按它给平铺的套装目录分组（见 groupByIndexPage） */
  private async applyIndexPageGroups(): Promise<void> {
    if (this.chapters.length < 6) return;
    for (const chapter of this.chapters.slice(0, 3)) {
      let html = '';
      try { html = await this.readChapterHtml(chapter.id); } catch { continue; }
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
    // 有的书正文图片没写进 manifest（只在 zip 里），按 zip 条目名直接读；只认图片扩展名
    if (!item) return this.readZipImage(path);
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

  /** zip 里存在、但 manifest 没声明的图片条目；不是图片扩展名或不存在时返回 null */
  private async readZipImage(entryName: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    const mimeType = imageMimeByExt(entryName);
    const zip = this.epub?.zip;
    if (!mimeType || !zip || !Array.isArray(zip.names) || !zip.names.includes(entryName)) return null;
    try {
      const buf = await new Promise<Buffer>((resolve, reject) => {
        zip.readFile(entryName, (err: Error | null, data: Buffer) => {
          if (err || !data) reject(err || new Error('empty')); else resolve(data);
        });
      });
      return { buffer: Buffer.from(buf), mimeType };
    } catch {
      return null;
    }
  }

  /**
   * 文件内置封面：OPF <meta name="cover"> → EPUB3 cover-image → id / 文件名含 cover 的图片
   * → 第一页是封面页时取页内第一张图。只要光栅图片、至少 1KB（排除占位小图），找不到返回 null。
   */
  async getCoverImage(): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!this.epub) return null;
    const manifest: Record<string, { href?: string; 'media-type'?: string; properties?: string }> = this.epub.manifest || {};
    const isImage = (id: string) => !!manifest[id]?.href && RASTER_MIME.test(manifest[id]['media-type'] || imageMimeByExt(manifest[id].href!) || '');
    const hrefs: string[] = [];
    const add = (href: string | undefined) => { if (href && !hrefs.includes(href)) hrefs.push(href); };

    const metaId = typeof this.epub.metadata?.cover === 'string' ? this.epub.metadata.cover : '';
    if (metaId && isImage(metaId)) add(manifest[metaId].href);
    for (const [id, item] of Object.entries(manifest)) {
      if (isImage(id) && /(^|\s)cover-image(\s|$)/.test(item.properties || '')) add(item.href);
    }
    for (const [id, item] of Object.entries(manifest)) {
      if (isImage(id) && (/cover/i.test(id) || /cover/i.test(path.posix.basename(item.href!)))) add(item.href);
    }
    const first: { id?: string; href?: string } | undefined = (this.epub.flow || [])[0];
    if (first?.id && first.href && /cover|titlepage/i.test(`${first.id} ${first.href}`)) {
      try {
        const html = await this.readChapterHtml(first.id);
        const src = html.match(/<(?:img\b[^>]*?\ssrc|image\b[^>]*?\s(?:xlink:)?href)\s*=\s*["']([^"']+)["']/i)?.[1];
        if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) {
          add(path.posix.normalize(path.posix.join(path.posix.dirname(first.href), src.split('#')[0])));
        }
      } catch {
        // 封面页读不出来就算了
      }
    }

    for (const href of hrefs) {
      const asset = await this.getAsset(href);
      if (asset && asset.buffer.length >= COVER_MIN_BYTES && RASTER_MIME.test(asset.mimeType)) return asset;
    }
    return null;
  }

  private buildChapterList(pageHeadings?: Map<string, string>): void {
    this.fullFlow = false;
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
      this.fullFlow = true;
      // 有标题的页沿用原书目录层级；没有标题的页挂在前面最近一个有标题的条目下面
      // （漫画：卷 → 话 → 各页），目录里默认收起，不再与章节标题平铺
      let lastTitledLevel: number | null = null;
      this.chapters = validFlow.map((item, idx) => {
        // 目录里没有的页，用页内第一个标题（见 collectPageHeadings）；漫画页没有标题，仍为空
        const title = flowIdToTitle.get(item.id) || pageHeadings?.get(item.id) || '';
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

  /**
   * 读出章节文件的 HTML（代替 epub2 的 getChapterRaw）：按文件声明的编码解码；
   * media-type 写成 text/html 等非标准值的章节也照常读取（epub2 会直接报错）
   */
  private async readChapterHtml(id: string): Promise<string> {
    const item = this.epub?.manifest?.[id];
    if (!item?.href) throw new Error(`章节文件不存在：${id}`);
    const mediaType = String(item['media-type'] || '');
    if (mediaType && !/html|xml|svg/i.test(mediaType)) throw new Error(`不是文本章节：${id} ${mediaType}`);
    const buf = await new Promise<Buffer>((resolve, reject) => {
      this.epub.zip.readFile(item.href, (err: Error | null, data?: Buffer) => {
        if (err || !data) reject(err || new Error(`读取章节失败：${item.href}`)); else resolve(data);
      });
    });
    return decodeHtmlBuffer(buf);
  }

  async getChapterContent(index: number): Promise<string> {
    const chapter = this.chapters[index];
    if (!chapter) throw new Error(`章节 ${index} 不存在`);

    const rawHtml = await this.readChapterHtml(chapter.id);
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
