# 隐含分卷与非「第N章」标题识别 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 AI 整理能识别只靠书名前缀表示的分卷、「数字＋章名」的章节标题，以及卷前言的归属。

**Architecture:** candidates 扩大候选行；judge 的 chapter 标签可带经原文校验的 `volumeTitle`，跨批摘要带上推断卷；structure 的 inferGroups 按 volumeTitle 建卷、按卷名合并重复卷、在安全时把卷前言放入其卷。writer / apply 不变。

**Tech Stack:** Node + TypeScript + jest。

**Spec:** `docs/superpowers/specs/2026-11-28-txt-organize-volume-inference-design.md`（含「实施前补充决定」1–5）

## Global Constraints

- 风格跟随所改文件；中文注释 / 文案；不引入新依赖；不读 `.env`；不 push。
- 测试：`backend/` 下 `node --experimental-vm-modules node_modules/jest/bin/jest.js <files>`；每个任务提交前跑全量后端测试和 `npx tsc --noEmit`。
- 每个任务一个提交，中文提交信息，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。TDD：先 RED 后 GREEN。
- 卷名必须是原行去空白后的连续子串，否则丢弃（不判批次无效）。
- 同一卷不建两次；「第Y卷<卷名> 第Z章」前缀分支优先于 volumeTitle。
- 卷名比较沿用 `namesMatch`（相等或互相包含）。

## Review Focus

1. AI 在同一卷内多批重复给出同一 volumeTitle：不得重复建卷（Task 3 测试）。
2. AI 给的 volumeTitle 与上一个独立卷同名：不新建（Task 3 测试）。
3. 推断卷之后出现同名「第四卷 巫峡棺山 第四十五章」：不新建，章节留在该卷（Task 3 测试）。
4. 卷标题行后有正文时不重排前言，输出顺序与原文一致（Task 3 测试）。
5. 含句号的普通正文行（「3年后他回来了。」）不进候选（Task 1 测试）。

---

### Task 1: 候选行纳入「数字＋章名」

**Files:**
- Modify: `backend/src/services/txt-organize/candidates.ts`
- Test: `backend/tests/services/txt-organize/candidates.test.ts`

**Interfaces:**
- Produces: `collectCandidates` 行为扩展，签名不变。

- [ ] **Step 1: 写失败测试**（沿用该测试文件构造临时 TXT 的写法）：
  - `数字＋章名进候选`：「165 天崩」「158影骨」「183 古格银眼」「1．10：古物的命名方式」→ 都在 candidates 中，`ruleHint` 为解析器给的值（通常 `none`）。
  - `含句内或句末标点不进`：「3年后他回来了。」「2010年，他来了」→ 不在 candidates。
  - `超过 24 字不进`：「12 」+ 23 个汉字 → 不在。
  - `纯数字不进`：「2010」→ 不在。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**：新增常量正则（去空白前判断）：`^[0-9０-９]{1,4}[\s　.．、:：]*[^\d\s０-９。！？；，,.!?]` 开头、整行 ≤ 24 字、不含 `。！？；，,!?`；与现有 `CANDIDATE_START_RE` 条件取或。
- [ ] **Step 4: 运行通过；全量后端 + tsc。**
- [ ] **Step 5: 提交** `feat(organize): 「数字＋章名」的行也作为候选交给 AI 判断`

### Task 2: judge 支持 volumeTitle

**Files:**
- Modify: `backend/src/services/txt-organize/judge.ts`（`Label`、INSTRUCTIONS、`parseBatch`、`structureSummary`）
- Test: `backend/tests/services/txt-organize/judge.test.ts`

**Interfaces:**
- Produces: `Label.volumeTitle?: string`（仅 chapter；已校验为原行去空白后的连续子串，值为 AI 给出的原样去首尾空白字符串）。

行为：
- INSTRUCTIONS 增加两条说明（spec「2. 判定」）并在 JSON 示例中加一个带 `"volumeTitle":"云南虫谷"` 的 chapter。
- `parseBatch`：volumeTitle 若 type≠chapter、非字符串、去空白后为空、或 `compact(volumeTitle)` 不是 `compact(行文字)` 的子串（compact = 去所有空白）→ 丢弃并 `repaired++`；合法则保留。
- `structureSummary`：遇到带 volumeTitle 的 chapter，`volume = volumeTitle`（部不变），使「当前卷」反映推断卷。

- [ ] **Step 1: 写失败测试**：
  - `volumeTitle 合法保留`：行「《鬼吹灯之云南虫谷》 第一百章 人皮地图」，AI 给 `{type:'chapter', volumeTitle:'云南虫谷'}` → label.volumeTitle === '云南虫谷'。
  - `不在原行中 → 丢弃并计入补全`：给「昆仑神宫」→ 无 volumeTitle；notes 含「标签格式不全，已按保守方式处理」。
  - `非 chapter 带 volumeTitle → 丢弃`：type noise 带 volumeTitle → 无该字段。
  - `提示词含新说明`：prompt 含「183 古格银眼」和「volumeTitle」。
  - `下一批摘要的当前卷为推断卷`：两批，第一批某 chapter 带 volumeTitle「云南虫谷」→ 第二批 prompt 含「当前卷：」后跟包含「云南虫谷」的文字。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 运行通过；全量后端 + tsc。**
- [ ] **Step 5: 提交** `feat(organize): AI 可在章节标签上指出新分卷（卷名须摘自原文）`

