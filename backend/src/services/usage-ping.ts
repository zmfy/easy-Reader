import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { EDITION } from '../edition';
import { readLocalChangelog } from './update-check';

// 匿名使用统计：每天随更新检查发送一次，用于了解大约有多少台在运行、用的版本与 CPU 架构。
// 只发送下面 4 个字段，不含书名、账号、阅读记录；接收端不记录 IP。
// 关闭方式：设置页「匿名使用统计」开关，或环境变量 USAGE_STATS=off。

const DEFAULT_URL = 'https://easyreader.ucool.uk/api/metrics/install';
const TIMEOUT_MS = 5000;

export interface UsagePayload {
  id: string;      // 随机生成的实例 ID，与任何用户数据无关
  edition: string; // main = 看书版，study = 学习版
  version: string; // 本站 CHANGELOG 中的当前版本
  arch: string;    // CPU 架构，如 x64 / arm64
}

type FetchImpl = (url: string, init?: any) => Promise<any>;

function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function isUsageStatsEnvDisabled(): boolean {
  return (process.env.USAGE_STATS || '').trim().toLowerCase() === 'off';
}

export function isUsageStatsEnabled(db: Database.Database): boolean {
  if (isUsageStatsEnvDisabled()) return false;
  return getSetting(db, 'usage_stats_enabled') !== 'false';
}

export function usageStatsUrl(): string {
  return (process.env.USAGE_STATS_URL || '').trim() || DEFAULT_URL;
}

export function getInstanceId(db: Database.Database): string {
  const existing = getSetting(db, 'instance_id');
  if (existing) return existing;
  const id = randomUUID();
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('instance_id', id);
  return getSetting(db, 'instance_id') || id;
}

export function buildUsagePayload(db: Database.Database): UsagePayload {
  return {
    id: getInstanceId(db),
    edition: EDITION,
    version: readLocalChangelog().currentVersion || 'unknown',
    arch: process.arch,
  };
}

// 发送一次；关闭时不发送。任何失败都只返回 false，不抛错、不影响其他功能
export async function sendUsagePing(
  db: Database.Database,
  fetchImpl: FetchImpl = fetch as any,
  timeoutMs: number = TIMEOUT_MS
): Promise<boolean> {
  try {
    if (!isUsageStatsEnabled(db)) return false;
    const body = JSON.stringify(buildUsagePayload(db));
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('超时')); }, timeoutMs);
    });
    try {
      const res = await Promise.race([
        fetchImpl(usageStatsUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        }),
        timeout,
      ]);
      return !!res && res.ok === true;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return false;
  }
}
