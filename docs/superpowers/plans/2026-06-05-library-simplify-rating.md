# 书库 UI 简化 + 豆瓣评分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把零散的书库筛选/入口收敛进搜索框关键词与扫描对话框,移除多余控件;并新增豆瓣评分(随 AI 填充抓取、卡片/详情显示、可排序)。

**Architecture:** 后端复用现有 `GET /library` 筛选,新增 `status=duplicate_groups` 分支与 `POST /ai-fill-reset-all`;`selectFillCandidates` 改为版本驱动;`cover.ts` 抽出 `doubanSuggest` 供封面与评分共用一次请求,新增 `fetchRating`/`parseDoubanRating`。前端 `Library.vue` 把搜索词翻译成筛选参数,移除下拉/开关/批量填充按钮,`ScanOptionsDialog` 加两个重置按钮,`BookCard`/`BookDetail` 显示评分。

**Tech Stack:** Express + better-sqlite3 + jest(后端 TDD);Vue 3 + Element Plus + vitest/vue-tsc(前端 typecheck+build 验证)。

**spec:** `docs/superpowers/specs/2026-06-05-library-simplify-rating-design.md`

**通用命令:** 后端 `cd backend`;单测 `npx jest <文件名关键字>`;全量 `npm test`;类型 `npx tsc --noEmit`。前端 `cd frontend`;`npm run typecheck`;`npm run build`。

---

## File Structure

**后端**
- `backend/src/db.ts` — 加 `rating` 列迁移
- `backend/src/services/ai-batch-fill.ts` — `selectFillCandidates` 版本驱动;`resetAllFills` 新函数;批量填充集成评分
- `backend/src/services/duplicate-view.ts` — **新建**,`selectDuplicateGroupBooks`
- `backend/src/utils/cover.ts` — 抽 `doubanSuggest`/`downloadCover`,新增 `fetchRating`/`parseDoubanRating`,`fetchAndSaveCover` 改为薄包装
- `backend/src/routes/library.ts` — `status=duplicate_groups` 分支;`POST /ai-fill-reset-all`;`ALLOWED_SORT_FIELDS` 加 `rating`;单本 `/ai-fill` 集成评分
- 测试:`backend/tests/services/ai-batch-fill.test.ts`(改)、`backend/tests/services/duplicate-view.test.ts`(新)、`backend/tests/utils/cover.test.ts`(新)

**前端**
- `frontend/src/types/index.ts` — `Book.rating`
- `frontend/src/api/library.ts` — `aiFillResetAll`,`status` 增 `duplicate_groups`,`listAdmin` 加 `status`
- `frontend/src/views/Library.vue` — 魔法关键词、移除控件、启用评分排序
- `frontend/src/components/ScanOptionsDialog.vue` — 两个重置按钮
- `frontend/src/components/BookCard.vue` — 评分角标
- `frontend/src/views/BookDetail.vue` — 评分显示

---

## Task 1: DB 加 rating 列

**Files:**
- Modify: `backend/src/db.ts`(迁移数组,`ai_fill_status` 之后)

- [ ] **Step 1: 加迁移语句**

在 `backend/src/db.ts` 找到这一行:
```ts
    "ALTER TABLE books ADD COLUMN ai_fill_status TEXT",
```
在其后新增一行:
```ts
    "ALTER TABLE books ADD COLUMN rating REAL",
```

- [ ] **Step 2: 编译确认**

Run: `cd backend && npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add backend/src/db.ts
git commit -m "feat(rating): books 加 rating 列"
```

---

## Task 2: selectFillCandidates 改为版本驱动

**Files:**
- Modify: `backend/src/services/ai-batch-fill.ts`(`selectFillCandidates` 非 force 分支)
- Test: `backend/tests/services/ai-batch-fill.test.ts`(`selectFillCandidates` describe)

- [ ] **Step 1: 写失败测试**

在 `backend/tests/services/ai-batch-fill.test.ts` 的 `describe('selectFillCandidates', …)` 内追加:
```ts
  it('version-driven: includes a fully-filled book whose ai_fill_version is NULL', () => {
    const d = db();
    // 字段齐全但未打版本戳 → 旧逻辑会排除,版本驱动应包含
    ins(d, { id: 'f', title: 'F', author: '作者', summary: '简介', file_path: '/f' });
    const ids = selectFillCandidates(d, false).map(r => r.id);
    expect(ids).toContain('f');
  });

  it('version-driven: excludes a book stamped at the current version', () => {
    const d = db();
    ins(d, { id: 'g', title: 'G', file_path: '/g', ai_fill_version: AI_FILL_VERSION });
    const ids = selectFillCandidates(d, false).map(r => r.id);
    expect(ids).not.toContain('g');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest ai-batch-fill -t "version-driven"`
