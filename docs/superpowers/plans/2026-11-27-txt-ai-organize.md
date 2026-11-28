# TXT 目录 AI 整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 读者对 TXT 发起「AI 整理目录」→ AI 逐行判定候选标题行 → 程序按原文抄写生成三层目录的 EPUB 整理版（存数据目录）→ 原书与整理版进入一条重复审核，管理员决定保留哪本，保留整理版时迁移所有读者的阅读数据。

**Architecture:** 新模块 `backend/src/services/txt-organize/`：逐行读取（lines）→ 挑候选行（candidates）→ AI 分批判定（judge）→ 生成章节结构并逐字校验（structure）→ 写 EPUB（writer）→ 后台任务（job）→ 审核决定与数据迁移（apply）。审核复用 `scan_batches` / `scan_batch_items`，新增批次类型 `organize`（不阻塞扫描）和审核项类型 `organized_duplicate`。整理版是一本 `status = 'pending_review'` 的新书，审核前对书库、搜索、OPDS 不可见。

**Tech Stack:** Node.js + Express + TypeScript + better-sqlite3（后端，jest）；Vue 3 + Element Plus（前端，vitest）；已有 `aiManager.chat`、`writeEpub`、`deleteBookCascade`、`addNotice`、`resolveRealPathInsideRoot`。

**Spec:** `docs/superpowers/specs/2026-11-27-txt-ai-organize-design.md`

## Global Constraints

- 只处理 TXT；正文一个字都不经过 AI，AI 只看候选行。
- 从正文去掉的只有三种行：作为标题的行本身、`duplicate` 行、`noise`+`kind: stray_number` 且去掉空白后整行只有「第 N 章 / 节 / 回 / 集」的行。其余原文一律保留（前言也原样保留，不做推广行过滤）。
- 逐字校验以原始文件逐行为准（去掉上述三种行、空行、行首尾空白后拼接），整理版正文必须完全一致，否则任务失败、删除生成的文件、不生成审核。
- 整理版文件：`DATA_DIR/organized/<整理版书籍 id>.epub`；书库文件夹不写入任何文件。
- 整理版书名：`原书名（整理版）`，审核保留后去掉「（整理版）」。
- 读者限制：同一本书同时只有一个整理任务（进行中或待审核）；非管理员每人每天最多 3 次；设置项 `txt_organize_allow_readers`（默认 `'1'`），为 `'0'` 时只有管理员能发起。
- AI 分批：每批约 300 行，相邻批重叠 20 行（重叠部分以后一批为准）；解析失败或数量对不上重试一次，仍失败则整个任务失败。
- 书签只迁移到章节（`scroll_top` 置 0）；阅读进度精确到段落。
- 审核页显示调用批次数和候选行数，不显示 token 用量；不改 `AiPlugin` 接口。
- 只在 main 上开发；学习版的高亮 / 笔记迁移在合并到 study 时补（本计划不含）。
- 后端测试命令：`cd backend && yarn test`（脚本带 `--experimental-vm-modules`，不要直接 `npx jest`）；前端：`cd frontend && yarn typecheck && yarn test`。
- 风格：中文注释、跟随相邻文件写法；所有 SQL 在 better-sqlite3 同步事务里做。

## Review Focus

1. **8000 万字节级的书（《校花的贴身高手》86MB、约 1.5 万候选行）**：读行、挑候选、写 EPUB 全程流式，内存不随文件线性增长，期间不阻塞事件循环超过 200ms（主线程 CPU）。→ Task 2、6 各加一个大文件测试。
2. **AI 返回乱的 JSON / id 对不上 / 少行**：重试一次后整个任务失败，不留下半成品书、文件或审核项。→ Task 3、7 测试。
3. **发起后、审核前原 TXT 被删或被改**：审核「保留整理版」照常可做（整理版是独立文件）；「保留原书」时原书已不存在则只删整理版。迁移进度时原文件解析不了，进度按章节序号就近换算而不是报错。→ Task 9 测试。
4. **服务重启时任务正在跑**：重启后任务从头重跑，不会卡在 running，也不会生成两份整理版。→ Task 7 测试。
5. **读者进度在原书最后一章之后 / 原书从未解析过 / 书签章号越界**：迁移时夹到有效范围内，不抛错。→ Task 8 测试。

---

### Task 1: 数据表、书籍状态与可见性

**Files:**
- Modify: `backend/src/db.ts`（books 加列、scan_batches 加列、新表）
- Modify: `backend/src/services/opds-catalog.ts:8-9`、`backend/src/routes/library.ts:94`（可见性加 `pending_review`）
- Modify: `backend/src/types/index.ts`（`Book` 加字段）
- Test: `backend/tests/services/txt-organize-schema.test.ts`

