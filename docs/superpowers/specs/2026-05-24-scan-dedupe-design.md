# 扫描导入功能增强：AI 去重 / 乱码检测 / 系列归类 / 批量填充

**日期**：2026-05-24
**作者**：zhangjq + Claude
**目标项目**：easy-Reader (`~/projects/easy-Reader/`)
**当前涉及代码**：
- 后端：`backend/src/routes/library.ts`, `backend/src/db.ts`, `backend/src/plugins/parser-txt.ts`, `backend/src/ai/ai-manager.ts`
- 前端：`frontend/src/views/Library.vue`, `frontend/src/components/BookCard.vue`, `frontend/src/api/library.ts`

---

## 一、背景与目标

当前 `POST /api/library/scan` 是一个简单的同步递归扫描：发现新文件就直接 `INSERT INTO books`，没有任何去重、乱码检测、系列归类。前端调用后用 `setTimeout(fetchBooks, 3000)` 假装等扫描完成，没有真实进度反馈。

随着书库规模增长，出现三类问题：
1. **重复书**：同一本书的不同副本（来自不同来源的 txt 文件）会被当作两本独立的书入库
2. **乱码书**：很多 GBK / GB18030 编码的 txt 文件被强行按 UTF-8 解码，出现"锟斤拷"内容
3. **同名系列**：《女生宿舍 1》《女生宿舍 2》《女生宿舍 3》这类书在书库铺成一排，浪费屏幕空间

本次需求要做的事：
- 引入 AI 辅助的去重、系列归类
- 本地实现乱码检测 + 自动编码修复
- 把扫描改造为带进度的后台任务
- 提供"暂存批次审核" UI，避免 AI 误判直接污染书库
- 提供成本控制开关与显著警告

---

## 二、设计原则

1. **AI 调用最小化**：先用本地确定性算法（指纹哈希、正则、Levenshtein）筛出候选组，AI 只在候选组内部判别。20 万次组合压缩为几十次调用。
2. **可回滚**：扫描结果先入暂存批次，admin 审核后才落库。误判可改。
3. **可恢复**：任务状态写 DB，关闭浏览器再打开仍能看到进度。
4. **人工修正记忆**：admin 对 AI 判定的纠正写入 `manual_overrides`，下次重扫不再被 AI 推翻。
5. **安全护栏**：删除文件路径必须在 `BOOKS_DIR` 内（防穿越），写审计日志，二次警告。

---

## 三、整体流程

```
管理员点击"扫描导入"
    ↓
弹出【扫描选项对话框】
  • 模式：自动写入 / 暂存审核（默认）/ 混合模式
  • AI 功能：[✓] AI去重  [✓] AI系列归类  [✓] AI批量填充
    （每项右侧显示「预估调用 X 次」）
  • 范围：[ ] 包含已入库书籍重新检测
    （首次部署后第一次扫描时默认勾选）
  • 若勾选"AI批量填充"且当前激活的 AI 插件属于高费用类
    → 弹出醒目费用警告 modal，需点击确认才继续
    ↓
后台异步任务启动（全局锁：同时仅允许一个 scan_task）
  阶段 1: 文件遍历 + 编码检测 + 自动修复（GBK→UTF8 覆盖原文件）
  阶段 2: 计算指纹（章节数 + 第一章前500字SHA1 + 文件大小）
  阶段 3: 候选分组（指纹相同→硬重复组；标题归一化相同→软重复候选）
  阶段 4: AI 去重（仅候选组内调用，跳过 manual_overrides 中已声明"不重复"的对）
  阶段 5: 系列归类（正则匹配抓 90% 明显情况，剩余交 AI 复核）
  阶段 6: 写入 scan_batch 表
  阶段 7: 若启用"AI 批量填充" → 对每个组的"正本" + 所有正常无重复书批量调用
          （并发限制 3，单本失败重试 2 次，失败记入 batch.failed_items）
    ↓
前端轮询 GET /api/library/scan/tasks/active 显示进度
  完成时 → 浏览器桌面通知 (Notification API)
    ↓
若是"暂存审核"模式 → 自动跳转到批次审核页 /library/scan-batches/:id
若是"自动写入" → 直接落库
若是"混合模式" → 硬重复（指纹完全相同）自动落库；软判定/系列进审核
```