### Task 3: structure 按 volumeTitle 建卷、按名合并、卷前言归位

**Files:**
- Modify: `backend/src/services/txt-organize/structure.ts`（`inferGroups`、`displayTitle` 的 BOOK_NAME_PREFIX_RE、`buildStructure` 中前言重排所需的最小改动）
- Modify: `CHANGELOG.md`（[Unreleased] 一句：「AI 整理能识别只靠书名前缀表示的分卷和『数字＋章名』的章节」）
- Test: `backend/tests/services/txt-organize/structure.test.ts`

**Interfaces:**
- Consumes: `Label.volumeTitle`（Task 2）。
- Produces: `buildStructure` 签名不变。

行为（spec「3. 结构」+ 补充决定 2/3/5）：
- 维护 `curVolumeName`（独立卷行：`headingParts(text).name`；前缀卷：前缀里「第Y卷」之后的卷名去标点；volumeTitle 卷：volumeTitle 去标点）；进入新部（含推断部）时清空。
- 前缀分支（`VOLUME_PREFIX_RE`）先判：卷名与 `curVolumeName` namesMatch → 视为同一卷，只更新 `curVolume = Y`；否则按现有编号规则。命中前缀分支的行忽略其 volumeTitle。
- 未命中前缀分支的 chapter 带 volumeTitle：与 `curVolumeName` 不匹配 → 在该章前插入 `{type:'volume', title: volumeTitle, synthetic: true}`，`curVolume = null`，`curVolumeName` 更新；匹配 → 忽略。
- 独立卷行：编号等于 `curVolume` **或** 卷名与 `curVolumeName` namesMatch → 视为重复卷标题（沿用现有 dropLines + note）。
- 卷前言：chapter 行匹配 `VOLUME_START_RE` 且不含章号，下一个结构性条目是编号相同的独立卷行，且该卷行与再下一个结构性条目之间没有正文 → 输出顺序变为「卷 → 该前言章 → …」；字节区间仍按原文位置算；否则不变并记 note `第 N 行像是卷前言，但卷标题后有正文，未调整位置：<行文字>`。
- notes：volumeTitle 建卷时记 `AI 指出 N 处新分卷：<卷名1>、<卷名2>…`。
- `displayTitle`：BOOK_NAME_PREFIX_RE 放宽为后面紧跟「第…」或阿拉伯 / 全角数字。

- [ ] **Step 1: 写失败测试**（用该文件现有的 candidates/labels 构造辅助）：
  - `volumeTitle 建卷`：卷「第一卷 甲」、章1、章2、章3(volumeTitle「云南虫谷」)、章4 → 结构为 卷甲[章1,章2]、卷「云南虫谷」[章3,章4]；notes 含「AI 指出 1 处新分卷：云南虫谷」。
  - `与上一独立卷同名不新建`：「第一部第二卷《龙岭迷窟》」后紧跟带 volumeTitle「龙岭迷窟」的章 → 只有一个卷。
  - `同一卷多次给出 volumeTitle 不重复建卷`：连续两章都带「云南虫谷」→ 一个卷。
  - `推断卷后同名前缀不新建`：章(volumeTitle「巫峡棺山」)…「第四卷 巫峡棺山 第四十五章 奇遇」→ 只有一个「巫峡棺山」卷，第四十五章在其下且显示「第四十五章 奇遇」。
  - `短卷名与长卷名视为同卷`：卷「第二卷《龙岭迷窟》」+ 章(volumeTitle「龙岭」) → 不新建。
  - `不同卷名不误合并`：推断卷「云南虫谷」后章(volumeTitle「昆仑神宫」) → 新建第二个推断卷。
  - `卷前言归位`：章「第三卷 怒晴湘西 前言」(chapter，有正文)、卷「第三卷 怒晴湘西」(volume，后无正文)、章「第一章 琉璃厂」→ 卷「第三卷 怒晴湘西」下依次为 前言章、第一章。
  - `卷标题后有正文不重排`：同上但卷行后有正文 → 顺序不变，notes 含「未调整位置」。
  - `displayTitle 去书名前缀（数字）`：`displayTitle('《鬼吹灯之昆仑神宫》 178 死亡收藏者', {})` === `'178 死亡收藏者'`。
  - 现有 structure 用例全部原样通过。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现。**
- [ ] **Step 4: 运行通过；全量后端 + tsc。**
- [ ] **Step 5: 提交** `feat(organize): 按 AI 指出的新分卷建卷、同名卷合并、卷前言归入其卷`

### Task 4: 真书验证（控制器）

- [ ] 重建 `easyreader-app:e2e`，在 er-e2e 上完全 AI 整理《鬼吹灯》：第一部 4 卷（精绝古城 / 龙岭迷窟 / 云南虫谷 / 昆仑神宫）、第二部 4 卷（黄皮子坟 / 南海归墟 / 怒晴湘西 / 巫峡棺山，后者含第一章起）；「165 天崩」「183 古格银眼」等进入目录；「第三卷 怒晴湘西 前言」在第三卷下。未达标：调一轮提示词（回到 Task 2 补测试）后重跑；仍未达标记录差异交用户。
- [ ] 完全 AI 重跑《凡人修仙传》，与 `.superpowers/sdd/2026-11-27-txt-ai-organize/fanren-full-ai-toc-20261128.txt` diff：分卷一致、差异逐条解释。
- [ ] 结果写入 progress。