**Interfaces:**
- Produces:
  - `books.organized_from TEXT`（原书 id）、`books.organized_job_id TEXT`；`books.status = 'pending_review'` 为新状态值。
  - `scan_batches.kind TEXT DEFAULT 'scan'`（取值 `'scan' | 'organize'`）。
  - 表 `txt_organize_jobs(id TEXT PK, book_id TEXT NOT NULL, requested_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' /* pending/running/review/failed/done */, phase TEXT, batches_done INTEGER DEFAULT 0, batches_total INTEGER DEFAULT 0, candidate_count INTEGER DEFAULT 0, notes TEXT /* JSON string[] */, src_size INTEGER, src_mtime REAL /* 整理时原文件的大小和修改时间 */, result_book_id TEXT, error TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, finished_at DATETIME)`，索引 `(book_id)`、`(requested_by, created_at)`。
  - 表 `txt_organize_chapter_map(book_id TEXT NOT NULL /* 整理版 id */, chapter_index INTEGER NOT NULL, src_start INTEGER NOT NULL, src_end INTEGER NOT NULL, PRIMARY KEY(book_id, chapter_index))`，字节区间指原 TXT（UTF-16 原文时指转码后的 UTF-8 缓冲区，与 TxtParser 一致）。
  - 表 `txt_organize_rejections(book_id TEXT NOT NULL, file_size INTEGER NOT NULL, file_mtime REAL, rejected_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(book_id, file_size))`。
  - 启动时 `UPDATE txt_organize_jobs SET status='pending' WHERE status='running'`（同 ai_apply_jobs）。
  - `VISIBLE_BOOK_SQL` 与书库列表的排除列表都加上 `'pending_review'`。

- [ ] **Step 1: 写失败的测试** `txt-organize-schema.test.ts`：
  - `it('新表和新列存在')`：`PRAGMA table_info(books)` 含 `organized_from`、`organized_job_id`；`scan_batches` 含 `kind` 且默认 `'scan'`；三张新表存在。
  - `it('pending_review 的书不出现在 OPDS 可见书籍里')`：插入一本 `status='pending_review'` 的书，`SELECT COUNT(*) FROM books WHERE ${VISIBLE_BOOK_SQL}` 为 0。
  - `it('启动时 running 的整理任务回到 pending')`。
- [ ] **Step 2: 运行，确认失败**：`cd backend && yarn test tests/services/txt-organize-schema.test.ts` → FAIL（列 / 表不存在）。
- [ ] **Step 3: 实现**：在 `db.ts` 按现有 `try { ALTER … } catch {}` 写法加列、`CREATE TABLE IF NOT EXISTS` 建表；改两处可见性列表。
- [ ] **Step 4: 运行，确认通过**，并跑 `yarn test tests/routes/opds.test.ts tests/services/opds-catalog.test.ts` 不回归。
- [ ] **Step 5: 提交** `feat(organize): 整理任务相关数据表与 pending_review 状态`。

---

### Task 2: 逐行读取与候选行

**Files:**
- Create: `backend/src/services/txt-organize/lines.ts`
- Create: `backend/src/services/txt-organize/candidates.ts`
- Modify: `backend/src/plugins/parser-txt.ts`（导出 `detectEncoding` 已有；新增导出 `TxtParser.getHeadingStarts()`）
- Test: `backend/tests/services/txt-organize/candidates.test.ts`

**Interfaces:**
- Produces:
  - `interface TxtLine { lineNo: number; byteStart: number; byteEnd: number; text: string }`（`text` 已解码、未 trim；`byteEnd` 不含换行符）。
  - `readTxtLines(filePath: string): AsyncGenerator<TxtLine>`：编码识别、UTF-16 转码、只用 CR 换行的处理与 `TxtParser.load` 一致（字节位置与 TxtParser 的 `startByte` 同一坐标系）；流式读取。
  - `TxtParser.getHeadingStarts(): Array<{ byte: number; level: number }>`：现有规则切出的每个章节起点及目录层级（无层级为 0），供候选行附「规则判定」用。
  - `interface Candidate { id: number /* 从 0 连续 */; lineNo: number; byteStart: number; byteEnd: number; text: string /* trim 后 */; bodyChars: number /* 到下一候选行之间非空正文字数 */; bodyLines: number; prevSnippet: string /* 前一行非空正文前 20 字 */; nextSnippet: string; ruleHint: 'heading' | 'volume' | 'none' }`
  - `collectCandidates(filePath: string, parser: TxtParser): Promise<{ candidates: Candidate[]; totalLines: number }>`
  - 候选条件：trim 后 1〜60 字，且以 `第 | 正文 | 【［[〔（( | chapter(不分大小写) | 楔子 | 序 | 引子 | 前言 | 尾声 | 后记 | 终章 | 番外 | 《` 开头；或其字节起点在 `getHeadingStarts()` 里。

