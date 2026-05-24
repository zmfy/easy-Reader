# Plan 2: AI 去重 + 系列归类 + 批次审核

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**前置条件：** Plan 1 已实施完成（scan_tasks 表、扫描进度框架、指纹与编码已就绪）。

**Goal:** 在 Plan 1 框架上加入"指纹候选分组 + AI 判别"的去重与系列归类逻辑，把扫描结果先入 `scan_batch` 暂存表，提供折叠面板审核 UI 让 admin 修正 AI 判定，确认后再批量应用到 books 表。完成后扫描真正具备"智能"，但 AI 批量填充、Library UI 集成（badge、系列卡）、费用警告留给 Plan 3。

**Architecture:** 在 `services/` 加 4 个本地算法模块（dedup-grouper、series-regex、title-normalizer、batch-builder）+ 2 个 AI 服务模块（ai-dedup、ai-series）+ 应用模块（batch-applier）。`AiPlugin` interface 扩展一个 `chat()` 低层原语，6 个 plugin 各加一个直通调用，所有 prompt 工程集中在 `ai-manager`。前端新增 `ScanOptionsDialog`（替换原裸点扫描按钮）和 `ScanBatchReview` 页面。

**Tech Stack:** Express + better-sqlite3 + Jest + Vue 3 + Pinia + Element Plus（含 `el-collapse`, `el-popover`, `el-dialog`）+ Vitest

**关联设计文档:** `docs/superpowers/specs/2026-05-24-scan-dedupe-design.md`

---

## File Structure

### 后端新增

| 文件 | 职责 |
|---|---|
| `backend/tests/services/dedup-grouper.test.ts` | 候选分组单元测试 |
| `backend/tests/services/series-regex.test.ts` | 系列正则单元测试 |
| `backend/tests/services/batch-builder.test.ts` | 批次构建单元测试 |
| `backend/tests/services/batch-applier.test.ts` | 批次应用单元测试 |
| `backend/src/utils/title-normalizer.ts` | 标题归一化 |
| `backend/src/services/dedup-grouper.ts` | 硬重复 + 软重复候选分组 |
| `backend/src/services/series-regex.ts` | 正则系列候选 |
| `backend/src/services/ai-dedup.ts` | AI 判别软重复（受 manual_overrides 影响）|
| `backend/src/services/ai-series.ts` | AI 复核系列候选 |
| `backend/src/services/batch-builder.ts` | 把扫描结果组装为 scan_batch_items |
| `backend/src/services/batch-applier.ts` | 应用批次到 books / series 表 |
| `backend/src/services/manual-override.ts` | manual_overrides CRUD |
| `backend/src/routes/scan-batches.ts` | 批次审核接口 |

### 后端修改

| 文件 | 修改 |
|---|---|
| `backend/src/db.ts` | 加 series / scan_batches / scan_batch_items / manual_overrides 表 |
| `backend/src/types/index.ts` | 加 Series, ScanBatch, ScanBatchItem, ManualOverride, ScanOptions 扩展 |
| `backend/src/ai/ai-manager.ts` | 加 chat() 入口 + judgeDuplicates / judgeSeries 方法 |
| `backend/src/ai/deepseek.ts` | 加 chat() 方法 |
| `backend/src/ai/qwen.ts` | 同上 |
| `backend/src/ai/minmax.ts` | 同上 |
| `backend/src/ai/openai.ts` | 同上 |
| `backend/src/ai/claude.ts` | 同上 |
| `backend/src/ai/ollama.ts` | 同上 |
| `backend/src/services/scan-walker.ts` | 添加 dedup/series 阶段；支持 review 模式（结果入批次而非 books）|
| `backend/src/routes/library.ts` | `/scan` 接受新 options |
| `backend/src/index.ts` | 挂载 scan-batches 路由 |

### 前端新增

| 文件 | 职责 |
|---|---|
| `frontend/src/api/scan-batches.ts` | API 客户端 |
| `frontend/src/stores/scan-batch.ts` | Pinia store（批次详情 + 操作）|
| `frontend/src/views/ScanBatchList.vue` | 批次列表 |
| `frontend/src/views/ScanBatchReview.vue` | 批次审核（折叠面板）|
| `frontend/src/components/ScanOptionsDialog.vue` | 扫描选项对话框 |
| `frontend/src/components/DuplicateGroupCard.vue` | 重复组卡片 |
| `frontend/src/components/SeriesGroupCard.vue` | 系列组卡片 |
| `frontend/src/components/BatchItemPreview.vue` | 第一章预览浮窗 |

### 前端修改

| 文件 | 修改 |
|---|---|
| `frontend/src/api/library.ts` | 扩展 scan 参数 |
| `frontend/src/router/index.ts` | 加批次审核路由 |
| `frontend/src/views/Library.vue` | 点扫描按钮触发 ScanOptionsDialog；显示 pending batch 提醒 |
| `frontend/src/types/index.ts` | 加 ScanBatch / ScanBatchItem 等类型 |

---

## Phase A: 数据库 Schema 扩展（任务 1）

### Task 1: 加 series / scan_batches / scan_batch_items / manual_overrides 表

**Files:**
- Modify: `backend/src/db.ts`

- [ ] **Step 1: 在 initSchema() 中 Plan 1 的「scan_tasks」段之后追加新表**

在 `backend/src/db.ts` 中找到 `// === Plan 1 schema: books extra columns ===` 段之后，紧接着 `// === Plan 1: recover stale running tasks on startup ===` 段**之前**，插入以下代码：

```typescript
  // === Plan 2 schema: series ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      summary TEXT,
      cover_url TEXT,
      author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_series_name ON series(name);
  `);

  // === Plan 2 schema: scan_batches ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_batches (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      summary_counts TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      applied_at DATETIME,
      applied_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scan_batches_status ON scan_batches(status);
  `);

  // === Plan 2 schema: scan_batch_items ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_batch_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      admin_decision TEXT,
      admin_payload TEXT,
      reviewed_at DATETIME,
      reviewed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scan_batch_items_batch ON scan_batch_items(batch_id);
    CREATE INDEX IF NOT EXISTS idx_scan_batch_items_type ON scan_batch_items(type);
  `);

  // === Plan 2 schema: manual_overrides ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS manual_overrides (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      book_id_a TEXT,
      book_id_b TEXT,
      series_id TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_manual_overrides_type ON manual_overrides(type);
    CREATE INDEX IF NOT EXISTS idx_manual_overrides_book_a ON manual_overrides(book_id_a);
  `);
```

- [ ] **Step 2: 启动 dev server 验证**

```bash
cd ~/projects/easy-Reader/backend && npm run dev
```
等 5 秒 Ctrl+C。

```bash
sqlite3 ~/projects/easy-Reader/backend/data/novel-reader.db ".tables"
```
Expected: 输出包含 `series scan_batches scan_batch_items manual_overrides` 这 4 张新表

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/db.ts
git commit -m "feat(scan): add series/scan_batches/scan_batch_items/manual_overrides tables"
```

---

## Phase B: 类型扩展（任务 2）

### Task 2: 扩展 types

**Files:**
- Modify: `backend/src/types/index.ts`

- [ ] **Step 1: 修改 types 文件**

把 Plan 1 在 `backend/src/types/index.ts` 末尾添加的 `ScanOptions` 接口**整段替换**为：

```typescript
export interface ScanOptions {
  mode: 'auto' | 'review' | 'hybrid';
  ai_dedup: boolean;
  ai_series: boolean;
  ai_fill: boolean;        // Plan 3 才生效，Plan 2 仅占位
  full_rescan: boolean;
}

export interface Series {
  id: string;
  name: string;
  summary?: string;
  cover_url?: string;
  author?: string;
  created_at: string;
}

export type ScanBatchStatus = 'pending' | 'applied' | 'discarded';

export interface ScanBatch {
  id: string;
  task_id: string;
  status: ScanBatchStatus;
  summary_counts: string;   // JSON
  created_at: string;
  applied_at?: string | null;
  applied_by?: string | null;
}

export type ScanBatchItemType =
  | 'new'
  | 'duplicate_group'
  | 'series'
  | 'garbled'
  | 'encoding_fixed'
  | 'ai_fill_failed';

export interface ScanBatchItem {
  id: string;
  batch_id: string;
  type: ScanBatchItemType;
  payload: string;          // JSON
  admin_decision?: 'accept' | 'reject' | 'modified' | null;
  admin_payload?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
}

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
}

export interface DuplicateGroupPayload {
  canonical_file_path: string;        // 正本文件路径
  members: Array<{
    file_path: string;
    fingerprint: string;
    decision_type: 'hard' | 'ai';     // hard = 指纹完全相同；ai = AI 判定
    ai_confidence?: number;           // 0..1
  }>;
}

export interface SeriesGroupPayload {
  series_name: string;
  author?: string;
  members: Array<{
    file_path: string;
    sequence: number;
  }>;
  source: 'regex' | 'ai';
  confidence?: 'high' | 'medium' | 'low';
}

export interface GarbledPayload {
  file_path: string;
  reason: string;
}

export interface EncodingFixedPayload {
  file_path: string;
  from_encoding: string;
  to_encoding: 'utf-8';
}

export type ManualOverrideType =
  | 'not_duplicate'
  | 'not_in_series'
  | 'forced_duplicate'
  | 'forced_series_member';

export interface ManualOverride {
  id: string;
  type: ManualOverrideType;
  book_id_a: string | null;
  book_id_b: string | null;
  series_id: string | null;
  created_by: string;
  created_at: string;
}
```

并扩展 `AiPlugin` 接口（在文件中找到 `export interface AiPlugin { ... }` 修改）：

```typescript
export interface AiPlugin {
  name: string;
  label: string;
  fields: string[];
  placeholders?: Record<string, string>;
  fillBookInfo(rawText: string, config: Record<string, string>): Promise<Partial<Book>>;
  classifyBook(bookInfo: Partial<Book>, config: Record<string, string>): Promise<string>;
  /**
   * Low-level chat primitive. Used by AI dedup/series judgement.
   * Plugins must implement this so judgement logic can stay centralized.
   */
  chat(prompt: string, config: Record<string, string>): Promise<string>;
}
```

- [ ] **Step 2: 类型检查（会暂时报错，因为 plugins 还没实现 chat —— 下一个 Task 修）**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 6 errors（6 个 plugin 没实现 chat）— 这是预期，留到 Task 3 修复。

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/types/index.ts
git commit -m "feat(scan): extend types for Plan 2 (Series, ScanBatch, ManualOverride, AiPlugin.chat)"
```

---

## Phase C: AI 原语扩展（任务 3-4）

### Task 3: 给 6 个 AI plugin 添加 chat() 方法

**Files:**
- Modify: `backend/src/ai/deepseek.ts`
- Modify: `backend/src/ai/qwen.ts`
- Modify: `backend/src/ai/minmax.ts`
- Modify: `backend/src/ai/openai.ts`
- Modify: `backend/src/ai/claude.ts`
- Modify: `backend/src/ai/ollama.ts`

- [ ] **Step 1: deepseek.ts 加 chat()**

在 `backend/src/ai/deepseek.ts` 的 `classifyBook` 方法之后（仍在对象内）添加：

```typescript
  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';
    const model = config.model || 'deepseek-chat';

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!resp.ok) throw new Error(`DeepSeek API error: ${resp.status}`);

    const data = await resp.json() as Record<string, unknown>;
    return ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content || '';
  },
```

- [ ] **Step 2: qwen.ts 加 chat()**

打开 `backend/src/ai/qwen.ts`，参考其 `fillBookInfo` 实现写 chat()。一般模板：

```typescript
  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = config.model || 'qwen-turbo';
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });
    if (!resp.ok) throw new Error(`Qwen API error: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content || '';
  },
```

注意 `baseUrl` 与 `model` 默认值要从该 plugin 现有的 `fillBookInfo` 中复制（保持一致）。

- [ ] **Step 3: minmax.ts、openai.ts 同样套路**

对 `minmax.ts` 和 `openai.ts` 重复 step 2 的步骤，参考各自现有的 `fillBookInfo` 中 fetch 调用的 url 和 body 结构。

OpenAI 模板（如默认 baseUrl 不同需调整）：
```typescript
  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    const model = config.model || 'gpt-4o-mini';
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });
    if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content || '';
  },
```

- [ ] **Step 4: claude.ts 加 chat()**

Claude 的 API 形状不一样。打开 `backend/src/ai/claude.ts` 参考其 `fillBookInfo`。模板：

```typescript
  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
    const model = config.model || 'claude-3-5-haiku-latest';

    const resp = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Claude API error: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    const content = (data.content as Array<{ text?: string }> | undefined)?.[0]?.text;
    return content || '';
  },