Expected: 第一个用例 FAIL(`'f'` 不在结果里,因为旧逻辑要求缺字段)。

- [ ] **Step 3: 改实现**

在 `backend/src/services/ai-batch-fill.ts` 的 `selectFillCandidates`,把非 force 的 SQL 改为(删掉"缺 author/summary"那一行):
```ts
  return db.prepare(
    `SELECT id, file_path, file_format, title, author FROM books
     WHERE status = 'normal' AND (duplicate_of IS NULL OR duplicate_of = '')
       AND (ai_fill_version IS NULL OR ai_fill_version < ?)`
  ).all(AI_FILL_VERSION) as FillCandidate[];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest ai-batch-fill`
Expected: 全部 PASS(含原有用例 `includes books missing author/summary…`——该用例插入的 a 仍 version=NULL 故仍入选,b 有字段且无 version 也会入选;**注意**:原断言 `expect(ids).toEqual(['a'])` 会因 b 现在入选而失败)。

修正原用例:把 `includes books missing author/summary and not yet filled at current version` 用例的断言由 `toEqual(['a'])` 改为按版本语义——给 b 补上当前版本戳使其被排除:
```ts
    ins(d, { id: 'b', title: 'B', author: '作者', summary: '简介', file_path: '/b', ai_fill_version: AI_FILL_VERSION });
```
保持 `expect(ids).toEqual(['a'])` 不变(a 无戳入选,b 已戳排除,c 已戳排除)。并把该用例标题改为 `includes books not yet filled at current version`。重跑 `npx jest ai-batch-fill` 直到全绿。

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/ai-batch-fill.ts backend/tests/services/ai-batch-fill.test.ts
git commit -m "feat(ai-fill): selectFillCandidates 改为版本驱动(重置标记即可重填)"
```

---

## Task 3: resetAllFills 函数 + POST /ai-fill-reset-all

**Files:**
- Modify: `backend/src/services/ai-batch-fill.ts`(导出 `resetAllFills`)
- Modify: `backend/src/routes/library.ts`(新路由)
- Test: `backend/tests/services/ai-batch-fill.test.ts`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/services/ai-batch-fill.test.ts` 顶部 import 追加 `resetAllFills`:
```ts
import { selectFillCandidates, stampFillVersion, authorMatchDecision, batchFill, isRateLimitError, resetAllFills } from '../../src/services/ai-batch-fill';
```
新增 describe:
```ts
describe('resetAllFills', () => {
  it('clears ai_fill_version and ai_fill_status for all stamped books, returns count', () => {
    const d = db();
    ins(d, { id: 'a', title: 'A', file_path: '/a', ai_fill_version: AI_FILL_VERSION });
    ins(d, { id: 'b', title: 'B', file_path: '/b' }); // 未打戳
    d.prepare("UPDATE books SET ai_fill_status = 'filled' WHERE id = 'a'");
    const n = resetAllFills(d);
    const a = d.prepare("SELECT ai_fill_version v, ai_fill_status s FROM books WHERE id='a'").get() as { v: number | null; s: string | null };
    expect(a.v).toBeNull();
    expect(a.s).toBeNull();
    expect(n).toBeGreaterThanOrEqual(1);
  });
});
```
注意:`db()` 辅助建的最小表含 `ai_fill_version` 但不含 `ai_fill_status`。给最小表加列:在 `function db()` 的 `CREATE TABLE books (...)` 末尾字段补 `, ai_fill_status TEXT`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest ai-batch-fill -t "resetAllFills"`
Expected: FAIL(`resetAllFills` is not a function)。

- [ ] **Step 3: 实现 resetAllFills**

在 `backend/src/services/ai-batch-fill.ts` 末尾(其它导出函数旁)新增:
```ts
/** Clear AI-fill stamps on all books so the next AI-fill scan re-processes them. */
export function resetAllFills(db: Database.Database): number {
  const info = db.prepare(
    `UPDATE books SET ai_fill_version = NULL, ai_fill_status = NULL
     WHERE ai_fill_version IS NOT NULL OR ai_fill_status IS NOT NULL`
  ).run();
  return info.changes;
}
```
(文件已 `import Database from 'better-sqlite3'`;若未,确认顶部存在该 import。)

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest ai-batch-fill`
Expected: PASS 全绿。

- [ ] **Step 5: 加路由**