- [ ] **Step 1: 写失败的测试**（用临时文件）：
  - `it('UTF-8 / GBK / UTF-16LE / 只用 CR 换行的同一文本，readTxtLines 给出相同的行文字')`。
  - `it('byteStart 与 TxtParser 章节 startByte 一致')`：`getHeadingStarts()` 里每个 byte 都能在 `readTxtLines` 的某行 `byteStart` 找到。
  - `it('挑出各类候选行，并算出 bodyChars / 前后片段')`：文本含「第二章青牛镇」「第2章」「第二卷《山水郎》结束。」「【求月票】」正文行等，断言候选的 `text` 列表、`第2章` 的 `bodyChars` 等于其后正文字数、`ruleHint`。
  - `it('长正文行和非候选开头的行不是候选')`。
  - `it('86MB 级文件流式处理：生成 30MB 合成文本，collectCandidates 期间 heapUsed 增长 < 100MB')`（Review Focus 1）。
- [ ] **Step 2: 运行，确认失败**：`yarn test tests/services/txt-organize/candidates.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现** `readTxtLines`（`fs.createReadStream` 256KB 块，按 0x0a 切行；非 UTF-8 用 iconv 解码单行）、`collectCandidates`（一次遍历，候选之间累计 bodyChars / bodyLines）、`getHeadingStarts`。
- [ ] **Step 4: 运行，确认通过**；跑 `yarn test tests/plugins/parser-txt.test.ts` 不回归。
- [ ] **Step 5: 提交** `feat(organize): TXT 逐行读取与候选标题行`。

---

### Task 3: AI 分批判定

**Files:**
- Create: `backend/src/services/txt-organize/judge.ts`
- Test: `backend/tests/services/txt-organize/judge.test.ts`

**Interfaces:**
- Consumes: `Candidate`（Task 2）；`aiManager.chat(prompt, db)`（已有，返回字符串）。
- Produces:
  - `type LabelType = 'part' | 'volume' | 'chapter' | 'duplicate' | 'noise'`
  - `interface Label { id: number; type: LabelType; title?: string /* part/volume/chapter 必有 */; noiseKind?: 'stray_number' | 'text' /* noise 必有 */ }`
  - `interface JudgeResult { labels: Label[] /* 与 candidates 一一对应、按 id 排序 */; notes: string[]; batches: number }`
  - `judgeCandidates(candidates: Candidate[], book: { title: string; author?: string | null }, db: Database.Database, onBatch?: (done: number, total: number) => void): Promise<JudgeResult>`
  - `export const JUDGE_BATCH_SIZE = 300; export const JUDGE_OVERLAP = 20;`
  - 每批提示词附：书名、作者、上一批结束时的结构摘要（当前部名 / 卷名、最近 5 个章节标题）；要求只返回 JSON `{"labels":[{id,type,title?,noiseKind?}],"notes":[]}`。提示词正文由实施者写，须说明：`title` 只去掉附言 / 水印 / 卷名前缀，不改写章名、不转换数字。
  - 校验（失败即本批无效）：JSON 可解析；本批每个 id 恰好出现一次；`type` 合法；`part/volume/chapter` 有非空 `title`；`noise` 有 `noiseKind`。
  - 全局校验（失败抛错）：至少一个 `chapter`；第一个非 noise 标签不能是 `duplicate`。
  - 本批无效 → 重试一次 → 仍无效则抛 `Error('AI 判定失败：第 N 批')`。

- [ ] **Step 1: 写失败的测试**（`jest.spyOn(aiManager, 'chat')` 返回预设 JSON）：
  - `it('分批：700 个候选分 3 批，相邻批重叠 20 行，重叠部分以后一批为准')`：第二批返回的重叠行标签与第一批不同，结果取第二批。
  - `it('每批提示词带上一批的结构摘要')`：第二次调用的 prompt 包含第一批最后一个章节标题。
  - `it('返回非 JSON 时重试一次后成功')`、`it('两次都缺 id → 抛错，错误信息含批号')`（Review Focus 2）。
  - `it('没有任何 chapter → 抛错')`、`it('notes 汇总各批')`、`it('onBatch 回调按批报告进度')`。
- [ ] **Step 2: 运行，确认失败**。
- [ ] **Step 3: 实现**（JSON 提取用已有的 `extractJsonObject`，`backend/src/ai/json-extract.ts`）。
- [ ] **Step 4: 运行，确认通过**。
- [ ] **Step 5: 提交** `feat(organize): AI 分批判定候选标题行`。

---

### Task 4: 章节结构与逐字校验

**Files:**
- Create: `backend/src/services/txt-organize/structure.ts`
- Test: `backend/tests/services/txt-organize/structure.test.ts`

**Interfaces:**
- Consumes: `Candidate`、`Label`、`TxtLine`、`readTxtLines`。
- Produces:
  - `interface OrgSection { level: 0 | 1 | 2; title: string; groupOnly: boolean /* 没有正文的部 / 卷：只作目录分组 */; srcStart: number; srcEnd: number /* 原文字节区间，含标题行 */ }`
  - `interface OrgStructure { sections: OrgSection[]; dropLines: Set<number> /* 要从正文去掉的 lineNo：标题行、duplicate、合格的 stray_number */; preface: { srcStart: number; srcEnd: number } | null }`
  - `buildStructure(candidates: Candidate[], labels: Label[], fileSize: number): OrgStructure`
    - 层级：有 part 的书 part=0、volume=1、chapter=2；没有 part 时 volume=0、chapter=1；都没有时 chapter=0。卷不在部里、章不在卷里时取上一层可用的层级（不跳级）。
    - 部 / 卷标题行后、下一个标题之前没有非空正文行 → `groupOnly = true`。
    - `stray_number` 只有满足 `/^第[零〇一二两三四五六七八九十百千万\d]+[章节回集]$/`（去空白后）才进 `dropLines`，否则当正文。
  - `isStrictStrayNumber(text: string): boolean`（导出供测试）。
  - `verifyVerbatim(filePath: string, structure: OrgStructure, renderedChapters: AsyncIterable<string> /* 各章正文纯文本，段落以 \n 分隔，不含生成的标题 */): Promise<{ ok: true } | { ok: false; firstDiffAt: number }>`：左边 = 原文逐行去掉 `dropLines`、空行、行首尾空白后用 `\n` 拼接；右边 = 各章段落拼接；流式比较。

- [ ] **Step 1: 写失败的测试**：
  - `it('《凡人修仙传》写法：chapter + stray_number 合并，第2章行进 dropLines，正文连续')`。
  - `it('AI 把含正文的行判成 stray_number（如「第2章韩立说」）→ 不删，当正文')`。
  - `it('《鬼吹灯》写法：part/volume/chapter 三层，带引言的卷不是 groupOnly')`。
  - `it('只有 chapter 的书 level 全为 0；章不在卷里时不跳级')`。
  - `it('前言：第一个标题之前的内容成为 preface')`。
  - `it('verifyVerbatim：正文少一个字 → ok=false 并给出位置；完全一致 → ok=true')`。
- [ ] **Step 2: 运行，确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行，确认通过**。
- [ ] **Step 5: 提交** `feat(organize): 由判定结果生成章节结构并逐字校验`。

---

### Task 5: EPUB 写出支持三层目录

**Files:**
- Modify: `backend/src/services/epub-builder.ts`（`EpubTocEntry`、`groupChapters`、nav.xhtml、toc.ncx）
- Test: `backend/tests/services/epub-builder.test.ts`（追加）

**Interfaces:**
- Produces: `EpubTocEntry` 新增可选 `level?: number`（0 起）。有任一条目带 `level` 时，nav 和 ncx 按层级嵌套 `<ol>` / `navPoint`；`groupOnly` 的部 / 卷用新增可选字段 `groupOnly?: boolean` 表示：只写目录分组（nav 里 `<span>`，ncx 里指向下一章），不生成正文文件。都不带 `level` 时输出与现在逐字节相同（OPDS 现有转换不受影响）。

- [ ] **Step 1: 写失败的测试**：
  - `it('三层目录：nav.xhtml 嵌套两层 ol，toc.ncx navPoint 嵌套，playOrder 连续')`。
  - `it('groupOnly 条目不生成 xhtml 文件，但出现在目录里')`。
  - `it('不带 level 时输出与修改前一致')`：对现有一个测试用例的输出做快照比对（取修改前的 nav.xhtml 字符串写进测试）。
- [ ] **Step 2: 运行，确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行，确认通过**；跑 `yarn test tests/services/opds-download.test.ts` 不回归。
- [ ] **Step 5: 提交** `feat(epub): 逐章写出支持三层目录`。

---

### Task 6: 写出整理版 EPUB

**Files:**
- Create: `backend/src/services/txt-organize/writer.ts`
- Test: `backend/tests/services/txt-organize/writer.test.ts`

**Interfaces:**
- Consumes: `OrgStructure`、`verifyVerbatim`（Task 4）；`writeEpub`（Task 5，带 `level` / `groupOnly`）；`readTxtLines`。
- Produces:
  - `organizedDir(): string` → `path.join(DATA_DIR, 'organized')`（DATA_DIR 取法同 `utils/cover.ts`），不存在时创建。
  - `interface WriteResult { filePath: string; chapterMap: Array<{ chapterIndex: number; srcStart: number; srcEnd: number }> /* 只含有正文文件的章节（含前言），chapterIndex 与 EpubParser 读回后的序号一致 */ }`
  - `writeOrganizedEpub(input: { newBookId: string; sourcePath: string; structure: OrgStructure; title: string; author?: string | null; summary?: string | null; cover?: { buffer: Buffer; mimeType: string } | null }): Promise<WriteResult>`：前言章节标题为「前言」；各章正文 = 区间内的行去掉 `dropLines` 和空行，每行一个 `<p>`（HTML 转义）；写完调用 `verifyVerbatim`，失败则删除文件并抛 `Error('整理结果与原文不一致')`。

- [ ] **Step 1: 写失败的测试**：
  - `it('生成的 EPUB 用 EpubParser 读回：章节数、标题、层级与结构一致')`。
  - `it('读回的全部正文与原文（去掉标题行等）逐字一致')`。
  - `it('chapterMap 的 chapterIndex 与 EpubParser 章节序号对应，区间覆盖原文')`。
  - `it('校验失败时不留下文件')`：用一个故意不一致的结构（mock `verifyVerbatim` 返回 false），断言文件不存在。
  - `it('30MB 合成文本：写出期间主线程最长占用 < 200ms（process.threadCpuUsage）')`（Review Focus 1，写法同 `epub-builder.test.ts` 现有用例）。
- [ ] **Step 2: 运行，确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行，确认通过**。
- [ ] **Step 5: 提交** `feat(organize): 生成整理版 EPUB 并逐字校验`。

---

### Task 7: 整理任务（发起、后台执行、生成审核）

**Files:**
- Create: `backend/src/services/txt-organize/job.ts`
- Modify: `backend/src/index.ts`（启动时 `kickOrganizeWorker()`）
- Modify: `backend/src/services/notices.ts`（新增 `notifyOrganizeResult`）
- Test: `backend/tests/services/txt-organize/job.test.ts`

**Interfaces:**
- Consumes: Task 2〜6 全部；`addNotice`。整理版封面沿用原书的 `cover_url`（同一个封面文件，不复制）；EPUB 内嵌封面取该文件（`utils/cover.ts` 的读取方式），没有就不嵌。
- Produces:
  - `type OrganizeJobStatus = 'pending' | 'running' | 'review' | 'failed' | 'done'`
  - `interface OrganizeJob { id; book_id; requested_by; status: OrganizeJobStatus; phase: 'candidates' | 'judging' | 'writing' | null; batches_done; batches_total; candidate_count; notes: string[]; result_book_id: string | null; error: string | null; created_at; finished_at }`
  - `class OrganizeRequestError extends Error { code: 'NOT_TXT' | 'AI_NOT_CONFIGURED' | 'READERS_DISABLED' | 'DAILY_LIMIT' }`
  - `requestOrganize(bookId: string, user: { userId: string; role: 'admin' | 'user' }, db?): OrganizeJob`：已有 `pending/running/review` 任务时直接返回它（不新建）；否则按 Global Constraints 的限制校验后新建并 `kickOrganizeWorker()`。`DAILY_LIMIT` 按 `requested_by = userId AND created_at >= 今天 00:00（本地时区同 SQLite 'localtime'）` 计数，管理员不限。
  - `getActiveOrganizeJob(bookId: string, db?): OrganizeJob | null`（最近一个非 `done` 任务；`failed` 也返回，供前端显示失败原因）。
  - `getLastRejection(bookId: string, db?): { rejected_at: string } | null`（文件大小与当前一致时才算）。
  - `kickOrganizeWorker(): void`（写法同 `kickApplyWorker`，一次只跑一个任务）。
  - 任务开始时记录原文件 `src_size` / `src_mtime`。
  - 任务成功时，在一个事务里：插入整理版 `books` 行（新 id、`title = 原书名 + '（整理版）'`、作者 / 简介 / 分类 / 封面复制、`file_format='epub'`、`file_path`、`status='pending_review'`、`organized_from`、`organized_job_id`）；写 `txt_organize_chapter_map`；插入 `scan_batches(kind='organize', task_id=job.id, status='pending')` 和一条 `scan_batch_items(type='organized_duplicate', payload)`；任务 `status='review'`、`result_book_id`。
  - `organized_duplicate` 的 `payload`：`{ job_id, original: { book_id, title, file_path, chapter_count, toc: Array<{ title; level }> }, organized: { book_id, title, file_path, chapter_count, toc: Array<{ title; level }> }, notes: string[], batches: number, candidate_count: number, requested_by: { user_id, username } }`。
  - 失败：任务 `status='failed'`、`error`；删除已生成的文件；不插入任何 books / 批次。
  - 两种结果都 `notifyOrganizeResult(job, 'review' | 'failed')`：管理员通知，`link = '/library/scan-batches/<batchId>'`（失败时无 link）。

- [ ] **Step 1: 写失败的测试**（mock `aiManager.chat`，用临时 BOOKS_DIR / DATA_DIR，参照 `tests/services/ai-apply-job.test.ts` 的搭法）：
  - `it('成功：生成 pending_review 的整理版、organize 批次和审核项，任务进入 review')`。
  - `it('同一本书重复发起返回同一个任务')`、`it('非管理员第 4 次 → DAILY_LIMIT；管理员不限')`、`it('设置关闭后读者发起 → READERS_DISABLED')`、`it('非 TXT → NOT_TXT')`。
  - `it('AI 两次都失败 → 任务 failed，无新书、无批次、无文件')`（Review Focus 2）。
  - `it('服务重启：running 任务回到 pending 后重跑只生成一份整理版')`（Review Focus 4：手动把任务置 running、调用 db 初始化的重置逻辑再 kick）。
- [ ] **Step 2: 运行，确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行，确认通过**。
- [ ] **Step 5: 提交** `feat(organize): 整理任务的发起与后台执行`。

---

### Task 8: 阅读位置换算

**Files:**
- Create: `backend/src/services/txt-organize/position-map.ts`
- Test: `backend/tests/services/txt-organize/position-map.test.ts`

**Interfaces:**
- Consumes: `TxtParser`（原书）、`txt_organize_chapter_map`、`readTxtLines`。
- Produces:
  - `interface ReadingPos { chapterIndex: number; paragraphIndex: number; paragraphOffset: number }`
  - `class PositionMapper`：`static async create(originalPath: string, organizedBookId: string, db): Promise<PositionMapper>`（原文件解析失败时退化为「按章节序号比例换算」模式，不抛错）；`mapProgress(pos: ReadingPos): ReadingPos`；`mapChapter(chapterIndex: number): number`（书签用：原章节开头 → 整理版章节）。
  - 换算：原章节第 p 段 → 该段在原文的字节位置（原书 `getChapterContent` 的段落与原文非空行一一对应：段落序号 = 章节区间内第 p 个非空且未被去重的行）→ 找包含该位置的整理版章节 → 在该章内数出段落序号；`paragraphOffset` 原样保留。
  - 越界（章号 ≥ 原书章节数、段落号超出）一律夹到最后一个有效值。

- [ ] **Step 1: 写失败的测试**：
  - `it('原书第 3 章第 5 段 → 整理版对应章、对应段（合并了另一套编号的书）')`：构造原书被「第2章」切成两半的文本，原书第 2 章（「第2章」那半）第 0 段 → 整理版第 1 章的中间段。
  - `it('mapChapter：原书被合并掉的重复章节 → 整理版所在章')`。
  - `it('越界的章号 / 段落号夹到有效范围')`、`it('原文件已删除：按章节比例换算，不抛错')`（Review Focus 3、5）。
- [ ] **Step 2: 运行，确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行，确认通过**。
- [ ] **Step 5: 提交** `feat(organize): 原书与整理版之间的阅读位置换算`。

---

### Task 9: 审核决定与读者数据迁移

**Files:**
- Create: `backend/src/services/txt-organize/apply.ts`
- Modify: `backend/src/services/batch-applier.ts`（`organized_duplicate` 分派到 apply.ts）
- Modify: `backend/src/routes/scan-batches.ts`（丢弃 organize 批次 = 保留原书；PATCH 接受新的 decision payload）
- Test: `backend/tests/services/txt-organize/apply.test.ts`

**Interfaces:**
- Consumes: `PositionMapper`（Task 8）；`deleteBookCascade`（`keepFiles` 选项已有）；`recordSkip`（`scan-skips.ts`）。
- Produces:
  - `type OrganizeDecision = 'keep_new_hide_old' | 'keep_new_delete_record' | 'keep_new_delete_file' | 'keep_old'`；审核项 `admin_payload = { decision: OrganizeDecision }`，未填时默认 `keep_new_hide_old`。
  - `applyOrganizeDecision(item: { payload: OrganizedDuplicatePayload }, decision: OrganizeDecision, adminUserId: string, db): Promise<ApplySummary>`，`interface ApplySummary { decision; migrated: { progress: number; bookmarks: number; shelf: number; history: number } }`。
    - 注意：`applyBatch` 现在是同步事务；位置换算要解析原书（异步），所以先在事务外 `await PositionMapper.create(...)` 并算好所有换算结果，再进入同步事务写库。实施者调整 `applyBatch` 调用顺序时保持其他类型的行为不变。
  - `keep_new_*`：整理版 `status='normal'`、`title` 去掉「（整理版）」；迁移 `reading_progress`（换算 + `chapter_title` 取整理版标题）、`bookmarks`（`mapChapter`，`scroll_top=0`）、`shelf`、`reading_history`（同一用户已有整理版记录时保留 `updated_at` 较新的）；复制 `book_ai_metadata`；删除原书的 `ai_recaps`、`ai_suggestions`、`book_chapter_overrides`。
    - `keep_new_hide_old`：原书 `status='duplicate'`、`duplicate_of=整理版 id`。
    - `keep_new_delete_record`：`deleteBookCascade(..., { keepFiles: true })` + `recordSkip(原文件)`。
    - `keep_new_delete_file`：`deleteBookCascade`（删文件）。
  - `keep_old`：删除整理版记录和文件、`txt_organize_chapter_map`；写 `txt_organize_rejections`；原书数据不动。
  - 任务 `status='done'`、`finished_at`；批次 `applied`、`apply_summary` 记 `ApplySummary`；写 `audit_log`（类型 `organize_apply`，沿用 `services/audit-log.ts`）。
  - 丢弃 organize 批次（`DELETE /library/scan-batches/:id`）= 执行 `keep_old`。

- [ ] **Step 1: 写失败的测试**：
  - `it('keep_new_hide_old：整理版可见、改名；原书隐藏为副本；两个用户的进度 / 书签 / 书架 / 历史都迁到整理版且位置换算正确')`。
  - `it('keep_new_delete_record：原书记录删除、文件保留、记录跳过，下次扫描不再作为新书')`。
  - `it('keep_new_delete_file：原文件被删除')`。
  - `it('keep_old：整理版记录和文件删除，写拒绝记录，原书数据不变')`。
  - `it('丢弃 organize 批次等同 keep_old')`。
  - `it('原 TXT 在审核前已被删除：keep_new_* 照常完成（进度按比例换算），keep_old 只删整理版')`（Review Focus 3）。
  - `it('同一用户原书和整理版都有进度：保留较新的')`。
- [ ] **Step 2: 运行，确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行，确认通过**；跑 `yarn test tests/services/batch-applier.test.ts tests/routes/scan-batches.test.ts` 不回归。
- [ ] **Step 5: 提交** `feat(organize): 审核决定与读者数据迁移`。

---

### Task 10: 路由、路径放行与扫描保护

**Files:**
- Modify: `backend/src/routes/reader.ts`（`POST/GET /:bookId/organize`；`findReadableBook` 放行整理版目录）
- Modify: `backend/src/routes/opds.ts`（路径校验放行整理版目录）
- Modify: `backend/src/routes/library.ts:175`（待审核批次判断只看 `kind='scan'`）
- Modify: `backend/src/services/scan-walker.ts`（孤儿判定跳过 `organized_from IS NOT NULL`）
- Modify: `backend/src/routes/settings.ts`（`txt_organize_allow_readers` 读写，管理员）
- Modify: `docs/api.md`
- Test: `backend/tests/routes/organize.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `requestOrganize`、`getActiveOrganizeJob`、`getLastRejection`、`OrganizeRequestError`；`organizedDir()`（Task 6）。
- Produces:
  - `POST /api/reader/:bookId/organize`（登录用户）→ `successResponse(res, { job })`；`OrganizeRequestError` → 409 `BUSINESS_CONFLICT`，message：`NOT_TXT`「只有 TXT 可以整理目录」、`AI_NOT_CONFIGURED`「管理员尚未配置 AI」、`READERS_DISABLED`「管理员未开放此功能」、`DAILY_LIMIT`「今天的整理次数已用完，明天再试」。
  - `GET /api/reader/:bookId/organize`（登录用户）→ `{ available: boolean /* TXT 且 AI 已配置且（管理员或允许读者） */, job: OrganizeJob | null, lastRejectedAt: string | null }`；`job.notes` 对非管理员不返回。
  - 路径放行：`findReadableBook` 与 OPDS 的校验改为「在 BOOKS_DIR 内，或 `organized_from` 不为空且在 `organizedDir()` 内」。
  - 设置：`GET/PUT /api/settings` 已有的键值机制里加 `txt_organize_allow_readers`（若现有接口是白名单，加入白名单）。

