# Plan 3: AI 批量填充 + 费用 + 人工修正 + 书库 UI 集成

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**前置条件：** Plan 1 + Plan 2 已实施完成（扫描框架、AI 去重/系列、批次审核就绪）。

**Goal:** 完成整套扫描增强功能的收尾：把 `ai_fill` 选项激活成真正的批量填充阶段（并发限制 + 重试 + 失败入批次）；新增费用估算接口与醒目警告；书库列表加入系列卡 / 重复 badge / 乱码 badge / 删除按钮 + 文件删除 + 审计日志；新增系列详情页；新增人工修正管理 UI；BookDetail 加 AI 不覆盖人工字段的提示与逻辑。完成后特性闭环。

**Architecture:** 后端新增 `services/ai-batch-fill.ts`（p-limit 并发 + 重试）、`services/cost-estimator.ts`（依据当前 AI plugin tier + 候选数估算）、`services/audit-log.ts`、`services/file-deleter.ts`（路径安全 + 级联）。前端在 Library 加 dirty-toggle 显示开关、SeriesCard 与 BookCard badge 改造；新增 SeriesDetail、ManualOverridesAdmin 等视图；CostWarningDialog 在勾选 ai_fill 时弹出；Notification API 在扫描结束时通知。

**Tech Stack:** Express + better-sqlite3 + p-limit（新增）+ Vue 3 + Pinia + Element Plus + 浏览器 Notification API

**关联设计文档:** `docs/superpowers/specs/2026-05-24-scan-dedupe-design.md`

---

## File Structure

### 后端新增

| 文件 | 职责 |
|---|---|
| `backend/tests/services/cost-estimator.test.ts` | 单元测试 |
| `backend/tests/services/file-deleter.test.ts` | 单元测试 |
| `backend/src/services/cost-estimator.ts` | 估算 AI 调用次数与费用等级 |
| `backend/src/services/ai-batch-fill.ts` | 批量填充（p-limit + retry）|
| `backend/src/services/audit-log.ts` | 审计日志写入 + 查询 |
| `backend/src/services/file-deleter.ts` | 路径安全 + 级联删除 |
| `backend/src/routes/series.ts` | 系列查询 / 更新接口 |
| `backend/src/routes/audit-log.ts` | 审计日志查询 |

### 后端修改

| 文件 | 修改 |
|---|---|
| `backend/package.json` | 加 `p-limit` 依赖 |
| `backend/src/db.ts` | 加 audit_log 表 |
| `backend/src/types/index.ts` | 加 AuditLog 类型 |
| `backend/src/services/scan-walker.ts` | Phase 7 启用 AI 批量填充 |
| `backend/src/services/batch-applier.ts` | apply 写 audit_log |
| `backend/src/routes/library.ts` | `/scan/estimate` + 改造 DELETE + ai-fill 走人工字段感知 |
| `backend/src/index.ts` | 挂载新路由 |

### 前端新增

| 文件 | 职责 |
|---|---|
| `frontend/src/components/CostWarningDialog.vue` | AI 费用警告 |
| `frontend/src/components/SeriesCard.vue` | 系列卡 |
| `frontend/src/views/SeriesDetail.vue` | 系列详情 |
| `frontend/src/views/ManualOverridesAdmin.vue` | 人工修正管理 |
| `frontend/src/views/AuditLogView.vue` | 审计日志查看 |
| `frontend/src/api/series.ts` | API |
| `frontend/src/api/audit-log.ts` | API |

### 前端修改

| 文件 | 修改 |
|---|---|
| `frontend/src/components/BookCard.vue` | 加 duplicate/garbled badge + admin 删除按钮 |
| `frontend/src/components/ScanOptionsDialog.vue` | 启用 ai_fill 复选框 + 估算调用 + 触发 CostWarning |
| `frontend/src/components/ScanProgressBar.vue` | 完成时 Notification API 桌面通知；新增 `ai_fill` stage 文案 |
| `frontend/src/views/Library.vue` | 加 dirty-toggle 开关；获取列表带 include_dirty/series_grouped |
| `frontend/src/views/BookDetail.vue` | 加 AI 字段保护提示 + manually_edited_fields 联动 |
| `frontend/src/api/library.ts` | scan/estimate、updateBook 触发 manually_edited_fields |
| `frontend/src/router/index.ts` | 加系列详情 / 人工修正 / 审计日志路由 |
| `frontend/src/types/index.ts` | 加 Series, AuditLog 类型 |

---

## Phase A: 依赖与 schema（任务 1-2）

### Task 1: 添加 p-limit 依赖

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: 安装**

```bash
cd ~/projects/easy-Reader/backend
npm install p-limit@^5.0.0
```

注意：p-limit v5 是 ESM-only。如果 backend 用 CommonJS（参考 tsconfig `module: "commonjs"`），改装 v3：

```bash
npm install p-limit@^3.1.0
```

- [ ] **Step 2: 验证**

Run: `grep p-limit ~/projects/easy-Reader/backend/package.json`
Expected: `"p-limit": "^3.1.0"`

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/package.json backend/package-lock.json
git commit -m "chore(scan): add p-limit for AI batch concurrency control"
```

### Task 2: 加 audit_log 表

**Files:**
- Modify: `backend/src/db.ts`
- Modify: `backend/src/types/index.ts`

- [ ] **Step 1: 在 db.ts 加 audit_log 表**

在 `backend/src/db.ts` 的 `// === Plan 2 schema: manual_overrides ===` 段**之后**，紧接 `// === Plan 1: recover stale running tasks on startup ===` **之前**，插入：

```typescript
  // === Plan 3 schema: audit_log ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_id TEXT,
      file_path TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
  `);
```

- [ ] **Step 2: types 加 AuditLog**

在 `backend/src/types/index.ts` 末尾追加：

```typescript
export type AuditAction =
  | 'delete_book_file'
  | 'delete_book_record'
  | 'apply_batch'
  | 'discard_batch'
  | 'create_manual_override'
  | 'delete_manual_override';

export interface AuditLog {
  id: string;
  user_id: string;
  action: AuditAction;
  resource_id?: string | null;
  file_path?: string | null;
  details?: string | null;
  created_at: string;
}
```

- [ ] **Step 3: 验证与提交**

```bash
cd ~/projects/easy-Reader/backend && npm run dev
# 等几秒 Ctrl+C
sqlite3 ~/projects/easy-Reader/backend/data/novel-reader.db ".schema audit_log"
```
Expected: 看到 audit_log 表定义

```bash
cd ~/projects/easy-Reader
git add backend/src/db.ts backend/src/types/index.ts
git commit -m "feat(scan): add audit_log table and AuditLog type"
```

---

## Phase B: 审计 + 文件删除服务（任务 3-5）

### Task 3: audit-log service

**Files:**
- Create: `backend/src/services/audit-log.ts`

- [ ] **Step 1: 创建**

Create `backend/src/services/audit-log.ts`:

```typescript
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import { AuditAction, AuditLog } from '../types';

export interface WriteAuditInput {
  user_id: string;
  action: AuditAction;
  resource_id?: string | null;
  file_path?: string | null;
  details?: Record<string, unknown> | null;
}