在 `backend/src/routes/library.ts` 找到 `POST /ai-fill-reset-failed`(约 209 行)。确认它从 `ai-batch-fill` import 了内容;在该路由之后新增:
```ts
// POST /api/library/ai-fill-reset-all — admin: clear ALL fill stamps (re-fill everything next scan)
router.post('/ai-fill-reset-all', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  const reset = resetAllFills(getDb());
  successResponse(res, { reset });
});
```
并在文件顶部该模块的 import 里加上 `resetAllFills`(找到 `from '../services/ai-batch-fill'` 的 import 行,把 `resetAllFills` 加入花括号)。

- [ ] **Step 6: 类型 + 提交**

Run: `cd backend && npx tsc --noEmit`(干净)
```bash
git add backend/src/services/ai-batch-fill.ts backend/src/routes/library.ts backend/tests/services/ai-batch-fill.test.ts
git commit -m "feat(ai-fill): resetAllFills + POST /ai-fill-reset-all"
```

---

## Task 4: duplicate_groups 视图

**Files:**
- Create: `backend/src/services/duplicate-view.ts`
- Create: `backend/tests/services/duplicate-view.test.ts`
- Modify: `backend/src/routes/library.ts`(list 路由 status 分支)

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/services/duplicate-view.test.ts`:
```ts
import Database from 'better-sqlite3';
import { selectDuplicateGroupBooks } from '../../src/services/duplicate-view';

function makeDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT, author TEXT, status TEXT, duplicate_of TEXT
  );`);
  const ins = (o: Record<string, unknown>) =>
    d.prepare('INSERT INTO books (id,title,author,status,duplicate_of) VALUES (@id,@title,@author,@status,@duplicate_of)')
      .run({ author: null, status: 'normal', duplicate_of: null, ...o });
  ins({ id: 'canon', title: '甲', status: 'normal' });            // 正规本(被指向)
  ins({ id: 'dup1', title: '甲', status: 'duplicate', duplicate_of: 'canon' });
  ins({ id: 'dup2', title: '甲', status: 'duplicate', duplicate_of: 'canon' });
  ins({ id: 'solo', title: '乙', status: 'normal' });             // 无关正常书
  return d;
}

describe('selectDuplicateGroupBooks', () => {
  it('returns the full group: canonical + its duplicates, excludes unrelated normal books', () => {
    const d = makeDb();
    const { rows, total } = selectDuplicateGroupBooks(d, 50, 0);
    const ids = rows.map(r => r.id).sort();
    expect(ids).toEqual(['canon', 'dup1', 'dup2']);
    expect(total).toBe(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest duplicate-view`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 service**