```

如果 claude.ts 的 fillBookInfo 用了不同的 url 或 header，按 fillBookInfo 调整。

- [ ] **Step 5: ollama.ts 加 chat()**

参考 ollama.ts 现有 fillBookInfo。模板（Ollama 本地 API）：

```typescript
  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'http://localhost:11434';
    const model = config.model || 'qwen2.5:7b';
    const resp = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.1 },
      }),
    });
    if (!resp.ok) throw new Error(`Ollama API error: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    const msg = data.message as { content?: string } | undefined;
    return msg?.content || '';
  },
```

- [ ] **Step 6: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 7: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/ai/
git commit -m "feat(scan): add chat() primitive to all AI plugins"
```

### Task 4: 在 ai-manager 加 chat / judgeDuplicates / judgeSeries

**Files:**
- Modify: `backend/src/ai/ai-manager.ts`

- [ ] **Step 1: 替换 ai-manager.ts 的导出对象**

把 `backend/src/ai/ai-manager.ts` 末尾的 `export const aiManager = { ... }` **整段替换**为：

```typescript
export interface AiDedupCandidate {
  index: number;
  title: string;
  author?: string;
  chapter_count?: number;
  first_chapter_preview: string;   // 第一章前 300 字
}

export interface AiDedupResult {
  /** 按 input 数组 index 引用；每组的 canonical_index + duplicate_indices */
  groups: Array<{
    canonical_index: number;
    duplicate_indices: number[];
  }>;
}

export interface AiSeriesCandidate {
  index: number;
  title: string;
  author?: string;
}

export interface AiSeriesResult {
  is_series: boolean;
  series_name?: string;
  /** 按 input index 引用的成员顺序 */
  members?: Array<{ index: number; sequence: number }>;
  confidence?: 'high' | 'medium' | 'low';
}

export const aiManager = {
  async fillBookInfo(rawText: string, db: Database.Database): Promise<Partial<Book>> {
    const active = getActivePlugin(db);
    if (!active) throw new Error('未配置 AI 插件');
    return active.plugin.fillBookInfo(rawText, active.config);
  },

  async classifyBook(bookInfo: Partial<Book>, db: Database.Database): Promise<string> {
    const active = getActivePlugin(db);
    if (!active) throw new Error('未配置 AI 插件');
    return active.plugin.classifyBook(bookInfo, active.config);
  },

  async chat(prompt: string, db: Database.Database): Promise<string> {
    const active = getActivePlugin(db);
    if (!active) throw new Error('未配置 AI 插件');
    return active.plugin.chat(prompt, active.config);
  },

  async judgeDuplicates(
    candidates: AiDedupCandidate[],
    db: Database.Database,
  ): Promise<AiDedupResult> {
    if (candidates.length < 2) return { groups: [] };
    const prompt = buildDedupPrompt(candidates);
    const raw = await this.chat(prompt, db);
    return parseDedupResponse(raw, candidates.length);
  },

  async judgeSeries(
    candidates: AiSeriesCandidate[],
    db: Database.Database,
  ): Promise<AiSeriesResult> {
    if (candidates.length < 2) return { is_series: false };
    const prompt = buildSeriesPrompt(candidates);
    const raw = await this.chat(prompt, db);
    return parseSeriesResponse(raw, candidates.length);
  },
};

function buildDedupPrompt(candidates: AiDedupCandidate[]): string {
  const blocks = candidates.map((c, i) => (
    `[#${i}]\n书名：${c.title}\n作者：${c.author ?? '未知'}\n章节数：${c.chapter_count ?? '?'}\n第一章节选：${c.first_chapter_preview.slice(0, 300)}`
  )).join('\n---\n');
  return `下面有 ${candidates.length} 本疑似重复的小说，请判断哪些是同一本书的不同版本（哪怕排版/章节标题略有不同）。

${blocks}

请按以下 JSON 格式返回，**只输出 JSON，不要任何其他文字**：
{"groups":[{"canonical_index":0,"duplicate_indices":[2,3]}]}

约定：
- canonical_index 选章节数最完整且内容最齐全的那本
- duplicate_indices 是除 canonical 外的同一本书
- 如果没有任何重复，返回 {"groups":[]}
- 不要把不同的书归到同一组`;
}

function parseDedupResponse(raw: string, total: number): AiDedupResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { groups: [] };
    const parsed = JSON.parse(jsonMatch[0]) as AiDedupResult;
    // sanity check indices
    const valid = (parsed.groups ?? []).filter(g =>
      g.canonical_index >= 0 && g.canonical_index < total &&
      g.duplicate_indices.every(i => i >= 0 && i < total && i !== g.canonical_index)
    );
    return { groups: valid };
  } catch {
    return { groups: [] };
  }
}

function buildSeriesPrompt(candidates: AiSeriesCandidate[]): string {
  const blocks = candidates.map((c, i) => `[#${i}] 书名：${c.title} | 作者：${c.author ?? '未知'}`).join('\n');
  return `下面有 ${candidates.length} 本书，请判断它们是否属于同一个系列（如《女生宿舍 1》《女生宿舍 2》《女生宿舍 3》算一个系列）。

${blocks}

请按以下 JSON 格式返回，**只输出 JSON**：
{"is_series": true, "series_name": "女生宿舍", "members": [{"index": 0, "sequence": 1}, {"index": 1, "sequence": 2}], "confidence": "high"}

或如果不是系列：{"is_series": false}

约定：
- series_name 是去除编号后的公共部分
- sequence 是该书在系列中的序号（从 1 开始）
- confidence: high / medium / low
- 同作者 + 标题仅尾缀不同 → high
- 标题相似但作者不同 → low 或 is_series:false`;
}

