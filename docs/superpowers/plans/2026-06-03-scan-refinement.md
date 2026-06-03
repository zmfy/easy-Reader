# 扫描功能完善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扫描回归确定性纯指纹判重、隐藏脆弱的扫描时 AI（去重/系列）、把 AI 填充做成版本号+双重跳过的批量能力，并用「文件未变跳过」大幅提速重扫。

**Architecture:** 在 `books` 表加 `file_mtime` / `fingerprint_version` / `ai_fill_version` 三列；walker 收文件时只 `stat`（不读内容），用纯函数 `shouldReuseFingerprint` 决定是否复用旧指纹；移除扫描流程对 AI 去重/系列函数的调用（保留函数本体）；AI 填充用版本号过滤候选并在处理后（成功/失败都）标版本。前端隐藏系列卡与 AI 去重/系列开关，新增书库「批量 AI 填充」入口。

**Tech Stack:** TypeScript, Express, better-sqlite3, Jest (ts-jest), Vue 3 + Element Plus, Docker。

**约定:**
- 后端纯逻辑一律 TDD（先写失败测试）。前端无单测框架 → 用 `npm run build` + 浏览器手测验证。
- 后端测试命令在 `backend/` 目录下：`npx jest <path>`。
- 每个 Task 结束 `npx tsc --noEmit` 干净 + 相关测试绿 + 独立 commit。commit message 末尾带：
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 部署验证：`docker compose up -d --build`（容器 `novel-reader`，:8080→:3000，admin/admin123）。

**spec:** `docs/superpowers/specs/2026-06-03-scan-refinement-design.md`

---

## File Structure

**新建**
- `backend/src/services/scan-versions.ts` — `FINGERPRINT_VERSION`、`AI_FILL_VERSION` 常量 + `shouldReuseFingerprint()` + `backfillFingerprintVersion()` 纯/半纯逻辑（集中、可测）。
- `backend/tests/services/scan-versions.test.ts` — 上述纯函数测试。

**修改（后端）**
- `backend/src/db.ts` — 3 列迁移 + 调用 backfill。
- `backend/src/types/index.ts` — `ScanOptions`（去 ai_dedup/ai_series、mode 去 hybrid）、`NewBookPayload`（加 file_mtime/fingerprint_version）。
- `backend/src/services/scan-walker.ts` — 增量跳过；移除 AI 去重/系列调用与 hybrid 分支；ai_fill 候选版本感知。
- `backend/src/services/batch-applier.ts` — `upsertBookByPath` 写入 file_mtime/fingerprint_version。
- `backend/src/services/ai-batch-fill.ts` — `selectFillCandidates()` / `stampFillVersion()` / `force` 入参 / 处理后标版本。
- `backend/src/services/cost-estimator.ts` — 仅算填充。
- `backend/src/routes/library.ts` — scanOptionsSchema 调整；`/scan/estimate` 仅填充；新增 `POST /library/ai-fill-batch`。
- `backend/tests/services/cost-estimator.test.ts`、`backend/tests/services/ai-batch-fill.test.ts`（新）。

**修改（前端）**
- `frontend/src/types/index.ts` — `ScanStartOptions`（去 ai_dedup/ai_series、mode 去 hybrid）、`CostEstimate`（去 dedup/series）。
- `frontend/src/api/library.ts` — `estimate` 入参收窄、新增 `aiFillBatch`。
- `frontend/src/components/ScanOptionsDialog.vue` — 去 AI 去重/系列开关 + hybrid 模式。
- `frontend/src/views/Library.vue` — 移除系列卡/拉取、恒平铺、新增「批量 AI 填充」按钮+对话框。

---

## Task 1: 版本常量 + 表结构迁移 + 回填

**Files:**
- Create: `backend/src/services/scan-versions.ts`
- Create: `backend/tests/services/scan-versions.test.ts`
- Modify: `backend/src/db.ts:128-141`

- [ ] **Step 1: 写失败测试（backfill 回填）**

`backend/tests/services/scan-versions.test.ts`:
```ts
import Database from 'better-sqlite3';
import { backfillFingerprintVersion, FINGERPRINT_VERSION } from '../../src/services/scan-versions';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT, fingerprint TEXT,
    file_mtime REAL, fingerprint_version INTEGER, ai_fill_version INTEGER
  );`);
  return db;
}