新建 `backend/src/services/duplicate-view.ts`:
```ts
import type Database from 'better-sqlite3';

const GROUP_WHERE = `WHERE (status = 'duplicate'
  OR id IN (SELECT DISTINCT duplicate_of FROM books
            WHERE duplicate_of IS NOT NULL AND duplicate_of != ''))`;

/** Books that belong to any duplicate group: the canonical kept book + its hidden duplicates. */
export function selectDuplicateGroupBooks(
  db: Database.Database,
  limit: number,
  offset: number,
): { rows: Record<string, unknown>[]; total: number } {
  const total = (db.prepare(`SELECT COUNT(*) c FROM books ${GROUP_WHERE}`).get() as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM books ${GROUP_WHERE}
     ORDER BY COALESCE(NULLIF(duplicate_of, ''), id), id
     LIMIT ? OFFSET ?`
  ).all(limit, offset) as Record<string, unknown>[];
  return { rows, total };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && npx jest duplicate-view`
Expected: PASS。

- [ ] **Step 5: 接入 list 路由**

在 `backend/src/routes/library.ts` 顶部 import 区加:
```ts
import { selectDuplicateGroupBooks } from '../services/duplicate-view';
```
在 list 路由里,解析出 `statusFilter`、`page`、`pageSize`(沿用现有变量名;若分页变量名不同则改为现有名)之后、构建 `whereClause` 之前,加入早返回分支:
```ts
  if (statusFilter === 'duplicate_groups') {
    const { rows, total } = selectDuplicateGroupBooks(db, pageSize, (page - 1) * pageSize);
    successResponse(res, {
      items: rows,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
    return;
  }
```
**注意**:`items`/`pagination` 的字段名必须与本路由现有正常分支的 `successResponse` 结构完全一致(实现前先读该路由现有返回结构,照抄字段名,如可能是 `{ list, total, page, … }`)。`db`、`page`、`pageSize` 用本路由已有的同名变量。

- [ ] **Step 6: 类型 + 提交**

Run: `cd backend && npx tsc --noEmit`(干净)
```bash
git add backend/src/services/duplicate-view.ts backend/tests/services/duplicate-view.test.ts backend/src/routes/library.ts
git commit -m "feat(library): GET /library 支持 status=duplicate_groups(完整重复组)"
```

---

## Task 5: cover.ts 重构 + 评分抓取/解析

**Files:**
- Modify: `backend/src/utils/cover.ts`
- Create: `backend/tests/utils/cover.test.ts`

- [ ] **Step 1: 写失败测试(纯函数 parseDoubanRating)**

新建 `backend/tests/utils/cover.test.ts`:
```ts
import { parseDoubanRating } from '../../src/utils/cover';

describe('parseDoubanRating', () => {
  it('extracts the rating number from a douban subject page', () => {
    const html = '<div><strong class="ll rating_num" property="v:average"> 8.5 </strong></div>';
    expect(parseDoubanRating(html)).toBe(8.5);
  });
  it('returns undefined when no rating present', () => {
    expect(parseDoubanRating('<div class="rating_num"></div>')).toBeUndefined();
    expect(parseDoubanRating('no rating here')).toBeUndefined();
  });
  it('returns undefined for a zero rating (douban shows 0 when unrated)', () => {
    const html = '<strong class="ll rating_num" property="v:average"> 0.0 </strong>';
    expect(parseDoubanRating(html)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest utils/cover`
Expected: FAIL(`parseDoubanRating` 未导出)。

- [ ] **Step 3: 重构 cover.ts**

在 `backend/src/utils/cover.ts`:保留顶部 `request()`、`COVERS_DIR`、`DoubanSuggest` 接口、`fs`/`path` import。把现有 `fetchAndSaveCover` 整体替换为下面这组导出(删除 `saveDebug` 调用与该辅助函数;若 `saveDebug` 不再被引用一并删除):
```ts
/** One suggest request; returns the best book item (prefers one with a real cover), or undefined. */
export async function doubanSuggest(title: string): Promise<DoubanSuggest | undefined> {
  try {
    const apiUrl = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`;
    const buf = await request(apiUrl, {
      'Accept': 'application/json, text/javascript, */*',
      'Referer': 'https://book.douban.com/',
    });
    const suggestions = JSON.parse(buf.toString('utf-8')) as DoubanSuggest[];
    if (!Array.isArray(suggestions) || suggestions.length === 0) return undefined;
    return suggestions.find(s => s.pic && !s.pic.includes('book-default')) ?? suggestions[0];
  } catch {
    return undefined;
  }
}

/** Download the cover image for an already-fetched suggest item. Returns /covers/… or undefined. */
export async function downloadCover(item: DoubanSuggest, bookId: string): Promise<string | undefined> {
  try {
    if (!item.pic || item.pic.includes('book-default')) return undefined;
    const imgUrl = item.pic
      .replace('/spic/', '/lpic/')
      .replace('/view/subject/s/', '/view/subject/l/')
      .replace('/view/subject/m/', '/view/subject/l/');
    const imgBuf = await request(imgUrl, {
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Referer': 'https://book.douban.com/',
    });
    if (imgBuf.length < 1024) return undefined;
    const ext = imgUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] ?? 'jpg';
    const filename = `${bookId}.${ext}`;
    fs.writeFileSync(path.join(COVERS_DIR, filename), imgBuf);
    return `/covers/${filename}`;
  } catch {
    return undefined;
  }
}

/** Pure: extract the douban rating number from a subject page's HTML. */
export function parseDoubanRating(html: string): number | undefined {
  const m = html.match(/rating_num"[^>]*>\s*([\d.]+)\s*</);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Fetch + parse the douban rating from a suggest item's subject page. */
export async function fetchRating(item: DoubanSuggest): Promise<number | undefined> {
  try {
    if (!item.url) return undefined;
    const buf = await request(item.url, {
      'Accept': 'text/html,application/xhtml+xml',
      'Referer': 'https://book.douban.com/',
    });
    return parseDoubanRating(buf.toString('utf-8'));
  } catch {
    return undefined;
  }
}

/** Backwards-compatible wrapper used by the single-book cover-test endpoint. */
export async function fetchAndSaveCover(title: string, bookId: string): Promise<string | undefined> {
  const item = await doubanSuggest(title);
  if (!item) return undefined;
  return downloadCover(item, bookId);
}
```

- [ ] **Step 4: 跑测试确认通过 + 类型**

Run: `cd backend && npx jest utils/cover && npx tsc --noEmit`
Expected: cover 测试 PASS;tsc 干净(若 `saveDebug` 删除后有未用 import 报错,清理之)。

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/cover.ts backend/tests/utils/cover.test.ts
git commit -m "feat(rating): cover.ts 抽 doubanSuggest/downloadCover + 新增 fetchRating/parseDoubanRating"
```

---

## Task 6: 评分集成进填充(批量 + 单本)

**Files:**
- Modify: `backend/src/services/ai-batch-fill.ts`(cover 块 + SELECT 加 rating)
- Modify: `backend/src/routes/library.ts`(单本 `/ai-fill` cover 块)
- Test: `backend/tests/services/ai-batch-fill.test.ts`(更新 cover mock + 集成测试 + 集成库 schema 加 rating)

- [ ] **Step 1: 更新 cover mock 与集成库 schema,写失败测试**

在 `backend/tests/services/ai-batch-fill.test.ts`:

(a) 把 cover 模块 mock 改为新接口:
```ts
jest.mock('../../src/utils/cover', () => ({
  doubanSuggest: jest.fn().mockResolvedValue(undefined),
  downloadCover: jest.fn().mockResolvedValue(undefined),
  fetchRating: jest.fn().mockResolvedValue(undefined),
}));
```
(b) 顶部 import 改为:
```ts
import { doubanSuggest, downloadCover, fetchRating } from '../../src/utils/cover';
```
(c) `makeIntegrationDb()` 的 `CREATE TABLE books` 字段表里,在 `cover_url TEXT,` 后加一行 `rating REAL,`。`insBook` 的 INSERT 列表/默认值加 `rating`(默认 `null`):列清单加 `rating`,VALUES 加 `@rating`,默认对象加 `rating: null`。
(d) 把之前的封面用例 `writes the fetched cover_url to the books row when a cover is found` 改为新接口:
```ts
  it('writes cover_url and rating fetched from douban during fill', async () => {
    insBook(_testDb!, { id: 'cv1', title: '有封面的书', author: '某作者', file_path: '/nonexistent/cv1.txt' });
    fillSpy.mockResolvedValueOnce({ author: '某作者', summary: '简介…' });
    (doubanSuggest as jest.Mock).mockResolvedValueOnce({ url: 'https://book.douban.com/subject/1/', pic: 'x/spic/y.jpg' });
    (downloadCover as jest.Mock).mockResolvedValueOnce('/covers/cv1.jpg');
    (fetchRating as jest.Mock).mockResolvedValueOnce(8.5);

    await batchFill({ books: [{ id: 'cv1', file_path: '/nonexistent/cv1.txt', file_format: 'txt', title: '有封面的书', author: '某作者' }] });

    const row = _testDb!.prepare('SELECT cover_url, rating FROM books WHERE id = ?').get('cv1') as { cover_url: string | null; rating: number | null };
    expect(row.cover_url).toBe('/covers/cv1.jpg');
    expect(row.rating).toBe(8.5);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && npx jest ai-batch-fill -t "cover_url and rating"`
Expected: FAIL(当前代码调用的是旧 `fetchAndSaveCover`,且不写 rating)。

- [ ] **Step 3: 改批量填充实现**

在 `backend/src/services/ai-batch-fill.ts`:

(a) 顶部 import:把 `import { fetchAndSaveCover } from '../utils/cover';` 改为
```ts
import { doubanSuggest, downloadCover, fetchRating } from '../utils/cover';
```
(b) 第 121 行的 SELECT 加 `rating` 列:
```ts
      const current = db.prepare('SELECT title, author, summary, category, cover_url, rating, manually_edited_fields FROM books WHERE id = ?').get(b.id) as
        | { title?: string; author?: string; summary?: string; category?: string; cover_url?: string; rating?: number | null; manually_edited_fields?: string }
        | undefined;
```
(c) 把现有 cover 块(`const titleForCover …` 起,到对应 `}` 止)整体替换为:
```ts
      // Cover + rating from douban: one suggest request shared by both, best-effort.
      const titleForCover = ((info.title && info.title.trim()) || knownTitle || filledFields.title || current.title || '').trim();
      const needCover = !current.cover_url;
      const needRating = current.rating == null;
      if ((needCover || needRating) && titleForCover.length > 0) {
        try {
          const item = await doubanSuggest(titleForCover);
          if (item) {
            if (needCover) {
              const coverUrl = await downloadCover(item, b.id);
              if (coverUrl) {
                db.prepare('UPDATE books SET cover_url = ? WHERE id = ?').run(coverUrl, b.id);
                result.covers_fetched++;
                writeAudit({ user_id: userId, action: 'ai_fetch_cover', resource_id: b.id, file_path: b.file_path, details: { cover_url: coverUrl, title_used: titleForCover } });
              }
            }
            if (needRating) {
              const rating = await fetchRating(item);
              if (rating != null) db.prepare('UPDATE books SET rating = ? WHERE id = ?').run(rating, b.id);
            }
          }
        } catch {
          // best-effort; never fail the book on cover/rating
        }
      }
```

- [ ] **Step 4: 跑测试确认通过(含全量)**

Run: `cd backend && npx jest ai-batch-fill`
Expected: 全绿(新 cover+rating 用例 PASS,原限流/两趟用例不受影响——它们的 `doubanSuggest` mock 默认返回 undefined,跳过封面/评分)。

- [ ] **Step 5: 单本 /ai-fill 集成评分**

在 `backend/src/routes/library.ts`:
(a) 顶部 cover import:把 `fetchAndSaveCover` 那条 import 改为(或追加)`doubanSuggest, downloadCover, fetchRating`(保留 `fetchAndSaveCover` 若 `/cover-test` 仍用它)。
(b) 找到单本填充的 cover 块(约 462-470 行 `if (!book.cover_url) { … fetchAndSaveCover … }`),整体替换为:
```ts
    // 封面 + 评分:共用一次豆瓣 suggest
    if (!book.cover_url || book.rating == null) {
      const coverTitle = (info.title as string | undefined) || cleanedTitle;
      const item = await doubanSuggest(coverTitle).catch(() => undefined);
      if (item) {
        if (!book.cover_url) {
          const coverUrl = await downloadCover(item, req.params.id).catch(() => undefined);
          if (coverUrl) { updates.push('cover_url = ?'); values.push(coverUrl); }
        }
        if (book.rating == null) {
          const rating = await fetchRating(item).catch(() => undefined);
          if (rating != null) { updates.push('rating = ?'); values.push(rating); }
        }
      }
    }
```
(`book` 由本路由前面的 `SELECT * FROM books` 取得,含 `rating`;若该处不是 `SELECT *` 而是显式列,需在其列清单加 `rating`。实现前确认。)

- [ ] **Step 6: 类型 + 提交**

Run: `cd backend && npx tsc --noEmit` 干净;`npm test` 全绿。
```bash
git add backend/src/services/ai-batch-fill.ts backend/src/routes/library.ts backend/tests/services/ai-batch-fill.test.ts
git commit -m "feat(rating): 批量/单本 AI 填充集成豆瓣评分写库"
```

---

## Task 7: 后端启用 rating 排序

**Files:**
- Modify: `backend/src/routes/library.ts`(`ALLOWED_SORT_FIELDS`)

- [ ] **Step 1: 加字段**

把 `const ALLOWED_SORT_FIELDS = ['title', 'author', 'imported_at', 'file_size', 'category'];` 改为追加 `'rating'`:
```ts
const ALLOWED_SORT_FIELDS = ['title', 'author', 'imported_at', 'file_size', 'category', 'rating'];
```
(SQLite `ORDER BY rating DESC` 天然把 NULL 排在最后,无需额外处理。)

- [ ] **Step 2: 类型 + 提交**

Run: `cd backend && npx tsc --noEmit`(干净)
```bash
git add backend/src/routes/library.ts
git commit -m "feat(rating): 后端允许按 rating 排序"
```

---

## Task 8: 前端类型 + API

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/library.ts`

- [ ] **Step 1: Book 类型加 rating**

`frontend/src/types/index.ts` 的 `interface Book` 内(`ai_fill_status` 附近)加:
```ts
  rating?: number | null
```

- [ ] **Step 2: API 加 reset-all,status 增 duplicate_groups**

`frontend/src/api/library.ts`:
(a) `LibraryQuery.status` 改为:
```ts
  status?: 'normal' | 'problems' | 'duplicate' | 'duplicate_groups' | 'garbled' | 'all'
```
(b) `libraryApi` 内 `aiFillResetFailed` 之后加:
```ts
  aiFillResetAll: () =>
    http.post<ApiResponse<{ reset: number }>>('/library/ai-fill-reset-all'),
```
(c) `listAdmin` 的参数对象类型加 `status` 与 rating-able sortBy(sortBy 已是 string):
```ts
  listAdmin: (params: {
    page?: number; pageSize?: number; search?: string; category?: string;
    include_dirty?: boolean; series_grouped?: boolean;
    sortBy?: string; sortOrder?: 'asc' | 'desc';
    ai_fill?: 'all' | 'filled' | 'failed' | 'none';
    status?: 'normal' | 'problems' | 'duplicate' | 'duplicate_groups' | 'garbled' | 'all';
  } = {}) =>
    http.get<PaginatedResponse<Book>>('/library', { params }),
```

- [ ] **Step 3: typecheck**

Run: `cd frontend && npm run typecheck`
Expected: 干净。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/library.ts
git commit -m "feat(library): 前端 Book.rating + aiFillResetAll + status=duplicate_groups"
```

---

## Task 9: Library.vue — 魔法关键词 + 移除控件 + 评分排序

**Files:**
- Modify: `frontend/src/views/Library.vue`

- [ ] **Step 1: 移除模板控件**

删除以下模板块:
- 排序下拉里 `<el-option label="网络评分（待上线）" value="rating" disabled />` → 改为 `<el-option label="网络评分（高→低）" value="rating" />`(去 disabled、改文案)。
- 整个 `<el-select v-if="authStore.isAdmin" v-model="aiFillFilter" …>…</el-select>` 块(38-48 行)。
- 整个 `<el-switch v-if="authStore.isAdmin" v-model="includeDirty" …/>` 块(49-56 行)。
- 「批量 AI 填充」按钮 `<el-button … @click="showFillDialog = true">…批量 AI 填充</el-button>`(61-64 行)。
- 「问题书籍管理」按钮 `<el-button … @click="$router.push('/library/problems')">问题书籍管理</el-button>`(65-67 行)。
- 整个 `<el-dialog v-model="showFillDialog" …>…</el-dialog>` 批量填充对话框(112-126 行)。

搜索框 placeholder 改为提示魔法词:
```html
placeholder="搜索书名/作者；输入「重复」「ai填充」「填充失败」"
```

- [ ] **Step 2: 删除/调整 script 中相关 state 与处理器**

删除:`includeDirty`、`aiFillFilter`、`showFillDialog`、`fillForce`、`fillEstimate`、`onStartFill`、`onResetFailedFills`、批量填充对话框相关 imports(若 `MagicStick` 仅此处用则保留——它也用于扫描;按编译报错清理)。删除 `safeSortBy` 降级逻辑。

`sortBy` ref 类型保留 `'imported_at' | 'title' | 'rating'`。

- [ ] **Step 3: 加魔法关键词映射,改 fetchBooks**

把 `fetchBooks` 改为:
```ts
type ListParams = Parameters<typeof libraryApi.listAdmin>[0]

function resolveListParams(): ListParams {
  const raw = searchQuery.value.trim()
  const base: ListParams = {
    page: pagination.page,
    pageSize: pagination.pageSize,
    category: selectedCategory.value || undefined,
    sortBy: sortBy.value,
    sortOrder: sortOrderFor(sortBy.value),
    series_grouped: false,
  }
  if (authStore.isAdmin) {
    if (raw === '重复') return { ...base, status: 'duplicate_groups' }
    if (raw === 'ai填充' || raw === '已填充') return { ...base, ai_fill: 'filled' }
    if (raw === '填充失败') return { ...base, ai_fill: 'failed' }
  }
  return { ...base, search: raw || undefined }
}

async function fetchBooks() {
  loading.value = true
  syncQuery()
  try {
    const booksResp = await libraryApi.listAdmin(resolveListParams())
    books.value = booksResp.data.data
    Object.assign(pagination, booksResp.data.pagination ?? {})
  } finally {
    loading.value = false
  }
}
```
**注意**:`pagination` 赋值、`books.value` 取值的字段名要与现有代码一致(实现前对照现有 `fetchBooks` 的 `booksResp.data.*` 用法照抄)。`sortOrderFor` 已存在;确认 `sortOrderFor('rating')` 返回 `'desc'`(若它按字段判断,'rating' 走默认 desc 即可,必要时加分支)。

- [ ] **Step 4: 清理 syncQuery 的 dirty/ai_fill**

`syncQuery()` 里删除 `if (includeDirty.value) query.dirty = '1'` 和 `if (aiFillFilter.value !== 'all') query.ai_fill = …`。保留 `search`/`sort`/`category` 同步。初始化 `searchQuery`/`sortBy` 从 query 恢复的逻辑保留;删除 `includeDirty`/`aiFillFilter` 的初始化。

- [ ] **Step 5: typecheck + build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: 通过(按报错清理遗留引用)。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/Library.vue
git commit -m "feat(library): 搜索框魔法关键词替代下拉/开关,移除批量填充与问题书籍入口,启用评分排序"
```

---

## Task 10: ScanOptionsDialog — 两个重置按钮

**Files:**
- Modify: `frontend/src/components/ScanOptionsDialog.vue`

- [ ] **Step 1: 模板加按钮**

在 `<el-form-item label="AI 功能">` 的 `.ai-toggles` div 内,`estimate-summary` 之后加:
```html
            <div class="reset-row">
              <el-button size="small" @click="onResetFailed">重置「填充失败」记录</el-button>
              <el-button size="small" type="warning" plain @click="onResetAll">重置全部填充记录</el-button>
            </div>
            <div class="reset-hint">重置后,勾选「AI 批量填充」开始扫描即会重填对应书籍</div>
```

- [ ] **Step 2: script 加处理器**

`<script setup>` 内 import 追加:
```ts
import { ElMessage, ElMessageBox } from 'element-plus'
```
新增两个函数:
```ts
async function onResetFailed(): Promise<void> {
  try {
    await ElMessageBox.confirm('将把所有「填充失败」的书重置为未尝试,下次带 AI 填充的扫描会自动重试。继续?', '重置填充失败', { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' })
  } catch { return }
  try {
    const resp = await libraryApi.aiFillResetFailed()
    ElMessage.success(`已重置 ${resp.data.data?.reset ?? 0} 本书的失败记录`)
  } catch { ElMessage.error('重置失败') }
}

async function onResetAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('将重置全部填充记录(不论成功/失败)。下次带 AI 填充的扫描会重新处理所有书(已有字段不会被覆盖,只补缺失的评分/封面等)。继续?', '重置全部填充', { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' })
  } catch { return }
  try {
    const resp = await libraryApi.aiFillResetAll()
    ElMessage.success(`已重置 ${resp.data.data?.reset ?? 0} 本书的填充记录`)
  } catch { ElMessage.error('重置失败') }
}
```

- [ ] **Step 3: 样式**

`<style scoped>` 末尾加:
```css
.reset-row { display: flex; gap: 8px; margin-top: 10px; }
.reset-hint { font-size: 12px; color: var(--text-2); margin-top: 6px; }
```

- [ ] **Step 4: typecheck + build + Commit**

Run: `cd frontend && npm run typecheck && npm run build`(通过)
```bash
git add frontend/src/components/ScanOptionsDialog.vue
git commit -m "feat(ai-fill): 扫描对话框加重置填充失败/重置全部填充按钮"
```

---

## Task 11: 评分显示(BookCard 角标 + BookDetail)

**Files:**
- Modify: `frontend/src/components/BookCard.vue`
- Modify: `frontend/src/views/BookDetail.vue`

- [ ] **Step 1: BookCard 角标**

在 `BookCard.vue` 模板 `.book-cover` 内,`status-badge` el-tag 之后加:
```html
      <span v-if="book.rating" class="rating-badge">★ {{ book.rating.toFixed(1) }}</span>
```
`<style scoped>` 末尾加:
```css
.rating-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 4;
  font-size: 11px;
  font-weight: 700;
  color: #ffd666;
  background: rgba(11, 16, 32, 0.7);
  padding: 2px 6px;
  border-radius: 4px;
}
```

- [ ] **Step 2: BookDetail 评分行**

在 `BookDetail.vue` 信息区 `meta-item` 序列里(如 `发布时间` 那组附近,约 114 行前),加一条:
```html
              <div v-if="book.rating" class="meta-item">
                <span class="meta-label">豆瓣评分</span>
                <span class="meta-value">★ {{ book.rating.toFixed(1) }}</span>
              </div>
```

- [ ] **Step 3: typecheck + build + Commit**

Run: `cd frontend && npm run typecheck && npm run build`(通过)
```bash
git add frontend/src/components/BookCard.vue frontend/src/views/BookDetail.vue
git commit -m "feat(rating): 卡片角标 + 详情页显示豆瓣评分"
```

---

## Task 12: 全量验证

- [ ] **Step 1: 后端全绿 + 类型**

Run: `cd backend && npm test && npx tsc --noEmit`
Expected: 全部 PASS;tsc 干净。

- [ ] **Step 2: 前端**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: 通过。

- [ ] **Step 3: 部署 + 浏览器实测(用户节点)**

```bash
docker compose up -d --build
```
逐项核对(见 spec「验证」):魔法关键词(重复/ai填充/填充失败/清空/普通词);工具栏已无问题书籍/脏数据/AI填充下拉/批量填充按钮;扫描对话框两个重置按钮 + 重置后带 AI 填充扫描重填;评分角标/详情/排序。

---

## Self-Review(已核对)

- **spec 覆盖**:① 重复搜索→Task 4+9;② 移除入口/批量按钮→Task 9;③ 重置按钮入扫描对话框→Task 3+10;④ ai填充/填充失败搜索→Task 8+9;⑤ selectFillCandidates 版本驱动→Task 2;⑥ 评分抓取→Task 5+6;⑦ 评分显示+排序→Task 7+8+11。
- **类型一致**:`doubanSuggest`/`downloadCover`/`fetchRating`/`parseDoubanRating`/`resetAllFills`/`selectDuplicateGroupBooks`/`aiFillResetAll`/`status='duplicate_groups'`/`Book.rating` 在定义与引用处命名一致。
- **占位符**:无 TBD;每步含可执行代码/命令。
- **风险点(实现时确认)**:Task 4/6/9 中标注"对照现有返回/SELECT/字段名照抄"处,需在改之前读一眼现有代码确认字段名(list 路由分页响应结构、单本路由 book 的 SELECT、Library.vue 现有 `booksResp.data.*` 用法)。