function parseSeriesResponse(raw: string, total: number): AiSeriesResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { is_series: false };
    const parsed = JSON.parse(jsonMatch[0]) as AiSeriesResult;
    if (!parsed.is_series) return { is_series: false };
    const members = (parsed.members ?? []).filter(m =>
      m.index >= 0 && m.index < total && m.sequence > 0
    );
    if (members.length < 2) return { is_series: false };
    return {
      is_series: true,
      series_name: parsed.series_name,
      members,
      confidence: parsed.confidence ?? 'medium',
    };
  } catch {
    return { is_series: false };
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/ai/ai-manager.ts
git commit -m "feat(scan): add chat/judgeDuplicates/judgeSeries to ai-manager"
```

---

## Phase D: 本地算法（任务 5-9，TDD）

### Task 5: title-normalizer 工具 — 测试 + 实现

**Files:**
- Create: `backend/src/utils/title-normalizer.ts`
- Create: `backend/tests/utils/title-normalizer.test.ts`

- [ ] **Step 1: 写测试**

Create `backend/tests/utils/title-normalizer.test.ts`:

```typescript
import { normalizeTitle, levenshtein } from '../../src/utils/title-normalizer';

describe('normalizeTitle', () => {
  it('strips parenthesized suffixes', () => {
    expect(normalizeTitle('斗破苍穹（上）')).toBe('斗破苍穹');
    expect(normalizeTitle('斗破苍穹(下)')).toBe('斗破苍穹');
  });
  it('strips trailing digit suffixes', () => {
    expect(normalizeTitle('女生宿舍1')).toBe('女生宿舍');
    expect(normalizeTitle('女生宿舍 2')).toBe('女生宿舍');
    expect(normalizeTitle('女生宿舍 第3部')).toBe('女生宿舍');
  });
  it('strips above/middle/below markers', () => {
    expect(normalizeTitle('三体 上')).toBe('三体');
    expect(normalizeTitle('三体下')).toBe('三体');
    expect(normalizeTitle('遮天 续')).toBe('遮天');
  });
  it('handles full-width and half-width digits/spaces', () => {
    expect(normalizeTitle('女生宿舍１')).toBe('女生宿舍');
    expect(normalizeTitle('女生宿舍 １')).toBe('女生宿舍');
  });
  it('preserves clean titles', () => {
    expect(normalizeTitle('三体')).toBe('三体');
    expect(normalizeTitle('诛仙')).toBe('诛仙');
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });
  it('returns 1 for single edit', () => {
    expect(levenshtein('女生宿舍1', '女生宿舍2')).toBe(1);
    expect(levenshtein('catch', 'match')).toBe(2);
  });
  it('returns length for empty vs string', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/utils/title-normalizer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

Create `backend/src/utils/title-normalizer.ts`:

```typescript
/**
 * Normalize a book title for grouping: strip volume/episode suffixes,
 * convert full-width to half-width, collapse whitespace.
 */
export function normalizeTitle(title: string): string {
  return title
    // Full-width digits → half-width
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
    // Full-width spaces → half-width
    .replace(/　/g, ' ')
    // Strip parenthesized suffix like (上) (下) （续）
    .replace(/[（(][^（()）]{1,5}[)）]\s*$/, '')
    // Strip "第N部/集/册/卷"
    .replace(/\s*第\s*[零一二三四五六七八九十百千\d]+\s*[部集册卷]\s*$/, '')
    // Strip trailing 上/中/下/续/完结/终
    .replace(/\s*[上中下续终完]\s*$/, '')
    .replace(/\s*完结\s*$/, '')
    // Strip trailing digits with optional space
    .replace(/\s*\d+\s*$/, '')
    // Collapse whitespace
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Compute Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
```

- [ ] **Step 4: 跑测试**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/utils/title-normalizer.test.ts`
Expected: PASS — 8 tests pass

- [ ] **Step 5: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/utils/title-normalizer.ts backend/tests/utils/title-normalizer.test.ts
git commit -m "feat(scan): add title normalizer and levenshtein utilities"
```

### Task 6: dedup-grouper 测试

**Files:**
- Create: `backend/tests/services/dedup-grouper.test.ts`

- [ ] **Step 1: 写测试**

Create `backend/tests/services/dedup-grouper.test.ts`:

```typescript
import { buildCandidateGroups, ScannedBook } from '../../src/services/dedup-grouper';

const fp = (s: string) => 'fingerprint_' + s;

describe('buildCandidateGroups', () => {
  it('returns empty groups for unique books', () => {
    const books: ScannedBook[] = [
      { file_path: '/a', title: '三体', author: '刘慈欣', fingerprint: fp('a') },
      { file_path: '/b', title: '诛仙', author: '萧鼎', fingerprint: fp('b') },
    ];
    const r = buildCandidateGroups(books);
    expect(r.hard_groups).toEqual([]);
    expect(r.soft_groups).toEqual([]);
  });

  it('groups books with identical fingerprint as hard duplicates', () => {
    const books: ScannedBook[] = [
      { file_path: '/a1', title: '三体', author: '刘慈欣', fingerprint: fp('x') },
      { file_path: '/a2', title: '三体复制', author: '刘慈欣', fingerprint: fp('x') },
      { file_path: '/b', title: '诛仙', author: '萧鼎', fingerprint: fp('y') },
    ];
    const r = buildCandidateGroups(books);
    expect(r.hard_groups).toHaveLength(1);
    expect(r.hard_groups[0].length).toBe(2);
    expect(r.soft_groups).toEqual([]);
  });

  it('groups books with normalized title as soft candidates', () => {
    const books: ScannedBook[] = [
      { file_path: '/1', title: '女生宿舍1', author: '同作者', fingerprint: fp('1') },
      { file_path: '/2', title: '女生宿舍2', author: '同作者', fingerprint: fp('2') },
      { file_path: '/c', title: '三体', author: '刘慈欣', fingerprint: fp('c') },
    ];
    const r = buildCandidateGroups(books);
    // soft group should contain the two 女生宿舍
    expect(r.soft_groups).toHaveLength(1);
    expect(r.soft_groups[0]).toHaveLength(2);
  });

  it('does NOT put books in soft group if they are already in hard group', () => {
    const books: ScannedBook[] = [
      { file_path: '/a', title: '女生宿舍1', fingerprint: fp('x') },
      { file_path: '/b', title: '女生宿舍1', fingerprint: fp('x') }, // hard dup
      { file_path: '/c', title: '女生宿舍2', fingerprint: fp('y') },
    ];
    const r = buildCandidateGroups(books);
    expect(r.hard_groups).toHaveLength(1);
    // soft groups should not duplicate-include /a or /b
    const softPaths = r.soft_groups.flat().map(b => b.file_path);
    expect(softPaths).not.toContain('/a');
    expect(softPaths).not.toContain('/b');
  });

  it('skips books without fingerprint', () => {
    const books: ScannedBook[] = [
      { file_path: '/a', title: '三体', fingerprint: undefined },
      { file_path: '/b', title: '三体', fingerprint: undefined },
    ];
    const r = buildCandidateGroups(books);
    expect(r.hard_groups).toEqual([]);
    expect(r.soft_groups).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/dedup-grouper.test.ts`
Expected: FAIL — module not found

### Task 7: dedup-grouper 实现

**Files:**
- Create: `backend/src/services/dedup-grouper.ts`

- [ ] **Step 1: 实现**

Create `backend/src/services/dedup-grouper.ts`:

```typescript
import { normalizeTitle } from '../utils/title-normalizer';

export interface ScannedBook {
  file_path: string;
  title: string;
  author?: string;
  fingerprint?: string;
  chapter_count?: number;
  first_chapter_preview?: string;
}

export interface CandidateGroups {
  /** 指纹完全相同的硬重复组（每组 ≥ 2 本） */
  hard_groups: ScannedBook[][];
  /** 标题归一化相同但指纹不同 → AI 软判定候选（每组 ≥ 2 本） */
  soft_groups: ScannedBook[][];
}

/**
 * Cluster scanned books into hard/soft duplicate candidate groups.
 * Hard groups: same fingerprint.
 * Soft groups: same normalized title, different fingerprint, exclude books already in hard groups.
 */
export function buildCandidateGroups(books: ScannedBook[]): CandidateGroups {
  // --- Hard groups by fingerprint ---
  const byFp = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint) continue;
    const arr = byFp.get(b.fingerprint);
    if (arr) arr.push(b);
    else byFp.set(b.fingerprint, [b]);
  }
  const hardGroups: ScannedBook[][] = [];
  const inHard = new Set<string>(); // file_path
  for (const [, group] of byFp) {
    if (group.length >= 2) {
      hardGroups.push(group);
      for (const b of group) inHard.add(b.file_path);
    }
  }

  // --- Soft groups by normalized title (exclude books already in hard) ---
  const byNorm = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint) continue; // can't dedup books without fingerprint
    if (inHard.has(b.file_path)) continue;
    const key = normalizeTitle(b.title);
    if (!key) continue;
    const arr = byNorm.get(key);
    if (arr) arr.push(b);
    else byNorm.set(key, [b]);
  }
  const softGroups: ScannedBook[][] = [];
  for (const [, group] of byNorm) {
    if (group.length >= 2) {
      // ensure distinct fingerprints (otherwise it'd already be a hard group, but defensive)
      const fps = new Set(group.map(b => b.fingerprint));
      if (fps.size >= 2) softGroups.push(group);
    }
  }

  return { hard_groups: hardGroups, soft_groups: softGroups };
}
```

- [ ] **Step 2: 跑测试**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/dedup-grouper.test.ts`
Expected: PASS — 5 tests pass

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/dedup-grouper.ts backend/tests/services/dedup-grouper.test.ts
git commit -m "feat(scan): add dedup candidate grouping (hard fingerprint + soft title)"
```

### Task 8: series-regex 测试

**Files:**
- Create: `backend/tests/services/series-regex.test.ts`

- [ ] **Step 1: 写测试**

Create `backend/tests/services/series-regex.test.ts`:

```typescript
import { extractSeriesCandidates, ScannedBookForSeries } from '../../src/services/series-regex';

describe('extractSeriesCandidates', () => {
  it('groups numeric-suffix books with same author', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '女生宿舍1', author: 'A' },
      { file_path: '/2', title: '女生宿舍2', author: 'A' },
      { file_path: '/3', title: '女生宿舍3', author: 'A' },
      { file_path: '/x', title: '三体', author: 'B' },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].series_name).toBe('女生宿舍');
    expect(groups[0].members).toHaveLength(3);
    expect(groups[0].members.map(m => m.sequence)).toEqual([1, 2, 3]);
  });

  it('groups 第N部 markers', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '遮天 第一部', author: '辰东' },
      { file_path: '/2', title: '遮天 第二部', author: '辰东' },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].series_name).toBe('遮天');
  });

  it('does NOT group books with different authors', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '女生宿舍1', author: 'A' },
      { file_path: '/2', title: '女生宿舍2', author: 'B' },
    ];
    expect(extractSeriesCandidates(books)).toHaveLength(0);
  });

  it('does NOT group single book', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '女生宿舍1', author: 'A' },
    ];
    expect(extractSeriesCandidates(books)).toHaveLength(0);
  });

  it('groups books with missing author by title only when both have no author', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '某书1', author: undefined },
      { file_path: '/2', title: '某书2', author: undefined },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/series-regex.test.ts`
Expected: FAIL — module not found

### Task 9: series-regex 实现

**Files:**
- Create: `backend/src/services/series-regex.ts`

- [ ] **Step 1: 实现**

Create `backend/src/services/series-regex.ts`:

```typescript
export interface ScannedBookForSeries {
  file_path: string;
  title: string;
  author?: string;
}

export interface SeriesCandidate {
  series_name: string;
  author?: string;
  members: Array<{ file_path: string; sequence: number; original_title: string }>;
}

/**
 * Match common series patterns and extract groups.
 * Returns groups with >=2 members sharing the same author + base title.
 */
export function extractSeriesCandidates(books: ScannedBookForSeries[]): SeriesCandidate[] {
  type ParseResult = { base: string; sequence: number } | null;
  const parsed: Array<{ book: ScannedBookForSeries; parsed: ParseResult }> = books.map(b => ({
    book: b,
    parsed: parseTitle(b.title),
  }));

  // Group by (author, base_title)
  const groups = new Map<string, Array<{ book: ScannedBookForSeries; sequence: number }>>();
  for (const { book, parsed: p } of parsed) {
    if (!p) continue;
    const key = `${book.author ?? ''}::${p.base}`;
    const arr = groups.get(key) ?? [];
    arr.push({ book, sequence: p.sequence });
    groups.set(key, arr);
  }

  const result: SeriesCandidate[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    // sort by sequence
    members.sort((a, b) => a.sequence - b.sequence);
    const [authorPart, base] = key.split('::');
    result.push({
      series_name: base,
      author: authorPart || undefined,
      members: members.map(m => ({
        file_path: m.book.file_path,
        sequence: m.sequence,
        original_title: m.book.title,
      })),
    });
  }
  return result;
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function parseTitle(title: string): { base: string; sequence: number } | null {
  const trimmed = title.trim();

  // Pattern 1: 第X部/集/册/卷 (allow leading whitespace)
  let m = trimmed.match(/^(.+?)\s*第\s*([零一二三四五六七八九十百千\d]+)\s*[部集册卷]\s*$/);
  if (m) {
    const seq = parseCnNumber(m[2]);
    if (seq > 0) return { base: m[1].trim(), sequence: seq };
  }

  // Pattern 2: 末尾数字 (e.g., 女生宿舍1, 女生宿舍 2, 女生宿舍－3)
  m = trimmed.match(/^(.+?)[\s\-_．.]*(\d+)\s*$/);
  if (m && m[1].length > 0) {
    return { base: m[1].trim(), sequence: parseInt(m[2], 10) };
  }

  // Pattern 3: 上中下
  if (/.+\s*上$/.test(trimmed)) {
    return { base: trimmed.replace(/\s*上$/, '').trim(), sequence: 1 };
  }
  if (/.+\s*中$/.test(trimmed)) {
    return { base: trimmed.replace(/\s*中$/, '').trim(), sequence: 2 };
  }
  if (/.+\s*下$/.test(trimmed)) {
    return { base: trimmed.replace(/\s*下$/, '').trim(), sequence: 3 };
  }

  return null;
}

function parseCnNumber(s: string): number {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  // Handle simple Chinese numerals (suffices for parts 1-99)
  if (s === '十') return 10;
  if (s.startsWith('十')) {
    const tail = s.slice(1);
    const tailN = CN_DIGITS[tail];
    return tailN !== undefined ? 10 + tailN : NaN;
  }
  if (s.endsWith('十')) {
    const head = s.slice(0, -1);
    const headN = CN_DIGITS[head];
    return headN !== undefined ? headN * 10 : NaN;
  }
  if (s.length === 1) return CN_DIGITS[s] ?? NaN;
  // 二十三 etc.
  const m = s.match(/^([零一二三四五六七八九])十([零一二三四五六七八九])?$/);
  if (m) {
    const tens = CN_DIGITS[m[1]];
    const ones = m[2] ? CN_DIGITS[m[2]] : 0;
    if (tens !== undefined && ones !== undefined) return tens * 10 + ones;
  }
  return NaN;
}
```

- [ ] **Step 2: 跑测试**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/series-regex.test.ts`
Expected: PASS — 5 tests pass

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/series-regex.ts backend/tests/services/series-regex.test.ts
git commit -m "feat(scan): add regex-based series candidate extraction"
```

---

## Phase E: 人工修正服务（任务 10）

### Task 10: manual-override service + 路由

**Files:**
- Create: `backend/src/services/manual-override.ts`
- Create: `backend/src/routes/manual-overrides.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: 创建 service**

Create `backend/src/services/manual-override.ts`:

```typescript
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import { ManualOverride, ManualOverrideType } from '../types';

export interface CreateOverrideInput {
  type: ManualOverrideType;
  book_id_a: string | null;
  book_id_b?: string | null;
  series_id?: string | null;
  created_by: string;
}

export function createOverride(input: CreateOverrideInput): ManualOverride {
  const id = uuidv4();
  getDb().prepare(
    `INSERT INTO manual_overrides (id, type, book_id_a, book_id_b, series_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.type, input.book_id_a, input.book_id_b ?? null, input.series_id ?? null, input.created_by);
  return getDb().prepare('SELECT * FROM manual_overrides WHERE id = ?').get(id) as ManualOverride;
}

export function listOverrides(type?: ManualOverrideType): ManualOverride[] {
  if (type) {
    return getDb().prepare('SELECT * FROM manual_overrides WHERE type = ? ORDER BY created_at DESC').all(type) as ManualOverride[];
  }
  return getDb().prepare('SELECT * FROM manual_overrides ORDER BY created_at DESC').all() as ManualOverride[];
}

export function deleteOverride(id: string): boolean {
  const r = getDb().prepare('DELETE FROM manual_overrides WHERE id = ?').run(id);
  return r.changes > 0;
}

export function deleteAllOverrides(): number {
  const r = getDb().prepare('DELETE FROM manual_overrides').run();
  return r.changes;
}

/**
 * Returns true if A and B are declared "not duplicate" by an admin override.
 */
export function isNotDuplicate(bookIdA: string, bookIdB: string): boolean {
  const row = getDb().prepare(
    `SELECT id FROM manual_overrides
     WHERE type = 'not_duplicate'
       AND ((book_id_a = ? AND book_id_b = ?) OR (book_id_a = ? AND book_id_b = ?))`
  ).get(bookIdA, bookIdB, bookIdB, bookIdA);
  return !!row;
}

export function isNotInSeries(bookId: string, seriesId: string): boolean {
  const row = getDb().prepare(
    "SELECT id FROM manual_overrides WHERE type = 'not_in_series' AND book_id_a = ? AND series_id = ?"
  ).get(bookId, seriesId);
  return !!row;
}
```

- [ ] **Step 2: 创建路由**

Create `backend/src/routes/manual-overrides.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import {
  createOverride,
  listOverrides,
  deleteOverride,
  deleteAllOverrides,
} from '../services/manual-override';
import { ManualOverrideType } from '../types';

const router = Router();

const createSchema = z.object({
  type: z.enum(['not_duplicate', 'not_in_series', 'forced_duplicate', 'forced_series_member']),
  book_id_a: z.string().nullable(),
  book_id_b: z.string().nullable().optional(),
  series_id: z.string().nullable().optional(),
});

router.get('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const type = req.query.type as ManualOverrideType | undefined;
  successResponse(res, listOverrides(type));
});

router.post('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败');
    return;
  }
  const ov = createOverride({ ...parsed.data, created_by: req.user!.userId });
  successResponse(res, ov, '已记录人工修正');
});

router.delete('/all', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  const n = deleteAllOverrides();
  successResponse(res, { deleted: n }, '已清空所有人工修正');
});

router.delete('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const ok = deleteOverride(req.params.id);
  if (!ok) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '不存在');
    return;
  }
  successResponse(res, null, '已删除');
});

export default router;
```

- [ ] **Step 3: 挂载到 index.ts**

修改 `backend/src/index.ts`，在 routes 段添加：

```typescript
import manualOverridesRoutes from './routes/manual-overrides';
// ...
app.use('/api/library/manual-overrides', manualOverridesRoutes);
```

注意：放在 `app.use('/api/library', libraryRoutes)` **之前**，否则 Express 路由匹配可能优先到 libraryRoutes 的 `/:id`。

- [ ] **Step 4: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/manual-override.ts backend/src/routes/manual-overrides.ts backend/src/index.ts
git commit -m "feat(scan): add manual-override service and routes"
```

---

## Phase F: 批次构建与应用（任务 11-13）

### Task 11: batch-builder 测试

**Files:**
- Create: `backend/tests/services/batch-builder.test.ts`

- [ ] **Step 1: 写测试**

Create `backend/tests/services/batch-builder.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { buildBatchFromScan, ScanResult } from '../../src/services/batch-builder';

let db: Database.Database;
const TEST_DB = path.join(__dirname, '__test-batch-builder.db');

function setup(): void {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  db = new Database(TEST_DB);
  db.exec(`
    CREATE TABLE scan_batches (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', summary_counts TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, applied_at DATETIME, applied_by TEXT);
    CREATE TABLE scan_batch_items (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, admin_decision TEXT, admin_payload TEXT, reviewed_at DATETIME, reviewed_by TEXT);
    CREATE TABLE manual_overrides (id TEXT PRIMARY KEY, type TEXT NOT NULL, book_id_a TEXT, book_id_b TEXT, series_id TEXT, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  `);
}

afterEach(() => {
  db?.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

beforeEach(() => {
  setup();
});

describe('buildBatchFromScan', () => {
  it('creates a batch with items for new books, duplicate groups, series, garbled', () => {
    const taskId = uuidv4();
    const scan: ScanResult = {
      new_books: [
        { file_path: '/a', title: '三体', file_format: 'txt', file_size: 100, fingerprint: 'f1', status: 'normal' },
      ],
      hard_duplicate_groups: [
        {
          canonical_file_path: '/x',
          members: [
            { file_path: '/x', fingerprint: 'same', decision_type: 'hard' },
            { file_path: '/y', fingerprint: 'same', decision_type: 'hard' },
          ],
        },
      ],
      ai_duplicate_groups: [],
      series_groups: [
        {
          series_name: '女生宿舍',
          author: 'X',
          members: [{ file_path: '/s1', sequence: 1 }, { file_path: '/s2', sequence: 2 }],
          source: 'regex',
        },
      ],
      garbled: [{ file_path: '/g', reason: 'random bytes' }],
      encoding_fixed: [{ file_path: '/e', from_encoding: 'gbk', to_encoding: 'utf-8' }],
    };

    const batch = buildBatchFromScan(taskId, scan, db);

    expect(batch.id).toBeTruthy();
    expect(batch.status).toBe('pending');

    const items = db.prepare('SELECT type, payload FROM scan_batch_items WHERE batch_id = ?').all(batch.id) as Array<{ type: string; payload: string }>;
    const typeCounts: Record<string, number> = {};
    for (const it of items) typeCounts[it.type] = (typeCounts[it.type] ?? 0) + 1;
    expect(typeCounts['new']).toBe(1);
    expect(typeCounts['duplicate_group']).toBe(1);
    expect(typeCounts['series']).toBe(1);
    expect(typeCounts['garbled']).toBe(1);
    expect(typeCounts['encoding_fixed']).toBe(1);

    const summary = JSON.parse(batch.summary_counts) as Record<string, number>;
    expect(summary.new).toBe(1);
    expect(summary.duplicate_groups).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/batch-builder.test.ts`
Expected: FAIL — module not found

### Task 12: batch-builder 实现 + 给 manual-override 加 _setDbForTesting

**Files:**
- Create: `backend/src/services/batch-builder.ts`
- Modify: `backend/src/services/manual-override.ts`

- [ ] **Step 1: 给 manual-override service 加 _setDbForTesting hook**

修改 `backend/src/services/manual-override.ts`，把 `getDb()` 调用全部改为通过本地 db 函数：

在文件顶部 import 后添加：

```typescript
import Database from 'better-sqlite3';

let dbOverride: Database.Database | null = null;
export function _setDbForTesting(db: Database.Database | null): void {
  dbOverride = db;
}
function db(): Database.Database {
  return dbOverride ?? getDb();
}
```

把所有 `getDb()` 替换为 `db()`。

- [ ] **Step 2: 实现 batch-builder**

Create `backend/src/services/batch-builder.ts`:

```typescript
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import {
  ScanBatch,
  NewBookPayload,
  DuplicateGroupPayload,
  SeriesGroupPayload,
  GarbledPayload,
  EncodingFixedPayload,
} from '../types';

export interface ScanResult {
  new_books: NewBookPayload[];
  hard_duplicate_groups: DuplicateGroupPayload[];
  ai_duplicate_groups: DuplicateGroupPayload[];
  series_groups: SeriesGroupPayload[];
  garbled: GarbledPayload[];
  encoding_fixed: EncodingFixedPayload[];
}

/**
 * Persist a ScanResult as a scan_batch + items rows.
 * Caller may pass a custom DB (for tests); production should use getDb().
 */
export function buildBatchFromScan(
  taskId: string,
  scan: ScanResult,
  customDb?: Database.Database,
): ScanBatch {
  const database = customDb ?? getDb();
  const batchId = uuidv4();
  const summary = {
    new: scan.new_books.length,
    duplicate_groups: scan.hard_duplicate_groups.length + scan.ai_duplicate_groups.length,
    series: scan.series_groups.length,
    garbled: scan.garbled.length,
    encoding_fixed: scan.encoding_fixed.length,
  };
  database.prepare(
    `INSERT INTO scan_batches (id, task_id, status, summary_counts) VALUES (?, ?, 'pending', ?)`
  ).run(batchId, taskId, JSON.stringify(summary));

  const insert = database.prepare(
    `INSERT INTO scan_batch_items (id, batch_id, type, payload) VALUES (?, ?, ?, ?)`
  );

  const txn = database.transaction(() => {
    for (const nb of scan.new_books) {
      insert.run(uuidv4(), batchId, 'new', JSON.stringify(nb));
    }
    for (const dg of [...scan.hard_duplicate_groups, ...scan.ai_duplicate_groups]) {
      insert.run(uuidv4(), batchId, 'duplicate_group', JSON.stringify(dg));
    }
    for (const sg of scan.series_groups) {
      insert.run(uuidv4(), batchId, 'series', JSON.stringify(sg));
    }
    for (const g of scan.garbled) {
      insert.run(uuidv4(), batchId, 'garbled', JSON.stringify(g));
    }
    for (const e of scan.encoding_fixed) {
      insert.run(uuidv4(), batchId, 'encoding_fixed', JSON.stringify(e));
    }
  });
  txn();

  return database.prepare('SELECT * FROM scan_batches WHERE id = ?').get(batchId) as ScanBatch;
}
```

- [ ] **Step 3: 跑测试**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/batch-builder.test.ts`
Expected: PASS — 1 test passes

- [ ] **Step 4: 跑全部测试确认其他没坏**

Run: `cd ~/projects/easy-Reader/backend && npx jest`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/batch-builder.ts backend/src/services/manual-override.ts backend/tests/services/batch-builder.test.ts
git commit -m "feat(scan): add batch builder for staging scan results"
```

### Task 13: batch-applier 实现（应用批次到 books）

**Files:**
- Create: `backend/src/services/batch-applier.ts`
- Create: `backend/tests/services/batch-applier.test.ts`

- [ ] **Step 1: 写测试**

Create `backend/tests/services/batch-applier.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { applyBatch } from '../../src/services/batch-applier';
import { _setDbForTesting } from '../../src/services/manual-override';

let db: Database.Database;
const TEST_DB = path.join(__dirname, '__test-batch-applier.db');

function setup(): void {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  db = new Database(TEST_DB);
  db.exec(`
    CREATE TABLE books (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, file_path TEXT NOT NULL,
      file_format TEXT NOT NULL, file_size INTEGER, status TEXT DEFAULT 'normal',
      duplicate_of TEXT, series_id TEXT, chapter_count INTEGER, fingerprint TEXT,
      first_chapter_hash TEXT, encoding_detected TEXT, manually_edited_fields TEXT,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_finished INTEGER DEFAULT 0
    );
    CREATE TABLE series (id TEXT PRIMARY KEY, name TEXT NOT NULL, summary TEXT, cover_url TEXT, author TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE scan_batches (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', summary_counts TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, applied_at DATETIME, applied_by TEXT);
    CREATE TABLE scan_batch_items (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, admin_decision TEXT, admin_payload TEXT, reviewed_at DATETIME, reviewed_by TEXT);
    CREATE TABLE manual_overrides (id TEXT PRIMARY KEY, type TEXT NOT NULL, book_id_a TEXT, book_id_b TEXT, series_id TEXT, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  `);
  _setDbForTesting(db);
}

beforeEach(setup);
afterEach(() => {
  db?.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

function makeBatch(items: Array<{ type: string; payload: any }>): string {
  const batchId = uuidv4();
  db.prepare(`INSERT INTO scan_batches (id, task_id, status) VALUES (?, ?, 'pending')`).run(batchId, uuidv4());
  const ins = db.prepare(`INSERT INTO scan_batch_items (id, batch_id, type, payload) VALUES (?, ?, ?, ?)`);
  for (const it of items) ins.run(uuidv4(), batchId, it.type, JSON.stringify(it.payload));
  return batchId;
}

describe('applyBatch', () => {
  it('inserts new books', () => {
    const batchId = makeBatch([
      { type: 'new', payload: { file_path: '/a', title: '三体', file_format: 'txt', file_size: 100, fingerprint: 'f1', status: 'normal' } },
    ]);
    const result = applyBatch(batchId, 'admin1', db);
    expect(result.inserted).toBe(1);
    const row = db.prepare('SELECT * FROM books WHERE file_path = ?').get('/a') as any;
    expect(row.title).toBe('三体');
    expect(row.fingerprint).toBe('f1');
  });

  it('inserts canonical + duplicate books with duplicate_of link', () => {
    const batchId = makeBatch([
      {
        type: 'duplicate_group',
        payload: {
          canonical_file_path: '/x',
          members: [
            { file_path: '/x', fingerprint: 'f' },
            { file_path: '/y', fingerprint: 'f' },
          ],
        },
      },
    ]);
    applyBatch(batchId, 'admin1', db);
    const canonical = db.prepare("SELECT * FROM books WHERE file_path = '/x'").get() as any;
    const dup = db.prepare("SELECT * FROM books WHERE file_path = '/y'").get() as any;
    expect(canonical.status).toBe('normal');
    expect(canonical.duplicate_of).toBeNull();
    expect(dup.status).toBe('duplicate');
    expect(dup.duplicate_of).toBe(canonical.id);
  });

  it('creates series and assigns series_id to members', () => {
    // Need books to exist first; add them via 'new' items in same batch
    const batchId = makeBatch([
      { type: 'new', payload: { file_path: '/s1', title: '女生宿舍1', file_format: 'txt', file_size: 100, fingerprint: 'fs1', status: 'normal' } },
      { type: 'new', payload: { file_path: '/s2', title: '女生宿舍2', file_format: 'txt', file_size: 100, fingerprint: 'fs2', status: 'normal' } },
      {
        type: 'series',
        payload: {
          series_name: '女生宿舍',
          author: 'X',
          members: [{ file_path: '/s1', sequence: 1 }, { file_path: '/s2', sequence: 2 }],
          source: 'regex',
        },
      },
    ]);
    applyBatch(batchId, 'admin1', db);
    const series = db.prepare("SELECT * FROM series WHERE name = '女生宿舍'").get() as any;
    expect(series).toBeTruthy();
    const s1 = db.prepare("SELECT * FROM books WHERE file_path = '/s1'").get() as any;
    expect(s1.series_id).toBe(series.id);
  });

  it('marks garbled books with status', () => {
    const batchId = makeBatch([
      { type: 'new', payload: { file_path: '/g', title: '乱码书', file_format: 'txt', file_size: 100, fingerprint: 'fg', status: 'normal' } },
      { type: 'garbled', payload: { file_path: '/g', reason: 'random bytes' } },
    ]);
    applyBatch(batchId, 'admin1', db);
    const row = db.prepare("SELECT * FROM books WHERE file_path = '/g'").get() as any;
    expect(row.status).toBe('garbled');
  });

  it('marks batch as applied and sets applied_by', () => {
    const batchId = makeBatch([
      { type: 'new', payload: { file_path: '/a', title: 'x', file_format: 'txt', file_size: 1, status: 'normal' } },
    ]);
    applyBatch(batchId, 'admin1', db);
    const batch = db.prepare('SELECT * FROM scan_batches WHERE id = ?').get(batchId) as any;
    expect(batch.status).toBe('applied');
    expect(batch.applied_by).toBe('admin1');
    expect(batch.applied_at).toBeTruthy();
  });

  it('records manual_overrides for rejected duplicate members', () => {
    const batchId = makeBatch([
      {
        type: 'duplicate_group',
        payload: {
          canonical_file_path: '/x',
          members: [
            { file_path: '/x', fingerprint: 'fx' },
            { file_path: '/y', fingerprint: 'fy' },
          ],
        },
      },
    ]);
    // Mark this item as rejected with payload listing /y as not_duplicate
    db.prepare(
      `UPDATE scan_batch_items SET admin_decision = 'modified', admin_payload = ? WHERE batch_id = ?`
    ).run(JSON.stringify({
      canonical_file_path: '/x',
      members: [{ file_path: '/x', fingerprint: 'fx' }],
      rejected_members: [{ file_path: '/y', fingerprint: 'fy' }],
    }), batchId);
    applyBatch(batchId, 'admin1', db);
    // /y should be inserted as normal (not duplicate)
    const y = db.prepare("SELECT * FROM books WHERE file_path = '/y'").get() as any;
    expect(y.status).toBe('normal');
    expect(y.duplicate_of).toBeNull();
    // manual_overrides should have a not_duplicate record
    const ov = db.prepare("SELECT * FROM manual_overrides WHERE type = 'not_duplicate'").get();
    expect(ov).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/batch-applier.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 batch-applier**

Create `backend/src/services/batch-applier.ts`:

```typescript
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { getDb } from '../db';
import {
  NewBookPayload,
  DuplicateGroupPayload,
  SeriesGroupPayload,
  GarbledPayload,
} from '../types';
import { createOverride } from './manual-override';

export interface ApplyResult {
  inserted: number;
  updated: number;
  duplicates_linked: number;
  series_created: number;
  garbled_marked: number;
  errors: Array<{ item_id: string; message: string }>;
}

/**
 * Apply a pending scan_batch to books / series tables.
 *
 * For each item:
 *  - 'new': INSERT new book
 *  - 'duplicate_group': INSERT canonical (if not exists) + each duplicate member,
 *      set duplicate_of on duplicates. Honor admin's rejected_members → mark as
 *      normal book + record manual_overrides 'not_duplicate'.
 *  - 'series': CREATE series row + UPDATE member books with series_id
 *  - 'garbled': UPDATE matching book.status = 'garbled' (book must already exist
 *      via a 'new' item in same batch or earlier)
 *  - 'encoding_fixed': UPDATE matching book.status = 'encoding_fixed'
 *
 * Returns aggregated counts. All work in a transaction.
 */
export function applyBatch(
  batchId: string,
  appliedBy: string,
  customDb?: Database.Database,
): ApplyResult {
  const db = customDb ?? getDb();
  const batch = db.prepare("SELECT * FROM scan_batches WHERE id = ? AND status = 'pending'").get(batchId) as
    | { id: string }
    | undefined;
  if (!batch) throw new Error(`Batch ${batchId} not found or not pending`);

  const items = db.prepare(
    'SELECT id, type, payload, admin_decision, admin_payload FROM scan_batch_items WHERE batch_id = ? ORDER BY type'
  ).all(batchId) as Array<{
    id: string;
    type: string;
    payload: string;
    admin_decision: string | null;
    admin_payload: string | null;
  }>;

  const result: ApplyResult = {
    inserted: 0,
    updated: 0,
    duplicates_linked: 0,
    series_created: 0,
    garbled_marked: 0,
    errors: [],
  };

  // Helper to find or insert book by file_path. Returns book id.
  function upsertBookByPath(payload: NewBookPayload): string {
    const existing = db.prepare('SELECT id FROM books WHERE file_path = ?').get(payload.file_path) as
      | { id: string }
      | undefined;
    if (existing) {
      db.prepare(
        `UPDATE books SET title = ?, fingerprint = ?, first_chapter_hash = ?, chapter_count = ?, encoding_detected = ?, status = ?, file_size = ? WHERE id = ?`
      ).run(
        payload.title,
        payload.fingerprint ?? null,
        payload.first_chapter_hash ?? null,
        payload.chapter_count ?? null,
        payload.encoding_detected ?? null,
        payload.status ?? 'normal',
        payload.file_size,
        existing.id,
      );
      result.updated++;
      return existing.id;
    }
    const id = uuidv4();
    db.prepare(
      `INSERT INTO books (id, title, file_path, file_format, file_size, status, fingerprint, first_chapter_hash, chapter_count, encoding_detected)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    );
    result.inserted++;
    return id;
  }

  const tx = db.transaction(() => {
    // Phase 1: 'new' items (so subsequent series/duplicate refs can resolve by file_path)
    for (const it of items) {
      if (it.type !== 'new') continue;
      if (it.admin_decision === 'reject') continue;
      try {
        const payload = JSON.parse(it.admin_payload ?? it.payload) as NewBookPayload;
        upsertBookByPath(payload);
      } catch (e) {
        result.errors.push({ item_id: it.id, message: (e as Error).message });
      }
    }

    // Phase 2: duplicate_group
    for (const it of items) {
      if (it.type !== 'duplicate_group') continue;
      if (it.admin_decision === 'reject') continue;
      try {
        const payload = JSON.parse(it.admin_payload ?? it.payload) as DuplicateGroupPayload & {
          rejected_members?: Array<{ file_path: string; fingerprint?: string }>;
        };

        // Ensure canonical exists
        const canonical = payload.members.find(m => m.file_path === payload.canonical_file_path);
        if (!canonical) {
          result.errors.push({ item_id: it.id, message: 'canonical member not found in members' });
          continue;
        }
        const canonicalRow = db.prepare('SELECT id FROM books WHERE file_path = ?').get(canonical.file_path) as
          | { id: string }
          | undefined;
        if (!canonicalRow) {
          // Auto-create from path basename
          const title = path.basename(canonical.file_path).replace(/\.[^.]+$/, '');
          const id = uuidv4();
          db.prepare(
            `INSERT INTO books (id, title, file_path, file_format, file_size, fingerprint, status)
             VALUES (?, ?, ?, ?, 0, ?, 'normal')`
          ).run(id, title, canonical.file_path, path.extname(canonical.file_path).slice(1).toLowerCase(), canonical.fingerprint ?? null);
          result.inserted++;
        }
        const canonicalId = (db.prepare('SELECT id FROM books WHERE file_path = ?').get(canonical.file_path) as { id: string }).id;
        // Clear duplicate_of on canonical (in case it was set previously)
        db.prepare("UPDATE books SET duplicate_of = NULL, status = 'normal' WHERE id = ?").run(canonicalId);

        for (const m of payload.members) {
          if (m.file_path === canonical.file_path) continue;
          const memRow = db.prepare('SELECT id FROM books WHERE file_path = ?').get(m.file_path) as
            | { id: string }
            | undefined;
          let memId: string;
          if (memRow) {
            memId = memRow.id;
          } else {
            memId = uuidv4();
            const title = path.basename(m.file_path).replace(/\.[^.]+$/, '');
            db.prepare(
              `INSERT INTO books (id, title, file_path, file_format, file_size, fingerprint)
               VALUES (?, ?, ?, ?, 0, ?)`
            ).run(memId, title, m.file_path, path.extname(m.file_path).slice(1).toLowerCase(), m.fingerprint ?? null);
            result.inserted++;
          }
          db.prepare("UPDATE books SET status = 'duplicate', duplicate_of = ? WHERE id = ?").run(canonicalId, memId);
          result.duplicates_linked++;
        }

        // Handle admin-rejected members → record manual_overrides
        if (payload.rejected_members) {
          for (const rm of payload.rejected_members) {
            const rmRow = db.prepare('SELECT id FROM books WHERE file_path = ?').get(rm.file_path) as
              | { id: string }
              | undefined;
            let rmId: string;
            if (rmRow) {
              rmId = rmRow.id;
            } else {
              rmId = uuidv4();
              const title = path.basename(rm.file_path).replace(/\.[^.]+$/, '');
              db.prepare(
                `INSERT INTO books (id, title, file_path, file_format, file_size, fingerprint, status)
                 VALUES (?, ?, ?, ?, 0, ?, 'normal')`
              ).run(rmId, title, rm.file_path, path.extname(rm.file_path).slice(1).toLowerCase(), rm.fingerprint ?? null);
              result.inserted++;
            }
            // Ensure status is normal
            db.prepare("UPDATE books SET status = 'normal', duplicate_of = NULL WHERE id = ?").run(rmId);
            // Record manual override
            createOverride({
              type: 'not_duplicate',
              book_id_a: canonicalId,
              book_id_b: rmId,
              created_by: appliedBy,
            });
          }
        }
      } catch (e) {
        result.errors.push({ item_id: it.id, message: (e as Error).message });
      }
    }

    // Phase 3: series
    for (const it of items) {
      if (it.type !== 'series') continue;
      if (it.admin_decision === 'reject') continue;
      try {
        const payload = JSON.parse(it.admin_payload ?? it.payload) as SeriesGroupPayload & {
          rejected_members?: string[];   // file_paths to drop from series
        };
        const seriesId = uuidv4();
        db.prepare(
          `INSERT INTO series (id, name, author) VALUES (?, ?, ?)`
        ).run(seriesId, payload.series_name, payload.author ?? null);
        result.series_created++;

        const rejectedSet = new Set(payload.rejected_members ?? []);
        for (const m of payload.members) {
          if (rejectedSet.has(m.file_path)) continue;
          const row = db.prepare('SELECT id FROM books WHERE file_path = ?').get(m.file_path) as
            | { id: string }
            | undefined;
          if (row) {
            db.prepare('UPDATE books SET series_id = ? WHERE id = ?').run(seriesId, row.id);
          }
        }

        // Rejected members → manual_overrides
        for (const fp of rejectedSet) {
          const row = db.prepare('SELECT id FROM books WHERE file_path = ?').get(fp) as
            | { id: string }
            | undefined;
          if (row) {
            createOverride({
              type: 'not_in_series',
              book_id_a: row.id,
              series_id: seriesId,
              created_by: appliedBy,
            });
          }
        }
      } catch (e) {
        result.errors.push({ item_id: it.id, message: (e as Error).message });
      }
    }

    // Phase 4: garbled / encoding_fixed
    for (const it of items) {
      if (it.type !== 'garbled' && it.type !== 'encoding_fixed') continue;
      if (it.admin_decision === 'reject') continue;
      try {
        const payload = JSON.parse(it.admin_payload ?? it.payload) as { file_path: string };
        const newStatus = it.type === 'garbled' ? 'garbled' : 'encoding_fixed';
        const r = db.prepare('UPDATE books SET status = ? WHERE file_path = ?').run(newStatus, payload.file_path);
        if (r.changes > 0 && it.type === 'garbled') result.garbled_marked++;
      } catch (e) {
        result.errors.push({ item_id: it.id, message: (e as Error).message });
      }
    }

    // Mark batch applied
    db.prepare(
      "UPDATE scan_batches SET status = 'applied', applied_at = CURRENT_TIMESTAMP, applied_by = ? WHERE id = ?"
    ).run(appliedBy, batchId);
  });
  tx();

  return result;
}
```

- [ ] **Step 4: 跑测试**

Run: `cd ~/projects/easy-Reader/backend && npx jest tests/services/batch-applier.test.ts`
Expected: PASS — 6 tests pass

- [ ] **Step 5: 全测**

Run: `cd ~/projects/easy-Reader/backend && npx jest`
Expected: ALL PASS

- [ ] **Step 6: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/batch-applier.ts backend/tests/services/batch-applier.test.ts
git commit -m "feat(scan): add batch applier to commit pending scan_batch to books table"
```

---

## Phase G: AI 服务（任务 14-15）

### Task 14: ai-dedup service

**Files:**
- Create: `backend/src/services/ai-dedup.ts`

注意：本任务 **不写自动化测试**（涉及真实 AI 调用），靠 E2E 验证。

- [ ] **Step 1: 创建**

Create `backend/src/services/ai-dedup.ts`:

```typescript
import { getDb } from '../db';
import { aiManager, AiDedupCandidate } from '../ai/ai-manager';
import { ScannedBook } from './dedup-grouper';
import { DuplicateGroupPayload } from '../types';
import { isNotDuplicate } from './manual-override';

/**
 * For each soft-candidate group, call AI to judge real duplicates.
 * Returns final DuplicateGroupPayloads (one per AI-confirmed duplicate cluster).
 * Soft candidates not flagged as duplicates by AI are NOT returned (they'll be
 * treated as separate "new" books by the caller).
 */
export async function judgeSoftDuplicateGroups(
  softGroups: ScannedBook[][],
  bookIdResolver?: (file_path: string) => string | null,
): Promise<DuplicateGroupPayload[]> {
  const db = getDb();
  const out: DuplicateGroupPayload[] = [];

  for (const group of softGroups) {
    if (group.length < 2) continue;

    // Filter via manual_overrides (skip pairs marked not_duplicate)
    // We do a best-effort filter: if any two members in the group are declared
    // not-duplicate, we still call AI but exclude any pair from the final result.
    // For simplicity here we just call AI on all and post-filter.

    const candidates: AiDedupCandidate[] = group.map((b, i) => ({
      index: i,
      title: b.title,
      author: b.author,
      chapter_count: b.chapter_count,
      first_chapter_preview: b.first_chapter_preview ?? '',
    }));

    let aiResult;
    try {
      aiResult = await aiManager.judgeDuplicates(candidates, db);
    } catch (err) {
      console.error('AI dedup error, skipping group:', err);
      continue;
    }

    for (const aiGroup of aiResult.groups) {
      const canonical = group[aiGroup.canonical_index];
      const dups = aiGroup.duplicate_indices.map(i => group[i]);

      // manual_overrides filter
      if (bookIdResolver) {
        const canonicalId = bookIdResolver(canonical.file_path);
        const filtered = dups.filter(d => {
          const dupId = bookIdResolver(d.file_path);
          if (!canonicalId || !dupId) return true;
          return !isNotDuplicate(canonicalId, dupId);
        });
        if (filtered.length === 0) continue;
        out.push({
          canonical_file_path: canonical.file_path,
          members: [
            { file_path: canonical.file_path, fingerprint: canonical.fingerprint ?? '', decision_type: 'ai' },
            ...filtered.map(d => ({ file_path: d.file_path, fingerprint: d.fingerprint ?? '', decision_type: 'ai' as const })),
          ],
        });
      } else {
        out.push({
          canonical_file_path: canonical.file_path,
          members: [
            { file_path: canonical.file_path, fingerprint: canonical.fingerprint ?? '', decision_type: 'ai' },
            ...dups.map(d => ({ file_path: d.file_path, fingerprint: d.fingerprint ?? '', decision_type: 'ai' as const })),
          ],
        });
      }
    }
  }

  return out;
}
```

- [ ] **Step 2: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/ai-dedup.ts
git commit -m "feat(scan): add ai-dedup service for soft duplicate candidates"
```

### Task 15: ai-series service

**Files:**
- Create: `backend/src/services/ai-series.ts`

- [ ] **Step 1: 创建**

Create `backend/src/services/ai-series.ts`:

```typescript
import { getDb } from '../db';
import { aiManager, AiSeriesCandidate } from '../ai/ai-manager';
import { ScannedBook } from './dedup-grouper';
import { SeriesGroupPayload } from '../types';
import { levenshtein } from '../utils/title-normalizer';

const FUZZY_THRESHOLD = 3;

/**
 * For books not already grouped by regex, compute fuzzy candidates
 * (same author + Levenshtein distance < threshold) and ask AI to confirm series.
 */
export async function judgeFuzzySeriesGroups(
  books: ScannedBook[],
  alreadyGroupedPaths: Set<string>,
): Promise<SeriesGroupPayload[]> {
  const db = getDb();

  // Cluster by author
  const byAuthor = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (alreadyGroupedPaths.has(b.file_path)) continue;
    const author = b.author ?? '';
    if (!author) continue; // skip authorless for fuzzy
    const arr = byAuthor.get(author) ?? [];
    arr.push(b);
    byAuthor.set(author, arr);
  }

  const fuzzyGroups: ScannedBook[][] = [];
  for (const [, members] of byAuthor) {
    if (members.length < 2) continue;
    // Within author, cluster by pairwise distance
    const used = new Set<number>();
    for (let i = 0; i < members.length; i++) {
      if (used.has(i)) continue;
      const group = [members[i]];
      used.add(i);
      for (let j = i + 1; j < members.length; j++) {
        if (used.has(j)) continue;
        if (levenshtein(members[i].title, members[j].title) < FUZZY_THRESHOLD) {
          group.push(members[j]);
          used.add(j);
        }
      }
      if (group.length >= 2) fuzzyGroups.push(group);
    }
  }

  const out: SeriesGroupPayload[] = [];
  for (const group of fuzzyGroups) {
    const candidates: AiSeriesCandidate[] = group.map((b, i) => ({
      index: i,
      title: b.title,
      author: b.author,
    }));
    let aiResult;
    try {
      aiResult = await aiManager.judgeSeries(candidates, db);
    } catch (err) {
      console.error('AI series error, skipping group:', err);
      continue;
    }
    if (!aiResult.is_series || !aiResult.members || !aiResult.series_name) continue;
    if ((aiResult.confidence ?? 'medium') === 'low') continue; // drop low-confidence

    out.push({
      series_name: aiResult.series_name,
      author: group[0].author,
      members: aiResult.members.map(m => ({
        file_path: group[m.index].file_path,
        sequence: m.sequence,
      })),
      source: 'ai',
      confidence: aiResult.confidence,
    });
  }
  return out;
}
```

- [ ] **Step 2: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/ai-series.ts
git commit -m "feat(scan): add ai-series service for fuzzy series candidates"
```

---

## Phase H: 改造扫描主循环（任务 16）

### Task 16: 重写 scan-walker.ts 以支持 review/auto/hybrid 模式

**Files:**
- Modify: `backend/src/services/scan-walker.ts`

- [ ] **Step 1: 完整重写文件**

将 `backend/src/services/scan-walker.ts` 整个内容替换为：

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
import { ScanOptions, NewBookPayload, EncodingFixedPayload, GarbledPayload } from '../types';
import { buildCandidateGroups, ScannedBook } from './dedup-grouper';
import { extractSeriesCandidates } from './series-regex';
import { judgeSoftDuplicateGroups } from './ai-dedup';
import { judgeFuzzySeriesGroups } from './ai-series';
import { buildBatchFromScan, ScanResult } from './batch-builder';

const SUPPORTED_FORMATS = ['txt', 'pdf', 'epub'];
const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';

export async function runScanTask(taskId: string, options: ScanOptions): Promise<void> {
  try {
    if (!fs.existsSync(BOOKS_DIR)) {
      finishScanTask(taskId, 'completed');
      return;
    }

    setScanProgress(taskId, { stage: 'walking' });
    const allFiles = collectFiles(BOOKS_DIR);
    setScanProgress(taskId, { total_files: allFiles.length, processed_files: 0 });

    // Phase 1: per-file processing (encoding + fingerprint)
    setScanProgress(taskId, { stage: 'fingerprinting' });
    const scanned: ScannedBookEx[] = [];
    const garbled: GarbledPayload[] = [];
    const encodingFixed: EncodingFixedPayload[] = [];
    let processed = 0;

    for (const fullPath of allFiles) {
      if (isCancelled(taskId)) return;
      const result = await processFile(fullPath, options);
      if (result.scanned) scanned.push(result.scanned);
      if (result.garbled) garbled.push(result.garbled);
      if (result.encoding_fixed) encodingFixed.push(result.encoding_fixed);
      processed++;
      if (processed % 5 === 0 || processed === allFiles.length) {
        setScanProgress(taskId, { processed_files: processed });
      }
    }

    if (isCancelled(taskId)) {
      // Still try to stage partial results if we have any
      const partial: ScanResult = {
        new_books: scanned.map(toNewPayload),
        hard_duplicate_groups: [],
        ai_duplicate_groups: [],
        series_groups: [],
        garbled,
        encoding_fixed: encodingFixed,
      };
      buildBatchFromScan(taskId, partial);
      return;
    }

    // Phase 2: dedup grouping
    setScanProgress(taskId, { stage: 'staging' });
    const { hard_groups, soft_groups } = buildCandidateGroups(scanned);

    // Phase 3: AI dedup judge (only soft groups, only if enabled)
    let aiDupGroups = [];
    if (options.ai_dedup && soft_groups.length > 0) {
      aiDupGroups = await judgeSoftDuplicateGroups(soft_groups);
    }

    // Hard groups always become duplicate_groups
    const hardDupPayloads = hard_groups.map(group => ({
      canonical_file_path: pickCanonical(group).file_path,
      members: group.map(b => ({
        file_path: b.file_path,
        fingerprint: b.fingerprint ?? '',
        decision_type: 'hard' as const,
      })),
    }));

    // Phase 4: series — regex first
    const regexSeriesCandidates = extractSeriesCandidates(scanned);
    const regexSeriesPayloads = regexSeriesCandidates.map(s => ({
      series_name: s.series_name,
      author: s.author,
      members: s.members.map(m => ({ file_path: m.file_path, sequence: m.sequence })),
      source: 'regex' as const,
    }));

    // Phase 5: AI series — fuzzy candidates not already in regex
    const regexPaths = new Set(regexSeriesCandidates.flatMap(s => s.members.map(m => m.file_path)));
    let aiSeriesPayloads = [];
    if (options.ai_series) {
      aiSeriesPayloads = await judgeFuzzySeriesGroups(scanned, regexPaths);
    }

    // Phase 6: assemble result
    const result: ScanResult = {
      new_books: scanned.map(toNewPayload),
      hard_duplicate_groups: hardDupPayloads,
      ai_duplicate_groups: aiDupGroups,
      series_groups: [...regexSeriesPayloads, ...aiSeriesPayloads],
      garbled,
      encoding_fixed: encodingFixed,
    };

    // Phase 7: dispatch by mode
    if (options.mode === 'auto') {
      // Apply immediately: build batch then apply
      const batch = buildBatchFromScan(taskId, result);
      const { applyBatch } = await import('./batch-applier');
      applyBatch(batch.id, 'system-auto');
    } else if (options.mode === 'hybrid') {
      // Hard duplicates + new books + encoding_fixed go straight to books;
      // AI duplicates + series stay in batch for review
      const auto: ScanResult = {
        new_books: result.new_books,
        hard_duplicate_groups: result.hard_duplicate_groups,
        ai_duplicate_groups: [],
        series_groups: [],
        garbled: result.garbled,
        encoding_fixed: result.encoding_fixed,
      };
      const review: ScanResult = {
        new_books: [],
        hard_duplicate_groups: [],
        ai_duplicate_groups: result.ai_duplicate_groups,
        series_groups: result.series_groups,
        garbled: [],
        encoding_fixed: [],
      };
      const autoBatch = buildBatchFromScan(taskId, auto);
      const { applyBatch } = await import('./batch-applier');
      applyBatch(autoBatch.id, 'system-hybrid-auto');
      if (review.ai_duplicate_groups.length > 0 || review.series_groups.length > 0) {
        buildBatchFromScan(taskId, review);
      }
    } else {
      // mode === 'review'
      buildBatchFromScan(taskId, result);
    }

    finishScanTask(taskId, 'completed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishScanTask(taskId, 'failed', msg);
    console.error('Scan task failed:', err);
  }
}

interface ScannedBookEx extends ScannedBook {
  file_format: string;
  file_size: number;
  encoding_detected: string;
  status: 'normal' | 'encoding_fixed';
}

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
  };
}

function pickCanonical(group: ScannedBook[]): ScannedBook {
  // Prefer the one with most chapters; tiebreak by shortest path (closer to root)
  return [...group].sort((a, b) => {
    const cca = a.chapter_count ?? 0;
    const ccb = b.chapter_count ?? 0;
    if (ccb !== cca) return ccb - cca;
    return a.file_path.length - b.file_path.length;
  })[0];
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

async function processFile(
  fullPath: string,
  options: ScanOptions,
): Promise<{
  scanned?: ScannedBookEx;
  garbled?: GarbledPayload;
  encoding_fixed?: EncodingFixedPayload;
}> {
  const db = getDb();
  const ext = path.extname(fullPath).slice(1).toLowerCase();
  const existing = db.prepare('SELECT * FROM books WHERE file_path = ?').get(fullPath) as
    | { id: string; fingerprint?: string; status?: string }
    | undefined;

  // Skip if already present with fingerprint AND not full_rescan
  if (existing && existing.fingerprint && !options.full_rescan) {
    return {};
  }

  let status: 'normal' | 'encoding_fixed' | 'garbled' = 'normal';
  let encoding = 'utf-8';
  if (ext === 'txt') {
    try {
      const enc = await detectAndFixEncoding(fullPath);
      status = enc.status;
      encoding = enc.encoding;
    } catch {
      status = 'garbled';
      encoding = 'unknown';
    }
  }

  if (status === 'garbled') {
    return { garbled: { file_path: fullPath, reason: 'failed encoding detection' } };
  }

  let fp: Awaited<ReturnType<typeof computeFingerprint>> | null = null;
  try {
    fp = await computeFingerprint(fullPath, ext);
  } catch {
    return { garbled: { file_path: fullPath, reason: 'failed fingerprint' } };
  }

  const stat = fs.statSync(fullPath);
  const title = path.basename(fullPath, path.extname(fullPath));

  // Read first chapter preview for AI dedup
  let firstChapterPreview = '';
  if (ext === 'txt') {
    try {
      const { TxtParser } = await import('../plugins/parser-txt');
      const p = new TxtParser();
      await p.load(fullPath);
      const chapters = await p.getChapters();
      if (chapters.length > 0) {
        const html = await p.getChapterContent(0);
        firstChapterPreview = html.replace(/<[^>]+>/g, '').slice(0, 300);
      }
    } catch {
      // ok, leave empty
    }
  }

  const ext2 = status === 'encoding_fixed';
  const result: ScannedBookEx = {
    file_path: fullPath,
    title,
    fingerprint: fp.fingerprint,
    chapter_count: fp.chapter_count,
    first_chapter_preview: firstChapterPreview,
    file_format: ext,
    file_size: stat.size,
    encoding_detected: encoding,
    status: ext2 ? 'encoding_fixed' : 'normal',
  };

  if (ext2) {
    return {
      scanned: result,
      encoding_fixed: { file_path: fullPath, from_encoding: encoding, to_encoding: 'utf-8' },
    };
  }
  return { scanned: result };
}
```

- [ ] **Step 2: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 跑全部测试（确保 walker 重构没坏其他测试）**

Run: `cd ~/projects/easy-Reader/backend && npx jest`
Expected: ALL PASS

- [ ] **Step 4: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/services/scan-walker.ts
git commit -m "feat(scan): refactor walker to support auto/review/hybrid modes with AI dedup/series stages"
```

---

## Phase I: 路由与扫描接口（任务 17-18）

### Task 17: scan-batches 路由

**Files:**
- Create: `backend/src/routes/scan-batches.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: 创建路由文件**

Create `backend/src/routes/scan-batches.ts`:

```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { applyBatch } from '../services/batch-applier';
import { ScanBatch, ScanBatchItem } from '../types';

const router = Router();

router.get('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const status = (req.query.status as string) || undefined;
  const db = getDb();
  const rows = status
    ? db.prepare('SELECT * FROM scan_batches WHERE status = ? ORDER BY created_at DESC').all(status) as ScanBatch[]
    : db.prepare('SELECT * FROM scan_batches ORDER BY created_at DESC').all() as ScanBatch[];
  successResponse(res, rows);
});

router.get('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const batch = db.prepare('SELECT * FROM scan_batches WHERE id = ?').get(req.params.id) as ScanBatch | undefined;
  if (!batch) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '批次不存在'); return; }
  const items = db.prepare(
    'SELECT * FROM scan_batch_items WHERE batch_id = ? ORDER BY type, id'
  ).all(req.params.id) as ScanBatchItem[];
  successResponse(res, { batch, items });
});

const itemPatchSchema = z.object({
  decision: z.enum(['accept', 'reject', 'modified']),
  payload: z.unknown().optional(),
});

router.patch('/:batchId/items/:itemId', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = itemPatchSchema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const db = getDb();
  const item = db.prepare('SELECT id FROM scan_batch_items WHERE id = ? AND batch_id = ?')
    .get(req.params.itemId, req.params.batchId);
  if (!item) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '审核项不存在'); return; }
  db.prepare(
    `UPDATE scan_batch_items SET admin_decision = ?, admin_payload = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?`
  ).run(
    parsed.data.decision,
    parsed.data.payload !== undefined ? JSON.stringify(parsed.data.payload) : null,
    req.user!.userId,
    req.params.itemId,
  );
  successResponse(res, null, '已记录修正');
});

router.post('/:id/apply', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const batch = db.prepare('SELECT id, status FROM scan_batches WHERE id = ?').get(req.params.id) as
    | { id: string; status: string }
    | undefined;
  if (!batch) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '批次不存在'); return; }
  if (batch.status !== 'pending') { errorResponse(res, 409, 'BATCH_ALREADY_APPLIED', '批次状态非 pending'); return; }
  try {
    const result = applyBatch(req.params.id, req.user!.userId);
    successResponse(res, result, '已应用');
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', (err as Error).message);
  }
});

router.delete('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const r = db.prepare("UPDATE scan_batches SET status = 'discarded' WHERE id = ? AND status = 'pending'")
    .run(req.params.id);
  if (r.changes === 0) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '批次不存在或已处理'); return; }
  successResponse(res, null, '已废弃');
});

router.get('/:batchId/preview', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const filePath = req.query.file_path as string;
  if (!filePath || !fs.existsSync(filePath)) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '文件不存在');
    return;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8').slice(0, 500);
    successResponse(res, { content });
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', '读取失败');
  }
});

