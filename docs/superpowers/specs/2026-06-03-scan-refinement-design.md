# 扫描功能完善 — 设计稿

**日期:** 2026-06-03
**分支:** `scan_books_ai1`
**状态:** 已与用户确认，待写实现 plan

## 背景与目标

完整的 AI 书籍 agent 工程量大，已 **backlog 延后**（见任务 #10）。本次先把现有扫描功能完善并上线，聚焦三件事：

1. **去掉扫描时脆弱/昂贵的 AI**（AI 去重、系列归类），回归确定性的纯指纹判重。
2. **保留并强化 AI 填充**：跳过已处理的书，省 token；提供扫描内 + 书库两个入口。
3. **提速**：重扫时跳过未变动的文件，避免每次都重读全库 + 重建指纹。

非目标：AI agent、豆瓣评分（#5）、类似作品/搜索（#4/#6 已单独完成并合入）。这些留待 agent 阶段。

---

## 1. 数据模型变更

`books` 表新增 3 列（`backend/src/db.ts`，按现有 Plan 1 的幂等迁移方式 `ALTER TABLE … ADD COLUMN`，先 `PRAGMA table_info` 判存在）：

| 列 | 类型 | 含义 |
|---|---|---|
| `file_mtime` | `REAL` | 文件修改时间（`fs.Stats.mtimeMs`） |
| `fingerprint_version` | `INTEGER` | 建该指纹时的算法版本 |
| `ai_fill_version` | `INTEGER` | AI 填充该书时的逻辑版本 |

中央常量文件 `backend/src/services/scan-versions.ts`：

```ts
export const FINGERPRINT_VERSION = 1;
export const AI_FILL_VERSION = 1;
```

- 改了指纹算法 → `FINGERPRINT_VERSION++`，下次扫描自动全量重建指纹。
- 改了 AI 填充 prompt/逻辑 → `AI_FILL_VERSION++`，下次填充自动全量重填。

**迁移兼容**：现有书行的新列为 NULL。迁移脚本把已有非空 `fingerprint` 的行回填 `fingerprint_version = FINGERPRINT_VERSION`（视为当前算法所建）。`file_mtime` 保持 NULL，由跳过逻辑首次扫描时回填（见 §2，避免一次性重读全库）。

---

## 2. 增量跳过（核心提速）

`scan-walker.ts` 当前已有「有指纹 && !full_rescan → 跳过」，但**不检查文件是否变动、无版本概念**。升级为：

收集文件后，对每个 path 先 `fs.statSync` 只取 `size` + `mtimeMs`（不读内容）。预取 map 扩展为携带 `{ id, fingerprint, file_size, file_mtime, fingerprint_version }`。

**跳过（复用旧指纹，连文件都不读）的条件：**

```
existing 存在 && existing.fingerprint 非空
  && existing.fingerprint_version === FINGERPRINT_VERSION
  && existing.file_size === stat.size
  && (existing.file_mtime === stat.mtimeMs || existing.file_mtime == null)  // null → 迁移遗留，信任并回填
  && !options.full_rescan
```

- 命中 `file_mtime == null` 分支时，顺手把 `stat.mtimeMs` 写回该行（一次性回填，不重读文件）→ 老库升级后第一次扫描也不会全量重读。
- 不满足条件（新文件 / size 或 mtime 变了 / 版本过期 / full_rescan）→ 走 `processFile`（读+编码检测+建指纹），并写入 `file_size`、`file_mtime`、`fingerprint_version = FINGERPRINT_VERSION`。

`processFile` 内部那处重复的 skip 检查同步改成同一套条件（或在主循环统一判断后不再二次判）。

**效果**：没动过的大书库重扫只走目录 + stat，≈ 秒过。

---

## 3. 去掉扫描时的 AI（隐藏 UI，保留后端代码）

### walker
- **不再调用**：`judgeSoftDuplicateGroups`（AI 去重）、`extractSeriesCandidates`（正则系列）、`judgeFuzzySeriesGroups`（AI 系列）。
- **保留**：硬指纹去重——`buildCandidateGroups` 的 `hard_groups`（指纹完全相同）仍产出 `duplicate_groups`，走审核/auto。
- 灰区编码的 AI 验证（原挂在 `options.ai_dedup` 上）随之移除 → 不确定编码回到「标记乱码」的旧确定性行为。
- `ScanResult.series_groups` 恒为空数组；`ai_duplicate_groups` 恒为空数组。

### 类型与入参
- `ScanOptions`：移除 `ai_dedup`、`ai_series`；`mode` 枚举改为 `'auto' | 'review'`（删除 `hybrid`）。
- `scanOptionsSchema`（`library.ts`）同步：去掉 `ai_dedup`/`ai_series`，`mode` 枚举去掉 `hybrid`。

### 模式分发
- **删除 `hybrid` 分支**（代码一并删除，非保留）。只留 `auto` 与 `review`。

### 保留的后端代码
- `ai-dedup.ts` / `ai-series.ts` / `series-regex.ts` 及其导出函数**全部保留**，仅扫描流程不再调用，留给后续 agent 复用。
- （可选）暴露一个 dev/test 接口手动触发这些函数以便日后测试；非必需，本次可不做。

---

