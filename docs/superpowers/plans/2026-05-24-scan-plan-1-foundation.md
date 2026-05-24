# Plan 1: 扫描功能基础设施 + 编码修复 + 指纹

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把扫描从同步黑盒改造为带任务追踪的后台流水线；落地数据库 schema 与扫描任务表；增加编码自动修复（GBK/GB18030/BIG5 → UTF-8）与文件指纹计算；前端显示真实进度条。完成后还没有 AI / 去重 / 系列 / 批次审核，但扫描流程框架就位、所有新字段就位、下一份计划可以填充更多 stage。

**Architecture:** 后端新增 `services/scan-task.ts` 作为任务状态机（DB 持久化），`utils/encoding.ts` 与 `utils/fingerprint.ts` 实现本地算法；现有 `routes/library.ts` 中的 `/scan` 被改写为创建任务 → 派 `scan-walker.ts` 在后台异步推进 stage。前端用 Pinia store 轮询 `/scan/tasks/active`，挂在 `App.vue` 全局的 `ScanProgressBar` 显示进度。

**Tech Stack:** Express + better-sqlite3 + iconv-lite（新增）+ Jest（已配置但无测试）+ Vue 3 + Pinia + Element Plus + Vitest

**关联设计文档:** `docs/superpowers/specs/2026-05-24-scan-dedupe-design.md`

---

## File Structure

### 后端新增

| 文件 | 职责 |
|---|---|
| `backend/jest.config.js` | Jest 配置（ts-jest）|
| `backend/tests/utils/encoding.test.ts` | 编码检测单元测试 |
| `backend/tests/utils/fingerprint.test.ts` | 指纹计算单元测试 |
| `backend/tests/services/scan-task.test.ts` | 任务状态机测试 |
| `backend/src/utils/path-safe.ts` | 路径越界检查（防穿越） |
| `backend/src/utils/encoding.ts` | 编码检测 + 自动转 UTF-8 |
| `backend/src/utils/fingerprint.ts` | 章节数/大小/第一章 hash 计算指纹 |
| `backend/src/services/scan-task.ts` | scan_tasks 表 CRUD + 状态机 |
| `backend/src/services/scan-walker.ts` | 扫描主循环：遍历 → 编码 → 指纹 → 写 books |

### 后端修改

| 文件 | 修改 |
|---|---|
| `backend/package.json` | 加 `iconv-lite` 依赖 |
| `backend/src/db.ts` | 加 books 新字段 + scan_tasks 表 + 启动时 recover stale tasks |
| `backend/src/types/index.ts` | 加 `ScanTask`、扩展 `Book` |
| `backend/src/routes/library.ts` | 重写 `/scan`，新增 3 个 task 接口 |

### 前端新增

| 文件 | 职责 |
|---|---|
| `frontend/src/stores/scan-task.ts` | 全局 Pinia store，轮询 active 任务 |
| `frontend/src/components/ScanProgressBar.vue` | 顶部进度条 |
| `frontend/src/api/scan-task.ts` | API 客户端方法 |

### 前端修改

| 文件 | 修改 |
|---|---|
| `frontend/src/App.vue` | 挂载 `<ScanProgressBar />` |
| `frontend/src/views/Library.vue` | 扫描按钮改为触发 store；删除 `setTimeout(fetchBooks, 3000)` |
| `frontend/src/types/index.ts` | 加 `ScanTask` 类型 |

---

## Phase A: 依赖与脚手架（任务 1-3）

### Task 1: 添加 backend 依赖

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: 安装 iconv-lite + jest types（如果已装跳过）**

Run in `~/projects/easy-Reader/backend`:
```bash
npm install iconv-lite@^0.6.3
npm install --save-dev @types/jest@^29.5.12
```

- [ ] **Step 2: 验证 package.json**

Run: `cd ~/projects/easy-Reader/backend && grep -E 'iconv-lite|jest' package.json`
Expected output contains: `"iconv-lite": "^0.6.3"`、`"jest": "^29.7.0"`、`"@types/jest"`、`"ts-jest"`

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/package.json backend/package-lock.json
git commit -m "chore(scan): add iconv-lite for encoding detection"
```

### Task 2: 添加 Jest 配置和测试目录

**Files:**
- Create: `backend/jest.config.js`
- Create: `backend/tests/.gitkeep`

- [ ] **Step 1: 创建 jest.config.js**

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
};
```

- [ ] **Step 2: 创建测试目录**

```bash
mkdir -p ~/projects/easy-Reader/backend/tests/utils
mkdir -p ~/projects/easy-Reader/backend/tests/services
touch ~/projects/easy-Reader/backend/tests/.gitkeep
```

- [ ] **Step 3: 验证 jest 能跑空测试**

Run: `cd ~/projects/easy-Reader/backend && npx jest --passWithNoTests`
Expected: `No tests found, exiting with code 0`

- [ ] **Step 4: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/jest.config.js backend/tests/.gitkeep
git commit -m "chore(scan): add jest configuration and tests directory"
```

### Task 3: 扩展 types

**Files:**
- Modify: `backend/src/types/index.ts`

- [ ] **Step 1: 在 Book 接口末尾加新字段，并在文件末尾加 ScanTask**

Edit `backend/src/types/index.ts`，**修改** `Book` 接口为：

```typescript
export interface Book {
  id: string;
  title: string;
  author?: string;
  file_path: string;
  file_format: string;
  cover_url?: string;
  summary?: string;
  category?: string;
  tags?: string;
  publish_date?: string;
  finish_date?: string;
  is_finished: number;
  file_size?: number;
  imported_at: string;
  // 扫描增强字段（Plan 1）
  status?: 'normal' | 'duplicate' | 'garbled' | 'encoding_fixed';
  duplicate_of?: string | null;
  series_id?: string | null;
  chapter_count?: number;
  fingerprint?: string;
  first_chapter_hash?: string;
  encoding_detected?: string;
  manually_edited_fields?: string; // JSON array string
}
```

并在文件末尾添加：

```typescript
export interface ScanTask {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  stage: 'walking' | 'fingerprinting' | 'staging' | null;
  total_files: number;
  processed_files: number;
  options: string;            // JSON
  started_by: string;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
}

export interface ScanOptions {
  full_rescan: boolean;
  // 后续 Plan 会加 ai_dedup / ai_series / ai_fill / mode
}
```

- [ ] **Step 2: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/types/index.ts
git commit -m "feat(scan): add types for ScanTask and extended Book"
```

---

## Phase B: 数据库 Schema 迁移（任务 4）