### 取消逻辑
- 任务运行中 admin 可点"取消"
- 已完成阶段的结果照样写入 scan_batch（AI 钱不白花）
- 后续阶段中止，任务标记 `cancelled`

### 并发与重入
- 若已有 `scan_task.status='running'`，新请求返回 409 + 当前任务 ID
- 若存在 `scan_batch.status='pending'`，新扫描请求返回 409 「请先处理待审批次 #N」
- 浏览器关闭/刷新后，Library 页加载时检查 active scan_task，自动显示进度条

---

## 四、数据库 Schema 变更

### books 表新增字段

```sql
ALTER TABLE books ADD COLUMN status TEXT DEFAULT 'normal';
-- 'normal' | 'duplicate' | 'garbled' | 'encoding_fixed'
ALTER TABLE books ADD COLUMN duplicate_of TEXT;
-- 指向正本 books.id；status='duplicate' 才有值
ALTER TABLE books ADD COLUMN series_id TEXT;
-- 关联 series.id；NULL 表示无系列
ALTER TABLE books ADD COLUMN chapter_count INTEGER;
ALTER TABLE books ADD COLUMN fingerprint TEXT;
-- sha1(chapter_count + "_" + file_size + "_" + first_chapter_hash)
ALTER TABLE books ADD COLUMN first_chapter_hash TEXT;
-- sha1(第一章前500字 trim 后)
ALTER TABLE books ADD COLUMN encoding_detected TEXT;
-- 'utf-8' | 'gbk' | 'gb18030' | 'big5'
ALTER TABLE books ADD COLUMN manually_edited_fields TEXT;
-- JSON 数组: ["title", "author", "summary"]
-- 表示这些字段被人工修改过，AI 填充时不应覆盖（即使为空也不再填充）

CREATE INDEX IF NOT EXISTS idx_books_fingerprint ON books(fingerprint);
CREATE INDEX IF NOT EXISTS idx_books_duplicate_of ON books(duplicate_of);
CREATE INDEX IF NOT EXISTS idx_books_series_id ON books(series_id);
CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
```

### 新增 series 表

```sql
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  summary TEXT,
  cover_url TEXT,            -- 通常用第一本书的封面
  author TEXT,               -- 共同作者（如果一致）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_series_name ON series(name);
```

### 新增 scan_tasks 表

```sql
CREATE TABLE IF NOT EXISTS scan_tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'
  stage TEXT,
  -- 'walking' | 'fingerprinting' | 'grouping' | 'ai_dedup' | 'ai_series' | 'staging' | 'ai_fill'
  total_files INTEGER DEFAULT 0,
  processed_files INTEGER DEFAULT 0,
  total_ai_calls INTEGER DEFAULT 0,
  done_ai_calls INTEGER DEFAULT 0,
  options TEXT,              -- JSON: {mode, ai_dedup, ai_series, ai_fill, full_rescan}
  started_by TEXT,           -- user_id
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  error TEXT,
  batch_id TEXT              -- 产生的 scan_batch.id
);
CREATE INDEX idx_scan_tasks_status ON scan_tasks(status);
```

### 新增 scan_batches 表

```sql
CREATE TABLE IF NOT EXISTS scan_batches (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'applied' | 'discarded'
  summary_counts TEXT,       -- JSON: {new:N, duplicate_groups:M, series:S, garbled:G, fixed:F, ai_fill_failed:X}
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME,
  applied_by TEXT
);
CREATE INDEX idx_scan_batches_status ON scan_batches(status);
```

### 新增 scan_batch_items 表