export function writeAudit(input: WriteAuditInput): AuditLog {
  const id = uuidv4();
  getDb().prepare(
    `INSERT INTO audit_log (id, user_id, action, resource_id, file_path, details)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.user_id,
    input.action,
    input.resource_id ?? null,
    input.file_path ?? null,
    input.details ? JSON.stringify(input.details) : null,
  );
  return getDb().prepare('SELECT * FROM audit_log WHERE id = ?').get(id) as AuditLog;
}

export interface AuditQuery {
  user_id?: string;
  action?: AuditAction;
  limit?: number;
  offset?: number;
}

export function queryAudit(q: AuditQuery): { logs: AuditLog[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.user_id) { where.push('user_id = ?'); params.push(q.user_id); }
  if (q.action) { where.push('action = ?'); params.push(q.action); }
  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (getDb().prepare(`SELECT COUNT(*) as cnt FROM audit_log ${whereClause}`).get(...params) as { cnt: number }).cnt;
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  const logs = getDb().prepare(
    `SELECT * FROM audit_log ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as AuditLog[];
  return { logs, total };
}
```

- [ ] **Step 2: 类型检查 + 提交**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

```bash
cd ~/projects/easy-Reader
git add backend/src/services/audit-log.ts
git commit -m "feat(scan): add audit-log write/query service"
```

### Task 4: file-deleter service — TDD

**Files:**
- Create: `backend/tests/services/file-deleter.test.ts`
- Create: `backend/src/services/file-deleter.ts`

- [ ] **Step 1: 写测试**

Create `backend/tests/services/file-deleter.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { deleteBookCascade, DeleteRequest, _setRootForTesting } from '../../src/services/file-deleter';

const TMP = path.join(__dirname, '__test-deleter-tmp');

beforeEach(() => {
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  _setRootForTesting(TMP);
});

afterEach(() => {
  if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
  _setRootForTesting(null);
});

describe('deleteBookCascade safety checks', () => {
  it('throws when file_path is outside root', () => {
    const req: DeleteRequest = {
      file_path: '/etc/passwd',
      book_id: 'x',
      cascade_duplicate_ids: [],
      cascade_duplicate_paths: [],
      user_id: 'u',
    };
    expect(() => deleteBookCascade(req, { dryRun: true })).toThrow(/outside root/i);
  });

  it('throws when file_path contains traversal', () => {
    const req: DeleteRequest = {
      file_path: path.join(TMP, '../escape.txt'),
      book_id: 'x',
      cascade_duplicate_ids: [],
      cascade_duplicate_paths: [],
      user_id: 'u',
    };
    expect(() => deleteBookCascade(req, { dryRun: true })).toThrow(/outside root/i);
  });

  it('deletes file and returns count when path is inside root', () => {
    const p = path.join(TMP, 'a.txt');
    fs.writeFileSync(p, 'content');
    const req: DeleteRequest = {
      file_path: p,
      book_id: 'x',
      cascade_duplicate_ids: [],
      cascade_duplicate_paths: [],
      user_id: 'u',
    };
    const r = deleteBookCascade(req, { dryRun: false, skipDbOps: true });
    expect(r.files_deleted).toBe(1);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('handles missing files gracefully', () => {
    const req: DeleteRequest = {
      file_path: path.join(TMP, 'nonexistent.txt'),
      book_id: 'x',
      cascade_duplicate_ids: [],
      cascade_duplicate_paths: [],
      user_id: 'u',
    };
    const r = deleteBookCascade(req, { dryRun: false, skipDbOps: true });
    expect(r.files_deleted).toBe(0);
    expect(r.warnings).toContain('file not found');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/file-deleter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

Create `backend/src/services/file-deleter.ts`:

```typescript
import fs from 'fs';
import { getDb } from '../db';
import { assertPathInsideRoot } from '../utils/path-safe';
import { writeAudit } from './audit-log';

const DEFAULT_ROOT = process.env.BOOKS_DIR || '/app/books';

let rootOverride: string | null = null;
export function _setRootForTesting(root: string | null): void {
  rootOverride = root;
}
function root(): string {
  return rootOverride ?? DEFAULT_ROOT;
}

export interface DeleteRequest {
  file_path: string;
  book_id: string;
  cascade_duplicate_ids: string[];
  cascade_duplicate_paths: string[];
  user_id: string;
}

export interface DeleteResult {
  files_deleted: number;
  records_deleted: number;
  shelf_entries_affected: number;
  warnings: string[];
}

export interface DeleteOptions {
  dryRun?: boolean;
  skipDbOps?: boolean;
}

/**
 * Delete a book file + its DB record, optionally cascading to duplicate books.
 *
 * Safety:
 *  - All file paths must be inside the BOOKS_DIR root (path traversal prevention)
 *  - All operations are wrapped in a DB transaction; if any fails we throw and
 *    nothing commits (BUT note: files already removed from disk are not restored)
 *
 * NOTE: caller is responsible for the "affected users" warning before calling.
 */
export function deleteBookCascade(req: DeleteRequest, opts: DeleteOptions = {}): DeleteResult {
  // Validate paths BEFORE any side effects
  assertPathInsideRoot(root(), req.file_path);
  for (const p of req.cascade_duplicate_paths) {
    assertPathInsideRoot(root(), p);
  }

  const result: DeleteResult = {
    files_deleted: 0,
    records_deleted: 0,
    shelf_entries_affected: 0,
    warnings: [],
  };

  if (opts.dryRun) return result;

  // Delete files first (this is the irreversible part)
  for (const fp of [req.file_path, ...req.cascade_duplicate_paths]) {
    try {
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        result.files_deleted++;
      } else {
        result.warnings.push('file not found');
      }
    } catch (err) {
      result.warnings.push(`failed to delete ${fp}: ${(err as Error).message}`);
    }
  }

  if (opts.skipDbOps) return result;

  const db = getDb();
  const tx = db.transaction(() => {
    const allBookIds = [req.book_id, ...req.cascade_duplicate_ids];
    const placeholders = allBookIds.map(() => '?').join(',');

    // Count affected shelf entries for audit
    const affected = db.prepare(`SELECT COUNT(*) as cnt FROM shelf WHERE book_id IN (${placeholders})`).get(...allBookIds) as { cnt: number };
    result.shelf_entries_affected = affected.cnt;

    // Cascade cleanup
    db.prepare(`DELETE FROM shelf WHERE book_id IN (${placeholders})`).run(...allBookIds);
    db.prepare(`DELETE FROM reading_progress WHERE book_id IN (${placeholders})`).run(...allBookIds);
    db.prepare(`DELETE FROM bookmarks WHERE book_id IN (${placeholders})`).run(...allBookIds);
    const r = db.prepare(`DELETE FROM books WHERE id IN (${placeholders})`).run(...allBookIds);
    result.records_deleted = r.changes;

    writeAudit({
      user_id: req.user_id,
      action: 'delete_book_file',
      resource_id: req.book_id,
      file_path: req.file_path,
      details: {
        cascade_ids: req.cascade_duplicate_ids,
        cascade_paths: req.cascade_duplicate_paths,
        files_deleted: result.files_deleted,
        records_deleted: result.records_deleted,
        shelf_entries_affected: result.shelf_entries_affected,
      },
    });
  });
  tx();

  return result;
}

/**
 * Count users affected if a book and its duplicates are deleted.
 * Used for the "二次警告" UI flow.
 */
export function countAffectedUsers(bookIds: string[]): number {
  if (bookIds.length === 0) return 0;
  const db = getDb();
  const placeholders = bookIds.map(() => '?').join(',');
  const row = db.prepare(
    `SELECT COUNT(DISTINCT user_id) as cnt FROM shelf WHERE book_id IN (${placeholders})`
  ).get(...bookIds) as { cnt: number };
  return row.cnt;
}

/**
 * Get duplicate book IDs and file_paths for a canonical book.
 */
export function getDuplicatesOf(bookId: string): Array<{ id: string; file_path: string }> {
  const db = getDb();
  return db.prepare(
    'SELECT id, file_path FROM books WHERE duplicate_of = ?'
  ).all(bookId) as Array<{ id: string; file_path: string }>;
}
```

- [ ] **Step 4: 跑测试**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/file-deleter.test.ts`
Expected: PASS — 4 tests pass

- [ ] **Step 5: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/file-deleter.ts backend/tests/services/file-deleter.test.ts
git commit -m "feat(scan): add file-deleter service with path-safety and cascade"
```

### Task 5: 替换 library.ts 的 DELETE 路由

**Files:**
- Modify: `backend/src/routes/library.ts`

- [ ] **Step 1: 在 imports 段加 file-deleter 引用**

在 `backend/src/routes/library.ts` 顶部 import 段加：

```typescript
import { deleteBookCascade, getDuplicatesOf, countAffectedUsers } from '../services/file-deleter';
```

- [ ] **Step 2: 替换原 DELETE /:id 路由**

把 `router.delete('/:id', ...)` 整段（约第 150-165 行）替换为：

```typescript
const deleteQuerySchema = z.object({
  cascade_duplicates: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
  confirm_shelf_impact: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
});

router.delete('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = deleteQuerySchema.safeParse(req.query);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const { cascade_duplicates, confirm_shelf_impact } = parsed.data;

  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book | undefined;
  if (!book) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }

  // Check if this book has duplicates pointing to it (it's a canonical)
  const dups = getDuplicatesOf(req.params.id);
  if (dups.length > 0 && !cascade_duplicates) {
    res.status(409).json({
      success: false,
      code: 'HAS_DUPLICATES',
      message: '该书有重复关联，请确认是否级联删除',
      data: { duplicate_count: dups.length, requires: 'cascade_duplicates' },
    });
    return;
  }

  // Check shelf impact
  const allIds = [req.params.id, ...dups.map(d => d.id)];
  const affectedUsers = countAffectedUsers(allIds);
  if (affectedUsers > 0 && !confirm_shelf_impact) {
    res.status(409).json({
      success: false,
      code: 'AFFECTS_SHELF',
      message: `该书已被 ${affectedUsers} 个用户加入书架`,
      data: { affected_users: affectedUsers, requires: 'confirm_shelf_impact' },
    });
    return;
  }

  try {
    const result = deleteBookCascade({
      file_path: book.file_path,
      book_id: req.params.id,
      cascade_duplicate_ids: dups.map(d => d.id),
      cascade_duplicate_paths: dups.map(d => d.file_path),
      user_id: req.user!.userId,
    });
    successResponse(res, result, '已删除');
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', (err as Error).message);
  }
});
```

- [ ] **Step 3: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/routes/library.ts
git commit -m "feat(scan): rewrite DELETE /library/:id with cascade and shelf impact warnings"
```

---

## Phase C: AI 批量填充（任务 6-7）

### Task 6: ai-batch-fill service

**Files:**
- Create: `backend/src/services/ai-batch-fill.ts`

- [ ] **Step 1: 创建**

Create `backend/src/services/ai-batch-fill.ts`:

```typescript
import fs from 'fs';
import pLimit from 'p-limit';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import { aiManager } from '../ai/ai-manager';
import { Book } from '../types';
import { setScanProgress } from './scan-task';

const CONCURRENCY = 3;
const RETRIES = 2;
const RETRY_BACKOFF_MS = 1500;

export interface BatchFillInput {
  taskId?: string;          // for progress updates
  books: Array<{ id: string; file_path: string; file_format: string }>;
}

export interface BatchFillResult {
  succeeded: string[];      // book ids
  failed: Array<{ book_id: string; file_path: string; error: string }>;
}

export async function batchFill(input: BatchFillInput): Promise<BatchFillResult> {
  const db = getDb();
  const limit = pLimit(CONCURRENCY);
  const result: BatchFillResult = { succeeded: [], failed: [] };
  let done = 0;
  const total = input.books.length;

  if (input.taskId) {
    setScanProgress(input.taskId, { total_files: total, processed_files: 0 });
  }

  await Promise.all(input.books.map(b => limit(async () => {
    try {
      const rawText = readPreview(b.file_path, b.file_format);
      const info = await callWithRetry(() => aiManager.fillBookInfo(rawText, db), RETRIES);

      // Look up current state to honor manually_edited_fields
      const current = db.prepare('SELECT title, author, summary, category, manually_edited_fields FROM books WHERE id = ?').get(b.id) as
        | { title?: string; author?: string; summary?: string; category?: string; manually_edited_fields?: string }
        | undefined;
      if (!current) {
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: 'book not found' });
        return;
      }
      const edited = new Set<string>(parseEditedFields(current.manually_edited_fields));

      const updates: string[] = [];
      const values: unknown[] = [];
      function maybeSet(field: 'title' | 'author' | 'summary' | 'category', newVal: string | undefined): void {
        if (!newVal) return;
        if (edited.has(field)) return;        // admin修改过的字段绝不覆盖
        const cur = current![field];
        if (cur && cur.trim().length > 0) return;  // 已填值不覆盖
        updates.push(`${field} = ?`);
        values.push(newVal);
      }
      maybeSet('title', info.title);
      maybeSet('author', info.author);
      maybeSet('summary', info.summary);
      maybeSet('category', info.category);

      if (updates.length > 0) {
        values.push(b.id);
        db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
      result.succeeded.push(b.id);
    } catch (err) {
      result.failed.push({ book_id: b.id, file_path: b.file_path, error: (err as Error).message });
    } finally {
      done++;
      if (input.taskId && (done % 2 === 0 || done === total)) {
        setScanProgress(input.taskId, { processed_files: done });
      }
    }
  })));

  return result;
}

function readPreview(filePath: string, format: string): string {
  if (format !== 'txt') return '';
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.slice(0, 2000);
  } catch {
    return '';
  }
}

function parseEditedFields(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function callWithRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise(res => setTimeout(res, RETRY_BACKOFF_MS * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/**
 * Append to manually_edited_fields when admin edits a field via PUT /library/:id.
 * Reads current value, merges in the new fields, writes back.
 */
export function markFieldsAsEdited(bookId: string, fields: Array<'title' | 'author' | 'summary' | 'category'>): void {
  const db = getDb();
  const row = db.prepare('SELECT manually_edited_fields FROM books WHERE id = ?').get(bookId) as
    | { manually_edited_fields?: string }
    | undefined;
  const existing = new Set<string>(parseEditedFields(row?.manually_edited_fields));
  for (const f of fields) existing.add(f);
  db.prepare('UPDATE books SET manually_edited_fields = ? WHERE id = ?').run(JSON.stringify([...existing]), bookId);
}
```

- [ ] **Step 2: 类型检查 + 提交**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

```bash
cd ~/projects/easy-Reader
git add backend/src/services/ai-batch-fill.ts
git commit -m "feat(scan): add ai-batch-fill service with concurrency and field-protection"
```

### Task 7: 在 scan-walker 启用 ai-fill 阶段；改 PUT /:id 标记 edited

**Files:**
- Modify: `backend/src/services/scan-walker.ts`
- Modify: `backend/src/routes/library.ts`

- [ ] **Step 1: 在 scan-walker.ts 末尾、`finishScanTask(taskId, 'completed')` **之前** 插入 AI fill 阶段**

找到 `// Phase 7: dispatch by mode` 段，在 `if (options.mode === 'auto')` 等 mode 分发**完成之后**，再 `if (options.ai_fill)` 分支处理填充。具体修改：

(a) 把 `finishScanTask(taskId, 'completed');` **之前**插入：

```typescript
    // Phase 8: AI batch fill (if enabled)
    if (options.ai_fill) {
      setScanProgress(taskId, { stage: 'staging' });  // reuse stage label or add new
      const { batchFill } = await import('./ai-batch-fill');
      const db = getDb();
      // Pick books eligible for fill: status=normal AND duplicate_of IS NULL AND no edited fields
      // (after the batch is applied, those books are in DB. For 'review' mode, books aren't applied yet,
      //  so skip fill for review mode.)
      if (options.mode === 'auto' || options.mode === 'hybrid') {
        const toFill = db.prepare(`
          SELECT id, file_path, file_format FROM books
          WHERE status = 'normal' AND duplicate_of IS NULL
            AND (author IS NULL OR author = '')
            AND (summary IS NULL OR summary = '')
        `).all() as Array<{ id: string; file_path: string; file_format: string }>;
        if (toFill.length > 0) {
          await batchFill({ taskId, books: toFill });
        }
      }
    }
```

需要 import `getDb`，如果文件顶部还没引入则加：
```typescript
import { getDb } from '../db';
```
（文件顶部应该已经有这个 import，因为 Plan 1/2 已经引入过）

- [ ] **Step 2: 修改 PUT /:id 路由记录人工编辑字段**

在 `backend/src/routes/library.ts` 顶部 imports 段加：

```typescript
import { markFieldsAsEdited } from '../services/ai-batch-fill';
```

找到 `router.put('/:id', ...)` 处理函数。在 `if (updates.length > 0) { ... }` 段**之前**插入：

```typescript
  // Track which fields admin manually edited so AI batch fill won't overwrite
  const editedFields: Array<'title' | 'author' | 'summary' | 'category'> = [];
  if (data.title !== undefined) editedFields.push('title');
  if (data.author !== undefined) editedFields.push('author');
  if (data.summary !== undefined) editedFields.push('summary');
  if (data.category !== undefined) editedFields.push('category');
  if (editedFields.length > 0) {
    markFieldsAsEdited(req.params.id, editedFields);
  }
```

- [ ] **Step 3: 类型检查 + 提交**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

```bash
cd ~/projects/easy-Reader
git add backend/src/services/scan-walker.ts backend/src/routes/library.ts
git commit -m "feat(scan): wire ai-batch-fill into scan walker and track manual edits"
```

---

## Phase D: 费用估算（任务 8-9）

### Task 8: cost-estimator service — TDD

**Files:**
- Create: `backend/tests/services/cost-estimator.test.ts`

- [ ] **Step 1: 写测试**

Create `backend/tests/services/cost-estimator.test.ts`:

```typescript
import { tierForPlugin, estimateCalls } from '../../src/services/cost-estimator';

describe('tierForPlugin', () => {
  it('classifies free providers', () => {
    expect(tierForPlugin('ollama')).toBe('free');
  });
  it('classifies low-cost providers', () => {
    expect(tierForPlugin('deepseek')).toBe('low');
    expect(tierForPlugin('qwen')).toBe('low');
    expect(tierForPlugin('minmax')).toBe('low');
  });
  it('classifies high-cost providers', () => {
    expect(tierForPlugin('openai')).toBe('high');
    expect(tierForPlugin('claude')).toBe('high');
  });
  it('returns unknown for unrecognized plugin', () => {
    expect(tierForPlugin('whatever')).toBe('unknown');
  });
});

describe('estimateCalls', () => {
  it('returns zero counts when all flags disabled', () => {
    const r = estimateCalls({
      ai_dedup: false, ai_series: false, ai_fill: false,
      soft_dup_candidate_groups: 5, series_fuzzy_groups: 3, books_to_fill: 100,
    });
    expect(r).toEqual({ dedup: 0, series: 0, fill: 0, total: 0 });
  });

  it('sums enabled flag counts', () => {
    const r = estimateCalls({
      ai_dedup: true, ai_series: true, ai_fill: true,
      soft_dup_candidate_groups: 5, series_fuzzy_groups: 3, books_to_fill: 100,
    });
    expect(r).toEqual({ dedup: 5, series: 3, fill: 100, total: 108 });
  });

  it('respects disable mix', () => {
    const r = estimateCalls({
      ai_dedup: true, ai_series: false, ai_fill: true,
      soft_dup_candidate_groups: 5, series_fuzzy_groups: 3, books_to_fill: 100,
    });
    expect(r).toEqual({ dedup: 5, series: 0, fill: 100, total: 105 });
  });
});
```

### Task 9: cost-estimator 实现 + 路由

**Files:**
- Create: `backend/src/services/cost-estimator.ts`
- Modify: `backend/src/routes/library.ts`

- [ ] **Step 1: 实现**

Create `backend/src/services/cost-estimator.ts`:

```typescript
import { getDb } from '../db';

export type CostTier = 'free' | 'low' | 'high' | 'unknown';

const TIER_MAP: Record<string, CostTier> = {
  ollama: 'free',
  deepseek: 'low',
  qwen: 'low',
  minmax: 'low',
  openai: 'high',
  claude: 'high',
};

export function tierForPlugin(name: string): CostTier {
  return TIER_MAP[name] ?? 'unknown';
}

export function getActivePluginName(): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'ai_plugin'").get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export interface EstimateInput {
  ai_dedup: boolean;
  ai_series: boolean;
  ai_fill: boolean;
  soft_dup_candidate_groups: number;
  series_fuzzy_groups: number;
  books_to_fill: number;
}

export interface EstimateOutput {
  dedup: number;
  series: number;
  fill: number;
  total: number;
}

export function estimateCalls(input: EstimateInput): EstimateOutput {
  const dedup = input.ai_dedup ? input.soft_dup_candidate_groups : 0;
  const series = input.ai_series ? input.series_fuzzy_groups : 0;
  const fill = input.ai_fill ? input.books_to_fill : 0;
  return { dedup, series, fill, total: dedup + series + fill };
}

/**
 * Best-effort pre-scan estimation. We don't actually walk the file system here
 * — instead we use heuristics based on the current books table.
 *
 * Note: this is approximate. The real scan may find more or fewer candidates.
 */
export function estimateFromCurrentDb(opts: {
  ai_dedup: boolean;
  ai_series: boolean;
  ai_fill: boolean;
  full_rescan: boolean;
}): EstimateOutput & { active_plugin: string | null; tier: CostTier } {
  const db = getDb();
  // Count books with potentially-similar titles (rough)
  // For simplicity: number of "soft groups" ≈ number of duplicate (normalized) titles.
  // We can't easily compute without normalizing every title in SQL; just use a coarse heuristic.
  const totalBooks = (db.prepare("SELECT COUNT(*) as c FROM books").get() as { c: number }).c;
  // Heuristic estimates — real values will be computed during scan
  const softGroups = Math.max(1, Math.floor(totalBooks / 20));
  const fuzzySeries = Math.max(1, Math.floor(totalBooks / 30));

  // For fill: books without author or summary (i.e., candidate set after this scan)
  const fillCandidates = (db.prepare(
    "SELECT COUNT(*) as c FROM books WHERE status = 'normal' AND duplicate_of IS NULL AND ((author IS NULL OR author = '') OR (summary IS NULL OR summary = ''))"
  ).get() as { c: number }).c;

  const est = estimateCalls({
    ai_dedup: opts.ai_dedup,
    ai_series: opts.ai_series,
    ai_fill: opts.ai_fill,
    soft_dup_candidate_groups: softGroups,
    series_fuzzy_groups: fuzzySeries,
    books_to_fill: fillCandidates,
  });

  const active = getActivePluginName();
  return {
    ...est,
    active_plugin: active,
    tier: active ? tierForPlugin(active) : 'unknown',
  };
}
```

- [ ] **Step 2: 跑测试**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/cost-estimator.test.ts`
Expected: PASS — 7 tests pass

- [ ] **Step 3: 加 estimate 接口**

在 `backend/src/routes/library.ts` 加入：

```typescript
import { estimateFromCurrentDb } from '../services/cost-estimator';
```

在 `POST /api/library/scan` 路由**之前**或之后添加：

```typescript
const estimateSchema = z.object({
  ai_dedup: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
  ai_series: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
  ai_fill: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
  full_rescan: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
});

router.get('/scan/estimate', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = estimateSchema.safeParse(req.query);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const result = estimateFromCurrentDb({
    ai_dedup: !!parsed.data.ai_dedup,
    ai_series: !!parsed.data.ai_series,
    ai_fill: !!parsed.data.ai_fill,
    full_rescan: !!parsed.data.full_rescan,
  });
  successResponse(res, result);
});
```

- [ ] **Step 4: 类型检查 + 提交**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

```bash
cd ~/projects/easy-Reader
git add backend/src/services/cost-estimator.ts backend/tests/services/cost-estimator.test.ts backend/src/routes/library.ts
git commit -m "feat(scan): add cost-estimator service and /scan/estimate endpoint"
```

---

## Phase E: 系列接口（任务 10）

### Task 10: series routes + library 加 series_grouped / include_dirty

**Files:**
- Create: `backend/src/routes/series.ts`
- Modify: `backend/src/routes/library.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: 创建 series 路由**

Create `backend/src/routes/series.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { Series, Book } from '../types';

const router = Router();

router.get('/', authMiddleware, (_req: Request, res: Response) => {
  const list = getDb().prepare('SELECT * FROM series ORDER BY name').all() as Series[];
  // Enrich with member count + cover from first member
  const enriched = list.map(s => {
    const members = getDb().prepare(
      "SELECT cover_url FROM books WHERE series_id = ? AND status != 'duplicate' ORDER BY title LIMIT 1"
    ).get(s.id) as { cover_url?: string } | undefined;
    const count = (getDb().prepare(
      "SELECT COUNT(*) as c FROM books WHERE series_id = ? AND status != 'duplicate'"
    ).get(s.id) as { c: number }).c;
    return { ...s, member_count: count, cover_url: s.cover_url ?? members?.cover_url ?? null };
  });
  successResponse(res, enriched);
});

router.get('/:id', authMiddleware, (req: Request, res: Response) => {
  const series = getDb().prepare('SELECT * FROM series WHERE id = ?').get(req.params.id) as Series | undefined;
  if (!series) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '系列不存在'); return; }
  const members = getDb().prepare(
    'SELECT * FROM books WHERE series_id = ? ORDER BY title'
  ).all(req.params.id) as Book[];
  successResponse(res, { series, members });
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  summary: z.string().max(5000).optional(),
  cover_url: z.string().max(500).optional(),
});

router.put('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const updates: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { updates.push(`${k} = ?`); values.push(v); }
  }
  if (updates.length === 0) { successResponse(res, null, '无变化'); return; }
  values.push(req.params.id);
  const r = getDb().prepare(`UPDATE series SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  if (r.changes === 0) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '系列不存在'); return; }
  const series = getDb().prepare('SELECT * FROM series WHERE id = ?').get(req.params.id) as Series;
  successResponse(res, series, '已更新');
});

export default router;
```

- [ ] **Step 2: 挂载路由**

修改 `backend/src/index.ts`，添加：

```typescript
import seriesRoutes from './routes/series';
// ...
app.use('/api/library/series', seriesRoutes);
```

注意：放在 `app.use('/api/library', libraryRoutes)` **之前**。

- [ ] **Step 3: 修改 GET /library 支持 include_dirty / series_grouped**

在 `backend/src/routes/library.ts` 找到 `router.get('/', ...)` 路由，**替换**整个 handler 为：

```typescript
router.get('/', authMiddleware, (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const search = (req.query.search as string) || '';
  const category = (req.query.category as string) || '';
  const includeDirty = req.query.include_dirty === '1' || req.query.include_dirty === 'true';
  const seriesGrouped = req.query.series_grouped === '1' || req.query.series_grouped === 'true';
  const sortBy = ALLOWED_SORT_FIELDS.includes(req.query.sortBy as string) ? (req.query.sortBy as string) : 'imported_at';
  const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const db = getDb();
  let whereClause = 'WHERE 1=1';
  const params: unknown[] = [];

  if (!includeDirty) {
    whereClause += " AND status = 'normal' AND (duplicate_of IS NULL OR duplicate_of = '')";
  }
  if (seriesGrouped) {
    whereClause += " AND (series_id IS NULL OR series_id = '')";
  }
  if (search) {
    whereClause += ' AND (title LIKE ? OR author LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    whereClause += ' AND category = ?';
    params.push(category);
  }

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM books ${whereClause}`).get(...params) as { cnt: number }).cnt;
  const offset = (page - 1) * pageSize;
  const books = db.prepare(`SELECT * FROM books ${whereClause} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as Book[];

  paginatedResponse(res, books, page, pageSize, total);
});
```

- [ ] **Step 4: 类型检查 + 提交**

```bash
cd ~/projects/easy-Reader/backend && npx tsc --noEmit
cd ~/projects/easy-Reader
git add backend/src/routes/series.ts backend/src/routes/library.ts backend/src/index.ts
git commit -m "feat(scan): add series routes and library include_dirty/series_grouped filters"
```

---

## Phase F: 审计日志路由（任务 11）

### Task 11: audit-log 路由

**Files:**
- Create: `backend/src/routes/audit-log.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: 创建路由**

Create `backend/src/routes/audit-log.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse } from '../utils/response';
import { queryAudit } from '../services/audit-log';
import { AuditAction } from '../types';

const router = Router();

router.get('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const action = req.query.action as AuditAction | undefined;
  const user_id = req.query.user_id as string | undefined;
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
  successResponse(res, queryAudit({ action, user_id, limit, offset }));
});

export default router;
```

- [ ] **Step 2: 挂载**

修改 `backend/src/index.ts`：

```typescript
import auditLogRoutes from './routes/audit-log';
// ...
app.use('/api/library/audit-log', auditLogRoutes);
```

放在 `app.use('/api/library', libraryRoutes)` **之前**。

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/routes/audit-log.ts backend/src/index.ts
git commit -m "feat(scan): add audit-log query route"
```

---

## Phase G: 前端 API + types（任务 12）

### Task 12: 前端 API 与 types 扩展

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/api/series.ts`
- Create: `frontend/src/api/audit-log.ts`
- Modify: `frontend/src/api/library.ts`
- Modify: `frontend/src/api/scan-task.ts`

- [ ] **Step 1: 加 types**

在 `frontend/src/types/index.ts` 末尾追加：

```typescript
export interface Series {
  id: string
  name: string
  summary?: string
  cover_url?: string
  author?: string
  created_at: string
  member_count?: number
}

export interface SeriesDetail {
  series: Series
  members: Book[]
}

export type AuditAction =
  | 'delete_book_file'
  | 'delete_book_record'
  | 'apply_batch'
  | 'discard_batch'
  | 'create_manual_override'
  | 'delete_manual_override'

export interface AuditLog {
  id: string
  user_id: string
  action: AuditAction
  resource_id?: string | null
  file_path?: string | null
  details?: string | null
  created_at: string
}

export interface CostEstimate {
  dedup: number
  series: number
  fill: number
  total: number
  active_plugin: string | null
  tier: 'free' | 'low' | 'high' | 'unknown'
}

export type ManualOverrideType = 'not_duplicate' | 'not_in_series' | 'forced_duplicate' | 'forced_series_member'

export interface ManualOverride {
  id: string
  type: ManualOverrideType
  book_id_a: string | null
  book_id_b: string | null
  series_id: string | null
  created_by: string
  created_at: string
}
```

并扩展 `Book` 接口（找到 export interface Book 添加字段）：

```typescript
// add these properties to the Book interface
status?: 'normal' | 'duplicate' | 'garbled' | 'encoding_fixed'
duplicate_of?: string | null
series_id?: string | null
chapter_count?: number
fingerprint?: string
encoding_detected?: string
manually_edited_fields?: string
```

- [ ] **Step 2: 创建 series API**

Create `frontend/src/api/series.ts`:

```typescript
import http from './http'
import type { ApiResponse, Series, SeriesDetail } from '@/types'

export const seriesApi = {
  list: () => http.get<ApiResponse<Series[]>>('/library/series'),
  get: (id: string) => http.get<ApiResponse<SeriesDetail>>(`/library/series/${id}`),
  update: (id: string, payload: { name?: string; summary?: string; cover_url?: string }) =>
    http.put<ApiResponse<Series>>(`/library/series/${id}`, payload),
}
```

- [ ] **Step 3: 创建 audit-log API**

Create `frontend/src/api/audit-log.ts`:

```typescript
import http from './http'
import type { ApiResponse, AuditLog, AuditAction } from '@/types'

export const auditLogApi = {
  list: (params: { action?: AuditAction; user_id?: string; limit?: number; offset?: number } = {}) =>
    http.get<ApiResponse<{ logs: AuditLog[]; total: number }>>('/library/audit-log', { params }),
}
```

- [ ] **Step 4: 扩展 libraryApi**

在 `frontend/src/api/library.ts` 末尾的 `libraryApi` 对象中添加：

```typescript
  listAdmin: (params: { page?: number; pageSize?: number; search?: string; category?: string; include_dirty?: boolean; series_grouped?: boolean; sortBy?: string; sortOrder?: 'asc' | 'desc' } = {}) =>
    http.get<import('@/types').PaginatedResponse<import('@/types').Book>>('/library', { params }),

  estimate: (params: { ai_dedup?: boolean; ai_series?: boolean; ai_fill?: boolean; full_rescan?: boolean }) =>
    http.get<ApiResponse<import('@/types').CostEstimate>>('/library/scan/estimate', { params }),

  removeWithOptions: (id: string, opts: { cascade_duplicates?: boolean; confirm_shelf_impact?: boolean } = {}) =>
    http.delete<ApiResponse<{ files_deleted: number; records_deleted: number; shelf_entries_affected: number; warnings: string[] }>>(
      `/library/${id}`,
      { params: opts },
    ),

  manualOverrides: {
    list: (type?: import('@/types').ManualOverrideType) =>
      http.get<ApiResponse<import('@/types').ManualOverride[]>>('/library/manual-overrides', { params: { type } }),
    create: (payload: { type: import('@/types').ManualOverrideType; book_id_a: string | null; book_id_b?: string | null; series_id?: string | null }) =>
      http.post<ApiResponse<import('@/types').ManualOverride>>('/library/manual-overrides', payload),
    remove: (id: string) =>
      http.delete<ApiResponse<null>>(`/library/manual-overrides/${id}`),
    removeAll: () =>
      http.delete<ApiResponse<{ deleted: number }>>('/library/manual-overrides/all'),
  },
```

- [ ] **Step 5: 类型检查 + 提交**

Run: `cd ~/projects/easy-Reader/frontend && npm run typecheck`
Expected: 0 errors

```bash
cd ~/projects/easy-Reader
git add frontend/src/types/index.ts frontend/src/api/
git commit -m "feat(scan): add frontend types and API clients for series/audit/cost/overrides"
```

---

## Phase H: 书库 UI 集成（任务 13-16）

### Task 13: BookCard badges + 删除按钮

**Files:**
- Modify: `frontend/src/components/BookCard.vue`

- [ ] **Step 1: 读现有 BookCard.vue**

Run: `cat ~/projects/easy-Reader/frontend/src/components/BookCard.vue`

观察其 template 结构。一般有封面 + 标题 + 作者，emits read/detail 事件。

- [ ] **Step 2: 修改组件**

在 `<template>` 中合适位置（封面右上角推荐）加 badge 区域，在底部操作区加管理员删除按钮。最小改动方案：

(a) 在 props 段添加（如果还没）：

```typescript
const props = defineProps<{
  book: import('@/types').Book
}>()
```

(b) 在 `<script setup>` 中加：

```typescript
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
const authStore = useAuthStore()

const showBadges = computed(() => {
  return props.book.status === 'duplicate' || props.book.status === 'garbled'
})
const badge = computed(() => {
  if (props.book.status === 'duplicate') return { type: 'danger', label: '重复' }
  if (props.book.status === 'garbled') return { type: 'warning', label: '乱码' }
  return null
})
const emit = defineEmits<{ delete: [import('@/types').Book] }>()
function onDelete(): void { emit('delete', props.book) }
```

(c) 在 `<template>` 封面区域内添加 badge：

```vue
<el-tag
  v-if="badge"
  :type="badge.type as any"
  size="small"
  class="status-badge"
>
  {{ badge.label }}
</el-tag>
```

(d) 在卡片底部（hover 显示的操作区或常驻区）加 admin 删除按钮：

```vue
<el-button
  v-if="authStore.isAdmin"
  size="small"
  type="danger"
  link
  @click.stop="onDelete"
  class="delete-btn"
>
  删除
</el-button>
```

(e) CSS 加：

```css
.status-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
}
.delete-btn {
  position: absolute;
  bottom: 8px;
  right: 8px;
}
```

如果原 BookCard 内部结构不便加 absolute 定位，按现有 layout 适配。

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/components/BookCard.vue
git commit -m "feat(scan): add badges and admin delete button to BookCard"
```

### Task 14: SeriesCard 组件

**Files:**
- Create: `frontend/src/components/SeriesCard.vue`

- [ ] **Step 1: 创建**

Create `frontend/src/components/SeriesCard.vue`:

```vue
<template>
  <div class="series-card" @click="$emit('click', series)">
    <div class="cover-stack">
      <img v-if="series.cover_url" :src="series.cover_url" class="cover" alt="" />
      <div v-else class="cover placeholder">📚</div>
      <div class="stack-layer layer-1"></div>
      <div class="stack-layer layer-2"></div>
    </div>
    <div class="info">
      <div class="title">{{ series.name }}</div>
      <div class="meta">系列 · {{ series.member_count ?? 0 }} 本</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Series } from '@/types'
defineProps<{ series: Series }>()
defineEmits<{ click: [Series] }>()
</script>

<style scoped>
.series-card {
  cursor: pointer;
  transition: transform 0.15s;
}
.series-card:hover { transform: translateY(-2px); }
.cover-stack {
  position: relative;
  aspect-ratio: 3 / 4;
  border-radius: 12px;
}
.cover, .stack-layer {
  position: absolute;
  inset: 0;
  border-radius: 12px;
  border: 1px solid var(--el-border-color-light);
}
.cover {
  background: var(--el-color-info-light-9);
  overflow: hidden;
  object-fit: cover;
  z-index: 3;
}
.cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
}
.stack-layer {
  background: var(--el-color-info-light-7);
}
.stack-layer.layer-1 { transform: translate(4px, 4px); z-index: 2; }
.stack-layer.layer-2 { transform: translate(8px, 8px); z-index: 1; }
.info { margin-top: 12px; padding: 0 4px; }
.title { font-weight: 500; }
.meta { font-size: 12px; color: var(--text-2); }
</style>
```

- [ ] **Step 2: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/components/SeriesCard.vue
git commit -m "feat(scan): add SeriesCard component"
```

### Task 15: SeriesDetail 视图

**Files:**
- Create: `frontend/src/views/SeriesDetail.vue`

- [ ] **Step 1: 创建**

Create `frontend/src/views/SeriesDetail.vue`:

```vue
<template>
  <DefaultLayout>
    <div class="series-detail-page" v-loading="loading">
      <div class="page-header">
        <el-button link @click="$router.back()">← 返回</el-button>
        <h1>{{ detail?.series.name }}</h1>
        <div class="meta" v-if="detail">
          <span>{{ detail.members.length }} 本</span>
          <span v-if="detail.series.author">· {{ detail.series.author }}</span>
        </div>
      </div>

      <div v-if="detail?.series.summary" class="summary">{{ detail.series.summary }}</div>

      <div v-if="detail" class="members-grid">
        <BookCard
          v-for="b in detail.members"
          :key="b.id"
          :book="b"
          @click="$router.push(`/book/${b.id}`)"
        />
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import BookCard from '@/components/BookCard.vue'
import { seriesApi } from '@/api/series'
import type { SeriesDetail } from '@/types'

const route = useRoute()
const detail = ref<SeriesDetail | null>(null)
const loading = ref(false)

async function fetch(): Promise<void> {
  loading.value = true
  try {
    const resp = await seriesApi.get(route.params.id as string)
    detail.value = resp.data.data
  } finally {
    loading.value = false
  }
}
onMounted(fetch)
</script>

<style scoped>
.series-detail-page { padding: 32px; }
.page-header { margin-bottom: 24px; }
.page-header h1 { margin: 8px 0; }
.meta { color: var(--text-2); font-size: 13px; }
.summary { background: var(--el-color-info-light-9); padding: 16px; border-radius: 8px; margin-bottom: 24px; }
.members-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
}
</style>
```

- [ ] **Step 2: 路由配置**

修改 `frontend/src/router/index.ts`，加：

```typescript
{
  path: '/library/series/:id',
  name: 'series-detail',
  component: () => import('@/views/SeriesDetail.vue'),
  meta: { requiresAuth: true },
},
```

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/views/SeriesDetail.vue frontend/src/router/index.ts
git commit -m "feat(scan): add SeriesDetail view and route"
```

### Task 16: Library.vue 大改：脏数据开关 + 系列卡 + 删除流程

**Files:**
- Modify: `frontend/src/views/Library.vue`

- [ ] **Step 1: 加 imports 与 state**

在 `<script setup>` imports 段添加：

```typescript
import SeriesCard from '@/components/SeriesCard.vue'
import { seriesApi } from '@/api/series'
import type { Series } from '@/types'
import { ElMessageBox } from 'element-plus'
```

在 reactive state 段加：

```typescript
const includeDirty = ref(false)
const seriesList = ref<Series[]>([])
```

- [ ] **Step 2: 替换 fetchBooks 同时拉 series**

替换原 `fetchBooks`：

```typescript
async function fetchBooks(): Promise<void> {
  loading.value = true
  try {
    const [booksResp, seriesResp] = await Promise.all([
      libraryApi.listAdmin({
        page: pagination.page,
        pageSize: pagination.pageSize,
        search: searchQuery.value || undefined,
        category: selectedCategory.value || undefined,
        sortBy: 'imported_at',
        sortOrder: 'desc',
        include_dirty: includeDirty.value,
        series_grouped: true,
      }),
      seriesApi.list(),
    ])
    books.value = booksResp.data.data
    Object.assign(pagination, booksResp.data.pagination)
    seriesList.value = seriesResp.data.data
  } finally {
    loading.value = false
  }
}
```

- [ ] **Step 3: 在 header 区加脏数据开关**

在 `<el-button type="primary" :loading="scanStore.isRunning" @click="handleScan">` **之前**加：

```vue
<el-switch
  v-if="authStore.isAdmin"
  v-model="includeDirty"
  inline-prompt
  active-text="显示脏数据"
  inactive-text="仅正常"
  @change="fetchBooks"
/>
```

- [ ] **Step 4: 在书库 grid 中渲染系列卡**

替换 `<div v-else class="books-grid">...</div>` 段为：

```vue
<div v-else class="books-grid">
  <SeriesCard
    v-for="s in seriesList"
    :key="'series-' + s.id"
    :series="s"
    @click="(s) => router.push(`/library/series/${s.id}`)"
  />
  <BookCard
    v-for="book in books"
    :key="book.id"
    :book="book"
    @click="onBookClick(book)"
    @read="router.push(`/reader/${book.id}`)"
    @detail="router.push(`/book/${book.id}`)"
    @delete="onBookDelete(book)"
  />
</div>
```

- [ ] **Step 5: 加 onBookClick / onBookDelete**

```typescript
import type { Book } from '@/types'

function onBookClick(book: Book): void {
  if (book.status === 'duplicate' && book.duplicate_of) {
    router.push(`/book/${book.duplicate_of}`)
  } else {
    router.push(`/book/${book.id}`)
  }
}

async function onBookDelete(book: Book): Promise<void> {
  await ElMessageBox.confirm(`确认删除「${book.title}」？将删除磁盘文件和数据库记录，且不可恢复。`, '删除确认', { type: 'warning' })
  try {
    await libraryApi.removeWithOptions(book.id)
    ElMessage.success('已删除')
    await fetchBooks()
  } catch (err: any) {
    if (err.response?.status === 409 && err.response.data?.code === 'HAS_DUPLICATES') {
      const cnt = err.response.data.data.duplicate_count
      await ElMessageBox.confirm(`此书有 ${cnt} 个重复关联，一并删除？`, '级联删除', { type: 'warning' })
      try {
        await libraryApi.removeWithOptions(book.id, { cascade_duplicates: true })
        ElMessage.success('已删除（含重复）')
        await fetchBooks()
      } catch (err2: any) {
        if (err2.response?.status === 409 && err2.response.data?.code === 'AFFECTS_SHELF') {
          const users = err2.response.data.data.affected_users
          await ElMessageBox.confirm(`此书已被 ${users} 个用户加入书架，确认删除？用户书架上的此书会消失。`, '影响用户书架', { type: 'warning' })
          await libraryApi.removeWithOptions(book.id, { cascade_duplicates: true, confirm_shelf_impact: true })
          ElMessage.success('已删除')
          await fetchBooks()
        } else { throw err2 }
      }
    } else if (err.response?.status === 409 && err.response.data?.code === 'AFFECTS_SHELF') {
      const users = err.response.data.data.affected_users
      await ElMessageBox.confirm(`此书已被 ${users} 个用户加入书架，确认删除？`, '影响用户书架', { type: 'warning' })
      await libraryApi.removeWithOptions(book.id, { confirm_shelf_impact: true })
      ElMessage.success('已删除')
      await fetchBooks()
    } else {
      ElMessage.error('删除失败')
    }
  }
}
```

- [ ] **Step 6: 类型检查 + 提交**

```bash
cd ~/projects/easy-Reader/frontend && npm run typecheck
cd ~/projects/easy-Reader
git add frontend/src/views/Library.vue
git commit -m "feat(scan): integrate series cards, dirty toggle, and cascade delete UI in Library"
```

---

## Phase I: 费用警告与扫描选项升级（任务 17）

### Task 17: CostWarningDialog + 升级 ScanOptionsDialog

**Files:**
- Create: `frontend/src/components/CostWarningDialog.vue`
- Modify: `frontend/src/components/ScanOptionsDialog.vue`

- [ ] **Step 1: 创建 CostWarningDialog**

Create `frontend/src/components/CostWarningDialog.vue`:

```vue
<template>
  <el-dialog v-model="visible" title="⚠️ AI 调用费用提示" width="500px" :close-on-click-modal="false">
    <div class="warning-content">
      <el-alert
        :type="tierAlertType"
        :title="tierTitle"
        :description="tierDescription"
        show-icon
        :closable="false"
      />
      <div class="breakdown">
        <div v-if="estimate.dedup > 0">AI 去重判定：约 <strong>{{ estimate.dedup }}</strong> 次</div>
        <div v-if="estimate.series > 0">AI 系列归类：约 <strong>{{ estimate.series }}</strong> 次</div>
        <div v-if="estimate.fill > 0">AI 批量填充：约 <strong>{{ estimate.fill }}</strong> 次</div>
        <div class="total">合计：约 <strong>{{ estimate.total }}</strong> 次 API 调用</div>
      </div>
      <div class="confirm-text">
        本次扫描将产生上述 AI 调用。<span v-if="tier === 'high'">⚠️ 当前使用的是<strong>高费用</strong> AI 模型，请评估成本后再继续。</span>
      </div>
    </div>
    <template #footer>
      <el-button @click="onCancel">取消</el-button>
      <el-button :type="tier === 'high' ? 'danger' : 'primary'" @click="onConfirm">确认继续</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CostEstimate } from '@/types'

