# 单本 AI 填充预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 单本书页「AI 填充」改为：先返回预览（不写库）→ 弹窗中可编辑字段、增删标签与类似作品、在多张豆瓣封面 / 当前封面 / 按分类风格生成的默认封面中选择 → 点「应用」才写入。

**Architecture:** 后端把 `POST /library/:id/ai-fill` 拆成 `preview`（只读，含豆瓣候选缩略图 data URI）与 `apply`（写入、锁规则、封面保存、填充状态标记）两个接口，另加 `GET /library/default-cover` 返回 SVG。默认封面由纯函数生成 SVG，预览与保存共用。前端新增弹窗组件，表单初始化与提交负载的规则放在可单测的纯函数里。

**Tech Stack:** Express + better-sqlite3 + zod + jest（后端）；Vue 3 + Element Plus + vitest（前端）。不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-04-ai-fill-preview-design.md`

## Global Constraints

- 预览接口不得写库、不得写封面文件、不得更新评分。
- 豆瓣图片只接受 `https://img<数字>.doubanio.com/…`；书目页只接受 `https://book.douban.com/subject/<数字>/…`；跟随重定向时每一跳都检查主机。
- SVG 中的书名、作者必须 XML 转义；不含脚本、不引用外部资源。`/covers` 对 `.svg` 加 `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` 与 `X-Content-Type-Options: nosniff`。
- 前端 API 调用只写在 `frontend/src/api/`；预览请求超时 180000 ms。
- 风格对应：网络小说类关键词 → `night`（A 夜读）；含「古典 / 名著 / 古代 / 古籍 / 文言 / 诗词」且不含网络小说关键词 → `classic`（B 古籍）；其余（含「历史」「综合」、空）→ `modern`（C 现代）。网络小说关键词：玄幻、修真、仙侠、奇幻、都市、科幻、悬疑、灵异、言情、武侠、游戏、竞技、军事、穿越。（「古代言情」归 `night`：网文关键词优先，这是我的决定。）
- 每个任务结束：`cd backend && npx jest`、`npx tsc --noEmit -p .`；涉及前端时 `cd frontend && npx vue-tsc --noEmit && npx vitest run`。提交信息用中文，结尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Review Focus

1. 豆瓣搜索失败、超时或零结果 → 预览仍然正常打开，候选里只有当前封面（如有）和默认封面，默认选中按规则落到当前封面或默认封面。（Task 3 测试）
2. AI 某些字段返回空 → 表单保留现有值，点「应用」不会把已有作者、简介清空。（Task 5 `initialForm` 测试）
3. 书没有作者 → 默认封面只印书名，不出现空的「著」字样。（Task 1 测试）
4. 书名含 `<`、`&`、引号、emoji 或超长 → SVG 仍是合法 XML，没有注入，长书名有截断。（Task 1 测试）
5. 单张豆瓣缩略图下载失败 → 只丢掉这一张候选，其余候选和整个预览不受影响。（Task 3 测试）

---

### Task 1: 默认封面生成器 + `/covers` 支持 SVG

**Files:**
- Create: `backend/src/utils/default-cover.ts`
- Modify: `backend/src/index.ts`（`/covers` 扩展名白名单与 SVG 响应头）
- Test: `backend/tests/utils/default-cover.test.ts`

**Interfaces:**
- Produces:
  - `export type CoverStyle = 'night' | 'classic' | 'modern'`
  - `export function coverStyleForCategory(category?: string | null): CoverStyle`
  - `export function renderDefaultCoverSvg(input: { title: string; author?: string | null; category?: string | null }): string`：viewBox `0 0 300 420`。竖排文字用**逐字一个 `<text>` 元素纵向排列**实现，不依赖 `writing-mode`。三种样式按草图：night 深色渐变 `#1a263d → #121a2b → #2a1f5c`，左侧 `#7c5cff → #00d4b8` 竖条；classic 米色 `#e9dfc8`，内框线和题签用 `#8a6d3b`；modern 用书名哈希从固定的 6 组渐变里选一组。字体写 `'Noto Serif SC','Songti SC',serif`。