### Task 4: 扩展 books 表 + 新建 scan_tasks 表 + 启动恢复

**Files:**
- Modify: `backend/src/db.ts`

- [ ] **Step 1: 找到现有 initSchema() 末尾的迁移段，整体替换**

打开 `backend/src/db.ts`。当前文件结构如下（确认位置）：
```
function initSchema(): void {
  const database = db;
  database.exec(`
    CREATE TABLE IF NOT EXISTS users ...
    ...
  `);

  // Migrations for existing databases
  try {
    database.exec('ALTER TABLE reading_progress ADD COLUMN chapter_title TEXT');
  } catch { /* ... */ }

  // Insert default admin if not exists
  const adminExists = ...
  ...
}
```

**把** `// Migrations for existing databases` 这一行连同其下方的整段 try/catch（仅 reading_progress 那段，**不包括** "Insert default admin if not exists" 段）**替换为**以下代码：

```typescript
  // === Migrations for existing databases ===
  try {
    database.exec('ALTER TABLE reading_progress ADD COLUMN chapter_title TEXT');
  } catch {
    /* column exists */
  }

  // === Plan 1 schema: scan_tasks ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      stage TEXT,
      total_files INTEGER DEFAULT 0,
      processed_files INTEGER DEFAULT 0,
      options TEXT,
      started_by TEXT NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scan_tasks_status ON scan_tasks(status);
  `);

  // === Plan 1 schema: books extra columns ===
  const booksAlters: string[] = [
    "ALTER TABLE books ADD COLUMN status TEXT DEFAULT 'normal'",
    "ALTER TABLE books ADD COLUMN duplicate_of TEXT",
    "ALTER TABLE books ADD COLUMN series_id TEXT",
    "ALTER TABLE books ADD COLUMN chapter_count INTEGER",
    "ALTER TABLE books ADD COLUMN fingerprint TEXT",
    "ALTER TABLE books ADD COLUMN first_chapter_hash TEXT",
    "ALTER TABLE books ADD COLUMN encoding_detected TEXT",
    "ALTER TABLE books ADD COLUMN manually_edited_fields TEXT",
  ];
  for (const stmt of booksAlters) {
    try { database.exec(stmt); } catch { /* column exists */ }
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_books_fingerprint ON books(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_books_duplicate_of ON books(duplicate_of);
    CREATE INDEX IF NOT EXISTS idx_books_series_id ON books(series_id);
    CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
  `);

  // === Plan 1: recover stale running tasks on startup ===
  database.prepare(
    "UPDATE scan_tasks SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE status = 'running'"
  ).run('service restarted while task was running');
```

**确认保留** `// Insert default admin if not exists` 及其下方代码完全不变。

- [ ] **Step 2: 启动 dev server 验证 schema 创建**

Run: `cd ~/projects/easy-Reader/backend && npm run dev`
等几秒后 Ctrl+C。
Run: `sqlite3 ~/projects/easy-Reader/backend/data/novel-reader.db ".schema scan_tasks"`
Expected: 输出 scan_tasks 表的 CREATE 语句

Run: `sqlite3 ~/projects/easy-Reader/backend/data/novel-reader.db ".schema books"`
Expected: 包含 status, duplicate_of, fingerprint 等新字段

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/db.ts
git commit -m "feat(scan): add scan_tasks table and books schema extensions"
```

---

## Phase C: 工具函数 — TDD（任务 5-9）

### Task 5: 路径安全工具（写测试 → 实现 → 通过）

**Files:**
- Create: `backend/src/utils/path-safe.ts`
- Create: `backend/tests/utils/path-safe.test.ts`

- [ ] **Step 1: 写失败测试**

Create `backend/tests/utils/path-safe.test.ts`:

```typescript
import { isPathInsideRoot } from '../../src/utils/path-safe';

describe('isPathInsideRoot', () => {
  it('returns true for path inside root', () => {
    expect(isPathInsideRoot('/app/books', '/app/books/foo.txt')).toBe(true);
    expect(isPathInsideRoot('/app/books', '/app/books/sub/foo.txt')).toBe(true);
  });

  it('returns false for path traversal attempt', () => {
    expect(isPathInsideRoot('/app/books', '/app/books/../etc/passwd')).toBe(false);
    expect(isPathInsideRoot('/app/books', '/app/secrets/foo')).toBe(false);
  });

  it('returns false for root path itself (must be strictly inside)', () => {
    expect(isPathInsideRoot('/app/books', '/app/books')).toBe(false);
  });

  it('handles trailing slash in root', () => {
    expect(isPathInsideRoot('/app/books/', '/app/books/foo.txt')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/utils/path-safe.test.ts`
Expected: FAIL — Cannot find module path-safe

- [ ] **Step 3: 实现 path-safe.ts**

Create `backend/src/utils/path-safe.ts`:

```typescript
import path from 'path';

export function isPathInsideRoot(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot) return false;
  return resolvedTarget.startsWith(resolvedRoot + path.sep);
}

export function assertPathInsideRoot(root: string, target: string): void {
  if (!isPathInsideRoot(root, target)) {
    throw new Error(`Path "${target}" is outside root "${root}"`);
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/utils/path-safe.test.ts`
Expected: PASS — 4 tests pass

- [ ] **Step 5: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/utils/path-safe.ts backend/tests/utils/path-safe.test.ts
git commit -m "feat(scan): add path-safe utility with traversal protection"
```

### Task 6: 编码检测工具 — 写失败测试

**Files:**
- Create: `backend/tests/utils/encoding.test.ts`
- Create: `backend/tests/utils/__fixtures__/encoding/` 几个样本文件

- [ ] **Step 1: 准备测试 fixture**

```bash
mkdir -p ~/projects/easy-Reader/backend/tests/utils/__fixtures__/encoding
```

Create `backend/tests/utils/__fixtures__/encoding/build-fixtures.ts`（脚手架脚本，跑一次生成实际文件）:

```typescript
import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';

const dir = __dirname;
const sample = '第一章 测试章节\n这是一段中文小说内容，主角说道：你好世界。\n第二章 又一章\n继续测试。';

// utf-8 正常
fs.writeFileSync(path.join(dir, 'utf8-normal.txt'), sample, 'utf-8');

// gbk 编码（需被自动修复）
fs.writeFileSync(path.join(dir, 'gbk-fixable.txt'), iconv.encode(sample, 'gbk'));

// gb18030 编码
fs.writeFileSync(path.join(dir, 'gb18030-fixable.txt'), iconv.encode(sample, 'gb18030'));

// 真乱码：随机字节
const garbled = Buffer.alloc(2048);
for (let i = 0; i < garbled.length; i++) garbled[i] = Math.floor(Math.random() * 256);
fs.writeFileSync(path.join(dir, 'garbled-random.txt'), garbled);

console.log('Fixtures generated.');
```

Run once: `cd ~/projects/easy-Reader/backend && npx ts-node tests/utils/__fixtures__/encoding/build-fixtures.ts`

- [ ] **Step 2: 写测试文件**

Create `backend/tests/utils/encoding.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { detectAndFixEncoding } from '../../src/utils/encoding';

const FIX_DIR = path.join(__dirname, '__fixtures__/encoding');

describe('detectAndFixEncoding', () => {
  // Snapshot original bytes so we can restore (since the function may overwrite)
  const backups = new Map<string, Buffer>();
  beforeAll(() => {
    for (const f of fs.readdirSync(FIX_DIR)) {
      if (f.endsWith('.txt')) {
        const p = path.join(FIX_DIR, f);
        backups.set(p, fs.readFileSync(p));
      }
    }
  });
  afterEach(() => {
    for (const [p, buf] of backups) fs.writeFileSync(p, buf);
  });

  it('detects normal UTF-8 file', async () => {
    const r = await detectAndFixEncoding(path.join(FIX_DIR, 'utf8-normal.txt'));
    expect(r.status).toBe('normal');
    expect(r.encoding).toBe('utf-8');
  });

  it('fixes GBK file by overwriting as UTF-8', async () => {
    const p = path.join(FIX_DIR, 'gbk-fixable.txt');
    const r = await detectAndFixEncoding(p);
    expect(r.status).toBe('encoding_fixed');
    expect(r.encoding).toBe('gbk');
    // After fix, file should be valid UTF-8
    const after = fs.readFileSync(p, 'utf-8');
    expect(after).toContain('第一章');
  });

  it('fixes GB18030 file', async () => {
    const r = await detectAndFixEncoding(path.join(FIX_DIR, 'gb18030-fixable.txt'));
    expect(['gb18030', 'gbk']).toContain(r.encoding);
    expect(r.status).toBe('encoding_fixed');
  });

  it('flags random garbage as garbled', async () => {
    const r = await detectAndFixEncoding(path.join(FIX_DIR, 'garbled-random.txt'));
    expect(r.status).toBe('garbled');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/utils/encoding.test.ts`
Expected: FAIL — Cannot find module encoding

### Task 7: 实现 encoding.ts

**Files:**
- Create: `backend/src/utils/encoding.ts`

- [ ] **Step 1: 实现**

Create `backend/src/utils/encoding.ts`:

```typescript
import fs from 'fs';
import iconv from 'iconv-lite';

export type EncodingStatus = 'normal' | 'encoding_fixed' | 'garbled';

export interface EncodingResult {
  status: EncodingStatus;
  encoding: string;
}

const SAMPLE_BYTES = 64 * 1024; // 只读前 64KB 来检测（避免大文件慢）
const CHINESE_THRESHOLD = 0.5;  // 真乱码阈值

/**
 * Detect file encoding. If non-UTF-8 but recognizable, overwrite as UTF-8.
 */
export async function detectAndFixEncoding(filePath: string): Promise<EncodingResult> {
  const fullBuf = await fs.promises.readFile(filePath);
  const sample = fullBuf.length > SAMPLE_BYTES ? fullBuf.subarray(0, SAMPLE_BYTES) : fullBuf;

  // Level 1: try UTF-8
  const utf8Text = tryDecode(sample, 'utf-8');
  if (utf8Text !== null && printableRatio(utf8Text) >= 0.95) {
    return { status: 'normal', encoding: 'utf-8' };
  }

  // Level 2: try GBK / GB18030 / BIG5
  for (const enc of ['gb18030', 'gbk', 'big5']) {
    const text = tryDecode(sample, enc);
    if (text !== null && printableRatio(text) >= 0.95) {
      // Re-decode the full file and overwrite
      const fullText = iconv.decode(fullBuf, enc);
      await fs.promises.writeFile(filePath, fullText, 'utf-8');
      return { status: 'encoding_fixed', encoding: enc };
    }
  }

  // Level 3: garbled
  // Compute against the best decoding we got
  return { status: 'garbled', encoding: 'unknown' };
}

function tryDecode(buf: Buffer, encoding: string): string | null {
  try {
    const text = iconv.decode(buf, encoding);
    // iconv-lite always returns a string — even if it's gibberish.
    // So we judge by printableRatio externally.
    return text;
  } catch {
    return null;
  }
}

/**
 * Ratio of "printable" characters (CJK, punctuation, ASCII letters/digits/whitespace)
 * over total chars in the text. Random bytes → ratio approaches 0.
 */
function printableRatio(text: string): number {
  if (text.length === 0) return 0;
  let good = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      // CJK Unified Ideographs + Extensions
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      // CJK punctuation
      (code >= 0x3000 && code <= 0x303f) ||
      // Fullwidth Forms
      (code >= 0xff00 && code <= 0xffef) ||
      // ASCII printable + tab/newline
      (code >= 0x20 && code <= 0x7e) ||
      code === 0x09 || code === 0x0a || code === 0x0d
    ) {
      good++;
    }
  }
  return good / text.length;
}

// Exported for testing
export const _internals = { printableRatio, CHINESE_THRESHOLD };
```

- [ ] **Step 2: 跑测试，确认通过**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/utils/encoding.test.ts`
Expected: PASS — 4 tests pass

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/utils/encoding.ts backend/tests/utils/encoding.test.ts \
  backend/tests/utils/__fixtures__/encoding/
git commit -m "feat(scan): add encoding detection with auto-fix for GBK/GB18030/BIG5"
```

### Task 8: 指纹工具 — 写失败测试

**Files:**
- Create: `backend/tests/utils/fingerprint.test.ts`
- Create: `backend/tests/utils/__fixtures__/fingerprint/` 样本文件

- [ ] **Step 1: 准备 fixture**

```bash
mkdir -p ~/projects/easy-Reader/backend/tests/utils/__fixtures__/fingerprint
```

Create `backend/tests/utils/__fixtures__/fingerprint/build-fixtures.ts`:

```typescript
import fs from 'fs';
import path from 'path';

const dir = __dirname;
const chapters = [
  '第一章 序章\n这是序章的内容，主角出场。',
  '第二章 启程\n主角离开家乡，踏上旅途。',
  '第三章 相遇\n主角遇到了导师，开始修炼。',
];

fs.writeFileSync(path.join(dir, 'book-a.txt'), chapters.join('\n'), 'utf-8');
// book-b 与 book-a 完全相同（应该有相同指纹）
fs.writeFileSync(path.join(dir, 'book-b.txt'), chapters.join('\n'), 'utf-8');
// book-c 第一章相同但后续不同
fs.writeFileSync(
  path.join(dir, 'book-c.txt'),
  chapters[0] + '\n第二章 不同\n这里内容不一样。',
  'utf-8',
);

console.log('Fingerprint fixtures generated.');
```

Run: `cd ~/projects/easy-Reader/backend && npx ts-node tests/utils/__fixtures__/fingerprint/build-fixtures.ts`

- [ ] **Step 2: 写测试**

Create `backend/tests/utils/fingerprint.test.ts`:

```typescript
import path from 'path';
import { computeFingerprint } from '../../src/utils/fingerprint';

const FIX = path.join(__dirname, '__fixtures__/fingerprint');

describe('computeFingerprint (txt)', () => {
  it('returns deterministic fingerprint for same content', async () => {
    const a = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    const a2 = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    expect(a.fingerprint).toBe(a2.fingerprint);
  });

  it('returns same fingerprint for identical content', async () => {
    const a = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    const b = await computeFingerprint(path.join(FIX, 'book-b.txt'), 'txt');
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.first_chapter_hash).toBe(b.first_chapter_hash);
  });

  it('returns different fingerprint for different content', async () => {
    const a = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    const c = await computeFingerprint(path.join(FIX, 'book-c.txt'), 'txt');
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it('returns same first_chapter_hash for files with same chapter 1 but different rest', async () => {
    const a = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    const c = await computeFingerprint(path.join(FIX, 'book-c.txt'), 'txt');
    expect(a.first_chapter_hash).toBe(c.first_chapter_hash);
  });

  it('returns positive chapter_count', async () => {
    const a = await computeFingerprint(path.join(FIX, 'book-a.txt'), 'txt');
    expect(a.chapter_count).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/utils/fingerprint.test.ts`
Expected: FAIL — Cannot find module fingerprint

### Task 9: 实现 fingerprint.ts

**Files:**
- Create: `backend/src/utils/fingerprint.ts`

- [ ] **Step 1: 实现**

Create `backend/src/utils/fingerprint.ts`:

```typescript
import fs from 'fs';
import crypto from 'crypto';
import { TxtParser } from '../plugins/parser-txt';

export interface Fingerprint {
  fingerprint: string;
  first_chapter_hash: string;
  chapter_count: number;
  file_size: number;
}

const FIRST_CHAPTER_PREVIEW_CHARS = 500;

/**
 * Compute a deterministic fingerprint of a book file.
 * Currently only txt is fully supported; epub/pdf fallback to size+sha1(head).
 */
export async function computeFingerprint(
  filePath: string,
  format: string,
): Promise<Fingerprint> {
  const stat = await fs.promises.stat(filePath);

  if (format === 'txt') {
    return computeTxtFingerprint(filePath, stat.size);
  }
  return computeGenericFingerprint(filePath, stat.size);
}

async function computeTxtFingerprint(filePath: string, fileSize: number): Promise<Fingerprint> {
  const parser = new TxtParser();
  await parser.load(filePath);
  const chapters = await parser.getChapters();

  let firstContent = '';
  if (chapters.length > 0) {
    const html = await parser.getChapterContent(0);
    // Strip <p> tags
    firstContent = html.replace(/<[^>]+>/g, '').trim();
  }

  const previewText = firstContent.slice(0, FIRST_CHAPTER_PREVIEW_CHARS).trim();
  const firstChapterHash = sha1(previewText);
  const fingerprint = sha1(`${chapters.length}_${fileSize}_${firstChapterHash}`);

  return {
    fingerprint,
    first_chapter_hash: firstChapterHash,
    chapter_count: chapters.length,
    file_size: fileSize,
  };
}

async function computeGenericFingerprint(filePath: string, fileSize: number): Promise<Fingerprint> {
  // Read first 64KB to hash
  const buf = Buffer.alloc(Math.min(64 * 1024, fileSize));
  const fd = await fs.promises.open(filePath, 'r');
  try {
    await fd.read(buf, 0, buf.length, 0);
  } finally {
    await fd.close();
  }
  const headHash = sha1(buf);
  return {
    fingerprint: sha1(`0_${fileSize}_${headHash}`),
    first_chapter_hash: headHash,
    chapter_count: 0,
    file_size: fileSize,
  };
}

function sha1(input: string | Buffer): string {
  return crypto.createHash('sha1').update(input).digest('hex');
}
```

- [ ] **Step 2: 跑测试确认通过**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/utils/fingerprint.test.ts`
Expected: PASS — 5 tests pass

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/utils/fingerprint.ts backend/tests/utils/fingerprint.test.ts \
  backend/tests/utils/__fixtures__/fingerprint/
git commit -m "feat(scan): add fingerprint utility for content-based deduplication"
```

---

## Phase D: 扫描任务状态机（任务 10-11）

### Task 10: 写 scan-task 状态机测试（先失败）

**Files:**
- Create: `backend/tests/services/scan-task.test.ts`

- [ ] **Step 1: 写测试文件**

Create `backend/tests/services/scan-task.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// We construct the DB inline (skip the default getDb singleton)
// then inject it via the scan-task module's setter.
import {
  createScanTask,
  setScanProgress,
  finishScanTask,
  cancelScanTask,
  getActiveScanTask,
  getScanTaskById,
  hasRunningTask,
  _setDbForTesting,
} from '../../src/services/scan-task';

let db: Database.Database;
const TEST_DB_PATH = path.join(__dirname, '__test-scan-task.db');

beforeEach(() => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE scan_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      stage TEXT,
      total_files INTEGER DEFAULT 0,
      processed_files INTEGER DEFAULT 0,
      options TEXT,
      started_by TEXT NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      error TEXT
    );
  `);
  _setDbForTesting(db);
});

afterEach(() => {
  db.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

describe('scan-task state machine', () => {
  it('createScanTask returns running task', () => {
    const task = createScanTask('user1', { full_rescan: false });
    expect(task.id).toBeTruthy();
    expect(task.status).toBe('running');
    expect(task.started_by).toBe('user1');
  });

  it('hasRunningTask returns true after create, false after finish', () => {
    createScanTask('user1', { full_rescan: false });
    expect(hasRunningTask()).toBe(true);
    const active = getActiveScanTask()!;
    finishScanTask(active.id, 'completed');
    expect(hasRunningTask()).toBe(false);
  });

  it('setScanProgress updates counters', () => {
    const task = createScanTask('u', { full_rescan: false });
    setScanProgress(task.id, { stage: 'fingerprinting', total_files: 100, processed_files: 42 });
    const reloaded = getScanTaskById(task.id)!;
    expect(reloaded.stage).toBe('fingerprinting');
    expect(reloaded.total_files).toBe(100);
    expect(reloaded.processed_files).toBe(42);
  });

  it('finishScanTask sets finished_at', () => {
    const task = createScanTask('u', { full_rescan: false });
    finishScanTask(task.id, 'completed');
    const reloaded = getScanTaskById(task.id)!;
    expect(reloaded.status).toBe('completed');
    expect(reloaded.finished_at).toBeTruthy();
  });

  it('cancelScanTask marks cancelled', () => {
    const task = createScanTask('u', { full_rescan: false });
    cancelScanTask(task.id);
    const reloaded = getScanTaskById(task.id)!;
    expect(reloaded.status).toBe('cancelled');
  });

  it('createScanTask throws if another task is running', () => {
    createScanTask('u', { full_rescan: false });
    expect(() => createScanTask('u', { full_rescan: false })).toThrow(/already running/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/scan-task.test.ts`
Expected: FAIL — Cannot find module scan-task

### Task 11: 实现 scan-task.ts

**Files:**
- Create: `backend/src/services/scan-task.ts`

- [ ] **Step 1: 创建目录与文件**

```bash
mkdir -p ~/projects/easy-Reader/backend/src/services
```

Create `backend/src/services/scan-task.ts`:

```typescript
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import { getDb } from '../db';
import { ScanTask, ScanOptions } from '../types';

let dbOverride: Database.Database | null = null;

/** Test-only: inject an in-memory or test DB. */
export function _setDbForTesting(db: Database.Database | null): void {
  dbOverride = db;
}

function db(): Database.Database {
  return dbOverride ?? getDb();
}

export function hasRunningTask(): boolean {
  const row = db().prepare("SELECT id FROM scan_tasks WHERE status = 'running' LIMIT 1").get();
  return !!row;
}

export function getActiveScanTask(): ScanTask | null {
  const row = db().prepare(
    "SELECT * FROM scan_tasks WHERE status = 'running' ORDER BY started_at DESC LIMIT 1"
  ).get() as ScanTask | undefined;
  return row ?? null;
}

export function getScanTaskById(id: string): ScanTask | null {
  const row = db().prepare('SELECT * FROM scan_tasks WHERE id = ?').get(id) as
    | ScanTask
    | undefined;
  return row ?? null;
}

export function createScanTask(userId: string, options: ScanOptions): ScanTask {
  if (hasRunningTask()) {
    throw new Error('A scan task is already running');
  }
  const id = uuidv4();
  db().prepare(
    `INSERT INTO scan_tasks (id, status, stage, options, started_by)
     VALUES (?, 'running', 'walking', ?, ?)`
  ).run(id, JSON.stringify(options), userId);
  return getScanTaskById(id)!;
}

export interface ProgressUpdate {
  stage?: ScanTask['stage'];
  total_files?: number;
  processed_files?: number;
}

export function setScanProgress(id: string, update: ProgressUpdate): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (update.stage !== undefined) { sets.push('stage = ?'); vals.push(update.stage); }
  if (update.total_files !== undefined) { sets.push('total_files = ?'); vals.push(update.total_files); }
  if (update.processed_files !== undefined) { sets.push('processed_files = ?'); vals.push(update.processed_files); }
  if (sets.length === 0) return;
  vals.push(id);
  db().prepare(`UPDATE scan_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function finishScanTask(id: string, status: 'completed' | 'failed', error?: string): void {
  db().prepare(
    `UPDATE scan_tasks SET status = ?, finished_at = CURRENT_TIMESTAMP, error = ? WHERE id = ?`
  ).run(status, error ?? null, id);
}

export function cancelScanTask(id: string): void {
  db().prepare(
    `UPDATE scan_tasks SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'running'`
  ).run(id);
}

export function isCancelled(id: string): boolean {
  const t = getScanTaskById(id);
  return t?.status === 'cancelled';
}
```

- [ ] **Step 2: 跑测试确认通过**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/scan-task.test.ts`
Expected: PASS — 6 tests pass

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/scan-task.ts backend/tests/services/scan-task.test.ts
git commit -m "feat(scan): add scan task state machine with global lock"
```

---

## Phase E: 扫描主循环（任务 12）

### Task 12: 实现 scan-walker.ts

**Files:**
- Create: `backend/src/services/scan-walker.ts`

注意：本任务不写自动化测试（涉及文件系统遍历，复杂，靠 E2E 验证）。如果觉得需要可以后续补。

- [ ] **Step 1: 创建文件**

Create `backend/src/services/scan-walker.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import { detectAndFixEncoding } from '../utils/encoding';
import { computeFingerprint } from '../utils/fingerprint';
import {
  setScanProgress,
  finishScanTask,
  isCancelled,
} from './scan-task';
import { ScanOptions } from '../types';

const SUPPORTED_FORMATS = ['txt', 'pdf', 'epub'];
const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';

/**
 * Run the scan in the background. Should be invoked via setImmediate from the route.
 * Caller has already created a 'running' scan_task; we update its progress and finish it.
 */
export async function runScanTask(taskId: string, options: ScanOptions): Promise<void> {
  try {
    if (!fs.existsSync(BOOKS_DIR)) {
      finishScanTask(taskId, 'completed');
      return;
    }

    // Phase 1: walk to count files
    setScanProgress(taskId, { stage: 'walking' });
    const allFiles: string[] = collectFiles(BOOKS_DIR);
    setScanProgress(taskId, { total_files: allFiles.length, processed_files: 0 });

    // Phase 2: per-file processing
    setScanProgress(taskId, { stage: 'fingerprinting' });
    let processed = 0;
    for (const fullPath of allFiles) {
      if (isCancelled(taskId)) {
        // honor cancellation; finishScanTask was already called by cancelScanTask
        return;
      }
      await processOneFile(fullPath, options);
      processed++;
      // Update progress every 5 files to reduce DB writes
      if (processed % 5 === 0 || processed === allFiles.length) {
        setScanProgress(taskId, { processed_files: processed });
      }
    }

    setScanProgress(taskId, { stage: 'staging', processed_files: allFiles.length });
    finishScanTask(taskId, 'completed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishScanTask(taskId, 'failed', msg);
    console.error('Scan task failed:', err);
  }
}

function collectFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(fp);
      else if (e.isFile()) {
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (SUPPORTED_FORMATS.includes(ext)) out.push(fp);
      }
    }
  }
  return out;
}

async function processOneFile(fullPath: string, options: ScanOptions): Promise<void> {
  const db = getDb();
  const ext = path.extname(fullPath).slice(1).toLowerCase();
  const existing = db.prepare('SELECT * FROM books WHERE file_path = ?').get(fullPath) as
    | { id: string; fingerprint?: string; status?: string }
    | undefined;

  // Skip if already present AND has fingerprint AND not full_rescan
  if (existing && existing.fingerprint && !options.full_rescan) return;

  // Encoding (only for txt; epub/pdf assumed binary)
  let status: 'normal' | 'encoding_fixed' | 'garbled' = 'normal';
  let encoding = 'utf-8';
  if (ext === 'txt') {
    try {
      const enc = await detectAndFixEncoding(fullPath);
      status = enc.status;
      encoding = enc.encoding;
    } catch (err) {
      // If encoding check fails, mark garbled
      status = 'garbled';
      encoding = 'unknown';
    }
  }

  // Fingerprint
  let fp: Awaited<ReturnType<typeof computeFingerprint>> | null = null;
  if (status !== 'garbled') {
    try {
      fp = await computeFingerprint(fullPath, ext);
    } catch {
      status = 'garbled';
    }
  }

  const stat = fs.statSync(fullPath);
  const title = path.basename(fullPath, path.extname(fullPath));

  if (existing) {
    // Update existing row with new fingerprint / encoding / status
    db.prepare(
      `UPDATE books SET
         status = ?,
         encoding_detected = ?,
         fingerprint = ?,
         first_chapter_hash = ?,
         chapter_count = ?,
         file_size = ?
       WHERE id = ?`
    ).run(
      status,
      encoding,
      fp?.fingerprint ?? null,
      fp?.first_chapter_hash ?? null,
      fp?.chapter_count ?? null,
      stat.size,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO books (
         id, title, file_path, file_format, file_size,
         status, encoding_detected, fingerprint, first_chapter_hash, chapter_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      title,
      fullPath,
      ext,
      stat.size,
      status,
      encoding,
      fp?.fingerprint ?? null,
      fp?.first_chapter_hash ?? null,
      fp?.chapter_count ?? null,
    );
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/scan-walker.ts
git commit -m "feat(scan): add scan walker with encoding fix and fingerprint stages"
```

---

## Phase F: API 接口（任务 13-14）

### Task 13: 重写 /scan + 新增任务接口

**Files:**
- Modify: `backend/src/routes/library.ts`

- [ ] **Step 1: 修改 imports**

替换 `backend/src/routes/library.ts` 第 1-11 行的 imports（注意 `errorResponse` 不支持 data 参数，路由里 409 响应将直接用 `res.status().json()`）：

```typescript
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, paginatedResponse, errorResponse } from '../utils/response';
import { Book, ScanOptions } from '../types';
import { aiManager } from '../ai/ai-manager';
import {
  createScanTask,
  getActiveScanTask,
  getScanTaskById,
  cancelScanTask,
  hasRunningTask,
} from '../services/scan-task';
import { runScanTask } from '../services/scan-walker';
```

- [ ] **Step 2: 替换原 POST /scan 路由为新的 scan 路由 + 3 个任务路由**

替换原 `POST /scan` 路由（`router.post('/scan', ...)` 那一整段，约第 48-89 行；包含从 `const taskId = uuidv4();` 到该 router.post 块结束）为：

```typescript
const scanOptionsSchema = z.object({
  full_rescan: z.boolean().default(false),
});

// POST /api/library/scan
router.post('/scan', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  if (hasRunningTask()) {
    const active = getActiveScanTask()!;
    res.status(409).json({
      success: false,
      code: 'TASK_RUNNING',
      message: '已有扫描任务在运行',
      data: { activeTaskId: active.id },
    });
    return;
  }

  const parsed = scanOptionsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败');
    return;
  }
  const options: ScanOptions = parsed.data;

  const task = createScanTask(req.user!.userId, options);

  // Fire and forget
  setImmediate(() => {
    void runScanTask(task.id, options);
  });

  successResponse(res, { taskId: task.id, status: task.status }, '扫描任务已启动');
});

// GET /api/library/scan/tasks/active
router.get('/scan/tasks/active', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  const active = getActiveScanTask();
  successResponse(res, active);
});

// GET /api/library/scan/tasks/:id
router.get('/scan/tasks/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const task = getScanTaskById(req.params.id);
  if (!task) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '任务不存在');
    return;
  }
  successResponse(res, task);
});

// POST /api/library/scan/tasks/:id/cancel
router.post('/scan/tasks/:id/cancel', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const task = getScanTaskById(req.params.id);
  if (!task) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '任务不存在');
    return;
  }
  cancelScanTask(req.params.id);
  successResponse(res, null, '任务取消请求已发出');
});
```

- [ ] **Step 3: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/routes/library.ts
git commit -m "feat(scan): wire scan task framework into library routes"
```

### Task 14: 启动 dev server 手动验证

- [ ] **Step 1: 启动 backend dev**

```bash
cd ~/projects/easy-Reader/backend
npm run dev
```

- [ ] **Step 2: 用 curl 测试（在另一个终端）**

先登录拿 token（假设 admin/admin123）：
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | grep -o '"accessToken":"[^"]*"' | sed 's/"accessToken":"\(.*\)"/\1/')
echo "Token: $TOKEN"
```

启动扫描：
```bash
curl -X POST http://localhost:3000/api/library/scan \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"full_rescan":false}'
```
Expected: `{"success":true, "data":{"taskId":"...","status":"running"}, ...}`

查询活跃任务：
```bash
curl http://localhost:3000/api/library/scan/tasks/active \
  -H "Authorization: Bearer $TOKEN"
```
Expected: 含 `status: 'running'` 或 `'completed'` 的任务对象

- [ ] **Step 3: 检查 DB**

```bash
sqlite3 ~/projects/easy-Reader/backend/data/novel-reader.db \
  "SELECT status, stage, total_files, processed_files FROM scan_tasks ORDER BY started_at DESC LIMIT 5"
```
Expected: 看到 completed 任务，processed_files == total_files

如果 BOOKS_DIR 里有 txt 文件：
```bash
sqlite3 ~/projects/easy-Reader/backend/data/novel-reader.db \
  "SELECT title, status, encoding_detected, chapter_count FROM books LIMIT 5"
```
Expected: 看到 fingerprint 字段填充、status='normal' 或 'encoding_fixed'

- [ ] **Step 4: 停止 dev server (Ctrl+C)，提交**

```bash
cd ~/projects/easy-Reader
# Phase 验证不产生代码变更；如果你为了调试改了任何文件，回退它们
git status   # should be clean or only have local-only changes
```

如果都 OK，不需要 commit。这是一个验证 step，不是代码变更。

---

## Phase G: 前端集成（任务 15-19）

### Task 15: 加 API 客户端方法

**Files:**
- Create: `frontend/src/api/scan-task.ts`
- Modify: `frontend/src/api/library.ts`
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: 加 type**

在 `frontend/src/types/index.ts` 末尾追加（如不存在该文件路径，先确认）：

```typescript
export interface ScanTask {
  id: string
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'
  stage: 'walking' | 'fingerprinting' | 'staging' | null
  total_files: number
  processed_files: number
  options: string
  started_by: string
  started_at: string
  finished_at?: string | null
  error?: string | null
}
```

- [ ] **Step 2: 创建 api client**

Create `frontend/src/api/scan-task.ts`:

```typescript
import http from './http'
import type { ApiResponse, ScanTask } from '@/types'

export interface ScanStartPayload {
  full_rescan?: boolean
}

export const scanTaskApi = {
  start: (payload: ScanStartPayload = {}) =>
    http.post<ApiResponse<{ taskId: string; status: string }>>('/library/scan', payload),

  getActive: () =>
    http.get<ApiResponse<ScanTask | null>>('/library/scan/tasks/active'),

  getById: (id: string) =>
    http.get<ApiResponse<ScanTask>>(`/library/scan/tasks/${id}`),

  cancel: (id: string) =>
    http.post<ApiResponse<null>>(`/library/scan/tasks/${id}/cancel`),
}
```

- [ ] **Step 3: 修改 libraryApi.scan**

在 `frontend/src/api/library.ts` 把 `scan: () => ...` 改为：

```typescript
scan: (payload: { full_rescan?: boolean } = {}) =>
  http.post<ApiResponse<{ taskId: string; status: string }>>('/library/scan', payload),
```

- [ ] **Step 4: 类型检查 + 提交**

Run: `cd ~/projects/easy-Reader/frontend && npm run typecheck`
Expected: 0 errors

```bash
cd ~/projects/easy-Reader
git add frontend/src/api/scan-task.ts frontend/src/api/library.ts frontend/src/types/
git commit -m "feat(scan): add frontend api client for scan tasks"
```

### Task 16: 创建 Pinia store

**Files:**
- Create: `frontend/src/stores/scan-task.ts`

- [ ] **Step 1: 创建 store**

Create `frontend/src/stores/scan-task.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { scanTaskApi } from '@/api/scan-task'
import type { ScanTask } from '@/types'

const POLL_INTERVAL_MS = 2000

export const useScanTaskStore = defineStore('scanTask', () => {
  const activeTask = ref<ScanTask | null>(null)
  const isPolling = ref(false)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const isRunning = computed(() => activeTask.value?.status === 'running')
  const progress = computed(() => {
    const t = activeTask.value
    if (!t || t.total_files === 0) return 0
    return Math.round((t.processed_files / t.total_files) * 100)
  })

  async function refresh(): Promise<void> {
    try {
      const resp = await scanTaskApi.getActive()
      activeTask.value = resp.data.data ?? null
      // If task is no longer running, stop polling
      if (activeTask.value && activeTask.value.status !== 'running') {
        stopPolling()
      }
    } catch {
      // ignore polling errors
    }
  }

  function startPolling(): void {
    if (isPolling.value) return
    isPolling.value = true
    void refresh()
    pollTimer = setInterval(refresh, POLL_INTERVAL_MS)
  }

  function stopPolling(): void {
    isPolling.value = false
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function startScan(payload: { full_rescan?: boolean } = {}): Promise<void> {
    await scanTaskApi.start(payload)
    await refresh()
    startPolling()
  }

  async function cancel(): Promise<void> {
    if (!activeTask.value) return
    await scanTaskApi.cancel(activeTask.value.id)
    await refresh()
  }

  return {
    activeTask,
    isRunning,
    progress,
    isPolling,
    refresh,
    startPolling,
    stopPolling,
    startScan,
    cancel,
  }
})
```

- [ ] **Step 2: 类型检查**

Run: `cd ~/projects/easy-Reader/frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/stores/scan-task.ts
git commit -m "feat(scan): add pinia store for scan task polling"
```

### Task 17: 创建 ScanProgressBar 组件

**Files:**
- Create: `frontend/src/components/ScanProgressBar.vue`

- [ ] **Step 1: 创建组件**

Create `frontend/src/components/ScanProgressBar.vue`:

```vue
<template>
  <div v-if="show" class="scan-progress-bar">
    <div class="progress-content">
      <div class="progress-label">
        <span class="stage-text">{{ stageLabel }}</span>
        <span class="progress-text">{{ store.activeTask?.processed_files ?? 0 }} / {{ store.activeTask?.total_files ?? 0 }}</span>
      </div>
      <el-progress
        :percentage="store.progress"
        :stroke-width="6"
        :show-text="false"
        :status="store.activeTask?.status === 'failed' ? 'exception' : undefined"
      />
    </div>
    <div class="progress-actions">
      <el-button v-if="store.isRunning" size="small" type="danger" plain @click="onCancel">
        取消
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useScanTaskStore } from '@/stores/scan-task'

const store = useScanTaskStore()

const show = computed(() => {
  const t = store.activeTask
  if (!t) return false
  // Show while running or 5s after completion / failure
  return t.status === 'running'
})

const stageLabel = computed(() => {
  const t = store.activeTask
  if (!t) return ''
  const stageMap: Record<string, string> = {
    walking: '遍历文件中…',
    fingerprinting: '计算指纹中…',
    staging: '入库中…',
  }
  return stageMap[t.stage ?? ''] ?? '处理中…'
})

async function onCancel(): Promise<void> {
  try {
    await store.cancel()
    ElMessage.success('已发送取消请求')
  } catch {
    ElMessage.error('取消失败')
  }
}

onMounted(() => {
  // On mount, check if there's an active task (e.g., user reloaded page mid-scan)
  void store.refresh().then(() => {
    if (store.isRunning) store.startPolling()
  })
})
</script>

<style scoped>
.scan-progress-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: var(--el-color-primary-light-9);
  border-bottom: 1px solid var(--el-color-primary-light-7);
}
.progress-content {
  flex: 1;
  min-width: 0;
}
.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--el-color-primary);
  margin-bottom: 4px;
}
.stage-text { font-weight: 500; }
.progress-text { color: var(--text-2); }
.progress-actions { flex-shrink: 0; }
</style>
```

- [ ] **Step 2: 类型检查**

Run: `cd ~/projects/easy-Reader/frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/components/ScanProgressBar.vue
git commit -m "feat(scan): add ScanProgressBar component"
```

### Task 18: 挂载到 App.vue + 改 Library.vue

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/views/Library.vue`

- [ ] **Step 1: 修改 App.vue 加入 ScanProgressBar**

当前 `App.vue` 结构是：

```vue
<template>
  <router-view v-slot="{ Component, route }">
    <transition name="page" mode="out-in">
      <component :is="Component" :key="route.path" />
    </transition>
  </router-view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { settingsApi } from '@/api/settings'

const authStore = useAuthStore()
// ... rest unchanged
</script>
```

修改两处：

(a) **template**：在最外层加 `<ScanProgressBar />` 作为第一个子元素：

```vue
<template>
  <ScanProgressBar />
  <router-view v-slot="{ Component, route }">
    <transition name="page" mode="out-in">
      <component :is="Component" :key="route.path" />
    </transition>
  </router-view>
</template>
```

(b) **script setup**：在 imports 段末尾加：

```typescript
import ScanProgressBar from '@/components/ScanProgressBar.vue'
```

保留所有其他 import 和 onMounted 逻辑不变。

- [ ] **Step 2: 修改 Library.vue 的 handleScan 函数**

在 `frontend/src/views/Library.vue` 中：

1. 找到 `<script setup>` 内的 imports（约 70 行附近），添加：
```typescript
import { useScanTaskStore } from '@/stores/scan-task'
import { watch } from 'vue'
```

2. 在 `const authStore = useAuthStore()` 下方添加：
```typescript
const scanStore = useScanTaskStore()
```

3. 替换原 `handleScan` 函数（约第 125 行）为：
```typescript
async function handleScan(): Promise<void> {
  if (scanStore.isRunning) {
    ElMessage.warning('已有扫描任务在运行')
    return
  }
  try {
    await scanStore.startScan({ full_rescan: false })
    ElMessage.success('扫描任务已启动')
  } catch (err: any) {
    if (err.response?.status === 409) {
      ElMessage.warning('已有扫描任务在运行')
      void scanStore.refresh()
    } else {
      ElMessage.error('扫描失败')
    }
  }
}

// 任务完成后刷新书库
watch(() => scanStore.activeTask?.status, (newStatus, oldStatus) => {
  if (oldStatus === 'running' && newStatus !== 'running') {
    void fetchBooks()
  }
})
```

4. 替换 `<el-button>` 上的 `:loading="scanning"` 为 `:loading="scanStore.isRunning"`，删除 `scanning` ref 声明（约第 85 行 `const scanning = ref(false)`）。

5. 删除原 handleScan 里的 `scanning.value = true` / `finally { scanning.value = false }` 段，以及 `setTimeout(fetchBooks, 3000)`。

- [ ] **Step 3: 类型检查**

Run: `cd ~/projects/easy-Reader/frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 4: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/App.vue frontend/src/views/Library.vue
git commit -m "feat(scan): integrate scan progress bar into Library and App"
```

### Task 19: 端到端验证

- [ ] **Step 1: 启动 backend 和 frontend dev server**

终端 1：
```bash
cd ~/projects/easy-Reader/backend && npm run dev
```

终端 2：
```bash
cd ~/projects/easy-Reader/frontend && npm run dev
```

- [ ] **Step 2: 浏览器手动测试**

打开 http://localhost:8080，用 admin/admin123 登录，进入书库页。

测试用例 A：**正常扫描**
- 点击「扫描导入」按钮
- 期望：按钮变为 loading；顶部出现进度条；进度条显示 "遍历文件中…" → "计算指纹中…"；完成后进度条消失；书库列表自动刷新

测试用例 B：**并发拒绝**
- 扫描运行中，再次点击「扫描导入」
- 期望：toast 提示「已有扫描任务在运行」

测试用例 C：**取消任务**
- 扫描运行中，点击进度条上的「取消」按钮
- 期望：任务状态变 cancelled，进度条消失

测试用例 D：**刷新页面恢复**
- 扫描运行中，刷新页面
- 期望：页面加载后进度条自动出现

测试用例 E：**扫描后数据库验证**
```bash
sqlite3 ~/projects/easy-Reader/backend/data/novel-reader.db \
  "SELECT title, status, encoding_detected, chapter_count, length(fingerprint) FROM books LIMIT 10"
```
- 期望：fingerprint 长度 = 40（sha1），encoding_detected 不为空

- [ ] **Step 3: 若发现 bug，逐项修复并提交**

每个修复独立 commit，消息格式：`fix(scan): <具体描述>`

如果一切正常，不产生 commit。

---

## Self-Review Notes（仅供 implementing agent 参考）

执行完所有任务后，逐项验证：

1. **DB schema**：`books` 表是否包含 `status`, `duplicate_of`, `series_id`, `chapter_count`, `fingerprint`, `first_chapter_hash`, `encoding_detected`, `manually_edited_fields`？`scan_tasks` 表是否存在？
2. **TDD**：所有 utils 测试通过？(`npx jest`)
3. **类型一致**：`ScanTask` 在 backend types 和 frontend types 中字段一致？
4. **全局锁**：`hasRunningTask()` 在 `/scan` 路由生效？测试 case B 验证
5. **可恢复**：刷新页面后 store 能 detect 到运行中的任务？测试 case D
6. **取消逻辑**：取消请求后，walker 在下一次 `isCancelled()` 检查时退出？测试 case C

---

## 范围之外（下一份计划承接）

下面这些**故意**未在 Plan 1 实现，放到 Plan 2 / 3：
- AI 去重 / AI 系列归类 / AI 批量填充
- 扫描选项对话框（当前 `/scan` 只接受 `full_rescan`）
- 批次审核 UI（当前扫描结果直接落 books 表）
- 重复 / 乱码 badge 显示在书库
- 系列卡 / 系列详情页
- 删除文件功能 + 审计日志
- 人工修正记忆
- 费用估算与警告
- 桌面通知

Plan 1 完成后产品状态：扫描流程更可靠（带进度、可取消、可恢复），所有书带指纹（为 Plan 2 的去重做准备），GBK 编码自动修复。