const props = defineProps<{
  modelValue: boolean
  estimate: CostEstimate
}>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: []
  cancel: []
}>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, v => visible.value = v)
watch(visible, v => emit('update:modelValue', v))

const tier = computed(() => props.estimate.tier)
const tierAlertType = computed(() => {
  if (tier.value === 'free') return 'success'
  if (tier.value === 'low') return 'info'
  if (tier.value === 'high') return 'error'
  return 'warning'
})
const tierTitle = computed(() => {
  const plugin = props.estimate.active_plugin ?? '未配置'
  return `当前 AI 插件：${plugin}（${tierLabel(tier.value)}）`
})
const tierDescription = computed(() => {
  switch (tier.value) {
    case 'free': return 'Ollama 本地模型，零费用'
    case 'low': return '低费用 API，整体成本通常可忽略'
    case 'high': return '⚠️ 高费用 API（OpenAI / Claude），单次调用可达 $0.01 量级'
    case 'unknown': return '未识别的 AI 插件，无法估算费用'
  }
  return ''
})
function tierLabel(t: string): string {
  return { free: '免费', low: '低费用', high: '高费用', unknown: '未知' }[t] ?? t
}

function onConfirm(): void { emit('confirm'); visible.value = false }
function onCancel(): void { emit('cancel'); visible.value = false }
</script>