- [ ] **Step 1: 写失败测试** `default-cover.test.ts`：
  - `coverStyleForCategory('玄幻') === 'night'`、`('古代言情') === 'night'`、`('古典小说') === 'classic'`、`('古典文学') === 'classic'`、`('历史') === 'modern'`、`('综合') === 'modern'`、`(null) === 'modern'`、`('') === 'modern'`
  - 书名 `'<script>&"'` → 输出含 `&lt;script&gt;&amp;`，不含 `<script`；输出以 `<svg` 开头，含 `xmlns="http://www.w3.org/2000/svg"`
  - 没有作者 → 输出不含 `著`；作者 `'罗贯中'` + 分类 night → 含 `罗`（逐字）以及 `著`
  - 30 个字的书名、各风格 → 含 `…`，且 `<text` 元素个数 ≤ 40
  - 相同输入两次调用结果相同；modern 风格下 `'三国演义'` 与 `'红楼梦'` 的渐变颜色不同
  - 不含 `<script`、`href=`、`url(http`
- [ ] **Step 2:** 运行 `cd backend && npx jest tests/utils/default-cover.test.ts`，预期失败（模块不存在）。
- [ ] **Step 3:** 实现 `default-cover.ts`，文本转义复用 `utils/html.ts` 的 `escapeHtml`，另外再转义 `"`。
- [ ] **Step 4:** `index.ts` 的 `/covers` 中间件：正则加 `svg`；请求 `.svg` 时设置 Global Constraints 中的两个响应头。
- [ ] **Step 5:** 运行该测试与全量 jest、tsc，预期通过。
- [ ] **Step 6:** 提交「默认封面 SVG 生成器，/covers 支持 SVG」。

### Task 2: 豆瓣候选列表、主机白名单、封面文件保存

**Files:**
- Modify: `backend/src/utils/cover.ts`
- Test: `backend/tests/utils/cover.test.ts`（追加）、`backend/tests/utils/cover-file.test.ts`（新建）

**Interfaces:**
- Produces:
  - `export interface DoubanCandidate { title: string; author?: string; year?: string; pic: string; subjectUrl?: string }`
  - `export function parseDoubanSuggestList(json: string, limit = 6): DoubanCandidate[]`（纯函数）：过滤没有 pic 或 pic 含 `book-default` 的条目；`author_name → author`，`url → subjectUrl`
  - `export async function doubanSuggestList(title: string, limit = 6): Promise<DoubanCandidate[]>`：网络错误时返回 `[]`
  - `export function isAllowedDoubanImageUrl(url: string): boolean`、`export function isAllowedDoubanSubjectUrl(url: string): boolean`
  - `export async function fetchCoverThumbnailDataUri(pic: string): Promise<string | undefined>`：不在白名单、请求失败或小于 1024 字节时返回 undefined；成功返回 `data:image/<ext>;base64,…`
  - `export async function downloadCoverFromPic(pic: string, bookId: string): Promise<string | undefined>`：白名单校验 → 换成大图 → 下载 → `saveCoverFile`
  - `export function saveCoverFile(bookId: string, data: Buffer | string, ext: string): string`：写入 `<bookId>-<Date.now().toString(36)>.<ext>`，删除封面目录里这本书的其他文件（`<bookId>.*` 和 `<bookId>-*`），返回 `/covers/<文件名>`
  - `request()` 增加可选参数 `allowHost?: (hostname: string) => boolean`，每次请求和每一跳重定向都要检查，不通过就 reject；改为 `export` 以便测试
  - 现有 `downloadCover(item, bookId)` 改为内部调用 `downloadCoverFromPic`，签名不变（批量填充继续用）；`fetchRating` 增加 `isAllowedDoubanSubjectUrl` 校验
- [ ] **Step 1: 写失败测试**：
  - `parseDoubanSuggestList`：3 条（其中 1 条是 `book-default`、1 条没有 pic）→ 只剩 1 条，字段映射正确；非法 JSON → `[]`；limit 生效
  - 白名单：`https://img1.doubanio.com/view/subject/s/public/s1.jpg` 为 true；`http://img1.doubanio.com/…`、`https://img1.doubanio.com.evil.com/…`、`https://evil.com/?img1.doubanio.com`、`https://doubanio.com/…` 为 false；`https://book.douban.com/subject/1234567/` 为 true，`https://book.douban.com/people/x/`、`https://movie.douban.com/subject/1/` 为 false
  - `request` 重定向检查：本地起一个 http server，`/a` 302 到 `http://127.0.0.1:<port>/b`，`allowHost = h => h === 'localhost'`，请求 `http://localhost:<port>/a` 应 reject
  - `cover-file.test.ts`（导入前设置 `process.env.DATA_DIR` 为临时目录）：预先放 `b1.jpg`、`b1-old.png`、`b2.jpg`，调用 `saveCoverFile('b1', 'svg', 'svg')` → 返回 `/covers/b1-*.svg`，`b1.jpg` 与 `b1-old.png` 被删除，`b2.jpg` 保留；连续两次调用返回的文件名不同
