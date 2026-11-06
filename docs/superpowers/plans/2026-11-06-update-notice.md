# 系统更新提醒与系统警告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 站点定期读取 GitHub 仓库的 `CHANGELOG.md`，发现新版本时只提示管理员（分类显示、【需操作】置顶）；本机配置问题用同一提示条提醒；设置页「更新说明」改读本站自带的同一份 `CHANGELOG.md`。

**Architecture:** 后端 `changelog.ts`（纯函数：解析、版本比较）+ `update-check.ts`（多来源拉取、超时、缓存到 settings 表、每日定时）+ `edition.ts`（版本线常量）；路由加在 `routes/settings.ts`（管理员）。前端 `api/settings.ts` 补接口、新组件 `SystemNoticeBar.vue` 挂在 `DefaultLayout`、`Settings.vue` 更新说明改为读接口。Docker 镜像带上 `CHANGELOG.md`。

**Tech Stack:** Express + better-sqlite3 + zod + Jest；Vue 3 + Element Plus + Vitest；Node 自带 fetch + AbortController（不新增依赖）。

**Spec:** `docs/superpowers/specs/2026-11-06-update-notice-design.md`

## Global Constraints

- 在 main 实现；study 之后单向合并，只改 `backend/src/edition.ts` 一处常量。
- 只提示管理员；不自动升级、不改设置；检查失败一律静默（`console.warn` 日志），不影响任何功能；用户打开页面时不访问外网。
- 来源顺序：`https://raw.githubusercontent.com/zmfy/easy-Reader/<branch>/CHANGELOG.md` → `https://cdn.jsdelivr.net/gh/zmfy/easy-Reader@<branch>/CHANGELOG.md`；每个请求超时 8000ms；`UPDATE_CHANGELOG_URL` 设置后只用它；`UPDATE_CHECK=off` 关闭远端检查。
- 定时：启动后 60 秒检查一次，之后每 24 小时；结果存 settings 表。
- 版本：本站版本 = 本站 CHANGELOG 最新已发布版本节；main 只认 `## [X.Y.Z]`，study 只认 `## [X.Y.Z-study]`；`[Unreleased…]` 忽略；只比较 X.Y.Z 数字。
- 条目以「【需操作】」开头为需操作；小标题 `### 新增` → kind `added`，`### 修复` → `fixed`，其他 → `other`（保留原标题，排在 added、fixed 之后）。
- 本站 CHANGELOG 读取路径：`CHANGELOG_PATH` → `<cwd>/CHANGELOG.md` → `<cwd>/../CHANGELOG.md`；读不到返回 `releases: []` 与 `missing: true`。
- 关闭规则：普通新版本关闭记 localStorage（按最新版本号）；含【需操作】的关闭记 sessionStorage；本机配置警告不可关闭；阅读器页面不显示提示条。
- API `{ success, code, data }`、`authMiddleware + adminMiddleware`，挂 `/api` 与 `/api/v1`，补 `docs/api.md`；前端 API 只经 `frontend/src/api/`；UI 中文；颜色用主题变量；Tabler 图标；手机 768px 无横向滚动。
- 测试：后端 `npx jest`，前端 `npx vitest run`；纯函数测试先行。

## Review Focus

1. **CHANGELOG 格式不规整**：版本节缺日期、小标题顺序不同、条目跨行续写、空版本节、行尾 `\r\n` → 解析不报错、续行并入上一条（Task 1 测试）。
2. **网络异常**：GitHub 超时 / 返回 HTML 错误页 / 404 / jsDelivr 返回旧内容 → 回退到下一个来源；全部失败只记 error，不覆盖上次成功结果（Task 2 测试）。
3. **版本线串台**：study 的 CHANGELOG 同时含 `[1.0.0]` 和 `[1.0.0-study]` → study 只看 `-study`，main 只看无后缀（Task 1 测试）。
4. **非管理员**：普通用户调接口 403、页面不渲染提示条（Task 3 实测、Task 5 组件条件）。
5. **本地开发与镜像路径不同**：ts-node-dev 的 cwd 为 backend/ 时也能读到仓库根的 CHANGELOG.md（Task 2 测试 + Task 6 Docker 实测）。

---

### Task 1: 版本线常量与 CHANGELOG 解析（纯函数）

**Files:**
- Create: `backend/src/edition.ts`、`backend/src/services/changelog.ts`
- Test: `backend/tests/services/changelog.test.ts`