<style scoped>
.warning-content > * + * { margin-top: 16px; }
.breakdown {
  background: var(--el-color-info-light-9);
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 14px;
}
.breakdown > * + * { margin-top: 4px; }
.total { margin-top: 8px !important; padding-top: 8px; border-top: 1px solid var(--el-border-color-light); font-size: 15px; }
.confirm-text { color: var(--text-2); line-height: 1.6; }
</style>
```

- [ ] **Step 2: 升级 ScanOptionsDialog**

替换 `frontend/src/components/ScanOptionsDialog.vue` 整个文件为：

```vue
<template>
  <div>
    <el-dialog
      v-model="visible"
      title="扫描选项"
      width="540px"
      @close="onClose"
    >
      <el-form label-width="120px">
        <el-form-item label="处理模式">
          <el-radio-group v-model="form.mode">
            <el-radio value="review">暂存审核（推荐）</el-radio>
            <el-radio value="auto">自动写入</el-radio>
            <el-radio value="hybrid">混合模式</el-radio>
          </el-radio-group>
          <div class="mode-hint">
            <span v-if="form.mode === 'review'">扫描结果先入暂存批次，admin 审核后再应用</span>
            <span v-else-if="form.mode === 'auto'">AI 判定直接落库，无审核环节</span>
            <span v-else>硬重复自动入库；AI 判定 + 系列归类进审核</span>
          </div>
        </el-form-item>

        <el-form-item label="AI 功能">
          <div class="ai-toggles">
            <el-checkbox v-model="form.ai_dedup">
              AI 去重判定
              <span class="toggle-meta" v-if="estimate">（预估 {{ estimate.dedup }} 次）</span>
            </el-checkbox>
            <el-checkbox v-model="form.ai_series">
              AI 系列归类
              <span class="toggle-meta" v-if="estimate">（预估 {{ estimate.series }} 次）</span>
            </el-checkbox>
            <el-checkbox v-model="form.ai_fill">
              AI 批量填充
              <span class="toggle-meta" v-if="estimate">（预估 {{ estimate.fill }} 次）</span>
            </el-checkbox>
            <div v-if="estimate" class="estimate-summary">
              当前 AI：<strong>{{ estimate.active_plugin ?? '未配置' }}</strong>
              （{{ tierLabel }}）
              · 总调用 <strong>{{ estimate.total }}</strong> 次
            </div>
          </div>
        </el-form-item>

        <el-form-item label="扫描范围">
          <el-checkbox v-model="form.full_rescan">
            包含已入库书籍重新检测（重建指纹）
          </el-checkbox>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="onStartScan">开始扫描</el-button>
      </template>
    </el-dialog>

    <CostWarningDialog
      v-if="estimate"
      v-model="showCostWarning"
      :estimate="estimate"
      @confirm="onCostConfirmed"
      @cancel="showCostWarning = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import type { ScanStartOptions, CostEstimate } from '@/types'