```sql
CREATE TABLE IF NOT EXISTS scan_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  type TEXT NOT NULL,
  -- 'new' | 'duplicate_group' | 'series' | 'garbled' | 'encoding_fixed' | 'ai_fill_failed'
  payload TEXT NOT NULL,
  -- 类型决定结构：
  --   new: {file_path, title, author, chapter_count, fingerprint, ai_fill_result?}
  --   duplicate_group: {canonical_path, members: [{file_path, fingerprint, decision_type: 'hard'|'ai'}]}
  --   series: {series_name, member_paths: [...], confidence}
  --   garbled: {file_path, reason}
  --   encoding_fixed: {file_path, from_encoding, to_encoding}
  --   ai_fill_failed: {file_path, error}
  admin_decision TEXT,
  -- NULL = 未审核（视为接受 AI 判定）
  -- 'accept' / 'reject' / 'modified'
  admin_payload TEXT,        -- admin 修改后的 payload（type='modified' 时使用）
  reviewed_at DATETIME,
  reviewed_by TEXT
);
CREATE INDEX idx_scan_batch_items_batch ON scan_batch_items(batch_id);
CREATE INDEX idx_scan_batch_items_type ON scan_batch_items(type);
```

### 新增 manual_overrides 表

```sql
CREATE TABLE IF NOT EXISTS manual_overrides (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  -- 'not_duplicate' (book_a 和 book_b 不是同一本)
  -- 'not_in_series' (book_a 不属于 series_b)
  -- 'forced_duplicate' (book_a 是 book_b 的重复，无论 AI 怎么判)
  -- 'forced_series_member' (book_a 强制属于 series_b)
  book_id_a TEXT,
  book_id_b TEXT,            -- not_duplicate / forced_duplicate 用
  series_id TEXT,            -- not_in_series / forced_series_member 用
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_manual_overrides_type ON manual_overrides(type);
CREATE INDEX idx_manual_overrides_book_a ON manual_overrides(book_id_a);
```

注：`book_id_a/b` 是 `books.id` 引用。对尚未入库的文件（扫描中发现的"软重复候选"）暂时不建 override 记录；只有当文件实际入库（或与已入库书构成关系）时才能记录人工修正。这样保持 schema 简洁，admin 在批次审核时的"剔除"操作会在批次应用时（此时新书已分配 books.id）转化为 manual_overrides。

### 新增 audit_log 表

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,      -- 'delete_book_file' | 'delete_book_record' | 'apply_batch' 等
  resource_id TEXT,          -- book_id / batch_id
  file_path TEXT,
  details TEXT,              -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
```

### 迁移策略

部署后第一次启动：
- `initSchema()` 自动 `ALTER TABLE` 添加新字段（用 try/catch 包裹 ignore 已存在错）
- `CREATE TABLE IF NOT EXISTS` 自动建新表
- **无需独立迁移脚本**：所有现有 books 默认 `status='normal'`、`fingerprint=NULL`；第一次扫描时若勾选"包含已入库书籍重新检测"则补算

---

## 五、后端 API 设计

### 扫描相关

```
POST   /api/library/scan
  body: {
    mode: 'auto' | 'review' | 'hybrid',
    ai_dedup: boolean,
    ai_series: boolean,
    ai_fill: boolean,
    full_rescan: boolean
  }
  返回: { taskId } 或 409 { code:'TASK_RUNNING', activeTaskId } 或 409 { code:'PENDING_BATCH', pendingBatchId }

GET    /api/library/scan/tasks/active
  返回: 当前 running 任务对象 + 进度，或 null

GET    /api/library/scan/tasks/:id
  返回: 任务详情

POST   /api/library/scan/tasks/:id/cancel
  返回: 标记任务 cancelled，已处理阶段结果保留为可审批次

GET    /api/library/scan/estimate
  query: ?ai_dedup=1&ai_series=1&ai_fill=1&full_rescan=0
  返回: {
    estimated_files: N,
    estimated_ai_calls: {
      dedup: X,
      series: Y,
      fill: Z,
      total: X+Y+Z
    },
    active_ai_plugin: 'deepseek',
    cost_tier: 'free' | 'low' | 'medium' | 'high'
  }
```

### 批次审核相关

```
GET    /api/library/scan-batches
  query: ?status=pending
  返回: 批次列表

GET    /api/library/scan-batches/:id
  返回: 批次详情 + 所有 items 分组

PATCH  /api/library/scan-batches/:id/items/:itemId
  body: { decision: 'accept'|'reject'|'modified', payload?: {...} }

POST   /api/library/scan-batches/:id/apply
  body: { skip_failed?: boolean }
  返回: 应用结果统计 + 错误列表