**Interfaces:**
- Produces:
  - `edition.ts`：`export const EDITION: 'main' | 'study' = 'main'`；`export const UPDATE_BRANCH = EDITION`；`export const VERSION_SUFFIX = EDITION === 'study' ? '-study' : ''`
  - `changelog.ts`：
    - `interface ReleaseItem { text: string; actionRequired: boolean }`
    - `interface ReleaseSection { title: string; kind: 'added' | 'fixed' | 'other'; items: ReleaseItem[] }`
    - `interface Release { version: string /* 去后缀的 X.Y.Z */; date: string | null; intro: string; sections: ReleaseSection[] }`
    - `parseChangelog(md: string, suffix: string): Release[]` — 只取 `## [X.Y.Z<suffix>]`（suffix 精确匹配：suffix 为 '' 时排除带任何 `-` 后缀的版本），新→旧按文件顺序；`intro` 为版本节下第一个 `###` 前的非空文字（多行用换行连接）；条目续行（以空格缩进、非 `- ` 开头）并入上一条；sections 排序 added → fixed → other
    - `compareVersions(a: string, b: string): number`（只比 X.Y.Z 数字）
    - `newerReleases(remote: Release[], current: string | null): Release[]`（current 为 null 时返回 []，避免本站无版本时误报）
    - `hasActionRequired(releases: Release[]): boolean`

- [ ] **Step 1: 写失败测试**：`parses version sections and skips Unreleased`；`main ignores -study sections and study ignores plain sections`；`classifies 新增/修复/other and orders them`；`marks 【需操作】 items`；`joins continuation lines and handles CRLF`；`keeps intro text before first subsection`（用仓库 1.0.0 节的「首个正式版本。」）；`tolerates missing date and empty sections`；`compareVersions and newerReleases`；`newerReleases returns [] when current is null`。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/changelog.test.ts`
- [ ] **Step 3: 实现** → PASS；`npx tsc --noEmit`
- [ ] **Step 4: 提交** `git commit -m "feat: CHANGELOG 解析与版本比较"`

### Task 2: 更新检查服务（拉取、回退、缓存、定时、本地读取）

**Files:**
- Create: `backend/src/services/update-check.ts`
- Modify: `backend/src/index.ts`（`app.listen` 回调里调用 `startUpdateChecker()`）
- Test: `backend/tests/services/update-check.test.ts`

**Interfaces:**
- Consumes: Task 1 全部导出
- Produces:
  - `readLocalChangelog(): { releases: Release[]; currentVersion: string | null; missing: boolean }`（路径按 Global Constraints；结果按文件 mtime 缓存在内存）
  - `updateSources(): string[]`（按 env 与 UPDATE_BRANCH 生成）
  - `fetchRemoteChangelog(sources: string[], fetchImpl = fetch, timeoutMs = 8000): Promise<{ text: string; source: string }>` — 依次尝试；非 2xx、内容不含 `## [` 视为失败；全部失败抛错，错误信息汇总各来源原因（不含任何密钥）
  - `checkForUpdates(db): Promise<UpdateStatus>`（拉取 → 解析 → 写 settings 表 `update_check_result`（JSON：remote releases、source）、`update_checked_at`、`update_check_error`；失败只更新 error 与时间，保留上次成功结果）
  - `getUpdateStatus(db): UpdateStatus` = `{ currentVersion, branch, enabled, checkedAt: string | null, error: string | null, newer: Release[] }`（只读缓存，不访问外网）
  - `startUpdateChecker(): void`（`UPDATE_CHECK=off` 时不启动；60 秒后首查，之后 `setInterval` 24 小时；定时器 `unref()`；异常只 `console.warn`）

- [ ] **Step 1: 写失败测试**（`:memory:` 库建 settings 表；mock fetch）：`falls back to jsdelivr when github times out`（fake 超时用永不 resolve 的 fetch + timeoutMs=20）；`treats HTML error page as failure`；`custom URL replaces default sources`；`failed check keeps previous result and records error`；`getUpdateStatus lists newer releases only`；`readLocalChangelog finds ../CHANGELOG.md from backend cwd`（用临时目录与 `process.chdir` 或注入路径参数）；`missing changelog returns missing true`；`disabled when UPDATE_CHECK=off`。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/update-check.test.ts`
- [ ] **Step 3: 实现** → PASS；接入 index.ts；`npx jest && npx tsc --noEmit`
- [ ] **Step 4: 提交** `git commit -m "feat: 更新检查服务（多来源回退、缓存、每日检查）"`

### Task 3: 接口、文档、Docker 与 CHANGELOG 约定

**Files:**
- Modify: `backend/src/routes/settings.ts`、`docs/api.md`、`Dockerfile`、`.dockerignore`、`CHANGELOG.md`（文件头维护说明）、`README.md`（环境变量表：`UPDATE_CHECK`、`UPDATE_CHANGELOG_URL`、`CHANGELOG_PATH`）、`.env.example`（同上，注释状态）

- [ ] **Step 1:** 路由（`authMiddleware, adminMiddleware`）：`GET /settings/update-status` → `getUpdateStatus`；`POST /settings/update-check` → `checkForUpdates` 后返回状态（失败也 200，状态里带 error）；`GET /settings/changelog` → `{ currentVersion, missing, releases: 最近 5 个 }`。
- [ ] **Step 2:** `docs/api.md` 管理员接口一节补三个接口与 `Release` 结构；`CHANGELOG.md` 文件头写明：版本节格式、`### 新增` / `### 修复`、「【需操作】」前缀、学习版 `-study` 版本节、站点据此提醒管理员。
- [ ] **Step 3:** `.dockerignore` 放行 `CHANGELOG.md`；Dockerfile 运行阶段 `COPY CHANGELOG.md ./CHANGELOG.md`。
- [ ] **Step 4: 验证** `cd backend && npx jest && npx tsc --noEmit`；数据副本起开发后端，curl：管理员三接口 200、普通用户 403；`UPDATE_CHANGELOG_URL` 指向本地 `python3 -m http.server` 提供的一份含 `## [1.1.0]`（含【需操作】条目）的 CHANGELOG，`POST update-check` 后 `newer` 有 1.1.0。
- [ ] **Step 5: 提交** `git commit -m "feat: 更新状态与更新说明接口，镜像带上 CHANGELOG"`

