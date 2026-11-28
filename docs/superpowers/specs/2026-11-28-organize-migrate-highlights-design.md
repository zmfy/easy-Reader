# 学习版：AI 整理采纳时迁移划线 / 批注 / 导图 — 设计

日期：2026-11-28　分支：feat/organize-highlights（基于 study）　用户已批准

## 为什么

学习版的划线（含批注）、导图节点挂在书上。TXT 目录 AI 整理采纳「保留整理版」时，现有迁移只处理阅读进度、书签、书架、阅读历史：
- 选「删除原书记录 / 删除原文件」→ `deleteBookRelations` 把原书的 highlights、mind_nodes 一起删掉，**不可恢复**；
- 选「隐藏原书」→ 数据留在被隐藏的原书上，整理版看不到。

## 目标

三种 keep_new_* 决定都把原书的划线、导图节点迁移到整理版，与进度等一起，在同一事务内写库。

## 数据与前端行为

- `highlights(chapter_index, start_offset, end_offset, text, note)`：偏移是阅读器 `.chapter-content` 的 `textContent` 中的 [start, end)（章节 HTML 全部文本，含被 `hidden` 的章首标题）。
- 阅读器 `locateHighlight`：存的偏移处文字不等于 text 时，在本章全文里找 text，取离存储起点最近的一处；找不到就不画。
- `mind_nodes(chapter_index, highlight_id, source_chapter, source_paragraph)`；`ai_expansions` 是可再生缓存。

## 做法

1. **事务外换算**（与 mappedProgress 一起）：`PositionMapper` 新增
   `mapTextRange(chapterIndex, start, text): Promise<{ chapterIndex, start, end, located: boolean }>`
   - 取原书该章 HTML（TxtParser），按块（`<p>` / `<h1>`–`<h6>`）切出各块纯文本及其在章全文中的起点，找到 start 所在块 p 与块内偏移 d；
   - 用现有逻辑（同 mapProgress）把 (章, p) 换到整理版 (章 k, 段 q)；
   - 取整理版第 k 章 HTML（EpubParser），算出第 q 块在章全文中的起点 → 候选位置 = 起点 + d；
   - 在第 k 章全文里按阅读器同样的规则找 text（候选处相等直接用，否则取离候选最近的一处）→ located；找不到再依次试 k−1、k+1 章；都找不到 → 返回第 k 章、候选位置（end = start + text.length），located = false；
   - 原文件不可用 / 按比例换算时：章节按 mapChapter，偏移原样，再在该章里找 text。
   - 纯文本取法须与浏览器 textContent 一致：去标签、解码实体（复用 `decodeHtmlEntities` / `unescapeHtml`），块之间不加分隔。
2. **导图节点**：source_chapter/source_paragraph 有值时用 `mapProgress` 换算（事务外）；chapter_index：有 highlight_id 且该划线已迁移 → 用划线的新章节，否则 `mapChapter`。
3. **事务内**（migrateReaderData）：`UPDATE highlights SET book_id, chapter_index, start_offset, end_offset, updated_at 不变`；`UPDATE mind_nodes SET book_id, chapter_index, source_chapter, source_paragraph`。ai_expansions 不迁移（删原书时随原书清除）。
4. **统计与提示**：`ApplySummary.migrated` 增加 `highlights`、`mind_nodes`；未定位的划线数 > 0 时 warnings 加「N 条划线在整理版中没找到原文位置，已保留在对应章节（批注不受影响）」。前端 `OrganizeApplySummary` 类型与审核页结果行显示「划线 N · 导图节点 N」。

## 不做

- 改变阅读器划线定位规则；迁移 ai_expansions；keep_old 决定（无需迁移）。

## 验证

- 单元测试（position-map / apply）：同章原文找得到；原章被拆成两章、划线在后一章 → 相邻章找到；整理版里找不到 → 保留、located=false、计入 warning；导图节点随划线迁移、出处换算；三种 keep_new_* 都迁移，删除类决定后划线仍在。
- 真书（控制器）：学习版镜像导入《鬼吹灯》，在几章里划线写批注（含后来新识别出的「165 天崩」所在章），AI 整理后选「删除原书记录」，确认划线与批注在整理版、文字对得上。