import { libraryApi } from '@/api/library'
import CostWarningDialog from './CostWarningDialog.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [ScanStartOptions]
}>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, v => visible.value = v)
watch(visible, v => emit('update:modelValue', v))

const form = reactive<ScanStartOptions>({
  mode: 'review',
  ai_dedup: false,
  ai_series: false,
  ai_fill: false,
  full_rescan: false,
})

const estimate = ref<CostEstimate | null>(null)
const showCostWarning = ref(false)

async function refreshEstimate(): Promise<void> {
  try {
    const resp = await libraryApi.estimate({
      ai_dedup: form.ai_dedup,
      ai_series: form.ai_series,
      ai_fill: form.ai_fill,
      full_rescan: form.full_rescan,
    })
    estimate.value = resp.data.data
  } catch {
    estimate.value = null
  }
}

watch([() => form.ai_dedup, () => form.ai_series, () => form.ai_fill, () => form.full_rescan], () => {
  void refreshEstimate()
})
watch(visible, (v) => { if (v) void refreshEstimate() })

const tierLabel = computed(() => {
  const labels: Record<string, string> = { free: '免费', low: '低费用', high: '⚠️ 高费用', unknown: '未知' }
  return labels[estimate.value?.tier ?? 'unknown'] ?? ''
})

function onClose(): void { visible.value = false }