export default router;
```

- [ ] **Step 2: 挂载到 index.ts**

修改 `backend/src/index.ts`，加 import 和 route：

```typescript
import scanBatchesRoutes from './routes/scan-batches';
// ...
app.use('/api/library/scan-batches', scanBatchesRoutes);
```

注意：放在 `app.use('/api/library', libraryRoutes)` **之前**。

- [ ] **Step 3: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/routes/scan-batches.ts backend/src/index.ts
git commit -m "feat(scan): add scan-batches review/apply/discard routes"
```

### Task 18: 修改 /scan 接受新选项 + 加 pending batch 检查

**Files:**
- Modify: `backend/src/routes/library.ts`

- [ ] **Step 1: 修改 scanOptionsSchema 与 /scan 路由**

在 `backend/src/routes/library.ts` 中：

(a) 把 Plan 1 添加的 `scanOptionsSchema`（在 `// POST /api/library/scan` 之前）**替换**为：

```typescript
const scanOptionsSchema = z.object({
  mode: z.enum(['auto', 'review', 'hybrid']).default('review'),
  ai_dedup: z.boolean().default(false),
  ai_series: z.boolean().default(false),
  ai_fill: z.boolean().default(false),
  full_rescan: z.boolean().default(false),
});
```

(b) 在 `POST /api/library/scan` 路由内部，`if (hasRunningTask()) { ... }` 之**后**插入 pending batch 检查：

