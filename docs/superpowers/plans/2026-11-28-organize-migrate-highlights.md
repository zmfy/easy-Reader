# 学习版整理采纳迁移划线 / 导图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** TXT 目录 AI 整理采纳 keep_new_* 时，把原书的划线（含批注）与导图节点迁移到整理版，不再随原书删除或留在隐藏的原书上。

**Architecture:** PositionMapper 新增 `mapTextRange`（块级换算 + 在整理版章全文中按阅读器规则定位原文）；apply 事务外预算划线 / 导图位置，migrateReaderData 事务内写库；ApplySummary 增加计数，审核页显示。

**Spec:** `docs/superpowers/specs/2026-11-28-organize-migrate-highlights-design.md`

## Global Constraints

- 只在 study 系分支（feat/organize-highlights）。风格跟随所改文件；中文注释 / 文案；不引入依赖；不读 `.env`；不 push。
- 后端测试 `backend/` 下 `node --experimental-vm-modules node_modules/jest/bin/jest.js <files>`；前端 `frontend/` 下 `npx vue-tsc --noEmit`、`npx vitest run`。全量 + tsc 后提交；中文提交信息，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。TDD 先 RED 后 GREEN。
- 迁移在三种 keep_new_* 决定下都执行；划线找不到原文位置时**保留**（挂到换算出的章节，located=false），不得删除。
- 未定位 warning 文案：`N 条划线在整理版中没找到原文位置，已保留在对应章节（批注不受影响）`。
- 审核页结果行追加：`· 划线 N · 导图节点 N`。

## Review Focus

1. 删除类决定（keep_new_delete_record / keep_new_delete_file）后划线与导图节点仍存在且 book_id 为整理版（测试）。
2. 原书一章在整理版被拆成两章、划线在后半 → 定位到后一章（测试）。
3. 原文件不可用 / 按比例换算时不抛错，划线仍迁移（测试）。
4. 同一用户同一处有多次相同短文本（如「他说」）时，取离候选位置最近的一处（测试）。
5. 旧的审核结果（无 highlights 字段）前端显示不报错（类型可选）。

---

### Task 1: 迁移划线 / 导图

**Files:**
- Modify: `backend/src/services/txt-organize/position-map.ts`（`mapTextRange`）
- Modify: `backend/src/services/txt-organize/apply.ts`（事务外预算、migrateReaderData、ApplySummary）
- Modify: `frontend/src/types/index.ts`（OrganizeApplySummary.migrated 增加可选 highlights / mind_nodes）、`frontend/src/views/ScanBatchReview.vue`（结果行）
- Test: `backend/tests/services/txt-organize/position-map.test.ts`、`backend/tests/services/txt-organize/apply.test.ts`

**Interfaces:**
- Produces: `PositionMapper.mapTextRange(chapterIndex: number, start: number, text: string): Promise<{ chapterIndex: number; start: number; end: number; located: boolean }>`；`ApplySummary.migrated.highlights: number`、`mind_nodes: number`。

- [ ] **Step 1: 写失败测试**（沿用两测试文件现有的造书 / 整理 fixture）：
  - position-map：`mapTextRange 同章找得到`（返回整理版对应章、start/end 处文字等于 text、located=true）；`原章拆成两章，划线在后半 → 后一章`；`整理版找不到原文 → located=false，章节为换算章`；`多处相同短文本取离候选最近`；`forceProportional 时不抛错且在 mapChapter 章里找`。
  - apply：三种 keep_new_* 用 `it.each`：原书 2 条划线（1 条带批注）+ 1 个关联划线的导图节点（有 source_chapter/paragraph）+ 1 个不关联的导图节点 → 采纳后全部 book_id = 整理版，划线 start/end 处文字等于 text，导图节点 chapter_index 与关联划线一致、source 已换算；`summary.migrated.highlights === 2`、`mind_nodes === 2`；未定位划线时 warnings 含规定文案且划线仍在；keep_old 不迁移。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**（设计文档「做法」1–4）。纯文本取法与浏览器 textContent 一致（去标签、解码实体、块间不加分隔）。
- [ ] **Step 4: 运行通过；后端全量 + tsc；前端 vue-tsc + vitest。**
- [ ] **Step 5: 提交** `feat(organize): 学习版整理采纳时迁移划线、批注与导图节点`

### Task 2: 真书验证（控制器）

- [ ] 学习版镜像，导入《鬼吹灯》，API 在 3–4 章划线（含批注、含「165 天崩」所在原章）+ 导图节点；完全 AI 整理；`keep_new_delete_record` 采纳；确认划线 / 批注 / 导图在整理版且文字对得上；清理临时容器。
