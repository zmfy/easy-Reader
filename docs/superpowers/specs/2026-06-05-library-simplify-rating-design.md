# 设计:书库 UI 简化 + 豆瓣评分

**日期:** 2026-06-05
**分支:** `scan_books_ai1`

## Context

easy-Reader 是一个**小型个人书籍管理系统**,核心原则是**简单、简洁**。当前书库工具栏堆了多个独立控件(分类、排序、AI填充筛选下拉、显示脏数据开关、批量AI填充按钮、问题书籍管理按钮)和一个独立的批量填充对话框,对一个个人小系统过于繁杂。

本次优化目标:把零散的筛选/入口收敛进**搜索框关键词**与**扫描导入对话框**,移除多余按钮;并补上一直停留在"待上线"的**网络评分**功能(豆瓣)。

四项需求来自用户:
1. 去掉「问题书籍管理」链接和「显示脏数据」开关;改为在搜索框输入"重复"显示所有重复书籍(含审核后保留的正常书)。
2. 去掉独立「批量 AI 填充」按钮;「重置填充失败」按钮移入扫描导入对话框,并新增「重置全部填充」(重置后下次扫描重填所有已填充的书,不论成功失败)。
3. 去掉「已填充/填充失败」筛选下拉;改为搜索框输入"ai填充"显示已填充、输入"填充失败"显示填充失败。
4. 加评分:AI 填充时顺带抓豆瓣评分,抓到存库,否则默认无评分。

## 已确认决策

- **评分来源/时机**:随 AI 填充一起抓豆瓣,best-effort,抓不到存 NULL。复用现有豆瓣 suggest 请求。
- **重置按钮语义**:按钮只重置标记(清版本/状态),真正重填由「扫描导入」勾选「AI 批量填充」时执行。

---

## 1. 搜索框「魔法关键词」

前端在 `Library.vue` 把搜索词翻译成已有后端筛选参数;清空恢复全部。**仅 admin 生效**(普通用户当普通搜索)。

| 精确输入(trim 后) | 翻译为 |
|---|---|
| `重复` | 后端新增 `status=duplicate_groups`(见下) |
| `ai填充` 或 `已填充` | `ai_fill=filled` |
| `填充失败` | `ai_fill=failed` |
| 其它任意文字 | 仍走 `search`(书名/作者 LIKE) |

实现:`Library.vue` 加一个映射函数 `resolveQuery(raw)` → `{ search?, status?, ai_fill? }`。`fetchBooks` 用其结果调 `libraryApi.list`,而非直接把 `searchQuery` 当 search。`syncQuery` 仍把原始输入写进 URL `?search=`(可返回还原),沿用现有 URL 同步模式。

**后端 `GET /library` 新增 `status=duplicate_groups`**(`routes/library.ts` 的 status 分支):
返回完整重复组 = 被隐藏的重复本 + 它们指向的正规本。
```sql
WHERE (status = 'duplicate'
       OR id IN (SELECT DISTINCT duplicate_of FROM books
                 WHERE duplicate_of IS NOT NULL AND duplicate_of != ''))
```
排序让同组聚拢:`ORDER BY COALESCE(NULLIF(duplicate_of,''), id), id`(此模式下覆盖默认排序)。

**移除**(`Library.vue` 模板 + 相关 state):
- 「问题书籍管理」按钮(`/library/problems` 路由与 `ProblemBooks` 视图**保留**,仅去工具栏入口,沿用既有"隐藏入口不删路由")。
- 「显示脏数据」`el-switch`(及 `includeDirty` state / URL 同步)。
- 「AI填充:全部/已填充/失败/未尝试」`el-select`(及 `aiFillFilter` state / URL 同步)。

## 2. AI 填充入口简化

- **移除** `Library.vue` 的「批量 AI 填充」按钮、`showFillDialog` 对话框及 `fillForce`/`fillEstimate`/`onStartFill`/`onResetFailedFills` 相关 state 与处理器(reset 处理器迁入扫描对话框)。
- AI 填充今后**只**经 `ScanOptionsDialog` 已有的「AI 批量填充」勾选执行。
- **`ScanOptionsDialog.vue` 「AI 功能」区新增两个按钮**(各带 `ElMessageBox.confirm` 二次确认):
  - `重置「填充失败」记录` → `POST /library/ai-fill-reset-failed`(已存在)。
  - `重置全部填充记录` → **新增** `POST /library/ai-fill-reset-all`。
- **新增后端 `POST /library/ai-fill-reset-all`**(admin):`UPDATE books SET ai_fill_version = NULL, ai_fill_status = NULL WHERE ai_fill_version IS NOT NULL OR ai_fill_status IS NOT NULL`,返回 `{ reset: <changes> }`。
- **`selectFillCandidates`(非 force)改为版本驱动**:
  现状:`WHERE status='normal' AND 非duplicate AND (缺author或summary) AND (version 为空或旧)`。
  改为:去掉"缺 author/summary"条件,只保留 `status='normal' AND 非duplicate AND (ai_fill_version IS NULL OR ai_fill_version < ?)`。
  理由:重置标记后(失败的或全部的)即可被扫描-填充重新选中;`maybeSet` 仍保护已有非空字段,故重填**只补缺失项**(评分、封面、空字段),不覆盖已有数据,安全。
  影响:首次带 AI 填充的扫描会处理所有未打版本戳的书(此前要求缺字段),token 略增但符合"填充全库"意图;打戳后稳态不变。