```typescript
  // Reject if any pending batch exists (force admin to handle prior results first)
  const pendingBatch = getDb().prepare("SELECT id FROM scan_batches WHERE status = 'pending' LIMIT 1").get() as
    | { id: string }
    | undefined;
  if (pendingBatch) {
    res.status(409).json({
      success: false,
      code: 'PENDING_BATCH',
      message: '请先处理待审核批次',
      data: { pendingBatchId: pendingBatch.id },
    });
    return;
  }
```

- [ ] **Step 2: 类型检查**

Run: `cd ~/projects/easy-Reader/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add backend/src/routes/library.ts
git commit -m "feat(scan): /scan accepts new options (mode + AI toggles) and blocks on pending batch"
```

---

## Phase J: 前端类型与 API（任务 19）

### Task 19: 前端 types + API 客户端

**Files:**
- Modify: `frontend/src/types/index.ts`
- Create: `frontend/src/api/scan-batches.ts`
- Modify: `frontend/src/api/library.ts`

- [ ] **Step 1: 加 types**

在 `frontend/src/types/index.ts` 末尾追加：

```typescript
export type ScanBatchStatus = 'pending' | 'applied' | 'discarded'
export type ScanBatchItemType = 'new' | 'duplicate_group' | 'series' | 'garbled' | 'encoding_fixed' | 'ai_fill_failed'

export interface ScanBatch {
  id: string
  task_id: string
  status: ScanBatchStatus
  summary_counts: string
  created_at: string
  applied_at?: string | null
  applied_by?: string | null
}

export interface ScanBatchItem {
  id: string
  batch_id: string
  type: ScanBatchItemType
  payload: string          // JSON string
  admin_decision?: 'accept' | 'reject' | 'modified' | null
  admin_payload?: string | null
  reviewed_at?: string | null
  reviewed_by?: string | null
}

export interface ScanStartOptions {
  mode: 'auto' | 'review' | 'hybrid'
  ai_dedup: boolean
  ai_series: boolean
  ai_fill: boolean
  full_rescan: boolean
}

export interface NewBookPayload {
  file_path: string
  title: string
  file_format: string
  file_size: number
  chapter_count?: number
  fingerprint?: string
  first_chapter_hash?: string
  encoding_detected?: string
  status?: 'normal' | 'encoding_fixed'
}

export interface DuplicateGroupPayload {
  canonical_file_path: string
  members: Array<{
    file_path: string
    fingerprint: string
    decision_type: 'hard' | 'ai'
    ai_confidence?: number
  }>
  rejected_members?: Array<{ file_path: string; fingerprint?: string }>
}

export interface SeriesGroupPayload {
  series_name: string
  author?: string
  members: Array<{ file_path: string; sequence: number }>
  source: 'regex' | 'ai'
  confidence?: 'high' | 'medium' | 'low'
  rejected_members?: string[]
}

export interface GarbledPayload {
  file_path: string
  reason: string
}

export interface EncodingFixedPayload {
  file_path: string
  from_encoding: string
  to_encoding: 'utf-8'
}
```

