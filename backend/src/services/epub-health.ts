import fs from 'fs';
import { EpubParser } from '../plugins/parser-epub';

/**
 * 健康检查规则版本；规则变化时加一，已入库的书会按新规则重查
 * 2：content.opf 元素带 opf: 前缀（epub4j / so-novel）的书不再误判为「没有可读的章节」
 */
export const HEALTH_CHECK_VERSION = 2;
/** 单本检查超时（超时后后台解析继续，不再等） */
export const EPUB_CHECK_TIMEOUT_MS = 15000;

export type EpubHealth =
  | { status: 'ok' }
  | { status: 'repaired' }
  // timedOut：解析超时（可能只是书太大、NAS 太慢），已入库的书不据此判损坏
  | { status: 'damaged'; reason: string; timedOut?: true }
  // 文件系统错误（权限、被占用、IO 等），这次没检查成，不算损坏
  | { status: 'unreadable' };

interface HealthParser {
  load(p: string): Promise<void>;
  getChapters(): Promise<unknown[]>;
  repaired?: boolean;
  dispose?(): void;
}

const REASON_INCOMPLETE = '文件不完整（可能下载或复制中断）';
const REASON_NO_OPF = '缺少书籍目录（content.opf）';
const REASON_NO_CHAPTERS = '没有可读的章节';
const REASON_TIMEOUT = '解析超时';
const REASON_MAX_LEN = 80;

/** zip 缺少尾部目录（EOCD）或中央目录时，多半是下载 / 复制中断；否则返回 null */
export function classifyZipDamage(buf: Buffer): string | null {
  const hasEnd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= 0;
  const hasCentral = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) >= 0;
  return hasEnd && hasCentral ? null : REASON_INCOMPLETE;
}

function describeError(err: unknown, filePath: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  const cleaned = raw
    .split(filePath).join('')
    .replace(/(?:[A-Za-z]:)?[\\/](?:[^\s\\/:'"]+[\\/])*[^\s\\/:'"]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const prefix = '无法解析：';
  return prefix + (cleaned || '未知错误').slice(0, REASON_MAX_LEN - prefix.length);
}

/** Node 文件系统错误（带 syscall 与 E 开头的 code），不是 zip / 解析错误 */
function isFsError(err: unknown): boolean {
  const e = err as { code?: unknown; syscall?: unknown } | null;
  return !!e && typeof e.code === 'string' && /^E[A-Z]+$/.test(e.code) && typeof e.syscall === 'string';
}

function classifyLoadError(err: unknown, filePath: string): string {
  let buf: Buffer | null = null;
  try { buf = fs.readFileSync(filePath); } catch { /* 读不出来按错误信息判断 */ }
  const zipReason = buf ? classifyZipDamage(buf) : null;
  if (zipReason) return zipReason;
  const raw = err instanceof Error ? err.message : String(err);
  if (/\.opf|rootfile|container\.xml|content\.opf/i.test(raw)) return REASON_NO_OPF;
  return describeError(err, filePath);
}

export async function checkEpubHealth(
  filePath: string,
  opts: { timeoutMs?: number; createParser?: () => HealthParser } = {},
): Promise<EpubHealth> {
  const timeoutMs = opts.timeoutMs ?? EPUB_CHECK_TIMEOUT_MS;
  const parser: HealthParser = opts.createParser ? opts.createParser() : new EpubParser();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<EpubHealth>(resolve => {
    timer = setTimeout(() => resolve({ status: 'damaged', reason: REASON_TIMEOUT, timedOut: true }), timeoutMs);
  });
  const run = (async (): Promise<EpubHealth> => {
    try {
      await parser.load(filePath);
      const chapters = await parser.getChapters();
      if (!chapters || chapters.length === 0) return { status: 'damaged', reason: REASON_NO_CHAPTERS };
      return parser.repaired ? { status: 'repaired' } : { status: 'ok' };
    } catch (err) {
      if (isFsError(err)) return { status: 'unreadable' };
      return { status: 'damaged', reason: classifyLoadError(err, filePath) };
    }
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    try { parser.dispose?.(); } catch { /* 释放失败不影响结论 */ }
  }
}
