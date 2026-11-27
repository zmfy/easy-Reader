import fs from 'fs';
import { PdfParser } from '../plugins/parser-pdf';
import { UmdParser } from '../plugins/parser-umd';
import {
  checkEpubHealth, describeError, isFsError, EpubHealth, EPUB_CHECK_TIMEOUT_MS, REASON_INCOMPLETE, REASON_TIMEOUT,
} from './epub-health';

/**
 * 扫描时的健康检查（所有格式）：打不开 / 没有内容的书进入审核批次的「文件损坏」组，已入库的标为损坏。
 * 健康检查规则版本；规则变化时加一，已入库的书会按新规则重查
 * 2：content.opf 元素带 opf: 前缀（epub4j / so-novel）的书不再误判为「没有可读的章节」
 * 3：没有 mimetype、container 路径带 ./、条目名大小写不一致、manifest 只有一个条目的书不再误判损坏
 * 4：PDF / UMD / TXT 也做检查（之前只查 EPUB）
 */
export const HEALTH_CHECK_VERSION = 4;
/** 做健康检查的格式 */
export const HEALTH_FORMATS = ['epub', 'pdf', 'umd', 'txt'];

export type BookHealth = EpubHealth;

export const REASON_PDF_PASSWORD = '需要打开密码（加密的 PDF）';
const REASON_NO_PAGES = '没有页面';
const REASON_NOT_UMD = '不是有效的 UMD 文件';
const REASON_NO_UMD_CHAPTERS = '没有可读的章节';
const REASON_EMPTY = '文件是空的';

interface Opts { timeoutMs?: number }

/** 解析器检查：load 后用 hasContent 判断有没有内容；超时 / 文件系统错误的处理与 EPUB 一致 */
async function checkWithParser(
  filePath: string,
  parser: { load(p: string): Promise<void>; dispose?(): void },
  hasContent: () => Promise<string | null>,
  classify: (err: unknown) => string,
  opts: Opts,
): Promise<BookHealth> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<BookHealth>(resolve => {
    timer = setTimeout(() => resolve({ status: 'damaged', reason: REASON_TIMEOUT, timedOut: true }), opts.timeoutMs ?? EPUB_CHECK_TIMEOUT_MS);
  });
  const run = (async (): Promise<BookHealth> => {
    try {
      await parser.load(filePath);
      const reason = await hasContent();
      return reason ? { status: 'damaged', reason } : { status: 'ok' };
    } catch (err) {
      if (isFsError(err)) return { status: 'unreadable' };
      return { status: 'damaged', reason: classify(err) };
    }
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    try { parser.dispose?.(); } catch { /* 释放失败不影响结论 */ }
  }
}

/** PDF 结尾 1KB 里找不到 %%EOF：多半是下载 / 复制中断 */
function pdfTruncated(filePath: string): boolean {
  try {
    const { size } = fs.statSync(filePath);
    const len = Math.min(1024, size);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(filePath, 'r');
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    return !buf.includes('%%EOF');
  } catch {
    return false;
  }
}

export async function checkBookHealth(filePath: string, format: string, opts: Opts = {}): Promise<BookHealth> {
  switch (format.toLowerCase()) {
    case 'epub':
      return checkEpubHealth(filePath, opts);
    case 'pdf': {
      const parser = new PdfParser();
      return checkWithParser(filePath, parser,
        async () => ((await parser.getTotalProgress()) > 0 ? null : REASON_NO_PAGES),
        err => {
          if ((err as { name?: string } | null)?.name === 'PasswordException') return REASON_PDF_PASSWORD;
          if (pdfTruncated(filePath)) return REASON_INCOMPLETE;
          return describeError(err, filePath);
        }, opts);
    }
    case 'umd': {
      const parser = new UmdParser();
      return checkWithParser(filePath, parser,
        async () => ((await parser.getChapters()).length > 0 ? null : REASON_NO_UMD_CHAPTERS),
        err => (/魔数/.test(err instanceof Error ? err.message : '') ? REASON_NOT_UMD : describeError(err, filePath)), opts);
    }
    case 'txt':
      try {
        return fs.statSync(filePath).size === 0 ? { status: 'damaged', reason: REASON_EMPTY } : { status: 'ok' };
      } catch {
        return { status: 'unreadable' };
      }
    default:
      return { status: 'ok' };
  }
}