- [ ] **Step 1: 写失败的测试**（搭法同 `tests/routes/reader-damaged.test.ts`）：
  - `it('POST 发起后 GET 返回进行中的任务；读者看不到 notes')`。
  - `it('四种 OrganizeRequestError 返回 409 和对应文案')`。
  - `it('pending_review 的整理版：书库列表不显示；管理员按 id 可以打开阅读（审核时预览）')`。
  - `it('整理版文件在 DATA_DIR/organized 下也能读章节；数据目录里其他文件（如 novel-reader.db）不能被当作书读')`。
  - `it('有待审核的 organize 批次时仍可以开始扫描')`。
  - `it('扫描不会把整理版当孤儿删掉')`。
- [ ] **Step 2: 运行，确认失败**。
- [ ] **Step 3: 实现**；更新 `docs/api.md` 两个新接口。
- [ ] **Step 4: 运行，确认通过**；跑后端全量 `yarn test`。
- [ ] **Step 5: 提交** `feat(organize): 整理接口、路径放行与扫描保护`。

---

### Task 11: 前端——阅读页发起、审核页决定、设置开关

**Files:**
- Modify: `frontend/src/api/reader.ts`（`getOrganize(bookId)`、`requestOrganize(bookId)`）
- Modify: `frontend/src/api/scan-batches.ts`、`frontend/src/types`（`ScanBatch.kind`、`OrganizedDuplicatePayload`、`OrganizeDecision`）
- Modify: `frontend/src/views/Reader.vue`（目录抽屉底部入口与状态）
- Create: `frontend/src/components/OrganizedDuplicateCard.vue`（审核项：并排目录、notes、四个选项）
- Create: `frontend/src/utils/toc-diff.ts`（两份目录按标题对齐，标出合并 / 去掉 / 改名）
- Modify: `frontend/src/views/ScanBatchReview.vue`（渲染新卡片；`keep_new_delete_file` 二次确认）、`frontend/src/views/ScanBatchList.vue`（`kind='organize'` 显示「AI 整理目录」标签和书名）
- Modify: `frontend/src/views/Settings.vue`（「允许读者发起 AI 整理目录」开关）
- Test: `frontend/src/utils/toc-diff.test.ts`

