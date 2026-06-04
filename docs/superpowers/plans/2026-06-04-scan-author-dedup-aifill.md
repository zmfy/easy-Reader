# 扫描作者提取 + 同书名作者软重复 + AI填充作者校验与查看视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扫描时从文件名提取作者入库，按"书名+作者"识别软重复（自动模式自动归并/审核模式进批次），并给 AI 填充加"已知作者"校验、区分已填充/失败/未尝试并在书库可筛选查看。

**Architecture:** 后端 Express + better-sqlite3 + ts-jest。新增两个纯函数工具（作者提取、作者比对）便于单测；软重复复用既有 `duplicate_group` 批次/应用/前端卡片；AI 填充编排两趟调用（书名+作者 → 仅书名）并用作者校验决定 filled/failed；前端 Vue3 加筛选与角标。

**Tech Stack:** TypeScript, Express, better-sqlite3, Jest(ts-jest), Vue 3 + Element Plus.

参考 spec：`docs/superpowers/specs/2026-06-04-scan-author-dedup-aifill-design.md`

---

## 文件结构

**Part 1（作者提取 + 软重复）**
- 修改 `backend/src/utils/title-normalizer.ts` — 加 `extractAuthorFromName`
- 修改 `backend/src/services/dedup-grouper.ts` — 加 `title_author_groups`
- 修改 `backend/src/types/index.ts` — `NewBookPayload.author`、`decision_type` 加 `'soft'`、`Book.ai_fill_status`、`AiPlugin.fillBookInfo` hint
- 修改 `backend/src/services/scan-walker.ts` — 提取作者、`ScannedBookEx.author`、`toNewPayload`、软重复分组与 payload、`isEmpty`
- 修改 `backend/src/services/batch-builder.ts` — `ScanResult.soft_duplicate_groups` + emit + summary
- 修改 `backend/src/services/batch-applier.ts` — `upsertBookByPath` 写 author

**Part 2（AI 填充校验 + 状态 + 视图）**
- 修改 `backend/src/db.ts` — 加列 `ai_fill_status`
- 新建 `backend/src/ai/fill-prompt.ts` — 共享 `buildFillPrompt(rawText, config, hint)`
- 新建 `backend/src/utils/author-match.ts` — `normalizeAuthor` + `authorsMatch`
- 修改 6 个插件 `backend/src/ai/{deepseek,openai,claude,qwen,minmax,ollama}.ts` — `fillBookInfo` 加 hint + 用 `buildFillPrompt`
- 修改 `backend/src/ai/ai-manager.ts` — 透传 hint
- 修改 `backend/src/services/ai-batch-fill.ts` — 两趟编排 + 作者校验 + `ai_fill_status`
- 修改 `backend/src/routes/library.ts` — `ai_fill` 筛选
- 修改 `frontend/src/types/index.ts` — `Book.ai_fill_status`、`LibraryQuery`(在 api 文件)
- 修改 `frontend/src/api/library.ts` — `LibraryQuery.ai_fill`
- 修改 `frontend/src/views/Library.vue` — 筛选下拉
- 修改 `frontend/src/components/BookCard.vue` — AI 填充角标

测试命令：后端 `cd backend && npx jest <path>`；类型检查 `npx tsc --noEmit`；前端构建 `cd frontend && npm run build`。

---

## Task 1: 文件名提取作者工具

**Files:**
- Modify: `backend/src/utils/title-normalizer.ts`
- Test: `backend/tests/utils/title-normalizer.test.ts`

- [ ] **Step 1: 写失败测试**（追加到现有 `title-normalizer.test.ts`；若文件无 import 则补 `import { extractAuthorFromName } from '../../src/utils/title-normalizer';`）

```typescript
describe('extractAuthorFromName', () => {
  it('提取「作者：X」', () => {
    expect(extractAuthorFromName('《黄金瞳(典当)》（精校版全本）作者：打眼.txt')).toBe('打眼');
  });
  it('提取「作者:X」半角冒号', () => {
    expect(extractAuthorFromName('18《轻狂》作者:巫哲')).toBe('巫哲');
  });
  it('无作者段返回 null', () => {
    expect(extractAuthorFromName('绿林七宗罪大史记.txt')).toBeNull();
  });
  it('去掉首尾空白', () => {
    expect(extractAuthorFromName('某书 作者： 夜的七宗罪 ')).toBe('夜的七宗罪');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest tests/utils/title-normalizer.test.ts -t extractAuthorFromName`
Expected: FAIL（`extractAuthorFromName is not a function`）

- [ ] **Step 3: 实现**（追加到 `title-normalizer.ts` 末尾）

