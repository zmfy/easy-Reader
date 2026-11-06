# 系统更新提醒与系统警告（设计）

## 为什么做

easy-Reader 由各个用户自行部署（NAS / Docker）。作者发了新版本、修了 bug，或者某些设置需要用户手动调整（例：MiniMax-M2 系列模型下线后，仍保存旧模型名的站点 AI 全部报错），部署者目前无从得知，只能等出问题再查。
用户（作者）希望：**以 GitHub 仓库的更新说明为唯一来源**，有新版本或需要调整设置时，**提示正在使用的站点管理员**；更新说明按「新增功能 / 问题修复」分类；国内访问 GitHub 不稳定时也要尽量能收到。

## 目标

1. 站点后台定期检查仓库中的 `CHANGELOG.md`，发现比本站更新的已发布版本时，在页面顶部提示**管理员**：「有新版本 x.y.z（当前 a.b.c）」，可展开查看更新内容。
2. 更新内容按 `### 新增`、`### 修复` 等小标题分类显示；条目以「【需操作】」开头的单独置顶、醒目显示。
3. 本机检测到的配置问题（目前是 AI 插件的 `config_warning`，如 MiniMax 旧模型）也用同一个提示条告诉管理员（统一的「系统警告」入口）。
4. 设置页「更新说明」不再写死在前端代码里，改为读取本站自带的同一份 `CHANGELOG.md`（显示最近 5 个版本），与远端提醒用同一份内容、同一套解析。
5. 看书版与学习版各自只检查自己的更新：看书版读 main 分支的 CHANGELOG，学习版读 study 分支的 CHANGELOG（学习版版本节为 `## [X.Y.Z-study]`）。

## 不做 / 反目标

- 不提示普通用户（用户决定：只提示管理员）。
- 不自动升级、不自动修改任何设置；只提醒。
- 不使用 GitHub Releases API（有频率限制、国内不稳定且无法用 CDN 镜像），只读 `CHANGELOG.md` 原文件。
- 不因检查失败影响任何正常功能：网络不通、解析失败一律静默（记日志），不弹错误。
- 不在用户打开页面时实时访问外网（反目标：页面因外网慢而卡住）。
- `[Unreleased]` 一节不参与提醒，也不在设置页显示（例：MiniMax 修复目前在 `[Unreleased]`，发布 1.0.1 后才会被提醒）。
- 不做多语言、不做推送通知 / 邮件。

## 数据来源与网络

- 来源按顺序尝试，任一成功即用，每个请求超时 8 秒：
  1. `https://raw.githubusercontent.com/zmfy/easy-Reader/<branch>/CHANGELOG.md`
  2. `https://cdn.jsdelivr.net/gh/zmfy/easy-Reader@<branch>/CHANGELOG.md`（国内通常可访问）
- 环境变量：
  - `UPDATE_CHECK=off`：关闭远端检查（内网 / 离线部署）。
  - `UPDATE_CHANGELOG_URL`：自定义地址（例如自建镜像），设置后只用这一个地址。
- 检查频率：服务启动 1 分钟后检查一次，之后每 24 小时一次；结果（远端解析结果、检查时间、最近错误）存数据库，重启后可直接用。管理员可在设置页点「立即检查」。
- 分支（branch）：看书版为 `main`，学习版为 `study`；由一个版本标识常量决定（学习版只改这一处），实现方式见「留给实现」。

## CHANGELOG 约定与解析

- 版本节：`## [X.Y.Z] - YYYY-MM-DD`（学习版 `## [X.Y.Z-study] - YYYY-MM-DD`），`## [Unreleased]` / `## [Unreleased-study]` 忽略。
- 小标题：以后每个版本用 `### 新增`、`### 修复`；其他小标题（如 1.0.0 中的主题式标题）照原样作为分类显示，排在新增、修复之后。
- 条目：`- ` 开头的行；条目文字以「【需操作】」开头的为需操作条目。
- 在 `CHANGELOG.md` 文件头的维护说明中写明以上约定。
- 解析为纯函数，前后端共用同一结果结构（后端解析，前端只渲染）。

## 版本比较（我的决定）