DELETE /api/library/scan-batches/:id
  返回: 废弃批次（不应用，但不删除磁盘上已修复编码的文件）

GET    /api/library/scan-batches/:id/preview
  query: ?file_path=...  (要 URL encode)
  返回: { content: "第一章前 500 字" }
```

### 书籍 / 系列相关

```
GET    /api/library
  query: 现有 + ?include_dirty=0|1 (默认 0，1 则返回 status != 'normal' 的)
                ?series_grouped=0|1 (默认 1，1 则将系列书合并为虚拟卡片)
  返回: 同前；如启用 series_grouped，结果含 type:'book' 和 type:'series' 两种条目

GET    /api/library/series
  返回: 所有系列列表

GET    /api/library/series/:id
  返回: { series, members: Book[] } (按 series 内序号排序)

PUT    /api/library/series/:id
  body: { name?, summary?, cover_url? }

DELETE /api/library/:id
  query: ?cascade_duplicates=1   是否一并删除重复书
  返回:
    - 200 成功
    - 409 + body { affected_users: N }（用户书架受影响）
    - 409 + body { duplicate_count: N, requires: 'cascade_duplicates' }（要删的是正本但有重复）

POST   /api/library/manual-overrides
  body: { type, book_id_a, book_id_b?, series_id? }
  返回: 创建的 override 记录

DELETE /api/library/manual-overrides/:id
  返回: 删除 override（admin 反悔逃生通道）

DELETE /api/library/manual-overrides
  返回: 删除所有 manual_overrides（清空逃生）
```

所有上述新接口均 `authMiddleware + adminMiddleware`。

---

## 六、前端组件设计

### 改造的视图

| 文件 | 改动 |
|---|---|
| `Library.vue` | 扫描按钮 → 弹出 `ScanOptionsDialog`；顶部显示 active scan 进度条；如有 pending batch 显示提醒条；列表支持系列卡 + 脏数据显示开关（admin 默认开）|
| `BookCard.vue` | 加 badge：重复（红色，可点击跳到正本）/ 乱码（黄色）/ 编码已修复（灰色提示）；admin 模式下加删除按钮 |
| `BookDetail.vue` | 加提示气泡："已修改的字段不会被 AI 填充覆盖，如想让 AI 重新填写请手动清空该字段" |
| `api/library.ts` | 加所有新 API 方法 |

### 新增组件 / 视图

| 文件 | 用途 |
|---|---|
| `components/SeriesCard.vue` | 系列卡片（书库网格中替代多本同系列书显示）|
| `views/SeriesDetail.vue` | 系列详情页：顶部系列简介 + 成员列表（按序号排）|
| `components/ScanOptionsDialog.vue` | 扫描选项对话框；调用 `/scan/estimate` 实时显示预估调用数与费用等级 |
| `components/CostWarningDialog.vue` | 高费用 AI 启用 AI 批量填充时的醒目费用警告 |
| `components/ScanProgressBar.vue` | 全局进度条，支持最小化为右下角浮窗，桌面通知（完成 / 失败）|
| `views/ScanBatchReview.vue` | 批次审核页：折叠面板分组：新书 / 重复组 / 系列 / 真乱码 / 编码已修复 / AI填充失败 |
| `components/DuplicateGroupCard.vue` | 重复组卡片：切换正本按钮、剔除成员按钮、合并组、立即删除文件、预览第一章 |
| `components/SeriesGroupCard.vue` | 系列卡片：编辑名称、剔除成员、确认 |
| `components/BatchItemPreview.vue` | 浮窗显示第一章前 500 字（含编码信息）|

### 路由

```
/library                       Library.vue
/library/series/:id            SeriesDetail.vue
/library/scan-batches          BatchListView (简单列表)
/library/scan-batches/:id      ScanBatchReview.vue
```

### 进度通知

- 进度条组件挂在 `App.vue` 全局，通过 Pinia store `useScanTaskStore` 管理状态
- 启动扫描 → store 触发轮询 (interval 2s) → 完成时调用 `Notification.requestPermission()` 后弹通知
- 用户关闭页面 → 下次打开 Library 时 store 自动检查 `GET /scan/tasks/active`

---

## 七、关键算法

### 7.1 指纹计算

```ts
async function computeFingerprint(filePath: string): Promise<{
  fingerprint: string,
  first_chapter_hash: string,
  chapter_count: number,
  file_size: number
}> {
  // 1. 用 TxtParser.load() 已有的流式扫章节
  // 2. 获取章节数 + 文件大小
  // 3. 读取第一章前 500 字符（不是字节，得 trim 处理）
  // 4. first_chapter_hash = sha1(first500.trim())
  // 5. fingerprint = sha1(chapter_count + "_" + file_size + "_" + first_chapter_hash)
}
```

### 7.2 编码检测与修复（三级处理）

```ts
async function detectAndFix(filePath: string): Promise<{
  status: 'normal' | 'encoding_fixed' | 'garbled',
  encoding: string
}> {
  const buf = await fs.promises.readFile(filePath);

  // Level 1: 尝试 UTF-8
  const utf8 = tryDecode(buf, 'utf-8');
  if (utf8.successful && printableChineseRatio(utf8.text) > 0.95) {
    return { status: 'normal', encoding: 'utf-8' };
  }

  // Level 2: 尝试 GBK / GB18030 / BIG5
  for (const enc of ['gbk', 'gb18030', 'big5']) {
    const r = tryDecode(buf, enc);
    if (r.successful && printableChineseRatio(r.text) > 0.95) {
      // 覆盖原文件为 UTF-8
      await fs.promises.writeFile(filePath, Buffer.from(r.text, 'utf-8'));
      return { status: 'encoding_fixed', encoding: enc };
    }
  }

  // Level 3: 真乱码
  return { status: 'garbled', encoding: 'unknown' };
}