### Task 4: 设置页「更新说明」改读 CHANGELOG

**Files:**
- Modify: `frontend/src/api/settings.ts`、`frontend/src/types/index.ts`（Release 等类型）、`frontend/src/views/Settings.vue`

- [ ] **Step 1:** `settingsApi.getUpdateStatus()`、`checkUpdates()`、`getChangelog()`。
- [ ] **Step 2:** 删除 Settings.vue 中写死的 `changelog` 数组与 tag 映射；「更新说明」改为：顶部「当前版本 vX.Y.Z」+ 远端状态文案（「已是最新」/「有新版本 vX.Y.Z」/「无法连接更新源，上次检查 MM-DD HH:mm」/「已关闭更新检查」/ 从未检查「尚未检查」）+「立即检查」按钮（检查中 loading）；列表：每个版本标题「vX.Y.Z · YYYY-MM-DD」、标题下 intro、展开后按 sections 分组（小标题 + 条目，【需操作】条目加醒目标签「需操作」）；`missing` 时显示「未找到更新说明文件」。
- [ ] **Step 3: 验证** `cd frontend && npx vitest run && npx vue-tsc --noEmit && npx vite build`
- [ ] **Step 4: 提交** `git commit -m "feat: 设置页更新说明改读 CHANGELOG，显示更新检查状态"`

### Task 5: 管理员系统提示条

**Files:**
- Create: `frontend/src/components/SystemNoticeBar.vue`、`frontend/src/utils/notice-dismiss.ts`
- Modify: `frontend/src/layouts/DefaultLayout.vue`（`<main class="main-content">` 顶部挂 `<SystemNoticeBar v-if="authStore.isAdmin" />`）
- Test: `frontend/src/utils/notice-dismiss.test.ts`

**Interfaces:**
- Produces: `notice-dismiss.ts`：`isDismissed(version: string, actionRequired: boolean, store: { local: Storage; session: Storage }): boolean`、`dismiss(version, actionRequired, store): void`（键 `update-notice-dismissed`）

- [ ] **Step 1: 写失败测试**：`normal release dismissal persists in local storage`；`action-required dismissal only lasts the session`；`a newer version shows again after dismissing an older one`。
- [ ] **Step 2: 运行确认失败** `cd frontend && npx vitest run src/utils/notice-dismiss.test.ts`
- [ ] **Step 3: 实现** → PASS；再实现组件：挂载时并行取 `getAiStatus()`（config_warning）与 `getUpdateStatus()`（失败静默）；配置警告条（warning，不可关闭，「去设置」→ `/settings?tab=ai`，Settings.vue 读取 `tab` 参数切换到 AI 区）；新版本条（有【需操作】用 warning 醒目样式、否则 info）：「有新版本 vX.Y.Z（当前 vA.B.C）」+「查看更新内容」（el-dialog：按版本、按分类列条目，【需操作】条目置顶并加「需操作」标签）+ 关闭（调用 `dismiss`）；路由在 `/reader/` 下不渲染（DefaultLayout 若不包阅读器则无需处理，检查后说明）；手机换行。
- [ ] **Step 4: 验证** `npx vitest run && npx vue-tsc --noEmit && npx vite build`
- [ ] **Step 5: 提交** `git commit -m "feat: 管理员系统提示条（新版本与配置警告）"`

### Task 6: 整体验收

- [ ] **Step 1:** 后端 `npx jest && npx tsc --noEmit`；前端 `npx vitest run && npx vue-tsc --noEmit && npx vite build`。
- [ ] **Step 2:** 开发服务器 + 数据副本 + 本地假更新源（`UPDATE_CHANGELOG_URL`）在 Chrome 实测：管理员看到新版本条与配置警告条（副本里保留 `MiniMax-M2`）、查看更新内容分类与【需操作】置顶、关闭规则（刷新后普通版本不再出现、【需操作】版本新会话再出现）、普通用户看不到、设置页更新说明与「立即检查」、`UPDATE_CHECK=off`、手机宽度。
- [ ] **Step 3:** `docker compose --env-file .env.example build`（国内源）确认镜像内有 `/app/CHANGELOG.md`；`CHANGELOG.md` 的 `[Unreleased]` 记一条「系统更新提醒」；推送与发版前向用户确认。