**Interfaces:**
- Consumes: Task 10 的接口和 payload 结构。
- Produces:
  - `diffToc(original: Array<{ title: string; level: number }>, organized: Array<{ title: string; level: number }>): Array<{ kind: 'same' | 'renamed' | 'merged' | 'removed' | 'added'; original?: string; organized?: string; level: number }>`
  - 阅读页入口文案：未发起「目录不对？让 AI 整理」；进行中「正在整理…（第 x / y 批）」，每 5 秒轮询 `GET` 直到离开进行中状态；待审核「已提交，等待管理员审核」；失败「整理失败：<原因>」+ 重试；上次被拒「上次的整理结果未被采用」（仍可再发起）。`available=false` 时不显示入口。发起前 `ElMessageBox.confirm` 说明「AI 会重新整理这本书的目录，管理员审核后对所有读者生效」。
  - 审核卡片默认选中 `keep_new_hide_old`；四个选项文案：「保留整理版，原书隐藏为副本」「保留整理版，删除原书记录（保留文件，以后扫描跳过）」「保留整理版，连原文件一起删除」「保留原书，删除整理版」。
  - 样式只用主题变量和 `main.css` 共享类；图标用 Tabler。

- [ ] **Step 1: 写失败的测试** `toc-diff.test.ts`：
  - `it('「第5章 X」「第0005章X？？」两条合并为一条 → 一个 merged')`、`it('标题去掉附言 → renamed')`、`it('另一套编号「第2章」被去掉 → removed')`、`it('完全相同 → same')`。