- [ ] **Step 2:** 运行测试，预期失败。
- [ ] **Step 3:** 按 Interfaces 实现。
- [ ] **Step 4:** 运行全量 jest 和 tsc，预期通过（`ai-batch-fill.test.ts` 对 cover 的 mock 不受影响）。
- [ ] **Step 5:** 提交「豆瓣候选列表与主机白名单，封面文件带版本号保存」。

### Task 3: 预览服务与接口（只读）

**Files:**
- Create: `backend/src/services/ai-fill-preview.ts`
- Modify: `backend/src/routes/library.ts`：把现有 `POST /:id/ai-fill` 的 AI 部分移进服务，路由改为 `POST /:id/ai-fill/preview`；新增 `GET /default-cover`，必须注册在 `router.get('/:id')` **之前**
- Test: `backend/tests/services/ai-fill-preview.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `doubanSuggestList`、`fetchCoverThumbnailDataUri`；Task 1 的 `renderDefaultCoverSvg`
- Produces:
  ```ts
  type LockableField = 'author' | 'summary' | 'category';
  type SimilarWork = { title: string; author?: string; reason?: string };
  export interface AiFillPreview {
    current: { title: string; author: string | null; summary: string | null; category: string | null;
               is_finished: boolean | null; cover_url: string | null;
               recommended_tags: string[]; similar_works: SimilarWork[] };
    suggested: { author?: string; summary?: string; category?: string; is_finished?: boolean;
                 recommended_tags: string[]; similar_works: SimilarWork[] };
    lockedFields: LockableField[];
    coverCandidates: Array<DoubanCandidate & { thumbnail: string }>;
  }
  export async function buildAiFillPreview(bookId: string): Promise<AiFillPreview>   // 书不存在 → throw NotFound；AI 未配置 → throw
  ```
  - `suggested` 沿用现有逻辑：清洗书名、TXT 前 600 字、连载说明追加到简介、文件名完结推断、`extractMetadataFromAiResponse`。
  - 豆瓣搜索用 AI 返回的书名（没有则用清洗后的书名）；缩略图并发获取，失败的候选直接丢弃。
  - 路由：`POST /:id/ai-fill/preview`（admin）；错误码沿用现有（400 `AI_NOT_CONFIGURED`、404、500 + 原因）。`GET /default-cover?title=&author=&category=`（登录即可）返回 `image/svg+xml`，title 必填、各参数最长 200，校验失败返回 422。
- [ ] **Step 1: 写失败测试**（仿照 `ai-batch-fill.test.ts`：mock `../../src/db` 返回内存库，mock `../../src/utils/cover` 与 `aiManager.fillBookInfo`）：
  - 返回结构包含 current / suggested / lockedFields（`manually_edited_fields='["author"]'` → `['author']`）
  - **不写库**：调用前后 `SELECT * FROM books` 与 `book_ai_metadata` 完全相同；`downloadCover`、`fetchRating` 未被调用
  - 豆瓣返回 3 个候选、其中 1 个缩略图返回 undefined → `coverCandidates.length === 2`
  - `doubanSuggestList` 返回 `[]` → 正常返回、候选为空
  - AI 返回 `is_finished` 未定义且文件名含「完本」→ `suggested.is_finished === true`
- [ ] **Step 2:** 运行，预期失败。
- [ ] **Step 3:** 实现服务和两个路由；删除旧的 `POST /:id/ai-fill`（先确认只有 `frontend/src/api/library.ts` 的 `aiFill` 调用它，Task 5 会替换）。
- [ ] **Step 4:** 全量 jest、tsc 通过。用 curl 带管理员令牌请求 `GET /api/library/default-cover?title=三国演义&author=罗贯中&category=古典小说`，返回 SVG，Content-Type 为 `image/svg+xml`。
- [ ] **Step 5:** 提交「AI 填充预览接口（只读）与默认封面预览接口」。

### Task 4: 应用服务与接口

**Files:**
- Create: `backend/src/services/ai-fill-apply.ts`
- Modify: `backend/src/services/ai-batch-fill.ts`（新增 `unmarkFieldsAsEdited`）、`backend/src/services/book-ai-metadata.ts`（新增 `replaceMetadata`）、`backend/src/routes/library.ts`（`POST /:id/ai-fill/apply` + zod 校验）
- Test: `backend/tests/services/ai-fill-apply.test.ts`

**Interfaces:**
- Consumes: Task 1 `renderDefaultCoverSvg`；Task 2 `saveCoverFile`、`downloadCoverFromPic`、`isAllowedDoubanSubjectUrl`、`fetchRating`
- Produces:
  ```ts
  export type CoverChoice = { type: 'keep' } | { type: 'douban'; pic: string } | { type: 'default' };
  export interface AiFillApplyInput {
    author?: string; summary?: string; category?: string; is_finished?: boolean;
    recommended_tags: string[]; similar_works: SimilarWork[];
    cover: CoverChoice;
    ratingSubjectUrl?: string;                  // 选中豆瓣封面时是它的 subjectUrl，否则是第一个候选的
    suggested: { author?: string; summary?: string; category?: string };  // 预览返回的 AI 建议原样回传，用来判断是否手动改过
  }
  export async function applyAiFill(bookId: string, input: AiFillApplyInput, generatedBy?: string): Promise<Book>
  export function unmarkFieldsAsEdited(bookId: string, fields: Array<'title'|'author'|'summary'|'category'>): void
  export function replaceMetadata(bookId: string, tags: string[], similar: SimilarWork[], generatedBy?: string): void  // 以提交为准，空数组即清空
  ```
  - **每个可锁字段的规则**：值等于 `suggested[f]`（且建议非空）→ 写入并解锁；值等于当前值 → 不写，锁状态不变；其他 → 写入并加锁。
  - `is_finished`：提交了就写。
  - 封面：`keep` 不动；`douban` 用 `downloadCoverFromPic`（白名单不通过则返回 422，**不写任何字段**，所以封面校验和下载要先于字段写入）；`default` 用最终的书名、作者、分类生成 SVG 后 `saveCoverFile`。
  - 评分：仅在 `book.rating == null` 且 `ratingSubjectUrl` 通过白名单时抓取，失败忽略。
  - 最后执行 `ai_fill_status='filled'`、`stampFillVersion`。字段写入在一个事务里完成。
  - 路由：zod 限制 tags 最多 20 个、每个最多 30 字；similar_works 最多 20 项，title 必填且最多 100 字；summary 最多 5000 字。
- [ ] **Step 1: 写失败测试**：
  - 锁规则三种情况：锁定作者被切换为 AI 值 → 写入并从 `manually_edited_fields` 移除；简介被手动改（≠ 建议、≠ 当前）→ 写入并加锁；分类等于当前值 → 不变
  - tags 为 `[]`、similar 为 `[]`，而库里原来有值 → 应用后都为空数组（与 `saveMetadata` 的跳过行为不同）
  - `cover: { type: 'douban', pic: 'https://evil.com/a.jpg' }` → reject，书的各字段不变
  - `cover: { type: 'default' }` → `cover_url` 以 `/covers/<id>-` 开头、以 `.svg` 结尾，文件内容含书名转义后的文字
  - 应用后 `ai_fill_status === 'filled'`，`ai_fill_version === AI_FILL_VERSION`
  - 原来有评分 → `fetchRating` 不被调用
- [ ] **Step 2:** 运行，预期失败。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** 全量 jest、tsc 通过。
- [ ] **Step 5:** 提交「AI 填充应用接口：锁规则、标签和类似作品以提交为准、封面保存」。

### Task 5: 前端预览弹窗与书页接入

**Files:**
- Create: `frontend/src/components/AiFillPreviewDialog.vue`、`frontend/src/utils/ai-fill-form.ts`、`frontend/src/utils/ai-fill-form.test.ts`
- Modify: `frontend/src/api/library.ts`（用 `aiFillPreview`、`aiFillApply`、`defaultCoverSvg` 替换 `aiFill`）、`frontend/src/types/index.ts`（`AiFillPreview`、`AiFillApplyInput` 与后端一致）、`frontend/src/views/BookDetail.vue`、`frontend/src/views/Settings.vue`（11-04 更新说明加一条）

**Interfaces:**
- Consumes: Task 3 / Task 4 的接口与类型
- Produces（`ai-fill-form.ts`，纯函数）：
  ```ts
  export interface AiFillForm {
    author: string; summary: string; category: string; is_finished: boolean | null;
    useAi: Record<'author'|'summary'|'category', boolean>;   // 仅对锁定字段有意义
    tags: string[]; similar: SimilarWork[];
    cover: 'current' | 'default' | number;                    // number = coverCandidates 的下标
  }
  export function initialForm(p: AiFillPreview): AiFillForm
  export function buildApplyPayload(form: AiFillForm, p: AiFillPreview): AiFillApplyInput
  ```
  - `initialForm`：非锁定字段 = AI 建议，没有建议时用当前值；锁定字段：当前值非空 → 当前值、`useAi=false`，当前值为空 → AI 建议、`useAi=true`；tags / similar = AI 结果，AI 为空时用当前值；cover：有 `current.cover_url` → `'current'`，否则有候选 → `0`，否则 `'default'`。
  - `buildApplyPayload`：cover 映射为 `keep / douban(pic) / default`；`ratingSubjectUrl` = 选中候选的 subjectUrl，否则取 `candidates[0]?.subjectUrl`；`suggested` 来自 `p.suggested`。
- [ ] **Step 1: 写失败测试** `ai-fill-form.test.ts`：
  - AI 作者为空、当前作者「罗贯中」→ 表单作者为「罗贯中」（Review Focus 2）
  - 作者锁定且当前非空 → 当前值、`useAi=false`；作者锁定且当前为空 → AI 值、`useAi=true`
  - AI 标签为空、当前有 `['历史']` → 表单为 `['历史']`
  - 封面默认选择的三种情况；`buildApplyPayload` 选中下标 1 → `{ type: 'douban', pic: candidates[1].pic }`，`ratingSubjectUrl === candidates[1].subjectUrl`
- [ ] **Step 2:** `cd frontend && npx vitest run src/utils/ai-fill-form.test.ts`，预期失败。
- [ ] **Step 3:** 实现 `ai-fill-form.ts`，以及 `api/library.ts`：`aiFillPreview(id)` 带 `{ timeout: 180000 }`，`defaultCoverSvg(params)` 用 `responseType: 'text'`。
- [ ] **Step 4:** 实现 `AiFillPreviewDialog.vue`（props：`preview`、`bookId`、`modelValue`；emits：`update:modelValue`、`applied(book: Book)`），单列布局按设计文档：
  - 封面横向滑动，带「当前」「默认」角标，选中有边框；
  - 默认封面缩略图用 `defaultCoverSvg` 获取后转成 blob URL，书名、作者、分类变化时防抖 300ms 重新请求，旧的 blob URL 要 revoke；
  - 锁定字段显示「已锁定」，有「改用 AI 结果」开关，旁边显示另一侧的值；
  - 标签用 `el-tag closable` + 输入框；类似作品列表可删除，可添加（书名必填）；
  - 「应用」进行中禁用，失败时 `ElMessage.error` 显示原因、弹窗不关；
  - 窄屏（≤ 768px）全屏（`el-dialog :fullscreen`）。
- [ ] **Step 5:** `BookDetail.vue`：`handleAiFill` 调预览 → 打开弹窗；`applied` 后刷新书籍与 `refreshAiMeta()`；第 83 行附近的锁定提示改为「AI 填充会先弹出预览，锁定字段默认保留现有内容，可在预览中改用 AI 结果。」；`Settings.vue` 的 11-04 更新说明加一条：「单本 AI 填充改为先预览：可修改简介等信息、增删标签和类似作品，从多张豆瓣封面或按分类风格生成的默认封面中选择，确认后才保存；预览时不再覆盖已锁定的字段」。
- [ ] **Step 6:** `npx vue-tsc --noEmit`、`npx vitest run` 通过。
- [ ] **Step 7: Chrome 实测**（开发环境，AI 用 DeepSeek）：
  - 电脑视口：《三国演义》点 AI 填充 → 弹窗出现，有多张豆瓣封面和默认封面；把分类改成「玄幻」→ 默认封面变成夜读风格；删一个类似作品、加一个；选默认封面 → 应用 → 书页显示新封面和修改后的内容，标签和类似作品与弹窗一致。
  - 再次打开预览后点「取消」→ 数据库中该书记录与之前完全一致。
  - 手机视口 390×844：弹窗全屏，封面可横向滑动。
- [ ] **Step 8:** 提交「单本 AI 填充预览弹窗：可编辑、多封面选择、默认封面」，并更新 `tasks/todo.md`。