describe('backfillFingerprintVersion', () => {
  it('stamps current version on rows that already have a fingerprint', () => {
    const db = freshDb();
    db.prepare("INSERT INTO books (id, title, fingerprint) VALUES ('a','A','fp1')").run();
    db.prepare("INSERT INTO books (id, title, fingerprint) VALUES ('b','B', NULL)").run();
    backfillFingerprintVersion(db);
    const a = db.prepare("SELECT fingerprint_version v FROM books WHERE id='a'").get() as { v: number };
    const b = db.prepare("SELECT fingerprint_version v FROM books WHERE id='b'").get() as { v: number | null };
    expect(a.v).toBe(FINGERPRINT_VERSION);
    expect(b.v).toBeNull();
  });

  it('does not overwrite an already-set version', () => {
    const db = freshDb();
    db.prepare("INSERT INTO books (id, title, fingerprint, fingerprint_version) VALUES ('a','A','fp1', 0)").run();
    backfillFingerprintVersion(db);
    const a = db.prepare("SELECT fingerprint_version v FROM books WHERE id='a'").get() as { v: number };
    expect(a.v).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest tests/services/scan-versions.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/scan-versions'`

- [ ] **Step 3: 写实现**

`backend/src/services/scan-versions.ts`:
```ts
import Database from 'better-sqlite3';

/** Bump when the fingerprint algorithm changes → forces a full rebuild next scan. */
export const FINGERPRINT_VERSION = 1;
/** Bump when the AI-fill prompt/logic changes → forces a full re-fill next run. */
export const AI_FILL_VERSION = 1;

/**
 * One-time migration backfill: rows that already have a fingerprint (built by a
 * prior version of the app) are assumed to be at the current algorithm version.
 * Rows whose version is already set are left untouched.
 */
export function backfillFingerprintVersion(db: Database.Database): void {
  db.prepare(
    'UPDATE books SET fingerprint_version = ? WHERE fingerprint IS NOT NULL AND fingerprint_version IS NULL'
  ).run(FINGERPRINT_VERSION);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest tests/services/scan-versions.test.ts`
Expected: PASS（2 个用例）

- [ ] **Step 5: 加表结构迁移**

`backend/src/db.ts`，在 `booksAlters` 数组末尾追加三列（`db.ts:129-138`）：
```ts
  const booksAlters: string[] = [
    "ALTER TABLE books ADD COLUMN status TEXT DEFAULT 'normal'",
    "ALTER TABLE books ADD COLUMN duplicate_of TEXT",
    "ALTER TABLE books ADD COLUMN series_id TEXT",
    "ALTER TABLE books ADD COLUMN chapter_count INTEGER",
    "ALTER TABLE books ADD COLUMN fingerprint TEXT",
    "ALTER TABLE books ADD COLUMN first_chapter_hash TEXT",
    "ALTER TABLE books ADD COLUMN encoding_detected TEXT",
    "ALTER TABLE books ADD COLUMN manually_edited_fields TEXT",
    "ALTER TABLE books ADD COLUMN file_mtime REAL",
    "ALTER TABLE books ADD COLUMN fingerprint_version INTEGER",
    "ALTER TABLE books ADD COLUMN ai_fill_version INTEGER",
  ];
  for (const stmt of booksAlters) {
    try { database.exec(stmt); } catch { /* column exists */ }
  }
```
在 `db.ts` 顶部 import 区加：
```ts
import { backfillFingerprintVersion } from './services/scan-versions';
```
在上面 `for` 循环之后、`CREATE INDEX … idx_books_fingerprint` 之前插入一行：
```ts
  backfillFingerprintVersion(database);
```
> 注意：确认 `db.ts` 中此处的局部变量名（`database`）。若不同请用实际变量名。

- [ ] **Step 6: 编译 + 全量测试**

Run: `cd backend && npx tsc --noEmit && npx jest`
Expected: tsc 无输出；所有测试 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/scan-versions.ts backend/tests/services/scan-versions.test.ts backend/src/db.ts
git commit -m "feat(scan): fingerprint/ai-fill version columns + backfill

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: walker 增量跳过（版本 + mtime + size）

**Files:**
- Modify: `backend/src/services/scan-versions.ts`（加 `shouldReuseFingerprint`）
- Modify: `backend/tests/services/scan-versions.test.ts`
- Modify: `backend/src/types/index.ts:186-196`（NewBookPayload）
- Modify: `backend/src/services/scan-walker.ts`（主循环 + processFile + ScannedBookEx + toNewPayload）
- Modify: `backend/src/services/batch-applier.ts:66-104`（upsertBookByPath）

- [ ] **Step 1: 写失败测试（shouldReuseFingerprint）**

在 `scan-versions.test.ts` 末尾追加：
```ts
import { shouldReuseFingerprint } from '../../src/services/scan-versions';

describe('shouldReuseFingerprint', () => {
  const base = { fingerprint: 'fp', file_size: 100, file_mtime: 5000, fingerprint_version: FINGERPRINT_VERSION };
  const call = (over: Partial<Parameters<typeof shouldReuseFingerprint>[0]>) =>
    shouldReuseFingerprint({ existing: base, statSize: 100, statMtime: 5000, fingerprintVersion: FINGERPRINT_VERSION, fullRescan: false, ...over });

  it('reuses when version+size+mtime all match', () => {
    expect(call({})).toBe(true);
  });
  it('rebuilds on full_rescan', () => {
    expect(call({ fullRescan: true })).toBe(false);
  });
  it('rebuilds when no existing row', () => {
    expect(call({ existing: undefined })).toBe(false);
  });
  it('rebuilds when fingerprint missing', () => {
    expect(call({ existing: { ...base, fingerprint: undefined } })).toBe(false);
  });
  it('rebuilds when version is stale', () => {
    expect(call({ existing: { ...base, fingerprint_version: FINGERPRINT_VERSION - 1 } })).toBe(false);
  });
  it('rebuilds when file size changed', () => {
    expect(call({ statSize: 999 })).toBe(false);
  });
  it('rebuilds when mtime changed', () => {
    expect(call({ statMtime: 9999 })).toBe(false);
  });
  it('trusts a null mtime (migration leftover) and reuses', () => {
    expect(call({ existing: { ...base, file_mtime: null } })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest tests/services/scan-versions.test.ts`
Expected: FAIL — `shouldReuseFingerprint is not a function`

- [ ] **Step 3: 实现 shouldReuseFingerprint**

`backend/src/services/scan-versions.ts` 追加：
```ts
export interface ReuseCheckInput {
  existing?: {
    fingerprint?: string | null;
    file_size?: number | null;
    file_mtime?: number | null;
    fingerprint_version?: number | null;
  };
  statSize: number;
  statMtime: number;
  fingerprintVersion: number;
  fullRescan: boolean;
}

/**
 * Decide whether an on-disk file can reuse its stored fingerprint instead of
 * being re-read and re-hashed. Reuse requires: not a full rescan, an existing
 * row with a fingerprint at the current algorithm version, matching file size,
 * and matching mtime — except a NULL stored mtime (migration leftover) is
 * trusted so an upgraded library doesn't force a one-time full re-read.
 */
export function shouldReuseFingerprint(i: ReuseCheckInput): boolean {
  if (i.fullRescan) return false;
  const e = i.existing;
  if (!e || !e.fingerprint) return false;
  if (e.fingerprint_version !== i.fingerprintVersion) return false;
  if (e.file_size !== i.statSize) return false;
  if (e.file_mtime != null && e.file_mtime !== i.statMtime) return false;
  return true;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest tests/services/scan-versions.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: NewBookPayload 加字段**

`backend/src/types/index.ts`，`NewBookPayload`（186-196）加两行：
```ts
export interface NewBookPayload {
  file_path: string;
  title: string;
  file_format: string;
  file_size: number;
  chapter_count?: number;
  fingerprint?: string;
  first_chapter_hash?: string;
  encoding_detected?: string;
  status?: 'normal' | 'encoding_fixed';
  file_mtime?: number;
  fingerprint_version?: number;
}
```

- [ ] **Step 6: walker 主循环改用 stat + shouldReuseFingerprint**

`backend/src/services/scan-walker.ts`：
1. 顶部 import：`import { FINGERPRINT_VERSION, shouldReuseFingerprint } from './scan-versions';`（`fs` 已 import）。
2. 预取 map（72-76）改为携带更多列：
```ts
    const prefetched = new Map<string, { id: string; fingerprint?: string; file_size?: number; file_mtime?: number | null; fingerprint_version?: number | null }>();
    if (!options.full_rescan) {
      const rows = getDb().prepare('SELECT id, file_path, fingerprint, file_size, file_mtime, fingerprint_version FROM books').all() as Array<{ id: string; file_path: string; fingerprint?: string; file_size?: number; file_mtime?: number | null; fingerprint_version?: number | null }>;
      for (const r of rows) prefetched.set(r.file_path, { id: r.id, fingerprint: r.fingerprint, file_size: r.file_size, file_mtime: r.file_mtime, fingerprint_version: r.fingerprint_version });
    }
```
3. 主循环（78-97）替换为：
```ts
    for (const fullPath of allFiles) {
      if (isCancelled(taskId)) return;
      let st: fs.Stats;
      try { st = fs.statSync(fullPath); } catch { processed++; continue; }
      const pre = prefetched.get(fullPath);
      if (shouldReuseFingerprint({ existing: pre, statSize: st.size, statMtime: st.mtimeMs, fingerprintVersion: FINGERPRINT_VERSION, fullRescan: options.full_rescan })) {
        // Backfill a migration-leftover NULL mtime without re-reading the file.
        if (pre && pre.file_mtime == null) {
          getDb().prepare('UPDATE books SET file_mtime = ?, fingerprint_version = ? WHERE id = ?').run(st.mtimeMs, FINGERPRINT_VERSION, pre.id);
        }
        processed++;
        if (processed % 50 === 0 || processed === allFiles.length) {
          setScanProgress(taskId, { processed_files: processed });
        }
        continue;
      }
      const result = await processFile(fullPath, options, st);
      if (result.scanned) scanned.push(result.scanned);
      if (result.garbled) garbled.push(result.garbled);
      if (result.encoding_fixed) encodingFixed.push(result.encoding_fixed);
      processed++;
      if (processed % 5 === 0 || processed === allFiles.length) {
        setScanProgress(taskId, { processed_files: processed });
      }
    }
```

- [ ] **Step 7: processFile 接收 stat 并写入 file_mtime；删除内部 skip**

`backend/src/services/scan-walker.ts`：
1. `ScannedBookEx`（280-285）加 `file_mtime: number;`。
2. `processFile` 签名加 `st: fs.Stats` 参数；删除内部 skip 检查（342-349 的 `existing && existing.fingerprint && !full_rescan → return {}`，主循环已统一处理）。
3. 构造返回的 `scanned` 对象时设置 `file_size: st.size, file_mtime: st.mtimeMs`（替换原来读 file_size 的来源——确认 processFile 末尾组装 `ScannedBookEx` 处把 `file_size`/`file_mtime` 设为 `st.size`/`st.mtimeMs`）。
4. `toNewPayload`（287-298）加两行：
```ts
function toNewPayload(b: ScannedBookEx): NewBookPayload {
  return {
    file_path: b.file_path,
    title: b.title,
    file_format: b.file_format,
    file_size: b.file_size,
    chapter_count: b.chapter_count,
    fingerprint: b.fingerprint,
    encoding_detected: b.encoding_detected,
    status: b.status,
    file_mtime: b.file_mtime,
    fingerprint_version: FINGERPRINT_VERSION,
  };
}
```
> 注：`processFile` 末尾组装 `ScannedBookEx` 的确切代码在 388 行之后（本计划未全部展开）。落地时读 `scan-walker.ts:386-430` 找到 `return { scanned: { … } }`，把 `file_size` 改成 `st.size` 并加 `file_mtime: st.mtimeMs`。

- [ ] **Step 8: upsertBookByPath 写入新列**

`backend/src/services/batch-applier.ts`，`upsertBookByPath`（66-104）：
UPDATE 分支改为：
```ts
      db.prepare(
        `UPDATE books SET title = ?, fingerprint = ?, first_chapter_hash = ?, chapter_count = ?, encoding_detected = ?, status = ?, file_size = ?, file_mtime = ?, fingerprint_version = ? WHERE id = ?`
      ).run(
        payload.title,
        payload.fingerprint ?? null,
        payload.first_chapter_hash ?? null,
        payload.chapter_count ?? null,
        payload.encoding_detected ?? null,
        payload.status ?? 'normal',
        payload.file_size,
        payload.file_mtime ?? null,
        payload.fingerprint_version ?? null,
        existing.id,
      );
```
INSERT 分支改为：
```ts
    const id = uuidv4();
    db.prepare(
      `INSERT INTO books (id, title, file_path, file_format, file_size, status, fingerprint, first_chapter_hash, chapter_count, encoding_detected, file_mtime, fingerprint_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      payload.title,
      payload.file_path,
      payload.file_format,
      payload.file_size,
      payload.status ?? 'normal',
      payload.fingerprint ?? null,
      payload.first_chapter_hash ?? null,
      payload.chapter_count ?? null,
      payload.encoding_detected ?? null,
      payload.file_mtime ?? null,
      payload.fingerprint_version ?? null,
    );
```

- [ ] **Step 9: 编译 + 全量测试**

Run: `cd backend && npx tsc --noEmit && npx jest`
Expected: tsc 干净；测试 PASS（含 batch-applier.test.ts —— 若该测试断言了 INSERT 列，按新增列更新断言）。

- [ ] **Step 10: Commit**

```bash
git add backend/src/services/scan-versions.ts backend/tests/services/scan-versions.test.ts backend/src/types/index.ts backend/src/services/scan-walker.ts backend/src/services/batch-applier.ts
git commit -m "feat(scan): skip unchanged files via version+mtime+size

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 移除扫描时 AI（去重/系列）+ 删除 hybrid 模式

**Files:**
- Modify: `backend/src/services/scan-walker.ts`（Phase 3/4/5、Phase 7 hybrid、processFile 灰区分支）

- [ ] **Step 1: 移除 AI 去重 + 系列调用**

`scan-walker.ts`：
1. 删除 Phase 3 AI 去重块（155-159）：
```ts
    let aiDupGroups: DuplicateGroupPayload[] = [];
    if (options.ai_dedup && soft_groups.length > 0) {
      aiDupGroups = await judgeSoftDuplicateGroups(soft_groups, undefined, taskId);
    }
```
→ 替换为：
```ts
    // AI dedup removed from scan (deterministic fingerprint dedup only).
    const aiDupGroups: DuplicateGroupPayload[] = [];
```
2. 删除 Phase 4 正则系列 + Phase 5 AI 系列（171-186），替换为：
```ts
    // Series grouping removed from scan (deferred to the future AI agent).
    const regexSeriesPayloads: SeriesGroupPayload[] = [];
    const aiSeriesPayloads: SeriesGroupPayload[] = [];
```
3. `setScanProgress(taskId, { stage: 'series' })`（172）删除（无系列阶段）。
4. `buildCandidateGroups(dedupInput)` 仍保留（硬指纹去重要用 `hard_groups`）；`soft_groups` 不再使用——若 lint 报未用，改为 `const { hard_groups } = buildCandidateGroups(dedupInput);`。
5. 顶部 import 中 `judgeSoftDuplicateGroups`、`extractSeriesCandidates`、`judgeFuzzySeriesGroups` 若变为未使用，删除这些 import（**保留这些源文件本身**，只是不再 import）。`seriesInput`（146-151）若不再使用一并删除。

- [ ] **Step 2: 删除 hybrid 分支**

`scan-walker.ts` Phase 7（208-248）：删除 `else if (options.mode === 'hybrid') { … }` 整块。结果只剩 `if (options.mode === 'auto') { … } else { /* review */ … }`。

- [ ] **Step 3: processFile 灰区编码回退**

`scan-walker.ts` processFile（356-372）：删除 `options.ai_dedup === true` 的 AI 灰区验证分支，使「不确定」编码直接标记乱码。替换 354-376 为：
```ts
    try {
      const enc = await detectAndFixEncoding(fullPath);
      if (enc.status === 'uncertain') {
        return { garbled: { file_path: fullPath, reason: `low ratio ${(enc.best_ratio ?? 0).toFixed(2)}` } };
      }
      status = enc.status;
      encoding = enc.encoding;
    } catch {
      status = 'garbled';
      encoding = 'unknown';
    }
```
（移除对 `aiManager.judgeGarbled` 的调用；若该 import 在本文件仅此处使用则删除 import。）

- [ ] **Step 4: 编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 干净（此时 `options.ai_dedup`/`ai_series` 仍存在于类型，未用不报错）。

- [ ] **Step 5: 跑全量测试**

Run: `cd backend && npx jest`
Expected: PASS。若 scan-walker 相关测试断言了 series/ai_dedup 行为，更新为"恒空"。

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/scan-walker.ts
git commit -m "feat(scan): strip scan-time AI dedup/series + delete hybrid mode

Keep fingerprint hard-dedup; series & AI-dedup services preserved but no
longer called during scan (reserved for the future agent). Uncertain encoding
reverts to deterministic garbled-marking.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 收窄 ScanOptions 类型 + 费用估算只算填充

**Files:**
- Modify: `backend/src/types/index.ts:137-143`（ScanOptions）
- Modify: `backend/src/services/cost-estimator.ts`
- Modify: `backend/tests/services/cost-estimator.test.ts`
- Modify: `backend/src/routes/library.ts:88-94`（scanOptionsSchema）+ `/scan/estimate` handler

- [ ] **Step 1: 改 cost-estimator 测试（先红）**

把 `backend/tests/services/cost-estimator.test.ts` 中针对 `ai_dedup`/`ai_series`/`dedup`/`series` 的用例改为只剩填充语义。新增/替换核心用例：
```ts
import { estimateCalls } from '../../src/services/cost-estimator';

describe('estimateCalls (fill-only)', () => {
  it('counts fill candidates when ai_fill on', () => {
    expect(estimateCalls({ ai_fill: true, books_to_fill: 7 })).toEqual({ fill: 7, total: 7 });
  });
  it('zero when ai_fill off', () => {
    expect(estimateCalls({ ai_fill: false, books_to_fill: 7 })).toEqual({ fill: 0, total: 0 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest tests/services/cost-estimator.test.ts`
Expected: FAIL（类型/字段不匹配）

- [ ] **Step 3: 改 cost-estimator 实现**

`backend/src/services/cost-estimator.ts`：
```ts
export interface EstimateInput {
  ai_fill: boolean;
  books_to_fill: number;
}

export interface EstimateOutput {
  fill: number;
  total: number;
}

export function estimateCalls(input: EstimateInput): EstimateOutput {
  const fill = input.ai_fill ? input.books_to_fill : 0;
  return { fill, total: fill };
}

export function estimateFromCurrentDb(opts: {
  ai_fill: boolean;
  full_rescan: boolean;
}): EstimateOutput & { active_plugin: string | null; tier: CostTier } {
  const db = getDb();
  const fillCandidates = (db.prepare(
    "SELECT COUNT(*) as c FROM books WHERE status = 'normal' AND duplicate_of IS NULL AND ((author IS NULL OR author = '') OR (summary IS NULL OR summary = ''))"
  ).get() as { c: number }).c;

  const est = estimateCalls({ ai_fill: opts.ai_fill, books_to_fill: fillCandidates });
  const active = getActivePluginName();
  return { ...est, active_plugin: active, tier: active ? tierForPlugin(active) : 'unknown' };
}
```
（删除 `soft_dup_candidate_groups` / `series_fuzzy_groups` / `dedup` / `series` 相关代码。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest tests/services/cost-estimator.test.ts`
Expected: PASS

- [ ] **Step 5: 收窄 ScanOptions 类型**

`backend/src/types/index.ts`（137-143）：
```ts
export interface ScanOptions {
  mode: 'auto' | 'review';
  ai_fill: boolean;
  full_rescan: boolean;
}
```

- [ ] **Step 6: 改 scanOptionsSchema + /scan/estimate**

`backend/src/routes/library.ts`：
1. scanOptionsSchema（88-94）：
```ts
const scanOptionsSchema = z.object({
  mode: z.enum(['auto', 'review']).default('review'),
  ai_fill: z.boolean().default(false),
  full_rescan: z.boolean().default(false),
});
```
2. `/scan/estimate` handler：把读取的 query 改为只 `ai_fill` + `full_rescan`，调用 `estimateFromCurrentDb({ ai_fill, full_rescan })`。删除对 `ai_dedup`/`ai_series` 的解析。
> 落地时 grep `estimateFromCurrentDb` 与 `ai_dedup` / `ai_series` 在 library.ts 的全部出现处，逐一清理。

- [ ] **Step 7: 编译 + 全量测试**

Run: `cd backend && npx tsc --noEmit && npx jest`
Expected: tsc 干净；测试 PASS。（若仍有引用 `options.ai_dedup`/`ai_series` 的残留 → 编译会报，按提示删除。）

- [ ] **Step 8: Commit**

```bash
git add backend/src/types/index.ts backend/src/services/cost-estimator.ts backend/tests/services/cost-estimator.test.ts backend/src/routes/library.ts
git commit -m "feat(scan): ScanOptions drops ai_dedup/ai_series/hybrid; estimate fill-only

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: AI 填充版本感知 + 强制重填 + 处理后标版本

**Files:**
- Modify: `backend/src/services/ai-batch-fill.ts`
- Create: `backend/tests/services/ai-batch-fill.test.ts`
- Modify: `backend/src/services/scan-walker.ts`（Phase 8 候选查询）

- [ ] **Step 1: 写失败测试（候选筛选 + 标版本）**

`backend/tests/services/ai-batch-fill.test.ts`:
```ts
import Database from 'better-sqlite3';
import { selectFillCandidates, stampFillVersion } from '../../src/services/ai-batch-fill';
import { AI_FILL_VERSION } from '../../src/services/scan-versions';

function db(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT, author TEXT, summary TEXT,
    file_path TEXT, file_format TEXT, status TEXT, duplicate_of TEXT,
    ai_fill_version INTEGER
  );`);
  return d;
}
const ins = (d: Database.Database, o: Record<string, unknown>) =>
  d.prepare(`INSERT INTO books (id,title,author,summary,file_path,file_format,status,duplicate_of,ai_fill_version)
             VALUES (@id,@title,@author,@summary,@file_path,@file_format,@status,@duplicate_of,@ai_fill_version)`)
    .run({ author: null, summary: null, status: 'normal', duplicate_of: null, ai_fill_version: null, file_format: 'txt', ...o });

describe('selectFillCandidates', () => {
  it('includes books missing author/summary and not yet filled at current version', () => {
    const d = db();
    ins(d, { id: 'a', title: 'A', file_path: '/a' });                       // empty → include
    ins(d, { id: 'b', title: 'B', author: '作者', summary: '简介', file_path: '/b' }); // full → exclude
    ins(d, { id: 'c', title: 'C', file_path: '/c', ai_fill_version: AI_FILL_VERSION }); // tried → exclude
    const ids = selectFillCandidates(d, false).map(r => r.id);
    expect(ids).toEqual(['a']);
  });

  it('force includes ALL normal non-duplicate books regardless of version/fields', () => {
    const d = db();
    ins(d, { id: 'a', title: 'A', file_path: '/a' });
    ins(d, { id: 'b', title: 'B', author: '作者', summary: '简介', file_path: '/b', ai_fill_version: AI_FILL_VERSION });
    ins(d, { id: 'x', title: 'X', file_path: '/x', status: 'duplicate' });   // excluded even with force
    const ids = selectFillCandidates(d, true).map(r => r.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });
});

describe('stampFillVersion', () => {
  it('marks the book at current version', () => {
    const d = db();
    ins(d, { id: 'a', title: 'A', file_path: '/a' });
    stampFillVersion(d, 'a');
    const v = (d.prepare("SELECT ai_fill_version v FROM books WHERE id='a'").get() as { v: number }).v;
    expect(v).toBe(AI_FILL_VERSION);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest tests/services/ai-batch-fill.test.ts`
Expected: FAIL — `selectFillCandidates is not a function`

- [ ] **Step 3: 实现 selectFillCandidates + stampFillVersion，并接入 batchFill**

`backend/src/services/ai-batch-fill.ts`：
1. 顶部 import：`import { AI_FILL_VERSION } from './scan-versions';`，并确保 `import Database from 'better-sqlite3';`。
2. 新增导出函数：
```ts
export interface FillCandidate { id: string; file_path: string; file_format: string; }

/**
 * Books eligible for AI fill. Normal mode: missing author/summary AND not yet
 * attempted at the current AI_FILL_VERSION. Force: every normal non-duplicate
 * book regardless of version/fields (manually-edited fields stay protected
 * inside batchFill).
 */
export function selectFillCandidates(db: Database.Database, force: boolean): FillCandidate[] {
  if (force) {
    return db.prepare(
      `SELECT id, file_path, file_format FROM books
       WHERE status = 'normal' AND (duplicate_of IS NULL OR duplicate_of = '')`
    ).all() as FillCandidate[];
  }
  return db.prepare(
    `SELECT id, file_path, file_format FROM books
     WHERE status = 'normal' AND (duplicate_of IS NULL OR duplicate_of = '')
       AND ((author IS NULL OR author = '') OR (summary IS NULL OR summary = ''))
       AND (ai_fill_version IS NULL OR ai_fill_version < ?)`
  ).all(AI_FILL_VERSION) as FillCandidate[];
}

export function stampFillVersion(db: Database.Database, bookId: string): void {
  db.prepare('UPDATE books SET ai_fill_version = ? WHERE id = ?').run(AI_FILL_VERSION, bookId);
}
```
3. 在 `batchFill` 的 `finally` 块（116-121）里、`done++` 旁边，对每本（无论成功失败）标版本：
```ts
    } finally {
      stampFillVersion(db, b.id);
      done++;
      if (input.taskId && (done % 2 === 0 || done === total)) {
        setScanProgress(input.taskId, { processed_files: done });
      }
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest tests/services/ai-batch-fill.test.ts`
Expected: PASS

- [ ] **Step 5: walker Phase 8 改用 selectFillCandidates**

`scan-walker.ts` Phase 8（256-270）：
```ts
    if (options.ai_fill) {
      setScanProgress(taskId, { stage: 'ai_fill' });
      const { batchFill, selectFillCandidates } = await import('./ai-batch-fill');
      const toFill = selectFillCandidates(db, false);
      console.log(`[scan ${taskId}] AI fill candidates: ${toFill.length}`);
      if (toFill.length > 0) {
        const r = await batchFill({ taskId, books: toFill });
        console.log(`[scan ${taskId}] AI fill done: ${r.succeeded.length} ok, ${r.failed.length} failed`);
      }
    }
```

- [ ] **Step 6: 编译 + 全量测试**

Run: `cd backend && npx tsc --noEmit && npx jest`
Expected: tsc 干净；全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/ai-batch-fill.ts backend/tests/services/ai-batch-fill.test.ts backend/src/services/scan-walker.ts
git commit -m "feat(scan): version-aware AI fill skip + force refill

Stamp ai_fill_version after every attempt (success or failure) so unfillable
books aren't retried each scan; bump AI_FILL_VERSION to refill all. force
ignores version+empty-field filters (still protects manually-edited fields).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 书库批量 AI 填充端点

**Files:**
- Modify: `backend/src/routes/library.ts`（新增 `POST /library/ai-fill-batch`）
- Modify: `frontend/src/api/library.ts`（新增 `aiFillBatch`）

- [ ] **Step 1: 后端新增端点**

`backend/src/routes/library.ts`，在合适位置（如 `/library/scan` 附近）新增：
```ts
const aiFillBatchSchema = z.object({ force: z.boolean().default(false) });
router.post('/ai-fill-batch', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = aiFillBatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const { force } = parsed.data;

  let task;
  try {
    // Reuse the scan-task machinery so the existing ScanProgressBar works.
    task = createScanTask(req.user!.userId, { mode: 'review', ai_fill: true, full_rescan: false });
  } catch {
    errorResponse(res, 409, 'CONFLICT', '已有扫描/填充任务在运行'); return;
  }

  void (async () => {
    const { batchFill, selectFillCandidates } = await import('../services/ai-batch-fill');
    const { setScanProgress, finishScanTask } = await import('../services/scan-task');
    try {
      const db = getDb();
      setScanProgress(task.id, { stage: 'ai_fill' });
      const toFill = selectFillCandidates(db, force);
      if (toFill.length > 0) {
        await batchFill({ taskId: task.id, user_id: req.user!.userId, books: toFill });
      }
      finishScanTask(task.id, 'completed');
    } catch (e) {
      finishScanTask(task.id, 'failed', (e as Error).message);
    }
  })();

  successResponse(res, { taskId: task.id, status: 'running' });
});
```
> 确认 `createScanTask` 已 import（来自 `../services/scan-task`）；若未，补 import。`ScanTask['stage']` 类型需含 `'ai_fill'`（现有 setScanProgress 已在扫描里用过该 stage，应已支持）。

- [ ] **Step 2: 前端 api client 新增方法**

`frontend/src/api/library.ts`，`libraryApi` 内加：
```ts
  aiFillBatch: (force = false) =>
    http.post<ApiResponse<{ taskId: string; status: string }>>('/library/ai-fill-batch', { force }),
```

- [ ] **Step 3: 编译**

Run: `cd backend && npx tsc --noEmit`
Expected: 干净。

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/library.ts frontend/src/api/library.ts
git commit -m "feat(scan): POST /library/ai-fill-batch (admin) with force option

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 前端 ScanOptionsDialog 去掉 AI 去重/系列 + hybrid

**Files:**
- Modify: `frontend/src/types/index.ts`（ScanStartOptions、CostEstimate）
- Modify: `frontend/src/api/library.ts`（estimate 入参）
- Modify: `frontend/src/components/ScanOptionsDialog.vue`

- [ ] **Step 1: 前端类型收窄**

`frontend/src/types/index.ts`：
- `ScanStartOptions` 改为：
```ts
export interface ScanStartOptions {
  mode: 'auto' | 'review'
  ai_fill: boolean
  full_rescan: boolean
}
```
- `CostEstimate` 去掉 `dedup`、`series`（保留 `fill`、`total`、`active_plugin`、`tier`）：
```ts
export interface CostEstimate {
  fill: number
  total: number
  active_plugin: string | null
  tier: 'free' | 'low' | 'high' | 'unknown'
}
```
> 落地时 grep 这两个类型的定义位置确认字段。

- [ ] **Step 2: estimate api 入参收窄**

`frontend/src/api/library.ts` 的 `estimate`：
```ts
  estimate: (params: { ai_fill?: boolean; full_rescan?: boolean }) =>
    http.get<ApiResponse<import('@/types').CostEstimate>>('/library/scan/estimate', { params }),
```

- [ ] **Step 3: 改 ScanOptionsDialog.vue**

`frontend/src/components/ScanOptionsDialog.vue`：
1. 模式 radio（10-21）删除 hybrid：
```html
        <el-form-item label="处理模式">
          <el-radio-group v-model="form.mode">
            <el-radio value="review">暂存审核（推荐）</el-radio>
            <el-radio value="auto">自动写入</el-radio>
          </el-radio-group>
          <div class="mode-hint">
            <span v-if="form.mode === 'review'">扫描结果先入暂存批次，admin 审核后再应用</span>
            <span v-else>结果直接落库，无审核环节</span>
          </div>
        </el-form-item>
```
2. AI 功能块（23-43）只留填充：
```html
        <el-form-item label="AI 功能">
          <div class="ai-toggles">
            <el-checkbox v-model="form.ai_fill">
              AI 批量填充
              <span v-if="estimate" class="toggle-meta">（预估 {{ estimate.fill }} 次）</span>
            </el-checkbox>
            <div v-if="estimate" class="estimate-summary">
              当前 AI：<strong>{{ estimate.active_plugin ?? '未配置' }}</strong>
              （{{ tierLabel }}）· 总调用 <strong>{{ estimate.total }}</strong> 次
            </div>
          </div>
        </el-form-item>
```
3. `form` 初值（84-90）去掉 ai_dedup/ai_series：
```ts
const form = reactive<ScanStartOptions>({
  mode: 'review',
  ai_fill: false,
  full_rescan: false,
})
```
4. `refreshEstimate`（95-107）入参改为：
```ts
    const resp = await libraryApi.estimate({ ai_fill: form.ai_fill, full_rescan: form.full_rescan })
```
5. `watch`（109-111）改为：
```ts
watch([() => form.ai_fill, () => form.full_rescan], () => { void refreshEstimate() })
```

- [ ] **Step 4: 前端构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TS 报错。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/library.ts frontend/src/components/ScanOptionsDialog.vue
git commit -m "feat(scan): scan dialog shows only AI fill; drop hybrid + AI dedup/series toggles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 前端 Library 去系列卡 + 平铺 + 批量 AI 填充入口

**Files:**
- Modify: `frontend/src/views/Library.vue`

- [ ] **Step 1: 列表恒平铺、移除系列拉取**

`frontend/src/views/Library.vue` 的 `fetchBooks`（172-206）替换为：
```ts
async function fetchBooks() {
  loading.value = true
  syncQuery()
  try {
    const safeSortBy = sortBy.value === 'rating' ? 'imported_at' : sortBy.value
    const booksResp = await libraryApi.listAdmin({
      page: pagination.page,
      pageSize: pagination.pageSize,
      search: searchQuery.value || undefined,
      category: selectedCategory.value || undefined,
      sortBy: safeSortBy,
      sortOrder: sortOrderFor(safeSortBy),
      include_dirty: includeDirty.value,
      series_grouped: false,
    })
    books.value = booksResp.data.data
    Object.assign(pagination, booksResp.data.pagination)
  } finally {
    loading.value = false
  }
}
```

- [ ] **Step 2: 模板移除 SeriesCard，调整空状态**

`Library.vue`：
1. 空状态条件（66）改为 `v-else-if="books.length === 0"`。
2. 删除 `<SeriesCard … />` 块（73-78）。
3. 删除 `seriesList` 相关：`import SeriesCard`（113）、`import { seriesApi }`（117）、`const seriesList = ref<Series[]>([])`（140）、`Series` 类型 import（120 中去掉 `Series`）。

- [ ] **Step 3: 加「批量 AI 填充」按钮 + 对话框**

1. header-actions（46-52 之间，"扫描导入"按钮旁）新增：
```html
          <el-button v-if="authStore.isAdmin" :loading="scanStore.isRunning" @click="showFillDialog = true">
            <el-icon><MagicStick /></el-icon>
            批量 AI 填充
          </el-button>
```
2. import 图标（108）：`import { Search, Refresh, MagicStick } from '@element-plus/icons-vue'`。
3. 模板末尾（`</ScanOptionsDialog>` 行后、`101` 附近）加填充对话框：
```html
      <el-dialog v-model="showFillDialog" title="批量 AI 填充" width="460px">
        <p>对书库中<strong>缺少作者/简介且尚未填充</strong>的书批量调用 AI 补全（作者、简介、分类、标签、封面）。</p>
        <el-checkbox v-model="fillForce">强制重填（忽略已填充记录，对全库重跑，会消耗更多 token）</el-checkbox>
        <div v-if="fillEstimate" class="fill-estimate">
          预计调用 <strong>{{ fillForce ? fillEstimate.total : fillEstimate.fill }}</strong> 次 ·
          当前 AI <strong>{{ fillEstimate.active_plugin ?? '未配置' }}</strong>
        </div>
        <template #footer>
          <el-button @click="showFillDialog = false">取消</el-button>
          <el-button type="primary" :loading="scanStore.isRunning" @click="onStartFill">开始填充</el-button>
        </template>
      </el-dialog>
```
4. script setup 加状态与逻辑（放在 `showScanDialog` 附近）：
```ts
import type { CostEstimate } from '@/types'
const showFillDialog = ref(false)
const fillForce = ref(false)
const fillEstimate = ref<CostEstimate | null>(null)

watch(showFillDialog, async (open) => {
  if (!open) return
  try {
    const resp = await libraryApi.estimate({ ai_fill: true, full_rescan: false })
    fillEstimate.value = resp.data.data ?? null
  } catch { fillEstimate.value = null }
})

async function onStartFill() {
  try {
    const resp = await libraryApi.aiFillBatch(fillForce.value)
    scanStore.startPolling(resp.data.data!.taskId)
    showFillDialog.value = false
    ElMessage.success('已开始批量填充，进度见顶部进度条')
  } catch (e) {
    ElMessage.error('启动失败：' + ((e as Error).message ?? '未知错误'))
  }
}
```
> 确认 `useScanTaskStore` 的轮询启动方法名（本计划假设 `startPolling(taskId)`）。落地时读 `frontend/src/stores/scan-task.ts` 用实际方法名；若扫描是通过别的方式触发轮询（如 `onScanConfirm`），照搬同样的调用。

- [ ] **Step 4: 前端构建验证**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TS 报错（确认无 `seriesList`/`SeriesCard`/`Series` 残留引用）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Library.vue
git commit -m "feat(scan): flat library (hide series cards) + batch AI fill entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 部署 + 端到端验证

**Files:** 无（验证任务）

- [ ] **Step 1: 重建部署**

Run: `cd /home/zhangjq/projects/easy-Reader && docker compose up -d --build`
等待 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/health` 返回 200。

- [ ] **Step 2: 提速验证（指纹跳过）**

跑两次扫描（review 模式、不勾 AI、不勾 full_rescan）。第一次会建/校验指纹；**第二次**应几乎瞬间完成（日志 `AI fill candidates` 之前的 fingerprinting 阶段快速跳过）。可对比 `scan_tasks` 的 `started_at`/`finished_at`。

- [ ] **Step 3: AI 填充跳过验证**

登录拿 token，调用 `POST /library/ai-fill-batch`（force=false）两次。第二次 `selectFillCandidates` 应返回更少/为 0（已标版本的书被跳过）。SQL 抽查：`SELECT COUNT(*) FROM books WHERE ai_fill_version IS NOT NULL`。

- [ ] **Step 4: 浏览器手测**

1. 书库为纯平铺，无系列卡；搜索任意词正常。
2. 扫描对话框只剩「自动写入/暂存审核」+「AI 批量填充」+「重建指纹」；无 AI 去重/系列、无混合模式。
3. 「批量 AI 填充」按钮 → 对话框显示预估 + 强制重填勾选 → 开始后顶部进度条动。
4. 重复书（指纹相同）仍能在 review 批次/问题书籍里看到。

- [ ] **Step 5: 全量回归**

Run: `cd backend && npx jest`
Expected: 全绿。

- [ ] **Step 6: 汇报**

向用户汇报：提速效果、各项验证结果、遗留项（如有）。docker-compose.yml 的本地挂载/healthcheck 改动仍不提交。

---

## Self-Review（已对照 spec 检查）

- **spec §1 数据模型** → Task 1（3 列 + 回填）✅
- **spec §2 增量跳过** → Task 2（shouldReuseFingerprint + 主循环 stat + mtime 回填 + 入库写列）✅
- **spec §3 去扫描时 AI + 删 hybrid + 灰区回退** → Task 3 ✅；类型/schema 收窄 → Task 4 ✅
- **spec §4 系列全隐藏** → Task 8（前端去系列卡、恒平铺）✅；后端系列函数保留（Task 3 仅停止调用）✅
- **spec §5 AI 填充版本+双重跳过+force+失败也标** → Task 5 ✅
- **spec §6 两个填充入口** → 扫描开关（Task 7 保留）+ 书库按钮（Task 6 端点 + Task 8 UI）✅
- **spec §7 费用估算仅填充** → Task 4 ✅
- **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码。少数「落地时 grep/确认变量名」处为针对未全文展开文件的精确定位指引，非占位。
- **类型一致性**：`shouldReuseFingerprint`/`selectFillCandidates`/`stampFillVersion`/`backfillFingerprintVersion` 命名在定义与调用处一致；`ScanOptions`/`NewBookPayload`/`CostEstimate`/`EstimateInput` 字段在前后端各任务间一致。
