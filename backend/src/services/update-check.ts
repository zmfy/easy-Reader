import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { UPDATE_BRANCH, VERSION_SUFFIX } from '../edition';
import { Release, parseChangelog, newerReleases } from './changelog';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 1024 * 1024; // 远端响应体上限 1MB
const FIRST_CHECK_DELAY_MS = 60 * 1000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateStatus {
  currentVersion: string | null;
  branch: string;
  enabled: boolean;
  checkedAt: string | null;
  error: string | null;
  newer: Release[];
}

type FetchImpl = (url: string, init?: any) => Promise<any>;

function isEnabled(): boolean {
  return (process.env.UPDATE_CHECK || '').trim().toLowerCase() !== 'off';
}

// ---- 本站 CHANGELOG ----

let localCache: { file: string; mtimeMs: number; releases: Release[] } | null = null;

function localCandidates(): string[] {
  const list: string[] = [];
  if (process.env.CHANGELOG_PATH) list.push(process.env.CHANGELOG_PATH);
  list.push(path.join(process.cwd(), 'CHANGELOG.md'), path.join(process.cwd(), '..', 'CHANGELOG.md'));
  return list;
}

export function readLocalChangelog(): { releases: Release[]; currentVersion: string | null; missing: boolean } {
  for (const file of localCandidates()) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      if (!localCache || localCache.file !== file || localCache.mtimeMs !== stat.mtimeMs) {
        localCache = { file, mtimeMs: stat.mtimeMs, releases: parseChangelog(fs.readFileSync(file, 'utf8'), VERSION_SUFFIX) };
      }
      const releases = localCache.releases;
      return { releases, currentVersion: releases.length ? releases[0].version : null, missing: false };
    } catch {
      // 试下一个路径
    }
  }
  return { releases: [], currentVersion: null, missing: true };
}

// ---- 远端拉取 ----

export function updateSources(): string[] {
  const custom = (process.env.UPDATE_CHANGELOG_URL || '').trim();
  if (custom) return [custom];
  return [
    `https://raw.githubusercontent.com/zmfy/easy-Reader/${UPDATE_BRANCH}/CHANGELOG.md`,
    `https://cdn.jsdelivr.net/gh/zmfy/easy-Reader@${UPDATE_BRANCH}/CHANGELOG.md`,
  ];
}

function sourceLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid-url';
  }
}

// 读取响应体，超过上限即中止；错误信息只含原因，不含远端内容
async function readBodyLimited(res: any): Promise<string> {
  const declared = Number(res.headers?.get?.('content-length'));
  if (declared > MAX_BODY_BYTES) throw new Error('响应过大');
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) throw new Error('响应过大');
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error('响应过大');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchOne(url: string, fetchImpl: FetchImpl, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('超时'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const res = await fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
        if (!res.ok) throw new Error(`状态码 ${res.status}`);
        const text = await readBodyLimited(res);
        if (!text.includes('## [')) throw new Error('内容无效');
        return text;
      })(),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchRemoteChangelog(
  sources: string[],
  fetchImpl: FetchImpl = fetch as any,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<{ text: string; source: string }> {
  const reasons: string[] = [];
  for (const source of sources) {
    try {
      return { text: await fetchOne(source, fetchImpl, timeoutMs), source };
    } catch (e: any) {
      const reason = e && e.name === 'AbortError' ? '超时' : e instanceof Error && e.message.length <= 30 ? e.message : '请求失败';
      reasons.push(`${sourceLabel(source)}: ${reason}`);
    }
  }
  throw new Error(`所有来源均失败（${reasons.join('；')}）`);
}

// ---- 缓存与状态 ----

function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getUpdateStatus(db: Database.Database): UpdateStatus {
  const { currentVersion } = readLocalChangelog();
  let remote: Release[] = [];
  try {
    const raw = getSetting(db, 'update_check_result');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.releases)) remote = parsed.releases;
  } catch {
    remote = [];
  }
  return {
    currentVersion,
    branch: UPDATE_BRANCH,
    enabled: isEnabled(),
    checkedAt: getSetting(db, 'update_checked_at'),
    error: getSetting(db, 'update_check_error') || null,
    newer: newerReleases(remote, currentVersion),
  };
}

export async function checkForUpdates(db: Database.Database, fetchImpl: FetchImpl = fetch as any): Promise<UpdateStatus> {
  try {
    const { text, source } = await fetchRemoteChangelog(updateSources(), fetchImpl);
    const releases = parseChangelog(text, VERSION_SUFFIX);
    setSetting(db, 'update_check_result', JSON.stringify({ releases, source }));
    setSetting(db, 'update_check_error', '');
  } catch (e: any) {
    setSetting(db, 'update_check_error', e instanceof Error ? e.message : '检查失败');
  }
  setSetting(db, 'update_checked_at', new Date().toISOString());
  return getUpdateStatus(db);
}

// ---- 定时 ----

export function startUpdateChecker(): void {
  if (!isEnabled()) return;
  const run = () => {
    checkForUpdates(getDb()).catch(e => console.warn('[update-check] 检查失败:', e instanceof Error ? e.message : e));
  };
  setTimeout(() => {
    run();
    setInterval(run, CHECK_INTERVAL_MS).unref();
  }, FIRST_CHECK_DELAY_MS).unref();
}