- **本站版本 = 本站自带 `CHANGELOG.md` 中最新的已发布版本节**（不读 package.json）。这样版本号只有一个来源，发版时照常在 CHANGELOG 加节即可，不会出现「package.json 忘改导致误报」。
- 版本线：看书版只认不带后缀的版本节 `## [X.Y.Z]`；学习版只认 `## [X.Y.Z-study]`。study 合并 main 时会带进看书版的版本节，学习版解析时直接忽略它们，所以合并不需要特殊处理（CHANGELOG 冲突照常手工合并）。
- 只比较数字部分 `X.Y.Z`；远端比本站新的已发布版本全部列出（从新到旧），提示条显示最新的版本号。
- 已经升级到某版本后，该版本里的【需操作】不再作为「新版本」提醒——本机仍存在的配置问题由本机检测（`config_warning`）持续提示。
- 若较新版本中任意一个含【需操作】条目，提示条为醒目的警告样式，展开时【需操作】条目置顶。

## 界面

### 顶部提示条（只对管理员）

- 位置：DefaultLayout 主内容区顶部（阅读器页面不显示，避免打扰阅读）。
- 内容（可同时多条，按严重程度排序）：
  - 本机配置问题：直接显示 `config_warning` 文案 + 「去设置」按钮（跳到设置页 AI 区域）。不可关闭（问题解决后自动消失）。
  - 新版本：「有新版本 x.y.z（当前 a.b.c）」+「查看更新内容」（展开或弹出对话框：按版本列出，每个版本按分类列条目，【需操作】置顶）+ 关闭按钮。
- 关闭规则：普通新版本关闭后同一版本不再提示（记在浏览器 localStorage，按最新版本号）；含【需操作】的版本关闭后只在本次浏览器会话内不再提示（sessionStorage），重新打开浏览器 / 下次登录再次提示。
- 颜色取主题变量；手机宽度下提示条换行，不出现横向滚动。

### 设置页「更新说明」

- 读取本站自带的 `CHANGELOG.md`（随镜像发布），显示最近 5 个已发布版本，按分类列出条目，样式沿用现有折叠列表。每个版本的标题为「vX.Y.Z · YYYY-MM-DD」；版本节下、第一个小标题前的说明文字（如 1.0.0 的「首个正式版本。」）显示在标题下方（我的决定）。
- 页面顶部显示「当前版本 a.b.c」、远端检查状态（「已是最新」/「有新版本 x.y.z」/「无法连接更新源，上次检查 MM-DD HH:mm」/「已关闭更新检查」）与「立即检查」按钮。

## 接口（管理员，`authMiddleware` + `adminMiddleware`，挂 `/api` 与 `/api/v1`）

- `GET /api/settings/update-status` → `{ currentVersion, branch, enabled, checkedAt, error, newer: Release[] }`（`Release = { version, date, sections: [{ title, kind: 'added'|'fixed'|'other', items: [{ text, actionRequired }] }] }`）。
- `POST /api/settings/update-check` → 立即检查，返回同上。
- `GET /api/settings/changelog` → 本站自带 CHANGELOG 解析结果 `{ currentVersion, releases: Release[] }`（最近 5 个）。
- 补 `docs/api.md`。普通用户访问返回 403。

## 约束

- 后端：Express + better-sqlite3 + zod；外网请求用 Node 自带 `fetch` + `AbortController` 超时；不新增依赖。
- Docker：`.dockerignore` 放行 `CHANGELOG.md`，Dockerfile 把它 COPY 到运行镜像的 `/app/CHANGELOG.md`；后端读取路径：环境变量 `CHANGELOG_PATH` 优先，否则依次尝试 `<cwd>/CHANGELOG.md`、`<cwd>/../CHANGELOG.md`（覆盖镜像与本地开发两种布局）；读不到时设置页显示「未找到更新说明文件」，不报错。
- 前端：Vue 3 + Element Plus；API 只经 `frontend/src/api/`；UI 中文；图标 Tabler。
- 测试：解析、版本比较、来源回退与超时（mock fetch）、【需操作】识别、关闭规则（纯函数）测试先行；后端 Jest，前端 Vitest。
- 只在 main 实现；之后单向合并进 study，study 只需把分支常量改为 `study`。

## 留给实现

- 版本线标识常量的放法（例如 `backend/src/edition.ts` 导出 `EDITION: 'main' | 'study'`，决定读取分支与版本节后缀），要求学习版只改这一处且以后合并 main 不冲突。
- 解析结果的数据库存法（settings 表键值或单独小表）。
- 提示条展开是内联还是对话框。
- 「去设置」跳转到设置页 AI 区域的具体方式。