- [ ] **Step 2: 运行，确认失败**：`cd frontend && yarn test src/utils/toc-diff.test.ts`。
- [ ] **Step 3: 实现** `diffToc` 和各界面。
- [ ] **Step 4: 运行** `yarn typecheck && yarn test` 通过；用开发环境 + Chrome 走一遍：读者发起 → 进行中显示 → 管理员通知 → 审核页并排目录 → 选择保留整理版 → 读者回到阅读页，进度在原来的段落。手机视口 390px 下审核卡片不溢出。
- [ ] **Step 5: 提交** `feat(organize): 阅读页发起整理、审核页决定、设置开关`。

---

### Task 12: 原文件变化提示、文档与真书验证

**Files:**
- Modify: `backend/src/routes/library.ts`（书籍详情接口：整理版的原文件当前大小 / 修改时间与 `txt_organize_jobs.src_size` / `src_mtime` 不同 → `organized_stale: true`；原文件已删除时不提示）
- Modify: `frontend/src/views/BookDetail.vue`（`organized_stale` 时提示「原文件已变化，整理版可能过时，可重新整理」）
- Modify: `CHANGELOG.md`（`[Unreleased]` 新增条目）、`README.md` 功能列表一行
- Test: `backend/tests/routes/organize.test.ts`（追加 `it('原文件变化后详情接口返回 organized_stale')`）

- [ ] **Step 1: 写失败的测试**（如上）。
- [ ] **Step 2: 运行，确认失败**。
- [ ] **Step 3: 实现**；写 CHANGELOG / README。
- [ ] **Step 4: 真书验证**（mock AI 不够，需要真实模型；**先征得用户同意再调用**，费用预计几毛到一两块）：对《凡人修仙传》（`books/理智与情感.txt`）、《鬼吹灯》、《剑来》各整理一次，记录：用时、批次数、整理版章节数、逐字校验通过、审核页目录对比是否合理。《校花的贴身高手》做一次大文件验证（内存、用时）。结果写进 `tasks/todo.md`。
- [ ] **Step 5: 后端 `yarn test`、前端 `yarn typecheck && yarn test`、`docker compose up -d --build` 后容器内走一遍发起 → 审核；提交** `feat(organize): 原文件变化提示与文档`。