function onStartScan(): void {
  // If ai_fill is enabled and tier is high — show cost warning first
  if (form.ai_fill && estimate.value?.tier === 'high') {
    showCostWarning.value = true
    return
  }
  emitConfirm()
}

function onCostConfirmed(): void {
  showCostWarning.value = false
  emitConfirm()
}

function emitConfirm(): void {
  emit('confirm', { ...form })
  visible.value = false
}
</script>

<style scoped>
.mode-hint { font-size: 12px; color: var(--text-2); margin-top: 6px; line-height: 1.5; }
.ai-toggles { display: flex; flex-direction: column; gap: 4px; }
.toggle-meta { font-size: 12px; color: var(--text-2); margin-left: 4px; }
.estimate-summary {
  margin-top: 8px;
  padding: 6px 10px;
  font-size: 13px;
  background: var(--el-color-info-light-9);
  border-radius: 4px;
}
</style>
```

- [ ] **Step 3: 类型检查 + 提交**

```bash
cd ~/projects/easy-Reader/frontend && npm run typecheck
cd ~/projects/easy-Reader
git add frontend/src/components/CostWarningDialog.vue frontend/src/components/ScanOptionsDialog.vue
git commit -m "feat(scan): add CostWarningDialog and upgrade ScanOptionsDialog with live estimation"
```

---

## Phase J: 桌面通知 + 进度条文案（任务 18）

### Task 18: ScanProgressBar 加 Notification API + ai_fill stage

**Files:**
- Modify: `frontend/src/components/ScanProgressBar.vue`

- [ ] **Step 1: 修改 stageLabel + 加完成通知**

替换 `frontend/src/components/ScanProgressBar.vue` 中：

(a) `stageLabel` computed，扩展 stage 文案：

```typescript
const stageLabel = computed(() => {
  const t = store.activeTask
  if (!t) return ''
  const stageMap: Record<string, string> = {
    walking: '遍历文件中…',
    fingerprinting: '计算指纹中…',
    staging: 'AI 判定 / 入库中…',
  }
  return stageMap[t.stage ?? ''] ?? '处理中…'
})
```

(b) 在 `<script setup>` 末尾加完成通知逻辑：

```typescript
import { watch } from 'vue'