## 4. 系列功能全隐藏

- `frontend/src/views/Library.vue`：移除 `SeriesCard` 渲染与 `seriesApi.list()` 调用；列表恒定平铺（`series_grouped=false`，不再按 `series_id` 隐藏书 → 老数据里残留 `series_id` 的书也正常显示）。这会让此前为 #6 加的 `series_grouped=isUnfiltered` 逻辑自然失效但无害（全平铺后搜索本就能命中）。
- 隐藏系列详情入口（导航/路由跳转）。
- **保留** `SeriesCard.vue`、`SeriesDetail.vue`、系列路由、后端 `/library/series*` 接口（给 agent 阶段）。
- 不删除 DB 中已有的 `series_id` 数据（无害，被忽略）。

---

## 5. AI 批量填充：版本号 + 双重跳过

### 候选查询（扫描内 ai_fill 与书库按钮共用）

```sql
SELECT id, file_path, file_format FROM books
WHERE status = 'normal' AND duplicate_of IS NULL
  AND (author IS NULL OR author = '' OR summary IS NULL OR summary = '')
  AND (ai_fill_version IS NULL OR ai_fill_version < :AI_FILL_VERSION)
```

- 已有完整 author+summary 的书天然被第一组条件挡掉。
- `ai-batch-fill.ts`：每本处理后 **无论成功或失败** 都写 `ai_fill_version = AI_FILL_VERSION`。
- **关键收益**：一本 AI 查不到资料的书，以前每次扫描都重试（白烧 token），现在标了版本就不再重试；改进 prompt 后 `AI_FILL_VERSION++` 即可全量重填。
- `manually_edited_fields` 仍受保护，AI 不覆盖管理员手改过的字段（现有行为不变）。

### 强制重填
- `batchFill` 增加 `force?: boolean` 入参。`force=true` 时候选查询**同时忽略** `ai_fill_version` 条件 **和** author/summary 为空的过滤 → 对所有 `status='normal'` 非重复书重填；仍受 `manually_edited_fields` 保护（不覆盖手改字段）。供书库按钮的「强制重填」使用。

---

## 6. 两个 AI 填充入口

1. **扫描开关 `ai_fill`**：保留。扫描末尾对候选集批量填充（走 §5 跳过逻辑）。
2. **书库批量按钮**：新增
   - 后端 `POST /library/ai-fill`（admin），body `{ force?: boolean }`，对候选集跑 `batchFill`，复用现有扫描进度机制（`setScanProgress` / 进度条）返回一个 task id。
   - 前端 `Library.vue` 加「批量 AI 填充」按钮 + 对话框：先显示费用估算 → 「强制重填」勾选项 → 确认后触发，复用 `ScanProgressBar` 展示进度。

---

## 7. 费用估算

- `cost-estimator.ts` 与 `/scan/estimate`：移除 AI 去重/系列的估算分量，**只算 AI 填充**（候选书数 × 每本填充 token 估值）。
- 书库批量按钮的估算复用同一估算函数（按候选集大小，force 时按全库规模）。

---

## 受影响文件清单（供 plan 拆任务）

**后端**
- `db.ts` — 3 列迁移 + 回填
- `services/scan-versions.ts` —（新）版本常量
- `services/scan-walker.ts` — 增量跳过；移除 AI 去重/系列调用；删 hybrid 分支；ai_fill 版本感知
- `services/ai-batch-fill.ts` — 处理后标版本（成功/失败）；`force` 入参
- `services/cost-estimator.ts` — 仅算填充
- `services/batch-builder.ts` / `services/batch-applier.ts` — `NewBookPayload`/入库携带 `file_mtime` + `fingerprint_version`
- `routes/library.ts` — `scanOptionsSchema` 调整；新增 `POST /library/ai-fill`；`/scan/estimate` 仅填充
- `types/index.ts` — `ScanOptions`（去 ai_dedup/ai_series、mode 去 hybrid）；`NewBookPayload` 加列

**前端**
- `views/Library.vue` — 移除系列卡/系列拉取，恒平铺；加「批量 AI 填充」按钮 + 对话框
- `components/ScanOptionsDialog.vue` — 去掉 ai_dedup/ai_series 开关、去掉 hybrid 模式选项
- `types/` + api client — ai-fill 接口、ScanOptions 变更
- 系列详情入口隐藏（保留组件/路由）

**测试（TDD）**
- 增量跳过条件（版本/size/mtime/null 回填）单测
- AI 填充候选筛选（版本跳过 + force 忽略）单测
- 受影响的现有测试（scan-task / cost-estimator / batch-applier）更新

---

## 方案取舍记录
- **文件未变检测**：mtime+size（选）vs 内容采样哈希。后者要读文件，违背省时间初衷 → 选 mtime+size，版本号兜底算法变更。
- **AI 填充失败标记**：`ai_fill_version` 一字段统一（选）vs 单独布尔 `ai_fill_attempted`。版本号同时解决「跳过重试」与「prompt 升级重填」，更省。
- **去掉 AI 的方式**：隐藏 UI + 保留后端函数（选）vs 删代码。保留以便 agent 阶段复用。
- **hybrid 模式**：直接删除（用户确认）——失去 AI 待审内容后已无意义。