function printableChineseRatio(text: string): number {
  // 统计 CJK + 标点 + 数字 + 英文 / 总字符
  // 阈值：真乱码判定为 < 50%
}
```

依赖：`iconv-lite` (已成熟，体积小)

### 7.3 候选分组

```ts
// Step A: 硬重复（指纹相同）
const groups = new Map<string, Book[]>();
for (const b of books) {
  if (!b.fingerprint) continue;
  if (!groups.has(b.fingerprint)) groups.set(b.fingerprint, []);
  groups.get(b.fingerprint).push(b);
}
const hardDuplicateGroups = [...groups.values()].filter(g => g.length > 1);

// Step B: 软重复候选（标题归一化相同）
// 归一化规则：去除 (上)(下)(续)(终)(完结) / 数字尾缀 / 空格 / 全半角
function normalizeTitle(t: string): string {
  return t
    .replace(/[（(].*?[)）]/g, '')         // 去括号内容
    .replace(/\d+/g, '')                    // 去数字
    .replace(/[上中下完终续之]\s*$/, '')   // 去尾缀
    .replace(/\s+/g, '')
    .toLowerCase();
}
// 把同 normalized title 的书归到候选软重复组（排除已在硬重复组的）
// 这些组送给 AI 判定
```

### 7.4 AI 去重判定

```ts
// 仅对软重复候选组调用
async function aiJudgeDuplicates(candidates: Book[]): Promise<{
  duplicates: Array<{canonical_id: string, duplicate_ids: string[]}>
}> {
  // 构造 prompt: "下面这几本书是否是同一本书的不同版本？"
  // 输入每本的 title / author / chapter_count / 第一章前 300 字
  // 输出 JSON: {groups: [{canonical_idx: 0, duplicate_idxs: [1,3]}]}
}
```

### 7.5 系列归类

```ts
// Step A: 正则抓明显系列（无需 AI）
const seriesPatterns = [
  /^(.+?)\s*[（(]?第[一二三四五六七八九十\d]+[部册集卷]/,
  /^(.+?)\s*(\d+)\s*$/,
  /^(.+?)\s*(上|中|下|续)\s*$/,
];
// 同作者 + 同正则前缀 → 候选系列

// Step B: 模糊匹配（Levenshtein 距离）
// 同作者书的标题两两距离 < 3 且非完全相同 → AI 候选

// Step C: AI 复核
async function aiJudgeSeries(candidates: Book[]): Promise<{
  series_name: string,
  members: Array<{book_id: string, sequence: number}>,
  confidence: 'high' | 'medium' | 'low'
}>
```

### 7.6 成本估算

```ts
const COST_TIERS = {
  ollama: 'free',
  deepseek: 'low',
  qwen: 'low',
  minmax: 'low',
  openai: 'high',
  claude: 'high',
};

// 估算逻辑
function estimateAiCalls(opts) {
  let dedup = countSoftDupCandidates();      // 软重复候选组数
  let series = countSeriesCandidates();      // 模糊匹配后的候选
  let fill = countNewOrCanonicalBooks();     // 待填充的书数
  return {
    dedup: opts.ai_dedup ? dedup : 0,
    series: opts.ai_series ? series : 0,
    fill: opts.ai_fill ? fill : 0,
  };
}
```

### 7.7 AI 并发与重试

```ts
import pLimit from 'p-limit';
const limit = pLimit(3);
const tasks = books.map(b =>
  limit(() => withRetry(() => aiManager.fillBookInfo(...), { retries: 2, backoff: 1000 }))
);
await Promise.allSettled(tasks);
// 失败的写入 scan_batch_items.type='ai_fill_failed'
```

---

## 八、安全考虑

### 路径穿越防护

所有删除文件接口必须：
```ts
const resolved = path.resolve(filePath);
const booksDir = path.resolve(BOOKS_DIR);
if (!resolved.startsWith(booksDir + path.sep)) {
  return errorResponse(res, 403, 'INVALID_PATH', '路径越界');
}
```

### 审计

所有删除操作 + apply batch 写入 `audit_log`，包含 user_id、文件路径、动作类型。

### 权限

所有扫描、批次、删除接口都需要 `authMiddleware + adminMiddleware`。

### 二次确认

- 删除文件按钮 → ElMessageBox 确认（"将删除磁盘文件 + 数据库记录，无法恢复"）
- 删除影响他人书架时 → 后端返回 409 + affected_users，前端二次警告
- 应用批次 → 强警告显示具体影响（新增 N、重复处理 M、文件删除 X）

---

## 九、错误处理

| 场景 | 处理 |
|---|---|
| 扫描中文件被删除 | 跳过，记 `scan_task.warnings` |
| 编码修复写文件失败（只读 / 权限） | 仍标 garbled，记录错误信息 |
| AI 调用失败（超时 / 限流） | 重试 2 次；失败计入 batch.failed_items；不阻塞整个任务 |
| AI 返回 JSON 解析失败 | 同上，按失败处理 |
| 任务进程崩溃 / 服务重启 | 启动时把 running 任务标 `failed`，提示 admin |
| 应用批次中途失败 | 已应用部分保留，未应用部分留在批次（status 仍 pending） |

---

## 十、测试关注点

虽然实现细节留给 plan，这里列出值得重点测试的：
- 编码检测：GBK / GB18030 / BIG5 三种样本文件能正确识别并修复
- 真乱码样本：能识别为 garbled 而不是误改写
- 指纹一致性：同一文件多次调用 fingerprint 结果不变
- 硬重复识别：两份完全相同的 txt 自动归到一组、不调 AI
- manual_overrides：admin 改过的判定在重扫中被保留
- 并发：同时点扫描按钮返回 409
- 安全：尝试通过 `../` 删除 BOOKS_DIR 外文件被拒
- 影响书架：删除被多用户加入书架的书时弹警告

---

## 十一、范围之外（不在本次实现）

- 多人协作：批次只有一个 admin 同时审核（不做行级锁）
- 跨服务器同步
- 自动周期扫描（不加 cron，仍是手动触发）
- AI 自动生成系列封面图（用第一本书封面即可）
- 已删除文件的回收站功能（用户选了 B 而非 C）
- 全文搜索改造（继续用现有 LIKE 查询）

---

## 十二、参考

- 现有代码：`backend/src/routes/library.ts:48` 是当前扫描入口
- 已有的 AI 接口：`backend/src/ai/ai-manager.ts`，`fillBookInfo` 可直接复用
- 章节扫描已优化：`backend/src/plugins/parser-txt.ts:27` 流式 256KB 读取
- API 响应规范：`backend/src/utils/response.ts`
- 现有 BOOKS_DIR 默认 `/app/books`，环境变量可覆盖