```typescript
/**
 * Extract the author from a book filename like
 * "《黄金瞳》（精校版全本）作者：打眼.txt" → "打眼".
 * Returns null when no "作者：…" segment is present.
 */
export function extractAuthorFromName(name: string): string | null {
  const noExt = name.replace(/\.[^.]+$/, '');
  const m = noExt.match(/作者[：:]\s*(.+?)\s*$/);
  return m ? m[1].trim() || null : null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest tests/utils/title-normalizer.test.ts -t extractAuthorFromName`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/utils/title-normalizer.ts backend/tests/utils/title-normalizer.test.ts
git commit -m "feat(scan): extractAuthorFromName 从文件名提取作者"
```

---

## Task 2: 作者比对工具

**Files:**
- Create: `backend/src/utils/author-match.ts`
- Test: `backend/tests/utils/author-match.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import { authorsMatch, normalizeAuthor } from '../../src/utils/author-match';

describe('normalizeAuthor', () => {
  it('去空白/全角空格、去尾部「著」、小写', () => {
    expect(normalizeAuthor(' 南派三叔 著 ')).toBe('南派三叔');
    expect(normalizeAuthor('Ａｂｃ')).toBe('abc');
  });
});

describe('authorsMatch', () => {
  it('归一化后完全相等', () => {
    expect(authorsMatch('打眼', '打眼')).toBe(true);
    expect(authorsMatch('南派三叔 著', '南派三叔')).toBe(true);
  });
  it('包含关系算一致', () => {
    expect(authorsMatch('天蚕土豆', '天蚕土豆(唐家三少推荐)')).toBe(true);
  });
  it('2/3 以上文字一致（模糊）算一致', () => {
    expect(authorsMatch('夜的七宗罪', '夜的七宗')).toBe(true); // 距离1/长度5 → 0.8
  });
  it('差异过大不一致', () => {
    expect(authorsMatch('打眼', '唐家三少')).toBe(false);
  });
  it('任一方为空不一致', () => {
    expect(authorsMatch('', '打眼')).toBe(false);
    expect(authorsMatch('打眼', '')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest tests/utils/author-match.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
import { levenshtein } from './title-normalizer';

/** 归一化作者名：全角→半角、去所有空白、去尾部「著/编著/着」、小写。 */
export function normalizeAuthor(s: string): string {
  return (s || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, '')
    .replace(/(编著|编着|著|着)$/g, '')
    .toLowerCase()
    .trim();
}

/**
 * 判断两个作者名是否“一致”：归一化后 ① 完全相等 → ② 一方包含另一方
 * → ③ 模糊相似度 >= 2/3。任一方归一化后为空则不一致。
 */
export function authorsMatch(a: string, b: string): boolean {
  const na = normalizeAuthor(a);
  const nb = normalizeAuthor(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const sim = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  return sim >= 2 / 3;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest tests/utils/author-match.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/src/utils/author-match.ts backend/tests/utils/author-match.test.ts
git commit -m "feat(ai-fill): authorsMatch 作者一致性比对(相等/包含/模糊2-3)"
```

---

## Task 3: dedup-grouper 增加 title_author_groups

**Files:**
- Modify: `backend/src/services/dedup-grouper.ts`
- Test: `backend/tests/services/dedup-grouper.test.ts`

- [ ] **Step 1: 写失败测试**（追加 describe；顶部确保 `import { buildCandidateGroups } from '../../src/services/dedup-grouper';` 已存在）

```typescript
describe('buildCandidateGroups.title_author_groups', () => {
  const mk = (file_path: string, title: string, author: string, fingerprint: string) =>
    ({ file_path, title, author, fingerprint, chapter_count: 10, first_chapter_hash: 'h', first_chapter_preview: '' });

  it('同书名同作者、指纹不同 → 成一组', () => {
    const r = buildCandidateGroups([
      mk('/a.txt', '《黄金瞳(典当)》（精校版全本）作者：打眼', '打眼', 'fpA'),
      mk('/b.txt', '《黄金瞳(典当)》（校对版全本）作者：打眼', '打眼', 'fpB'),
    ]);
    expect(r.title_author_groups.length).toBe(1);
    expect(r.title_author_groups[0].map(x => x.file_path).sort()).toEqual(['/a.txt', '/b.txt']);
  });

  it('同书名不同作者 → 不成组', () => {
    const r = buildCandidateGroups([
      mk('/a.txt', '黄金瞳', '打眼', 'fpA'),
      mk('/b.txt', '黄金瞳', '别人', 'fpB'),
    ]);
    expect(r.title_author_groups.length).toBe(0);
  });

  it('指纹相同 → 归 hard，不计入 title_author_groups', () => {
    const r = buildCandidateGroups([
      mk('/a.txt', '黄金瞳', '打眼', 'same'),
      mk('/b.txt', '黄金瞳', '打眼', 'same'),
    ]);
    expect(r.hard_groups.length).toBe(1);
    expect(r.title_author_groups.length).toBe(0);
  });

  it('author 为空 → 跳过', () => {
    const r = buildCandidateGroups([
      mk('/a.txt', '黄金瞳', '', 'fpA'),
      mk('/b.txt', '黄金瞳', '', 'fpB'),
    ]);
    expect(r.title_author_groups.length).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest tests/services/dedup-grouper.test.ts -t title_author_groups`
Expected: FAIL（`title_author_groups` undefined）

- [ ] **Step 3: 实现**

3a. 顶部 import 增加 `lookupKey` 与 `normalizeAuthor`：

```typescript
import { normalizeTitle, levenshtein } from '../utils/title-normalizer';
import { lookupKey } from './title-lookup';
import { normalizeAuthor } from '../utils/author-match';
```

3b. `CandidateGroups` 接口加字段：

```typescript
export interface CandidateGroups {
  hard_groups: ScannedBook[][];
  soft_groups: ScannedBook[][];
  /** 同 lookupKey(title) + 同 normalizeAuthor(author)，指纹不同（≥2 本、≥2 指纹）。 */
  title_author_groups: ScannedBook[][];
}
```

3c. 在 `return { hard_groups: hardGroups, soft_groups: softGroups };` 之前插入分组计算，并改 return：

```typescript
  // --- Title + author groups (deterministic soft-dup, excludes hard members) ---
  const byTitleAuthor = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint || inHard.has(b.file_path)) continue;
    const author = normalizeAuthor(b.author ?? '');
    if (!author) continue;
    const titleKey = lookupKey(b.title);
    if (!titleKey) continue;
    const key = `${titleKey}::${author}`;
    const arr = byTitleAuthor.get(key);
    if (arr) arr.push(b);
    else byTitleAuthor.set(key, [b]);
  }
  const titleAuthorGroups: ScannedBook[][] = [];
  for (const [, group] of byTitleAuthor) {
    if (group.length < 2) continue;
    const fps = new Set(group.map(b => b.fingerprint));
    if (fps.size >= 2) titleAuthorGroups.push(group);
  }

  return { hard_groups: hardGroups, soft_groups: softGroups, title_author_groups: titleAuthorGroups };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest tests/services/dedup-grouper.test.ts`
Expected: PASS（含原有用例）

- [ ] **Step 5: 提交**

```bash
git add backend/src/services/dedup-grouper.ts backend/tests/services/dedup-grouper.test.ts
git commit -m "feat(scan): dedup-grouper 增加 title_author_groups(书名+作者软重复)"
```

---

## Task 4: 类型扩展

**Files:**
- Modify: `backend/src/types/index.ts`

- [ ] **Step 1: 改 `NewBookPayload` 加 author**（在 `export interface NewBookPayload {` 块内加一行）

```typescript
  author?: string;
```

- [ ] **Step 2: 改 `DuplicateMemberPayload.decision_type`**（找到 `decision_type: 'hard' | 'ai';` 改为）

```typescript
    decision_type: 'hard' | 'ai' | 'soft';     // hard=指纹相同；soft=书名+作者；ai=AI判定
```

- [ ] **Step 3: `Book` 接口加 ai_fill_status**（在 `export interface Book {` 块内加一行）

```typescript
  ai_fill_status?: 'filled' | 'failed' | null;
```

- [ ] **Step 4: `AiPlugin.fillBookInfo` 签名加 hint**（找到 `AiPlugin` 接口中的 `fillBookInfo`，改为）

```typescript
  fillBookInfo(rawText: string, config: Record<string, string>, hint?: { title?: string; author?: string }): Promise<Partial<Book>>;
```

- [ ] **Step 5: 类型检查 + 提交**

Run: `cd backend && npx tsc --noEmit`
Expected: 报错集中在尚未改的插件/调用处（预期，后续任务修复）。**确认无 `types/index.ts` 自身语法错误后**提交：

```bash
git add backend/src/types/index.ts
git commit -m "feat: 类型扩展(NewBookPayload.author / decision_type soft / Book.ai_fill_status / fillBookInfo hint)"
```

---

## Task 5: scan-walker 提取作者 + 软重复分组与分发

**Files:**
- Modify: `backend/src/services/scan-walker.ts`

- [ ] **Step 1: import 增加工具**（在顶部 import 区）

```typescript
import { extractAuthorFromName } from '../utils/title-normalizer';
```

- [ ] **Step 2: `ScannedBookEx` 加 author**（找到 `interface ScannedBookEx extends ScannedBook {`；`ScannedBook` 已含 `author?`，无需改，但 processFile 需赋值——见 Step 4）。`toNewPayload` 加 author：

```typescript
function toNewPayload(b: ScannedBookEx): NewBookPayload {
  return {
    file_path: b.file_path,
    title: b.title,
    author: b.author,
    file_format: b.file_format,
    file_size: b.file_size,
    file_mtime: b.file_mtime,
    fingerprint_version: FINGERPRINT_VERSION,
    chapter_count: b.chapter_count,
    fingerprint: b.fingerprint,
    encoding_detected: b.encoding_detected,
    status: b.status,
  };
}
```

- [ ] **Step 3: processFile 赋值 author**（找到 `const title = path.basename(fullPath, path.extname(fullPath));`，其后构造 `result: ScannedBookEx` 处加 `author`）。把 `const result: ScannedBookEx = {` 对象内加一行：

```typescript
    author: extractAuthorFromName(path.basename(fullPath)) ?? undefined,
```

- [ ] **Step 4: 软重复分组**（找到 `const { hard_groups } = buildCandidateGroups(dedupInput);`，改为）

```typescript
    const { hard_groups, title_author_groups } = buildCandidateGroups(dedupInput);
```

- [ ] **Step 5: 构造 soft payloads**（在 `const hardDupPayloads ...` 定义之后、`result: ScanResult` 之前加）

```typescript
    const softDupPayloads: DuplicateGroupPayload[] = title_author_groups.map(group => ({
      canonical_file_path: pickCanonical(group).file_path,
      members: group.map(b => ({
        file_path: b.file_path,
        fingerprint: b.fingerprint ?? '',
        decision_type: 'soft' as const,
      })),
    }));
```

- [ ] **Step 6: 放入 ScanResult**（在 `const result: ScanResult = {` 对象里加一行）

```typescript
      soft_duplicate_groups: softDupPayloads,
```

- [ ] **Step 7: isEmpty 计入 soft**（找到 `isEmpty` 函数，在条件链加一行）

```typescript
      r.soft_duplicate_groups.length === 0 &&
```

- [ ] **Step 8: 类型检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 仅剩 batch-builder（ScanResult 缺字段）相关报错，将在 Task 6 修复。

- [ ] **Step 9: 提交**

```bash
git add backend/src/services/scan-walker.ts
git commit -m "feat(scan): 提取作者入库 + 组装 soft_duplicate_groups + isEmpty 计入"
```

---

## Task 6: batch-builder 落地软重复

**Files:**
- Modify: `backend/src/services/batch-builder.ts`
- Test: `backend/tests/services/batch-builder.test.ts`

- [ ] **Step 1: 写失败测试**（追加用例；复用文件已有的 db/helper 风格——参考现有用例构造 `ScanResult`）

```typescript
it('soft_duplicate_groups 作为 duplicate_group 入库且计入 summary', () => {
  const db = freshDb(); // 文件中已有的内存 DB 工厂；若名称不同则沿用现有
  const scan = {
    new_books: [], hard_duplicate_groups: [], ai_duplicate_groups: [],
    soft_duplicate_groups: [{
      canonical_file_path: '/a.txt',
      members: [
        { file_path: '/a.txt', fingerprint: 'fpA', decision_type: 'soft' as const },
        { file_path: '/b.txt', fingerprint: 'fpB', decision_type: 'soft' as const },
      ],
    }],
    series_groups: [], garbled: [], encoding_fixed: [],
  };
  const batch = buildBatchFromScan('task-1', scan, db);
  const items = db.prepare("SELECT type FROM scan_batch_items WHERE batch_id = ?").all(batch.id) as Array<{ type: string }>;
  expect(items.filter(i => i.type === 'duplicate_group').length).toBe(1);
  expect(JSON.parse(batch.summary_counts).duplicate_groups).toBe(1);
});
```

> 注：若 `batch-builder.test.ts` 现有用例用别的内存 DB 构造方式（如 `new Database(':memory:')` + 建表），请照搬同样的构造，不要新发明 `freshDb`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest tests/services/batch-builder.test.ts -t soft_duplicate_groups`
Expected: FAIL（类型/字段不存在或计数为 0）

- [ ] **Step 3: 实现**

3a. `ScanResult` 接口加字段：

```typescript
export interface ScanResult {
  new_books: NewBookPayload[];
  hard_duplicate_groups: DuplicateGroupPayload[];
  ai_duplicate_groups: DuplicateGroupPayload[];
  soft_duplicate_groups: DuplicateGroupPayload[];
  series_groups: SeriesGroupPayload[];
  garbled: GarbledPayload[];
  encoding_fixed: EncodingFixedPayload[];
}
```

3b. summary 计数加上 soft：

```typescript
  const summary = {
    new: scan.new_books.length,
    duplicate_groups: scan.hard_duplicate_groups.length + scan.ai_duplicate_groups.length + scan.soft_duplicate_groups.length,
    series: scan.series_groups.length,
    garbled: scan.garbled.length,
    encoding_fixed: scan.encoding_fixed.length,
  };
```

3c. emit 循环把 soft 一并写为 duplicate_group：

```typescript
    for (const dg of [...scan.hard_duplicate_groups, ...scan.ai_duplicate_groups, ...scan.soft_duplicate_groups]) {
      insert.run(uuidv4(), batchId, 'duplicate_group', JSON.stringify(dg));
    }
```

- [ ] **Step 4: 跑测试 + 全量回归**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: 全绿，tsc 通过（Part 1 后端打通）。

- [ ] **Step 5: 提交**

```bash
git add backend/src/services/batch-builder.ts backend/tests/services/batch-builder.test.ts
git commit -m "feat(scan): batch-builder 把 soft_duplicate_groups 作为 duplicate_group 落地"
```

---

## Task 7: batch-applier 写入 author

**Files:**
- Modify: `backend/src/services/batch-applier.ts`
- Test: `backend/tests/services/batch-applier.test.ts`

- [ ] **Step 1: 写失败测试**（追加；沿用文件现有内存 DB 构造方式与 applyBatch 调用风格）

```typescript
it('new 书 INSERT 写入 author；UPDATE 不覆盖已有 author', () => {
  // 沿用本文件已有的 setup（建表 + 插 batch + items 的 helper）。
  // 1) 全新书带 author 的 new payload → 应用后 books.author = 'A'
  // 2) 已存在 author='旧' 的同 file_path 再次 new payload author='新' → 仍为 '旧'
  // 具体构造照搬现有 'new' 用例，仅在 payload 加 author 字段并断言。
});
```

> 注：照搬本文件现有 `'new'` 类型用例的 DB/批次构造，避免新造工具函数。断言两点：新书 author 写入；既有非空 author 不被覆盖。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest tests/services/batch-applier.test.ts -t author`
Expected: FAIL（author 未写入）

- [ ] **Step 3: 实现**（改 `upsertBookByPath`）

3a. UPDATE 分支 SQL 与参数（在现有 UPDATE 的 SET 列表加 author，用 COALESCE 不覆盖已有）：

```typescript
      db.prepare(
        `UPDATE books SET title = ?, author = COALESCE(NULLIF(author, ''), ?), fingerprint = ?, first_chapter_hash = ?, chapter_count = ?, encoding_detected = ?, status = ?, file_size = ?, file_mtime = ?, fingerprint_version = ? WHERE id = ?`
      ).run(
        payload.title,
        payload.author ?? null,
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

3b. INSERT 分支加 author 列与值：

```typescript
    db.prepare(
      `INSERT INTO books (id, title, author, file_path, file_format, file_size, status, fingerprint, first_chapter_hash, chapter_count, encoding_detected, file_mtime, fingerprint_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      payload.title,
      payload.author ?? null,
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

- [ ] **Step 4: 跑测试 + 回归**

Run: `cd backend && npx jest && npx tsc --noEmit`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add backend/src/services/batch-applier.ts backend/tests/services/batch-applier.test.ts
git commit -m "feat(scan): upsertBookByPath 写入 author(INSERT 写,UPDATE 不覆盖已有)"
```

---

## Task 8: 加列 ai_fill_status

**Files:**
- Modify: `backend/src/db.ts`

- [ ] **Step 1: 实现**（在 `booksAlters` 数组末尾加一行）

```typescript
    "ALTER TABLE books ADD COLUMN ai_fill_status TEXT",
```

- [ ] **Step 2: 类型检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add backend/src/db.ts
git commit -m "feat(ai-fill): books 加列 ai_fill_status"
```

---

## Task 9: 共享 fill-prompt + 6 插件加 hint

**Files:**
- Create: `backend/src/ai/fill-prompt.ts`
- Modify: `backend/src/ai/{deepseek,openai,claude,qwen,minmax,ollama}.ts`
- Modify: `backend/src/ai/ai-manager.ts`

- [ ] **Step 1: 创建 `fill-prompt.ts`**

```typescript
export interface FillHint { title?: string; author?: string }

/** 构造 fillBookInfo 的 prompt（6 个插件共用，避免分叉）。 */
export function buildFillPrompt(
  rawText: string,
  config: Record<string, string>,
  hint?: FillHint,
): string {
  const summaryLen = parseInt(config.summary_length ?? '100') || 100;
  const known: string[] = [];
  if (hint?.title) known.push(`书名：《${hint.title}》`);
  if (hint?.author) known.push(`作者：${hint.author}`);
  const knownBlock = known.length
    ? `已知信息：${known.join('，')}。请据此从你的知识库中查找该小说；若无法确认是这本书，请将 author 与 summary 都留空，不要猜测。\n`
    : '';
  return `你是一个熟悉中文网络小说的助手。请根据书名从你的知识库中查找该小说的准确信息，优先使用你已知的信息，不要从下方文本中分析。
${knownBlock}
${rawText}

只返回如下JSON格式，不含其他任何文字：
{"title":"正确书名","author":"作者名","summary":"${summaryLen}字左右的故事简介","category":"分类（玄幻/修真/都市/历史/科幻/悬疑/言情/武侠等）","is_finished":true,"platform":"首发连载平台（如起点中文网）","start_date":"开始连载年月（如2007年12月）","end_date":"完本年月（已完结时填写，如2023年8月）","recommended_tags":["标签1","标签2","标签3"],"similar_works":[{"title":"类似书1","author":"作者","reason":"相似原因"},{"title":"类似书2","author":"作者","reason":"相似原因"}]}
is_finished为true表示已完结，false表示连载中。如果不确定某字段，省略该字段，不要猜测。`;
}
```

- [ ] **Step 2: 改 6 个插件**（每个文件做同样两处改动）

对 `deepseek.ts / openai.ts / claude.ts / qwen.ts / minmax.ts / ollama.ts`：

2a. 顶部加 import：

```typescript
import { buildFillPrompt } from './fill-prompt';
```

2b. `fillBookInfo` 签名加 hint，并用 `buildFillPrompt` 替换原有 `const summaryLen ...` 到 `const prompt = \`...\`;` 整段：

```typescript
  async fillBookInfo(rawText: string, config: Record<string, string>, hint?: { title?: string; author?: string }): Promise<Partial<Book>> {
    // ...保留原本读取 baseUrl/model 等行不动...
    const prompt = buildFillPrompt(rawText, config, hint);
    // ...后续 fetch / 解析 JSON 不变...
```

> 删除每个插件里旧的 `const summaryLen = parseInt(...)` 和内联 `const prompt = \`你是一个熟悉中文网络小说的助手...\`;`，仅以上一行 `buildFillPrompt` 调用替代。其它逻辑（fetch、JSON 解析、classifyBook、chat）保持不变。

- [ ] **Step 3: 改 ai-manager 透传 hint**（找到 `async fillBookInfo(rawText: string, db: Database.Database)`）

```typescript
  async fillBookInfo(rawText: string, db: Database.Database, hint?: { title?: string; author?: string }): Promise<Partial<Book>> {
    const active = this.getActivePlugin(db);
    if (!active) throw new Error('no active AI plugin');
    return active.plugin.fillBookInfo(rawText, active.config, hint);
  }
```

> 注：保留原函数体里获取 active plugin 的写法（上面 getActivePlugin 仅示意），只在调用 `plugin.fillBookInfo(...)` 处把 `hint` 作为第三参传入，并在签名加 `hint?`。

- [ ] **Step 4: 类型检查**

Run: `cd backend && npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add backend/src/ai/
git commit -m "feat(ai-fill): 抽取 buildFillPrompt + fillBookInfo 支持 title/author hint"
```

---

## Task 10: ai-batch-fill 两趟编排 + 作者校验 + 状态

**Files:**
- Modify: `backend/src/services/ai-batch-fill.ts`
- Test: `backend/tests/services/ai-batch-fill.test.ts`

- [ ] **Step 1: 写失败测试**（mock aiManager.fillBookInfo；沿用文件现有 DB/mock 风格）

```typescript
// 顶部按文件现有方式 mock '../../src/ai/ai-manager' 的 aiManager.fillBookInfo
import { authorMatchDecision } from '../../src/services/ai-batch-fill';

describe('authorMatchDecision', () => {
  it('knownAuthor 为空 → filled', () => {
    expect(authorMatchDecision('', '随便')).toBe('filled');
  });
  it('Pass B 作者与已知一致 → filled', () => {
    expect(authorMatchDecision('打眼', '打眼')).toBe('filled');
  });
  it('Pass B 作者与已知不一致 → failed', () => {
    expect(authorMatchDecision('打眼', '唐家三少')).toBe('failed');
  });
  it('Pass B 没返回作者(空) → filled(无可反驳)', () => {
    expect(authorMatchDecision('打眼', '')).toBe('filled');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest tests/services/ai-batch-fill.test.ts -t authorMatchDecision`
Expected: FAIL（未导出）

- [ ] **Step 3: 实现**

3a. 顶部 import：

```typescript
import { lookupKey } from './title-lookup';
import { extractAuthorFromName } from '../utils/title-normalizer';
import { authorsMatch } from '../utils/author-match';
import path from 'path';
```

3b. 导出纯函数（供测试 + 主流程复用）：

```typescript
/** 给定已知作者与 Pass B 返回的作者，判定 filled/failed。 */
export function authorMatchDecision(knownAuthor: string, aiAuthor: string): 'filled' | 'failed' {
  if (!knownAuthor) return 'filled';
  if (!aiAuthor || !aiAuthor.trim()) return 'filled';
  return authorsMatch(aiAuthor, knownAuthor) ? 'filled' : 'failed';
}
```

3c. `FillCandidate` 与 `selectFillCandidates` 带上 title/author（两处 SELECT 都加列）：

```typescript
export interface FillCandidate { id: string; file_path: string; file_format: string; title: string; author?: string; }
```
force 分支与普通分支的 SELECT 改为 `SELECT id, file_path, file_format, title, author FROM books ...`（其余 WHERE 不变）。

3d. `BatchFillInput.books` 元素类型同步带 title/author：

```typescript
  books: Array<{ id: string; file_path: string; file_format: string; title: string; author?: string }>;
```

3e. 改 batchFill 每本书的核心逻辑——把原来"`const info = await callWithRetry(() => aiManager.fillBookInfo(rawText, db), RETRIES);`"这一行，替换为下面整段（直到拿到 `info` 与 `fillStatus`）：

```typescript
      const rawText = readPreview(b.file_path, b.file_format);
      const knownTitle = lookupKey(b.title) || b.title;
      const knownAuthor = ((b.author ?? '').trim()) || (extractAuthorFromName(path.basename(b.file_path)) ?? '');

      let info: Awaited<ReturnType<typeof aiManager.fillBookInfo>>;
      let fillStatus: 'filled' | 'failed' = 'filled';

      if (knownAuthor) {
        const passA = await callWithRetry(
          () => aiManager.fillBookInfo(rawText, db, { title: knownTitle, author: knownAuthor }),
          RETRIES,
        );
        const foundA = !!(passA.author && passA.author.trim()) || !!(passA.summary && passA.summary.trim());
        if (foundA) {
          info = passA;
        } else {
          const passB = await callWithRetry(() => aiManager.fillBookInfo(rawText, db, { title: knownTitle }), RETRIES);
          info = passB;
          fillStatus = authorMatchDecision(knownAuthor, passB.author ?? '');
        }
      } else {
        info = await callWithRetry(() => aiManager.fillBookInfo(rawText, db, { title: knownTitle }), RETRIES);
      }

      if (fillStatus === 'failed') {
        db.prepare("UPDATE books SET ai_fill_status = 'failed' WHERE id = ?").run(b.id);
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: 'author mismatch (AI 查到的作者与文件名作者不一致)' });
        return; // 不写任何字段
      }
```

3f. 在该 book 成功路径写入 `result.succeeded.push(b.id);` 之前，加一行标记 filled：

```typescript
      db.prepare("UPDATE books SET ai_fill_status = 'filled' WHERE id = ?").run(b.id);
      result.succeeded.push(b.id);
```

3g. catch 分支加 failed 标记（在 `result.failed.push(...)` 之后）：

```typescript
      try { getDb().prepare("UPDATE books SET ai_fill_status = 'failed' WHERE id = ?").run(b.id); } catch { /* ignore */ }
```

> 说明：`maybeSet('author', info.author)` 因扫描已写 author（current.author 非空）会自动跳过，作者始终保留 knownAuthor，无需额外改动。

- [ ] **Step 4: 调用方同步**（scan-walker Phase 5 调用 `selectFillCandidates`/`batchFill` 处无需改——FillCandidate 现含 title/author，类型自洽；library 路由 ai-fill-batch 若自行 SELECT 候选，确保也含 title/author）。

Run: `cd backend && npx tsc --noEmit`
Expected: 通过（若 ai-fill-batch 路由构造 books 缺 title/author 则在此补齐 SELECT）。

- [ ] **Step 5: 跑测试 + 回归**

Run: `cd backend && npx jest`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add backend/src/services/ai-batch-fill.ts backend/tests/services/ai-batch-fill.test.ts
git commit -m "feat(ai-fill): 书名+作者两趟校验 + ai_fill_status(filled/failed)"
```

---

## Task 11: library 路由 ai_fill 筛选

**Files:**
- Modify: `backend/src/routes/library.ts`

- [ ] **Step 1: 实现**

1a. 在 `const seriesGrouped = ...` 附近读取参数：

```typescript
  const aiFill = (req.query.ai_fill as string) || 'all';
```

1b. 在 status 过滤块之后、`if (search)` 之前加：

```typescript
  if (aiFill === 'filled') {
    whereClause += " AND ai_fill_status = 'filled'";
  } else if (aiFill === 'failed') {
    whereClause += " AND ai_fill_status = 'failed'";
  } else if (aiFill === 'none') {
    whereClause += " AND ai_fill_status IS NULL";
  }
```

> `SELECT *` 已会返回 `ai_fill_status`，无需改查询列。

- [ ] **Step 2: 类型检查 + 手测**

Run: `cd backend && npx tsc --noEmit`
Expected: 通过。
（手测：`GET /api/library?ai_fill=filled` 仅返回 filled 书。）

- [ ] **Step 3: 提交**

```bash
git add backend/src/routes/library.ts
git commit -m "feat(ai-fill): /library 增加 ai_fill 筛选(filled/failed/none/all)"
```

---

## Task 12: 前端类型与 API

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/library.ts`

- [ ] **Step 1: Book 类型加字段**（`export interface Book {` 块内，`status?` 行附近加）

```typescript
  ai_fill_status?: 'filled' | 'failed' | null
```

- [ ] **Step 2: LibraryQuery 加 ai_fill**（`export interface LibraryQuery {` 块内加）

```typescript
  ai_fill?: 'filled' | 'failed' | 'none' | 'all'
```

- [ ] **Step 3: 构建检查 + 提交**

Run: `cd frontend && npx vue-tsc --noEmit`（若项目用 `npm run build` 做类型检查则用之）
Expected: 通过。

```bash
git add frontend/src/types/index.ts frontend/src/api/library.ts
git commit -m "feat(ai-fill): 前端 Book.ai_fill_status + LibraryQuery.ai_fill"
```

---

## Task 13: 前端书库筛选 + 卡片角标

**Files:**
- Modify: `frontend/src/views/Library.vue`
- Modify: `frontend/src/components/BookCard.vue`

- [ ] **Step 1: Library.vue 加筛选下拉**（在 `includeDirty` 的 `<el-switch>` 之前/之后加，仅 admin）

```vue
          <el-select
            v-if="authStore.isAdmin"
            v-model="aiFillFilter"
            style="width: 140px"
            @change="fetchBooks"
          >
            <el-option label="AI填充：全部" value="all" />
            <el-option label="已AI填充" value="filled" />
            <el-option label="填充失败" value="failed" />
            <el-option label="未尝试填充" value="none" />
          </el-select>
```

- [ ] **Step 2: Library.vue 脚本加 ref + 传参**

2a. 在 `const includeDirty = ref(false)` 附近加：

```typescript
const aiFillFilter = ref<'all' | 'filled' | 'failed' | 'none'>('all')
```

2b. `fetchBooks` 里 `libraryApi.listAdmin({ ... })` 的参数对象加（在 `include_dirty: includeDirty.value,` 旁）：

```typescript
      ai_fill: aiFillFilter.value,
```

- [ ] **Step 3: BookCard.vue 加 AI 填充角标**

3a. 模板里在状态徽章 `<el-tag v-if="badge" .../>` 之后加：

```vue
      <el-tag v-if="aiFillBadge" :type="aiFillBadge.type" size="small" class="ai-fill-badge">
        {{ aiFillBadge.label }}
      </el-tag>
```

3b. 脚本里 `badge` computed 之后加：

```typescript
const aiFillBadge = computed<{ type: 'success' | 'warning'; label: string } | null>(() => {
  if (props.book.ai_fill_status === 'filled') return { type: 'success', label: 'AI已填充' }
  if (props.book.ai_fill_status === 'failed') return { type: 'warning', label: 'AI填充失败' }
  return null
})
```

3c. `<style scoped>` 末尾加（放右下角，避免与左上角 `.status-badge` 重叠）：

```css
.ai-fill-badge {
  position: absolute;
  right: 6px;
  top: 6px;
  z-index: 2;
}
```

> 若 `.status-badge` 也在右上角，则把 `.ai-fill-badge` 改为 `bottom: 6px; right: 6px;`（避免重叠）。实现时看一眼现有 `.status-badge` 定位再决定角位。

- [ ] **Step 4: 构建**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/views/Library.vue frontend/src/components/BookCard.vue
git commit -m "feat(ai-fill): 书库 AI 填充状态筛选 + 卡片角标"
```

---

## 最终验收（手测，需部署后）

- [ ] `docker compose up -d --build` 部署后端 + `cd frontend && npm run build && docker cp dist/. novel-reader:/app/public/`
- [ ] 扫描后：库中书的 author 字段已从文件名填入。
- [ ] 自动模式：两个《黄金瞳(典当)》（打眼）被自动归并（一本正常、一本 duplicate 隐藏）。
- [ ] 审核模式：软重复进待审核批次，`DuplicateGroupCard` 可选正本/剔除。
- [ ] AI 填充后：书库"AI填充状态"筛选可用，卡片角标显示已填充/失败；故意改坏一本文件名作者验证 failed 路径。
- [ ] `cd backend && npx jest` 全绿；`npx tsc --noEmit` 通过。

## Self-Review 备注

- 已覆盖 spec 全部小节（1.1–1.5、2.1–2.6）。
- 命名一致：`extractAuthorFromName` / `authorsMatch` / `normalizeAuthor` / `title_author_groups` / `soft_duplicate_groups` / `decision_type:'soft'` / `ai_fill_status` / `buildFillPrompt` / `authorMatchDecision` 全程统一。
- 测试文件中"沿用现有构造"的说明仅针对 DB/mock 脚手架，断言代码均已给出。