// 完成时通知
watch(() => store.activeTask?.status, async (newStatus, oldStatus) => {
  if (oldStatus === 'running' && (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled')) {
    await notifyOnFinish(newStatus)
  }
})

async function notifyOnFinish(status: string): Promise<void> {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission() } catch { return }
  }
  if (Notification.permission !== 'granted') return
  const titles: Record<string, string> = {
    completed: '扫描完成',
    failed: '扫描失败',
    cancelled: '扫描已取消',
  }
  new Notification(titles[status] ?? '扫描结束', {
    body: '点击查看 easy-Reader 书库',
    icon: '/favicon.ico',
  })
}
```

- [ ] **Step 2: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/components/ScanProgressBar.vue
git commit -m "feat(scan): add desktop notifications and ai_fill stage label to ScanProgressBar"
```

---

## Phase K: BookDetail 提示气泡（任务 19）

### Task 19: BookDetail 加 AI 字段保护说明

**Files:**
- Modify: `frontend/src/views/BookDetail.vue`

- [ ] **Step 1: 加提示气泡**

打开 `frontend/src/views/BookDetail.vue`，在编辑表单（admin 看到的 PUT 表单）之前或字段附近添加：

```vue
<el-alert
  v-if="authStore.isAdmin"
  type="info"
  show-icon
  :closable="false"
  class="ai-protect-alert"
>
  <template #title>
    AI 不会覆盖你修改过的字段
  </template>
  <template #default>
    已经被手动修改的标题 / 作者 / 简介 / 分类不会被「AI 填充」覆盖。如果想让 AI 重新填写，请<strong>手动清空</strong>该字段后保存。
  </template>
</el-alert>
```

CSS：
```css
.ai-protect-alert { margin-bottom: 16px; }
```

如果原 BookDetail 没有引入 useAuthStore，加上 import 和实例化。