- [ ] **Step 2: 创建 api 客户端**

Create `frontend/src/api/scan-batches.ts`:

```typescript
import http from './http'
import type { ApiResponse, ScanBatch, ScanBatchItem } from '@/types'

export const scanBatchesApi = {
  list: (status?: 'pending' | 'applied' | 'discarded') =>
    http.get<ApiResponse<ScanBatch[]>>('/library/scan-batches', { params: { status } }),

  get: (id: string) =>
    http.get<ApiResponse<{ batch: ScanBatch; items: ScanBatchItem[] }>>(`/library/scan-batches/${id}`),

  updateItem: (batchId: string, itemId: string, decision: 'accept' | 'reject' | 'modified', payload?: unknown) =>
    http.patch<ApiResponse<null>>(`/library/scan-batches/${batchId}/items/${itemId}`, { decision, payload }),

  apply: (id: string) =>
    http.post<ApiResponse<{ inserted: number; updated: number; errors: Array<{ item_id: string; message: string }> }>>(`/library/scan-batches/${id}/apply`),

  discard: (id: string) =>
    http.delete<ApiResponse<null>>(`/library/scan-batches/${id}`),

  preview: (id: string, filePath: string) =>
    http.get<ApiResponse<{ content: string }>>(`/library/scan-batches/${id}/preview`, {
      params: { file_path: filePath },
    }),
}
```

- [ ] **Step 3: 修改 libraryApi.scan**

把 `frontend/src/api/library.ts` 的 `scan` 方法**替换**为：

```typescript
scan: (payload: import('@/types').ScanStartOptions) =>
  http.post<ApiResponse<{ taskId: string; status: string }>>('/library/scan', payload),
```

- [ ] **Step 4: 类型检查**