## 3. 评分检索

并入第 1 条魔法关键词,无独立 UI。(`ai填充`/`填充失败` 已覆盖。)

## 4. 豆瓣评分(rating)

- **DB**(`db.ts`):`books` 加列 `rating REAL`(可空,默认 NULL)。沿用现有 `ALTER TABLE ... ADD COLUMN` 幂等迁移模式。
- **抓取**(`utils/cover.ts` 重构 + 新增):
  - 抽出 `doubanSuggest(title): Promise<DoubanSuggest | undefined>` —— 发一次 suggest 请求并选出最佳条目(现 `fetchAndSaveCover` 内联逻辑);封面与评分**共用这一次请求**。
  - `fetchAndSaveCover` 改为接收/复用该条目下载封面。
  - 新增 `fetchRating(item): Promise<number | undefined>` —— 抓 `item.url`(豆瓣 subject 页),正则解析 `rating_num`(形如 `<strong class="ll rating_num" property="v:average"> 8.5 </strong>`)→ `parseFloat`;无效/抓不到返回 undefined。`try/catch` 吞错,12s 超时复用现有 `request()`。
- **集成**(填充两处):
  - `services/ai-batch-fill.ts`:在现 cover 块,先 `doubanSuggest(titleForCover)` 取 item;`!current.cover_url` 时下封面;新增 `current.rating == null` 时 `fetchRating(item)` 抓到则 `UPDATE books SET rating = ?`。
  - `routes/library.ts` 单本 `/ai-fill`:同样改为复用 item,补 rating 写入(`updates.push('rating = ?')`)。
- **前端**:
  - `types`:`Book` 加 `rating?: number | null`。
  - `BookCard.vue`:有 rating 时显示角标(如封面右上角 `★ 8.5`),无则不显示。
  - `BookDetail.vue`:信息区显示评分(有则 `豆瓣 8.5`,无则不显示或"暂无评分")。
  - `Library.vue` 排序:启用「网络评分」选项(去 `disabled` 与 `safeSortBy` 降级);后端 `ALLOWED_SORT_FIELDS` 加 `'rating'`,SQLite `ORDER BY rating DESC` 天然 NULL 殿后。

---

## 受影响文件

**后端**
- `src/db.ts` — 加 `rating` 列迁移
- `src/routes/library.ts` — `status=duplicate_groups`;`POST /ai-fill-reset-all`;`ALLOWED_SORT_FIELDS` 加 rating;单本 ai-fill 补 rating
- `src/services/ai-batch-fill.ts` — `selectFillCandidates` 版本驱动;批量填充集成 rating
- `src/utils/cover.ts` — 抽 `doubanSuggest`;新增 `fetchRating`

**前端**
- `src/views/Library.vue` — 魔法关键词映射;移除问题书籍按钮/脏数据开关/AI填充下拉/批量填充按钮+对话框;启用评分排序
- `src/components/ScanOptionsDialog.vue` — 两个重置按钮
- `src/components/BookCard.vue` — 评分角标
- `src/views/BookDetail.vue` — 评分显示
- `src/api/library.ts` — `aiFillResetAll`
- `src/types` — `Book.rating`

## 测试(TDD,后端)

- `title-lookup` 风格新增/扩展:
  - `library.ts` `duplicate_groups`:构造一组(正规本 + 2 重复本)+ 无关正常书,断言只返回这 3 本。
  - `ai-fill-reset-all`:置若干书版本/状态,调用后断言全部 NULL、返回 reset 计数。
  - `selectFillCandidates` 版本驱动:已填满字段但 version=NULL 的书**应**入选;version=当前的**不**入选。
  - `fetchRating` 解析:喂样例 HTML 断言解析出 8.5;无 `rating_num` 返回 undefined。(对解析函数做纯函数单测,网络部分 mock。)
  - 批量填充 rating 写库:mock `doubanSuggest`+`fetchRating` 返回 8.5,跑 `batchFill`,断言 `books.rating == 8.5`。
- 前端:`vue-tsc` typecheck + `vite build`,用户浏览器实测。

## 验证(端到端)

1. `cd backend && npm test`(全绿)+ `npx tsc --noEmit`(干净)。
2. `cd frontend && npm run typecheck && npm run build`。
3. 部署 `docker compose up -d --build`。
4. 浏览器实测:
   - 搜索框输入「重复」→ 列出完整重复组(含保留的正常本);「ai填充」→ 已填充;「填充失败」→ 失败;清空→全部;普通词→正常搜索。
   - 工具栏无:问题书籍/脏数据开关/AI填充下拉/批量填充按钮。
   - 扫描导入对话框有两个重置按钮;点「重置全部填充」确认后,勾「AI 批量填充」开始扫描 → 已填充的书被重新处理(补评分/封面)。
   - 已填充书出现豆瓣评分(卡片角标 + 详情);「网络评分」排序可用。