- [ ] **Step 2: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/views/BookDetail.vue
git commit -m "feat(scan): add AI field-protection hint to BookDetail"
```

---

## Phase L: 人工修正与审计 UI（任务 20-21）

### Task 20: ManualOverridesAdmin 视图

**Files:**
- Create: `frontend/src/views/ManualOverridesAdmin.vue`
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1: 创建视图**

Create `frontend/src/views/ManualOverridesAdmin.vue`:

```vue
<template>
  <DefaultLayout>
    <div class="overrides-page">
      <div class="page-header">
        <h1>人工修正记录</h1>
        <el-button type="danger" plain @click="onClearAll">清空所有人工修正</el-button>
      </div>

      <el-table v-loading="loading" :data="overrides" empty-text="暂无记录">
        <el-table-column prop="type" label="类型" width="200">
          <template #default="{ row }">
            <el-tag :type="tagType(row.type)">{{ typeLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="书 A" prop="book_id_a">
          <template #default="{ row }">
            <code>{{ row.book_id_a?.slice(0,8) ?? '-' }}</code>
          </template>
        </el-table-column>
        <el-table-column label="书 B / 系列" prop="book_id_b">
          <template #default="{ row }">
            <code>{{ (row.book_id_b ?? row.series_id)?.slice(0,8) ?? '-' }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" type="danger" link @click="onDelete(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { libraryApi } from '@/api/library'
import type { ManualOverride } from '@/types'

const overrides = ref<ManualOverride[]>([])
const loading = ref(false)

async function fetch(): Promise<void> {
  loading.value = true
  try {
    const resp = await libraryApi.manualOverrides.list()
    overrides.value = resp.data.data
  } finally {
    loading.value = false
  }
}
function typeLabel(t: string): string {
  return { not_duplicate: '不是重复', not_in_series: '不属于此系列', forced_duplicate: '强制重复', forced_series_member: '强制系列成员' }[t] ?? t
}
function tagType(t: string): string {
  return t.startsWith('not_') ? 'warning' : 'primary'
}
async function onDelete(id: string): Promise<void> {
  await ElMessageBox.confirm('确认删除此修正？删除后 AI 重扫时该判定可能恢复。', '确认', { type: 'warning' })
  await libraryApi.manualOverrides.remove(id)
  ElMessage.success('已删除')
  await fetch()
}
async function onClearAll(): Promise<void> {
  await ElMessageBox.confirm('确认清空所有人工修正？这将让 AI 在下次扫描时重新自由判断。', '清空确认', { type: 'warning' })
  const r = await libraryApi.manualOverrides.removeAll()
  ElMessage.success(`已清空 ${r.data.data.deleted} 条`)
  await fetch()
}
onMounted(fetch)
</script>

<style scoped>
.overrides-page { padding: 32px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.page-header h1 { margin: 0; }
</style>
```

- [ ] **Step 2: 加路由**

修改 `frontend/src/router/index.ts`：

```typescript
{
  path: '/library/manual-overrides',
  name: 'manual-overrides',
  component: () => import('@/views/ManualOverridesAdmin.vue'),
  meta: { requiresAuth: true, requiresAdmin: true },
},
```

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/views/ManualOverridesAdmin.vue frontend/src/router/index.ts
git commit -m "feat(scan): add manual-overrides admin view"
```

### Task 21: AuditLogView

**Files:**
- Create: `frontend/src/views/AuditLogView.vue`
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1: 创建**

Create `frontend/src/views/AuditLogView.vue`:

```vue
<template>
  <DefaultLayout>
    <div class="audit-page">
      <h1>审计日志</h1>

      <el-table v-loading="loading" :data="logs" empty-text="暂无日志">
        <el-table-column prop="created_at" label="时间" width="180" />
        <el-table-column prop="action" label="操作" width="180">
          <template #default="{ row }">
            <el-tag>{{ actionLabel(row.action) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="user_id" label="用户" width="120">
          <template #default="{ row }"><code>{{ row.user_id.slice(0,8) }}</code></template>
        </el-table-column>
        <el-table-column prop="file_path" label="文件路径" />
        <el-table-column label="详情" width="100">
          <template #default="{ row }">
            <el-popover v-if="row.details" trigger="click" :width="400">
              <template #reference>
                <el-button size="small" link>查看</el-button>
              </template>
              <pre>{{ formatDetails(row.details) }}</pre>
            </el-popover>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          @current-change="fetch"
        />
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { auditLogApi } from '@/api/audit-log'
import type { AuditLog } from '@/types'

const logs = ref<AuditLog[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 50
const loading = ref(false)

async function fetch(): Promise<void> {
  loading.value = true
  try {
    const resp = await auditLogApi.list({ limit: pageSize, offset: (page.value - 1) * pageSize })
    logs.value = resp.data.data.logs
    total.value = resp.data.data.total
  } finally {
    loading.value = false
  }
}
function actionLabel(a: string): string {
  return ({
    delete_book_file: '删除文件',
    delete_book_record: '删除书籍记录',
    apply_batch: '应用批次',
    discard_batch: '废弃批次',
    create_manual_override: '新建人工修正',
    delete_manual_override: '删除人工修正',
  } as Record<string, string>)[a] ?? a
}
function formatDetails(d: string): string {
  try { return JSON.stringify(JSON.parse(d), null, 2) } catch { return d }
}
onMounted(fetch)
</script>

<style scoped>
.audit-page { padding: 32px; }
.pagination { margin-top: 24px; display: flex; justify-content: center; }
pre { white-space: pre-wrap; font-size: 12px; margin: 0; }
</style>
```

- [ ] **Step 2: 加路由**

修改 `frontend/src/router/index.ts`：

```typescript
{
  path: '/library/audit-log',
  name: 'audit-log',
  component: () => import('@/views/AuditLogView.vue'),
  meta: { requiresAuth: true, requiresAdmin: true },
},
```

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/views/AuditLogView.vue frontend/src/router/index.ts
git commit -m "feat(scan): add audit log view"
```

---

## Phase M: 端到端验证（任务 22）

### Task 22: 完整 E2E 测试

- [ ] **Step 1: 启动 backend + frontend**

```bash
cd ~/projects/easy-Reader/backend && npm run dev
cd ~/projects/easy-Reader/frontend && npm run dev
```

- [ ] **Step 2: 准备测试数据**

在 BOOKS_DIR 放入：
- 2 个内容完全相同（指纹同）的 txt
- 2 个内容相似（同名作者）但不同字数的 txt
- 3 个《女生宿舍1.txt》《女生宿舍2.txt》《女生宿舍3.txt》（同作者）
- 1 个 GBK 编码的 txt
- 1 个真乱码 txt（随机字节）
- 3 个独立"新书"

- [ ] **Step 3: 测试用例**

A. **扫描选项 + 估算**
- 点扫描 → 弹出选项对话框 → 勾选 AI 去重/系列/填充 → 各选项右侧显示预估调用数 → 顶部摘要显示「合计 N 次」

B. **费用警告 — 当 AI 是 ollama 时**
- AI 设置为 ollama → 勾选 AI 批量填充 → 点开始扫描 → 直接开始，不弹费用警告

C. **费用警告 — 当 AI 是 openai/claude 时**
- AI 设置为 openai → 勾选 AI 批量填充 → 点开始扫描 → 弹出红色 CostWarningDialog → 确认后才开始

D. **完整扫描流程（review 模式 + 全 AI）**
- 选 review 模式，勾选 ai_dedup + ai_series + ai_fill
- 扫描运行 → 进度条 → 完成桌面通知（首次会请求权限）
- 跳转或返回 Library → 顶部 alert 提示有待审批次
- 点立即审核 → 折叠面板：新书、硬重复 1 组、AI 重复 1 组、系列 1 组、编码已修复、真乱码
- 点击重复组中的预览按钮 → 浮窗显示第一章前 500 字
- 把 AI 重复组中的某成员标"剔除"
- 点击应用全部 → 确认 → 跳回 Library

E. **应用后效果验证**
- 书库出现一张系列卡《女生宿舍》→ 点进入 → SeriesDetail 显示 3 本
- 普通用户视角：看不到重复/乱码（因为 dirty toggle 默认关）
- admin 打开「显示脏数据」开关 → 列表多出重复书（带红色 badge）和乱码（黄色 badge）

F. **manual_overrides 生效**
- 上一步 admin 剔除的 AI 重复对，去 /library/manual-overrides 应该看到一条 `not_duplicate` 记录
- 再次扫描（这次不要 full_rescan），观察该对不再被判为重复

G. **删除流程**
- 点重复书的删除按钮 → 二次确认 → 删除（验证文件确实从 BOOKS_DIR 消失）
- 点正本书的删除按钮 → 弹「有 N 个重复关联」→ 选级联 → 弹「影响 N 个用户书架」（如果有）→ 确认 → 全部删除
- 去 /library/audit-log 看到 delete_book_file 记录

H. **AI 字段保护**
- 编辑某本书 author → /library/audit-log 不需要（这只是 PUT 不写 audit）
- 进入数据库验证 manually_edited_fields = `["author"]`
- 再扫描 + 勾选 AI 填充 → 该书的 author 字段不被覆盖
- 把 author 字段手动清空再保存 → 重新扫描 + AI 填充 → 字段被 AI 重新填上（因为 admin 主动清空）

- [ ] **Step 4: 修复任何 bug**

每个修复独立 commit：`fix(scan): <描述>`。

---

## Self-Review Notes

执行完所有任务后验证：

1. **完整闭环**：扫描 → 暂存 → 审核 → 应用 → 书库 UI 全部体现？
2. **费用警告**：高费用 plugin + ai_fill 一定弹警告？
3. **manual_overrides**：admin 剔除被应用时正确写入？后续扫描是否绕过？
4. **路径安全**：删除文件接口拒绝 `../` 路径？
5. **审计日志**：所有删除操作有记录？
6. **字段保护**：admin 编辑过的字段不被 AI 覆盖？
7. **桌面通知**：扫描完成时桌面通知（首次询问权限）？
8. **系列详情**：点击 SeriesCard 进入正确显示成员？

---

## 总结：Plan 1 + 2 + 3 全部完成后的最终能力

✅ 扫描进度可视化（带取消、可恢复）
✅ 编码自动修复（GBK/GB18030/BIG5 → UTF-8）
✅ 真乱码检测
✅ 文件指纹去重（确定性 + AI 软判定）
✅ 系列归类（正则 + AI）
✅ 批次暂存审核（折叠面板 + 预览 + 剔除）
✅ AI 批量填充（并发 + 重试 + 字段保护）
✅ 费用估算与高费用警告
✅ 人工修正记忆（next-scan 持久化）
✅ 系列卡 + 系列详情页
✅ 重复 / 乱码 badge 显示
✅ 脏数据显示开关
✅ 删除文件 + 级联 + 影响警告 + 路径安全
✅ 审计日志
✅ 桌面通知
✅ AI 字段保护提示

完结。