Run: `cd ~/projects/easy-Reader/frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 5: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/types/index.ts frontend/src/api/scan-batches.ts frontend/src/api/library.ts
git commit -m "feat(scan): add frontend types and API for scan batches"
```

---

## Phase K: 前端组件（任务 20-25）

### Task 20: ScanOptionsDialog

**Files:**
- Create: `frontend/src/components/ScanOptionsDialog.vue`

- [ ] **Step 1: 创建组件**

Create `frontend/src/components/ScanOptionsDialog.vue`:

```vue
<template>
  <el-dialog
    v-model="visible"
    title="扫描选项"
    width="500px"
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
          <el-checkbox v-model="form.ai_dedup">AI 去重判定</el-checkbox>
          <el-checkbox v-model="form.ai_series">AI 系列归类</el-checkbox>
          <el-checkbox v-model="form.ai_fill" disabled>
            AI 批量填充（Plan 3 启用）
          </el-checkbox>
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
      <el-button type="primary" @click="onConfirm">开始扫描</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import type { ScanStartOptions } from '@/types'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  'confirm': [ScanStartOptions]
}>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, (v) => { visible.value = v })
watch(visible, (v) => emit('update:modelValue', v))

const form = reactive<ScanStartOptions>({
  mode: 'review',
  ai_dedup: false,
  ai_series: false,
  ai_fill: false,
  full_rescan: false,
})

function onClose(): void {
  visible.value = false
}

function onConfirm(): void {
  emit('confirm', { ...form })
  visible.value = false
}
</script>

<style scoped>
.mode-hint {
  font-size: 12px;
  color: var(--text-2);
  margin-top: 6px;
  line-height: 1.5;
}
.ai-toggles {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
```

- [ ] **Step 2: 类型检查 + 提交**

Run: `cd ~/projects/easy-Reader/frontend && npm run typecheck`
Expected: 0 errors

```bash
cd ~/projects/easy-Reader
git add frontend/src/components/ScanOptionsDialog.vue
git commit -m "feat(scan): add ScanOptionsDialog component"
```

### Task 21: BatchItemPreview

**Files:**
- Create: `frontend/src/components/BatchItemPreview.vue`

- [ ] **Step 1: 创建组件**

Create `frontend/src/components/BatchItemPreview.vue`:

```vue
<template>
  <el-popover
    placement="right"
    :width="400"
    trigger="click"
    @show="loadPreview"
  >
    <template #reference>
      <el-button size="small" link>预览第一章</el-button>
    </template>
    <div class="preview-content">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="error" class="error">{{ error }}</div>
      <pre v-else>{{ content }}</pre>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { scanBatchesApi } from '@/api/scan-batches'

const props = defineProps<{
  batchId: string
  filePath: string
}>()

const content = ref('')
const loading = ref(false)
const error = ref('')

async function loadPreview(): Promise<void> {
  if (content.value) return
  loading.value = true
  error.value = ''
  try {
    const resp = await scanBatchesApi.preview(props.batchId, props.filePath)
    content.value = resp.data.data.content
  } catch {
    error.value = '加载失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.preview-content {
  max-height: 300px;
  overflow-y: auto;
}
.preview-content pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  margin: 0;
}
.loading, .error {
  color: var(--text-2);
  font-size: 13px;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/components/BatchItemPreview.vue
git commit -m "feat(scan): add BatchItemPreview popover"
```

### Task 22: DuplicateGroupCard

**Files:**
- Create: `frontend/src/components/DuplicateGroupCard.vue`

- [ ] **Step 1: 创建组件**

Create `frontend/src/components/DuplicateGroupCard.vue`:

```vue
<template>
  <el-card class="dup-card" :class="{ rejected: isRejected }">
    <div class="card-header">
      <div class="title">
        <el-tag :type="hasHard ? 'danger' : 'warning'" size="small">
          {{ hasHard ? '硬重复（指纹相同）' : 'AI 判定' }}
        </el-tag>
        <span class="member-count">{{ members.length }} 本</span>
      </div>
      <div class="actions">
        <el-button size="small" type="danger" plain @click="$emit('reject')" v-if="!isRejected">
          否决整组
        </el-button>
        <el-button size="small" @click="$emit('restore')" v-else>
          恢复
        </el-button>
      </div>
    </div>

    <div class="members">
      <div
        v-for="m in members"
        :key="m.file_path"
        class="member-row"
        :class="{ canonical: m.file_path === canonicalPath, rejected: rejectedSet.has(m.file_path) }"
      >
        <el-radio
          :model-value="canonicalPath"
          :label="m.file_path"
          @change="onSetCanonical(m.file_path)"
        >
          <span class="path">{{ shortPath(m.file_path) }}</span>
        </el-radio>
        <div class="member-actions">
          <BatchItemPreview :batch-id="batchId" :file-path="m.file_path" />
          <el-button
            v-if="m.file_path !== canonicalPath"
            size="small"
            link
            type="warning"
            @click="onToggleReject(m.file_path)"
          >
            {{ rejectedSet.has(m.file_path) ? '撤回' : '剔除（不是重复）' }}
          </el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import BatchItemPreview from './BatchItemPreview.vue'
import type { DuplicateGroupPayload } from '@/types'

const props = defineProps<{
  batchId: string
  payload: DuplicateGroupPayload
  isRejected: boolean
}>()

const emit = defineEmits<{
  modify: [DuplicateGroupPayload]
  reject: []
  restore: []
}>()

const canonicalPath = ref(props.payload.canonical_file_path)
const rejectedSet = ref(new Set<string>())

const members = computed(() => props.payload.members)
const hasHard = computed(() => members.value.some(m => m.decision_type === 'hard'))

function shortPath(p: string): string {
  return p.split('/').slice(-2).join('/')
}

function onSetCanonical(p: string): void {
  canonicalPath.value = p
  emitModified()
}

function onToggleReject(p: string): void {
  if (rejectedSet.value.has(p)) rejectedSet.value.delete(p)
  else rejectedSet.value.add(p)
  emitModified()
}

function emitModified(): void {
  const rejectedArr = [...rejectedSet.value].map(p => {
    const m = members.value.find(x => x.file_path === p)
    return { file_path: p, fingerprint: m?.fingerprint }
  })
  emit('modify', {
    canonical_file_path: canonicalPath.value,
    members: members.value.filter(m => !rejectedSet.value.has(m.file_path)),
    rejected_members: rejectedArr,
  })
}
</script>

<style scoped>
.dup-card { margin-bottom: 12px; }
.dup-card.rejected { opacity: 0.5; }
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.title { display: flex; align-items: center; gap: 8px; }
.member-count { color: var(--text-2); font-size: 13px; }
.members { display: flex; flex-direction: column; gap: 6px; }
.member-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-radius: 4px;
}
.member-row.canonical { background: var(--el-color-success-light-9); }
.member-row.rejected .path { text-decoration: line-through; color: var(--text-3); }
.path { font-family: monospace; font-size: 13px; }
.member-actions { display: flex; gap: 8px; }
</style>
```

- [ ] **Step 2: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/components/DuplicateGroupCard.vue
git commit -m "feat(scan): add DuplicateGroupCard component"
```

### Task 23: SeriesGroupCard

**Files:**
- Create: `frontend/src/components/SeriesGroupCard.vue`

- [ ] **Step 1: 创建组件**

Create `frontend/src/components/SeriesGroupCard.vue`:

```vue
<template>
  <el-card class="series-card" :class="{ rejected: isRejected }">
    <div class="card-header">
      <div class="title">
        <el-tag :type="payload.source === 'ai' ? 'warning' : 'primary'" size="small">
          {{ payload.source === 'ai' ? `AI 判定 (${payload.confidence})` : '正则匹配' }}
        </el-tag>
        <el-input
          v-model="seriesName"
          size="small"
          style="width: 180px"
          @blur="emitModified"
        />
        <span class="member-count">{{ activeMembers.length }} 本</span>
      </div>
      <div class="actions">
        <el-button size="small" type="danger" plain @click="$emit('reject')" v-if="!isRejected">
          否决整组
        </el-button>
        <el-button size="small" @click="$emit('restore')" v-else>恢复</el-button>
      </div>
    </div>

    <div class="members">
      <div
        v-for="m in payload.members"
        :key="m.file_path"
        class="member-row"
        :class="{ rejected: rejectedSet.has(m.file_path) }"
      >
        <span class="seq">#{{ m.sequence }}</span>
        <span class="path">{{ shortPath(m.file_path) }}</span>
        <div class="member-actions">
          <BatchItemPreview :batch-id="batchId" :file-path="m.file_path" />
          <el-button size="small" link type="warning" @click="onToggleReject(m.file_path)">
            {{ rejectedSet.has(m.file_path) ? '撤回' : '剔除' }}
          </el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import BatchItemPreview from './BatchItemPreview.vue'
import type { SeriesGroupPayload } from '@/types'

const props = defineProps<{
  batchId: string
  payload: SeriesGroupPayload
  isRejected: boolean
}>()

const emit = defineEmits<{
  modify: [SeriesGroupPayload]
  reject: []
  restore: []
}>()

const seriesName = ref(props.payload.series_name)
const rejectedSet = ref(new Set<string>())

const activeMembers = computed(() => props.payload.members.filter(m => !rejectedSet.value.has(m.file_path)))

function shortPath(p: string): string { return p.split('/').slice(-2).join('/') }

function onToggleReject(p: string): void {
  if (rejectedSet.value.has(p)) rejectedSet.value.delete(p)
  else rejectedSet.value.add(p)
  emitModified()
}

function emitModified(): void {
  emit('modify', {
    series_name: seriesName.value,
    author: props.payload.author,
    members: activeMembers.value,
    source: props.payload.source,
    confidence: props.payload.confidence,
    rejected_members: [...rejectedSet.value],
  })
}
</script>

<style scoped>
.series-card { margin-bottom: 12px; }
.series-card.rejected { opacity: 0.5; }
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.title { display: flex; align-items: center; gap: 8px; }
.member-count { color: var(--text-2); font-size: 13px; }
.members { display: flex; flex-direction: column; gap: 6px; }
.member-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
}
.member-row.rejected .path { text-decoration: line-through; }
.seq { font-family: monospace; color: var(--el-color-primary); }
.path { flex: 1; font-family: monospace; font-size: 13px; }
.member-actions { display: flex; gap: 8px; }
</style>
```

- [ ] **Step 2: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/components/SeriesGroupCard.vue
git commit -m "feat(scan): add SeriesGroupCard component"
```

### Task 24: 路由配置 + ScanBatchList view

**Files:**
- Modify: `frontend/src/router/index.ts`
- Create: `frontend/src/views/ScanBatchList.vue`

- [ ] **Step 1: 读现有路由**

Run: `cat ~/projects/easy-Reader/frontend/src/router/index.ts`
观察现有路由结构。

- [ ] **Step 2: 加新路由**

修改 `frontend/src/router/index.ts`，在 routes 数组中添加两条（参考现有 admin 路由的 meta 限定）：

```typescript
{
  path: '/library/scan-batches',
  name: 'scan-batches',
  component: () => import('@/views/ScanBatchList.vue'),
  meta: { requiresAuth: true, requiresAdmin: true },
},
{
  path: '/library/scan-batches/:id',
  name: 'scan-batch-review',
  component: () => import('@/views/ScanBatchReview.vue'),
  meta: { requiresAuth: true, requiresAdmin: true },
},
```

如果项目中的 meta 命名不同（比如用的是 `isAdmin: true`），按现有约定调整。

- [ ] **Step 3: 创建 ScanBatchList**

Create `frontend/src/views/ScanBatchList.vue`:

```vue
<template>
  <DefaultLayout>
    <div class="batch-list-page">
      <div class="page-header">
        <h1>扫描批次</h1>
      </div>

      <el-table v-loading="loading" :data="batches" empty-text="暂无批次">
        <el-table-column prop="id" label="批次 ID" width="280">
          <template #default="{ row }">
            <code>{{ row.id.slice(0, 8) }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="统计">
          <template #default="{ row }">
            <span v-if="row.summary_counts" class="summary">
              新增 {{ summary(row.summary_counts).new }}，
              重复组 {{ summary(row.summary_counts).duplicate_groups }}，
              系列 {{ summary(row.summary_counts).series }}，
              乱码 {{ summary(row.summary_counts).garbled }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="160" />
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="goReview(row.id)">
              {{ row.status === 'pending' ? '审核' : '查看' }}
            </el-button>
            <el-button v-if="row.status === 'pending'" size="small" type="danger" link @click="onDiscard(row.id)">
              废弃
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { scanBatchesApi } from '@/api/scan-batches'
import type { ScanBatch } from '@/types'

const router = useRouter()
const batches = ref<ScanBatch[]>([])
const loading = ref(false)

async function fetch(): Promise<void> {
  loading.value = true
  try {
    const resp = await scanBatchesApi.list()
    batches.value = resp.data.data
  } finally {
    loading.value = false
  }
}

function statusType(s: string): string {
  return s === 'pending' ? 'warning' : s === 'applied' ? 'success' : 'info'
}
function statusLabel(s: string): string {
  return { pending: '待审核', applied: '已应用', discarded: '已废弃' }[s] ?? s
}
function summary(s: string): Record<string, number> {
  try { return JSON.parse(s) } catch { return {} }
}

function goReview(id: string): void {
  router.push(`/library/scan-batches/${id}`)
}

async function onDiscard(id: string): Promise<void> {
  await ElMessageBox.confirm('废弃此批次将丢失 AI 判定结果，确定？', '确认', { type: 'warning' })
  await scanBatchesApi.discard(id)
  ElMessage.success('已废弃')
  await fetch()
}

onMounted(fetch)
</script>

<style scoped>
.batch-list-page { padding: 32px; }
.page-header { margin-bottom: 24px; }
.summary { font-size: 13px; color: var(--text-2); }
</style>
```

- [ ] **Step 3: 类型检查 + 提交**

Run: `cd ~/projects/easy-Reader/frontend && npm run typecheck`
Expected: 0 errors

```bash
cd ~/projects/easy-Reader
git add frontend/src/router/index.ts frontend/src/views/ScanBatchList.vue
git commit -m "feat(scan): add scan batch list view and routes"
```

### Task 25: ScanBatchReview view

**Files:**
- Create: `frontend/src/views/ScanBatchReview.vue`

- [ ] **Step 1: 创建**

Create `frontend/src/views/ScanBatchReview.vue`:

```vue
<template>
  <DefaultLayout>
    <div class="review-page" v-loading="loading">
      <div class="page-header">
        <div>
          <el-button link @click="$router.push('/library/scan-batches')">← 返回批次列表</el-button>
          <h1>审核批次 {{ batchIdShort }}</h1>
        </div>
        <div class="actions">
          <div class="unreviewed-stats" v-if="unreviewedCount > 0">
            <el-tag type="warning">{{ unreviewedCount }} 项未审视</el-tag>
          </div>
          <el-button @click="onDiscard" type="danger" plain>废弃批次</el-button>
          <el-button @click="onApply" type="primary" :disabled="batch?.status !== 'pending'">
            应用全部
          </el-button>
        </div>
      </div>

      <el-collapse v-model="activePanels" v-if="batch">
        <el-collapse-item :name="'new'" v-if="grouped.new.length > 0">
          <template #title>
            <span class="panel-title">新书 <el-badge :value="grouped.new.length" /></span>
          </template>
          <div class="new-list">
            <div v-for="item in grouped.new" :key="item.id" class="new-row">
              <span class="path">{{ shortPath(payload(item).file_path) }}</span>
              <span class="meta">{{ payload(item).chapter_count }} 章</span>
              <BatchItemPreview :batch-id="batch.id" :file-path="payload(item).file_path" />
            </div>
          </div>
        </el-collapse-item>

        <el-collapse-item :name="'duplicate_group'" v-if="grouped.duplicate_group.length > 0">
          <template #title>
            <span class="panel-title">重复组 <el-badge :value="grouped.duplicate_group.length" /></span>
          </template>
          <DuplicateGroupCard
            v-for="item in grouped.duplicate_group"
            :key="item.id"
            :batch-id="batch.id"
            :payload="payload(item)"
            :is-rejected="item.admin_decision === 'reject'"
            @modify="(p) => onModify(item.id, p)"
            @reject="onItemReject(item.id)"
            @restore="onItemRestore(item.id)"
          />
        </el-collapse-item>

        <el-collapse-item :name="'series'" v-if="grouped.series.length > 0">
          <template #title>
            <span class="panel-title">系列 <el-badge :value="grouped.series.length" /></span>
          </template>
          <SeriesGroupCard
            v-for="item in grouped.series"
            :key="item.id"
            :batch-id="batch.id"
            :payload="payload(item)"
            :is-rejected="item.admin_decision === 'reject'"
            @modify="(p) => onModify(item.id, p)"
            @reject="onItemReject(item.id)"
            @restore="onItemRestore(item.id)"
          />
        </el-collapse-item>

        <el-collapse-item :name="'encoding_fixed'" v-if="grouped.encoding_fixed.length > 0">
          <template #title>
            <span class="panel-title">编码已修复 <el-badge :value="grouped.encoding_fixed.length" /></span>
          </template>
          <div v-for="item in grouped.encoding_fixed" :key="item.id" class="fix-row">
            <span class="path">{{ shortPath(payload(item).file_path) }}</span>
            <el-tag size="small">{{ payload(item).from_encoding }} → utf-8</el-tag>
          </div>
        </el-collapse-item>

        <el-collapse-item :name="'garbled'" v-if="grouped.garbled.length > 0">
          <template #title>
            <span class="panel-title">真乱码 <el-badge :value="grouped.garbled.length" type="danger" /></span>
          </template>
          <div v-for="item in grouped.garbled" :key="item.id" class="garbled-row">
            <span class="path">{{ shortPath(payload(item).file_path) }}</span>
            <span class="reason">{{ payload(item).reason }}</span>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import DuplicateGroupCard from '@/components/DuplicateGroupCard.vue'
import SeriesGroupCard from '@/components/SeriesGroupCard.vue'
import BatchItemPreview from '@/components/BatchItemPreview.vue'
import { scanBatchesApi } from '@/api/scan-batches'
import type { ScanBatch, ScanBatchItem } from '@/types'

const route = useRoute()
const router = useRouter()
const batchId = route.params.id as string
const batchIdShort = computed(() => batchId.slice(0, 8))

const batch = ref<ScanBatch | null>(null)
const items = ref<ScanBatchItem[]>([])
const loading = ref(false)
const activePanels = ref(['new', 'duplicate_group', 'series', 'encoding_fixed', 'garbled'])

function payload<T = any>(item: ScanBatchItem): T {
  try { return JSON.parse(item.admin_payload ?? item.payload) } catch { return {} as T }
}
function shortPath(p: string): string { return (p || '').split('/').slice(-2).join('/') }

const grouped = computed(() => {
  const out = { new: [] as ScanBatchItem[], duplicate_group: [] as ScanBatchItem[], series: [] as ScanBatchItem[], garbled: [] as ScanBatchItem[], encoding_fixed: [] as ScanBatchItem[] }
  for (const it of items.value) {
    if (it.type in out) (out as any)[it.type].push(it)
  }
  return out
})

const unreviewedCount = computed(() => items.value.filter(i => !i.admin_decision).length)

async function fetch(): Promise<void> {
  loading.value = true
  try {
    const resp = await scanBatchesApi.get(batchId)
    batch.value = resp.data.data.batch
    items.value = resp.data.data.items
  } finally {
    loading.value = false
  }
}

async function onModify(itemId: string, p: unknown): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'modified', p)
  await fetch()
}
async function onItemReject(itemId: string): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'reject')
  await fetch()
}
async function onItemRestore(itemId: string): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'accept')
  await fetch()
}
async function onApply(): Promise<void> {
  await ElMessageBox.confirm(`确认应用？将影响书库。${unreviewedCount.value} 项未审视将按 AI 判定执行。`, '应用确认', { type: 'warning' })
  const resp = await scanBatchesApi.apply(batchId)
  const r = resp.data.data
  ElMessage.success(`已应用：新增 ${r.inserted}，更新 ${r.updated}，错误 ${r.errors.length}`)
  router.push('/library')
}
async function onDiscard(): Promise<void> {
  await ElMessageBox.confirm('确认废弃整个批次？AI 判定结果将丢弃，但已修复编码的文件不会还原。', '废弃确认', { type: 'warning' })
  await scanBatchesApi.discard(batchId)
  ElMessage.success('已废弃')
  router.push('/library/scan-batches')
}

onMounted(fetch)
</script>

<style scoped>
.review-page { padding: 24px 32px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 24px;
}
.page-header h1 { margin: 8px 0 0 0; }
.actions { display: flex; gap: 12px; align-items: center; }
.unreviewed-stats { margin-right: 8px; }
.panel-title { font-weight: 500; }
.new-row, .fix-row, .garbled-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
}
.path { font-family: monospace; }
.meta { color: var(--text-2); }
.reason { color: var(--el-color-danger); font-size: 12px; }
</style>
```

- [ ] **Step 2: 类型检查 + 提交**

Run: `cd ~/projects/easy-Reader/frontend && npm run typecheck`
Expected: 0 errors

```bash
cd ~/projects/easy-Reader
git add frontend/src/views/ScanBatchReview.vue
git commit -m "feat(scan): add scan batch review view with folding panels"
```

---

## Phase L: 集成 Library.vue（任务 26-27）

### Task 26: Library.vue 改造扫描按钮 + pending batch 提醒

**Files:**
- Modify: `frontend/src/views/Library.vue`

- [ ] **Step 1: 修改 Library.vue**

在 `frontend/src/views/Library.vue`：

(a) 在 `<script setup>` imports 段（约 70 行）添加：

```typescript
import ScanOptionsDialog from '@/components/ScanOptionsDialog.vue'
import { scanBatchesApi } from '@/api/scan-batches'
import type { ScanStartOptions, ScanBatch } from '@/types'
```

(b) 在已有 `const scanStore = useScanTaskStore()` 下方加：

```typescript
const showScanDialog = ref(false)
const pendingBatch = ref<ScanBatch | null>(null)

async function refreshPendingBatch(): Promise<void> {
  try {
    const resp = await scanBatchesApi.list('pending')
    pendingBatch.value = resp.data.data[0] ?? null
  } catch {
    pendingBatch.value = null
  }
}
```

(c) **替换** Plan 1 中加入的 `handleScan` 函数为：

```typescript
async function handleScan(): Promise<void> {
  if (scanStore.isRunning) {
    ElMessage.warning('已有扫描任务在运行')
    return
  }
  await refreshPendingBatch()
  if (pendingBatch.value) {
    ElMessageBox.alert(`存在未处理的待审核批次（${pendingBatch.value.id.slice(0,8)}），请先处理后再扫描。`, '提示', {
      confirmButtonText: '去处理',
      callback: () => router.push(`/library/scan-batches/${pendingBatch.value!.id}`),
    })
    return
  }
  showScanDialog.value = true
}

async function onScanConfirm(options: ScanStartOptions): Promise<void> {
  try {
    await scanStore.startScan(options)
    ElMessage.success('扫描任务已启动')
  } catch (err: any) {
    if (err.response?.status === 409) {
      if (err.response.data?.code === 'PENDING_BATCH') {
        ElMessage.warning('请先处理待审核批次')
        await refreshPendingBatch()
      } else {
        ElMessage.warning('已有扫描任务在运行')
        void scanStore.refresh()
      }
    } else {
      ElMessage.error('扫描失败')
    }
  }
}
```

(d) 在 `<template>` 的扫描按钮**之后**插入 dialog：

```vue
<ScanOptionsDialog v-model="showScanDialog" @confirm="onScanConfirm" />
```

(e) 在 `<template>` 顶部 `page-header` **之前**（即 `library-page` div 内最顶部）插入 pending batch 提醒：

```vue
<el-alert
  v-if="pendingBatch && authStore.isAdmin"
  type="warning"
  show-icon
  :closable="false"
  class="batch-alert"
>
  存在未处理的扫描批次
  <el-button link type="primary" @click="$router.push(`/library/scan-batches/${pendingBatch.id}`)">
    立即审核
  </el-button>
</el-alert>
```

(f) 在 `<style scoped>` 末尾添加：

```css
.batch-alert { margin-bottom: 20px; }
```

(g) 在 `onMounted(fetchBooks)` 旁边追加：

```typescript
onMounted(refreshPendingBatch)
```

(h) 在 `watch(() => scanStore.activeTask?.status, ...)` 已存在的回调里，扫描完成时也刷新 batch：

把回调内 `void fetchBooks()` 替换为：
```typescript
void fetchBooks()
void refreshPendingBatch()
```

- [ ] **Step 2: 类型检查**

Run: `cd ~/projects/easy-Reader/frontend && npm run typecheck`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
cd ~/projects/easy-Reader
git add frontend/src/views/Library.vue
git commit -m "feat(scan): integrate scan options dialog and pending batch alert in Library"
```

### Task 27: 端到端验证

- [ ] **Step 1: 启动 backend + frontend**

两个终端：
```bash
cd ~/projects/easy-Reader/backend && npm run dev
cd ~/projects/easy-Reader/frontend && npm run dev
```

- [ ] **Step 2: 浏览器测试**

打开 http://localhost:8080，admin 登录。

测试用例 A：**扫描选项对话框**
- 点击「扫描导入」→ 期望弹出 ScanOptionsDialog
- 默认选中 "暂存审核"，AI 复选框可勾选

测试用例 B：**review 模式（不勾选 AI）**
- 模式：暂存审核，AI 全不勾选
- 点击「开始扫描」→ 进度条出现
- 完成后跳转或保持 Library 页，顶部应有黄色 alert：「存在未处理的扫描批次」
- 点击 alert 中的「立即审核」→ 进入 `/library/scan-batches/:id`
- 看到折叠面板：新书 / 编码已修复（若有 GBK 文件）/ 真乱码（若有）等
- 应该没有 重复组 / 系列（因为没勾 AI）— 除非有指纹完全相同的硬重复

测试用例 C：**应用批次**
- 在审核页点「应用全部」→ 确认 → 期望 toast「已应用：新增 N，更新 M」
- 跳回 /library，黄色 alert 消失，新书出现在列表

测试用例 D：**review 模式 + AI 去重**
- 准备：在 BOOKS_DIR 放两个内容相似但文件名不同的 txt（手动构造或复制后改文件名）
- 扫描时勾选 AI 去重
- 期望：批次审核页出现「重复组」面板，含 AI 判定的组

测试用例 E：**pending batch 阻止新扫描**
- 当存在 pending batch 时，点扫描按钮 → 期望提示「存在未处理的待审批次」且不弹对话框

测试用例 F：**废弃批次**
- 审核页点「废弃批次」→ 二次确认 → 期望跳回批次列表，状态为 discarded

- [ ] **Step 3: 修复任何 bug**

每个修复独立 commit，消息格式：`fix(scan): <描述>`。

---

## Self-Review Notes

执行完所有任务后，逐项验证：

1. **Schema**: `series`, `scan_batches`, `scan_batch_items`, `manual_overrides` 4 张表存在？
2. **TDD**: 所有 service 测试通过？(`npx jest`)
3. **AI plugin**: 6 个 plugin 都实现了 `chat()` 方法？
4. **批次状态机**: pending → applied / discarded 转换正确？
5. **manual_overrides**: admin 在 review 中剔除某个重复后，应用时确实记入 `manual_overrides`？
6. **三种扫描模式**: auto / review / hybrid 行为符合预期？
7. **AI 错误降级**: AI 调用失败时整个扫描不挂掉，只是该组不出现在结果中？
8. **pending batch 锁**: 待审批次存在时新扫描被阻止？

---

## 范围之外（Plan 3 承接）

- **AI 批量填充**：当前 ai_fill 字段还在 schema 但无实际用途；Plan 3 将启用
- **费用估算与警告**：`/scan/estimate` 接口、cost-tier 提示、勾选 ai_fill 后的醒目费用警告
- **书库 UI 集成**：BookCard 加 duplicate/garbled badge；SeriesCard 列表展示；SeriesDetail 视图；脏数据显示开关
- **删除文件 + 审计日志**：删除按钮、cascade_duplicates 逻辑、audit_log 表与查看
- **manual_overrides 管理 UI**：admin 查看 / 清除人工修正
- **桌面通知**：浏览器 Notification API 集成
- **BookDetail 提示**：「AI 不覆盖人工修改」气泡

Plan 2 完成后产品状态：**admin 可以做完整的智能扫描+审核工作流**，但普通用户体验和 Plan 1 一样（看不到重复/系列展示）；Plan 3 让普通用户也享受到效果。
