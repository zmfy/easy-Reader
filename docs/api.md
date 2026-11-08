# easyReader API（v1）

本文档面向想自己开发阅读客户端（手机 App、桌面应用等）的用户。网页版用的也是这组接口，所有功能都能通过 API 完成。

- 在线查看：`http://<服务器地址>/api/docs`（原文 `/api/docs.md`）
- 本文只列出**读者端**接口；扫描书库、AI 补全、用户管理等管理员接口不在稳定范围内，可能随版本调整。

## 1. 基本约定

### 1.1 地址与版本

所有接口都以 `/api/v1` 开头，例如 `http://nas.local:3000/api/v1/library`。

- `/api/v1` 保证向后兼容：只会**新增**字段或接口，不会删除或改变已有字段的含义。客户端应忽略不认识的字段。
- 不兼容的改动会放到 `/api/v2`，`/api/v1` 继续保留。
- 网页版使用的 `/api/...`（不带版本）与 `/api/v1/...` 是同一组接口，第三方客户端请用带版本的地址。

> 从外网访问 NAS 时，请通过反向代理（Nginx、Caddy、群晖反代等）启用 HTTPS，否则密码与令牌会以明文传输。使用反向代理时请同时设置服务器环境变量 `TRUST_PROXY`（见 README），否则所有客户端会被当作同一个 IP 限流。

### 1.2 请求

- 请求体为 JSON：`Content-Type: application/json`。没有请求体的 POST 也请发送 `{}`。
- 除特别注明外，接口都需要登录：请求头 `Authorization: Bearer <accessToken>`。

### 1.3 响应格式

成功：

```json
{
  "success": true,
  "code": "OK",
  "message": "操作成功",
  "data": { },
  "meta": { "requestId": "…", "timestamp": "2026-11-05T07:40:25.889Z" }
}
```

分页接口另有 `pagination`：`{ "page": 1, "pageSize": 20, "total": 135, "totalPages": 7 }`。

失败时 `success` 为 `false`，`message` 是可直接显示给用户的中文说明：

| HTTP 状态 | code | 含义 |
|---|---|---|
| 401 | `AUTH_UNAUTHORIZED` | 未登录、令牌无效或已过期 |
| 403 | `AUTH_FORBIDDEN` | 没有权限（如普通用户调用管理员接口） |
| 403 | `AUTH_PASSWORD_CHANGE_REQUIRED` | 账号仍在使用默认密码，需先调用改密码接口（见第 2 节） |
| 404 | `RESOURCE_NOT_FOUND` | 书籍、书签等不存在 |
| 409 | `BUSINESS_CONFLICT` | 状态冲突（如书已在书架中） |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 不支持的资源类型 |
| 422 | `VALIDATION_ERROR` | 参数校验失败 |
| 429 | `RATE_LIMIT` | 请求过于频繁 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

### 1.4 时间格式

数据库中的时间（`imported_at`、`added_at`、`updated_at` 等）格式为 `YYYY-MM-DD HH:MM:SS`，时区为 **UTC**（不带 `Z`）。`meta.timestamp` 为 ISO 8601。

### 1.5 跨域

原生 App 不受浏览器跨域限制，无需配置。若客户端运行在浏览器中（另一个域名下的网页），需在服务器环境变量 `CORS_ORIGINS` 中加入该来源，多个用逗号分隔，例如 `CORS_ORIGINS=https://reader.example.com,http://localhost:5173`。

## 2. 登录与令牌

使用用户名、密码登录，得到两个令牌：

- `accessToken`：有效期 **2 小时**，放在每个请求的 `Authorization` 头里。
- `refreshToken`：有效期 **30 天**，只用于换取新令牌。请妥善保存（如系统钥匙串）。

推荐流程：请求返回 401 时，用 `refreshToken` 调用续期接口拿到新令牌，再重试原请求；续期也返回 401 时，回到登录界面。用户修改密码或被删除后，旧令牌立即失效。

频率限制（按客户端 IP，超出返回 429 `RATE_LIMIT`）：

- 登录、改密码：15 分钟内最多 **20 次失败**，成功的请求不计。
- 注册：15 分钟内最多 20 次（成功的也计数）。
- 续期：15 分钟内最多 120 次。请在收到 401 时续期，或在 accessToken 快过期时续期，不要每次请求前都续期。

### POST /api/v1/auth/login（无需登录）

```json
{ "username": "admin", "password": "******" }
```

返回：

```json
{
  "user": { "id": "b56e…", "username": "admin", "role": "admin" },
  "accessToken": "eyJ…",
  "refreshToken": "eyJ…"
}
```

用户名或密码错误时返回 401。

`user.mustChangePassword` 为 `true` 表示账号仍在使用默认密码（如首次启动自动创建的管理员）。这时除 `me`、`password`、`logout` 外，其他接口都返回 403 `AUTH_PASSWORD_CHANGE_REQUIRED`，客户端应先引导用户修改密码。

### POST /api/v1/auth/refresh（无需登录）

```json
{ "refreshToken": "eyJ…" }
```

返回新的 `{ "accessToken", "refreshToken" }`。两个都要替换保存。

### GET /api/v1/auth/me

返回当前用户 `{ id, username, role, created_at, mustChangePassword }`。

### POST /api/v1/auth/password

修改自己的密码，需要默认密码的账号也可以调用。

```json
{ "currentPassword": "当前密码", "newPassword": "Good#Pass1" }
```

新密码规则：8–100 位，包含大写字母、小写字母、数字和特殊字符（如 `!@#$%^&*`），且不能与当前密码相同。当前密码错误或新密码不合规时返回 422，`message` 说明原因。

成功后返回新的 `{ user, accessToken, refreshToken }`，请替换保存。此账号在其他设备上的令牌全部失效，需要重新登录。

### POST /api/v1/auth/logout

服务器不保存会话，调用后客户端删除本地保存的令牌即可。

### POST /api/v1/auth/register（无需登录）

```json
{ "username": "reader", "password": "至少 6 位", "inviteCode": "ABCD2345" }
```

用户名 3–50 位，密码 6–100 位。站点为邀请注册模式时必须提供 `inviteCode`。成功返回 201，内容与登录相同。

## 3. 站点信息

### GET /api/v1/settings/public（无需登录）

```json
{ "site_name": "我的书房", "site_subtitle": "", "site_theme": "indigo" }
```

可用于登录前确认服务器地址填写正确。

### 系统更新（管理员）

以下三个接口只有管理员可用，普通用户返回 403。站点会定期读取远端 CHANGELOG，比较本站版本，有新版本时提醒管理员。

`Release` 结构：

```json
{
  "version": "1.1.0",
  "date": "2026-11-10",
  "intro": "",
  "sections": [
    { "title": "新增", "kind": "added", "items": [{ "text": "……", "actionRequired": false }] }
  ]
}
```

`kind` 为 `added`（新增）、`fixed`（修复）或 `other`；`actionRequired` 为 `true` 表示条目以「【需操作】」开头，升级时需要管理员手动处理。`version` 是不带后缀的 `X.Y.Z`，`date` 可能为 `null`。

#### GET /api/v1/settings/update-status

返回最近一次检查的结果，不联网：

```json
{
  "currentVersion": "1.0.0",
  "branch": "main",
  "enabled": true,
  "noticeEnabled": true,
  "envDisabled": false,
  "checkedAt": "2026-11-06T08:00:00.000Z",
  "error": null,
  "newer": [ /* Release，新版本在前，只含比本站新的版本 */ ]
}
```

`currentVersion` 取自本站 CHANGELOG，读不到或其中没有本版本线的版本节时为 `null`（此时 `newer` 为远端全部版本，按版本降序）；`enabled` 为 `false` 表示用环境变量 `UPDATE_CHECK=off` 关闭了更新检查（此时 `envDisabled` 为 `true`）；`noticeEnabled` 为「系统提醒」开关的实际状态（环境变量关闭时恒为 `false`），关闭时前端隐藏铃铛、后台停止定时检查；`error` 是最近一次检查失败的原因（失败时 `newer` 仍保留上次成功的结果）。

#### POST /api/v1/settings/update-check

立即联网检查一次，返回值与 `update-status` 相同。检查失败也返回 200，原因在 `error` 里。「系统提醒」关闭（`noticeEnabled` 为 `false`，含环境变量关闭）时不联网，直接返回当前状态。

「系统提醒」开关通过 `PUT /api/v1/settings` 保存，键 `system_notice_enabled`，值 `'true'` / `'false'`（缺省视为开启）。保存后立即生效：关闭时清除后台定时检查；开启时恢复定时检查，并在约 5 秒后检查一次。

#### GET /api/v1/settings/changelog

本站 CHANGELOG 中最近 5 个版本：

```json
{ "currentVersion": "1.0.0", "missing": false, "releases": [ /* Release */ ] }
```

`missing` 为 `true` 表示本站找不到 CHANGELOG 文件。

## 4. 书库

### GET /api/v1/library

分页列出书籍。

| 参数 | 说明 |
|---|---|
| `page` | 页码，从 1 开始，默认 1 |
| `pageSize` | 每页数量，1–100，默认 20 |
| `search` | 按书名或作者模糊搜索 |
| `category` | 按分类筛选（完全匹配） |
| `sortBy` | `imported_at`（默认）、`title`、`author`、`file_size`、`category`、`rating` |
| `sortOrder` | `desc`（默认）或 `asc` |
| `series_grouped` | 为 `1` 时不列出属于某个系列的书（系列见下文） |

`data` 是书籍数组，每本书的主要字段：

| 字段 | 说明 |
|---|---|
| `id` | 书籍 ID（UUID），后续接口都用它 |
| `title` | 原始书名（来自文件名或元数据） |
| `display_title` | **用于显示的书名**（去掉了版本标记、作者等），界面请优先用它 |
| `author` | 作者，可能为 `null` |
| `file_format` | `txt` / `epub` / `pdf` / `umd` |
| `cover_url` | 封面地址，可能为 `null`，见「封面」 |
| `summary`、`category`、`tags` | 简介、分类、标签（`tags` 是 JSON 数组字符串） |
| `is_finished` | 是否完结（0 / 1） |
| `chapter_count` | 章节数（扫描时统计，可能为空） |
| `file_size` | 文件大小（字节） |
| `rating` | 评分，可能为 `null` |
| `series_id` | 所属系列 ID，没有为 `null` |
| `imported_at` | 入库时间 |

### GET /api/v1/library/:id

单本书的详情，字段同上。

### GET /api/v1/library/series

所有系列（同一部作品分成多个文件，如上下册）：`[{ id, name, summary, cover_url, member_count, … }]`。

### GET /api/v1/library/series/:id

`{ series, members }`，`members` 为该系列的书籍数组。

### 封面

`cover_url` 有两种形式：

- 以 `/` 开头的站内路径（如 `/covers/<id>.jpg`）：拼上服务器地址即可，**无需登录**。
- 完整的 `http(s)://` 地址：直接使用。

`cover_url` 为 `null` 时，客户端自行显示默认封面。

## 5. 书架

每个用户有自己的书架。

### GET /api/v1/shelf

按最近阅读排序的书架列表：

```json
[{
  "book_id": "4807…", "added_at": "2026-05-06 08:43:08", "last_read_at": "2026-11-05 04:15:19",
  "title": "西游记", "display_title": "西游记", "author": "吴承恩",
  "cover_url": "/covers/4807….jpg", "category": "玄幻", "file_format": "umd",
  "chapter_index": 12, "chapter_title": "第十三回 …", "scroll_top": 0,
  "progress_updated_at": "2026-11-05 04:15:19"
}]
```

没有阅读进度时，`chapter_index` 等进度字段为 `null`。

### GET /api/v1/shelf/:bookId

`{ "inShelf": true }`

### POST /api/v1/shelf

```json
{ "bookId": "4807…" }
```

成功返回 201；已在书架中返回 409。

### DELETE /api/v1/shelf/:bookId

不在书架中时返回 404。

## 6. 阅读

### GET /api/v1/reader/:bookId/chapters

目录：

```json
{
  "format": "epub",
  "chapters": [
    { "index": 0, "title": "封面", "level": 0 },
    { "index": 1, "title": "第一章 …", "level": 1, "groupTitle": "第一部 小丑" }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `index` | 章节序号，从 0 开始，取内容、保存进度都用它 |
| `title` | 章节标题，可能为空字符串（如漫画的单页） |
| `level` | 可选。目录层级，0 为顶层；没有多层目录的书不返回 |
| `groupTitle` | 可选。从这一章开始的分组标题（如 TXT 的「第一部 小丑」）。分组本身不是章节，显示为比该章高一层的目录项 |
| `href` | 可选。EPUB 内部路径，客户端一般用不到 |

PDF 另有 `pdfUsePlugin`：为 `false` 时 `chapters` 为空，表示管理员设置为直接显示原文件，请用下文的「原文件」接口下载 PDF 自行渲染。

### GET /api/v1/reader/:bookId/chapter/:index

章节内容。参数 `format`：

- `html`（默认）：返回 `{ "index": 1, "content": "<p>…</p>" }`，是网页版使用的、已清理过的 HTML。
- `blocks`：返回结构化内容块，**推荐 App 使用**：

```json
{
  "index": 8,
  "format": "blocks",
  "blocks": [
    { "type": "h", "level": 4, "text": "摆平违规者", "anchor": 1 },
    { "type": "p", "text": "清朝的京官比外官穷……", "anchor": 3 },
    { "type": "img", "src": "/api/reader/ee17…/asset/OEBPS/Images/1.jpg", "alt": "插图", "anchor": 7 }
  ]
}
```

| type | 字段 | 说明 |
|---|---|---|
| `h` | `level`、`text` | 标题，`level` 为 1–6 |
| `p` | `text` | 段落。已去掉首行缩进，由客户端自行排版；`text` 中的 `\n` 是原文的换行（如诗句） |
| `img` | `src`、`alt`（可选） | 图片，`src` 规则见「图片」 |

每个块都有 `anchor`，用于保存阅读进度（见下文）。

- TXT 的章节标题也包含在正文第一段中，与网页版一致。
- 漫画 EPUB 的每一页通常只有一个 `img` 块。

`format` 不是 `html` 或 `blocks` 时返回 422。

### 图片

章节中的图片地址形如 `/api/reader/<bookId>/asset/<路径>`，是相对服务器的地址，拼上服务器地址即可。图片请求**无需登录**，可直接交给图片加载库。只提供 JPEG、PNG、GIF、WebP。

### GET /api/v1/reader/:bookId/raw

下载原文件（需要登录），可用于离线阅读或自行渲染 PDF。`Content-Type` 为 `application/pdf`、`application/epub+zip` 或 `application/octet-stream`。

## 7. 阅读进度

进度按用户、按书保存，网页版与各客户端共用，读到哪里在所有设备上同步。

### GET /api/v1/reader/:bookId/progress

```json
{
  "hasProgress": true,
  "chapterIndex": 12,
  "chapterTitle": "第十三回 …",
  "scrollTop": 0,
  "paragraphIndex": 37,
  "paragraphOffset": 0.4,
  "updatedAt": "2026-11-05 04:15:19"
}
```

没有进度时 `hasProgress` 为 `false`，其余字段为 0 或空。

### POST /api/v1/reader/:bookId/progress

```json
{ "chapterIndex": 12, "chapterTitle": "第十三回 …", "scrollTop": 0, "paragraphIndex": 37, "paragraphOffset": 0.4 }
```

| 字段 | 说明 |
|---|---|
| `chapterIndex` | 必填，章节序号 |
| `scrollTop` | 必填，网页版的滚动像素，App 填 0 即可 |
| `chapterTitle` | 可选，最长 100 字，用于书架显示「读到」 |
| `paragraphIndex` | 可选，当前屏幕顶部那个块的 **`anchor`**（不是块在数组中的位置） |
| `paragraphOffset` | 可选，0–1，该块已经滚过的比例 |

位置的含义：

- 保存时，`paragraphIndex` 填屏幕顶部第一个可见块的 `anchor`。`anchor` 与网页版的段落计数一致，所以 App 与网页版之间可以精确接着读。
- 恢复时，找到第一个 `anchor >= paragraphIndex` 的块，滚动到该块，再按 `paragraphOffset` 向下偏移块高度的相应比例。
- 后保存的覆盖先保存的。离开阅读界面或翻章时保存一次，阅读中建议停止滚动约 1 秒后保存，不要每帧都保存。

保存时书若在书架中，书架的「最近阅读」时间也会更新。

## 8. 书签

每本书最多保留最近的 10 个书签，超出时自动删除最早的。

### GET /api/v1/reader/:bookId/bookmarks

`[{ id, book_id, chapter_index, scroll_top, note, created_at }]`，按创建时间倒序。

### POST /api/v1/reader/:bookId/bookmarks

```json
{ "chapterIndex": 12, "scrollTop": 0, "note": "最长 500 字，可选" }
```

成功返回 201 和新书签。

### DELETE /api/v1/reader/:bookId/bookmarks/:id

### 划线与批注

对正文的一段文字做划线，可附带批注。每个用户在每本书上各有一份，按阅读顺序（章节、偏移）排列。

### GET /api/v1/reader/:bookId/highlights

`[{ id, user_id, book_id, chapter_index, start_offset, end_offset, text, note, created_at, updated_at }]`，按 `chapter_index`、`start_offset` 升序。

### POST /api/v1/reader/:bookId/highlights

```json
{ "chapterIndex": 12, "startOffset": 100, "endOffset": 130, "text": "划线的原文，1 到 1000 字", "note": "最长 2000 字，可选" }
```

`chapterIndex`、`startOffset` 为不小于 0 的整数，`endOffset` 必须大于 `startOffset`。成功返回 201 和新划线；书不存在返回 404，参数不合法返回 422。

### PATCH /api/v1/reader/:bookId/highlights/:id

```json
{ "note": "新的批注，最长 2000 字；传 null 或空字符串清除批注" }
```

返回更新后的划线；不存在返回 404。

### DELETE /api/v1/reader/:bookId/highlights/:id

删除划线，不存在返回 404。

### AI 展开与导图节点

对划线调用 AI，生成可继续追问的知识点候选；保留的知识点链存为导图节点。AI 只使用读者当前阅读位置之前的内容（防剧透），出处在读者位置之后的候选带 `later: true`。

### POST /api/v1/reader/:bookId/highlights/:id/expand

```json
{ "center": "要展开的知识点，1 到 60 字，可选（缺省为划线原文）", "path": ["上游知识点，最多 10 项，每项不超过 60 字"], "force": false }
```

返回 `{ candidates: [{ label, kind, summary, source }], cached }`。`kind` 为 `event`、`concept`、`person`；`source` 为 `{ chapterIndex, paragraphIndex, chapterTitle, later }` 或 `null`。缓存按（书、中心词、划线所在章、实际送给 AI 的段落范围）跨用户共享，阅读边界更早的用户不会命中含更后段落的缓存；命中时按本次的中心词与 `path` 再过滤候选。`force: true` 跳过缓存重新生成。错误：未配置 AI 返回 400 `AI_NOT_CONFIGURED`；划线或书不存在 404；AI 返回无法解析 422 `AI_BAD_OUTPUT`；其他 AI 错误 500。

### GET /api/v1/reader/:bookId/mind-nodes

可选查询参数 `highlightId`，只取该划线下的节点。返回 `MindNode[]`，每个节点额外带 `source_later: boolean`：出处（`source_chapter`/`source_paragraph`）在当前用户阅读边界（阅读进度与该划线位置中较晚者）之后为 `true`，无出处为 `false`。书或书文件不存在返回 404。

### POST /api/v1/reader/:bookId/mind-nodes/keep

```json
{ "highlightId": "划线 id", "chain": [{ "label": "1 到 60 字", "kind": "event", "summary": "可选，最长 200 字", "source": { "chapterIndex": 3, "paragraphIndex": 5 } }] }
```

`chain` 为 1 到 10 项，从上游到下游依次排列；已存在的节点会复用。返回该链上的 `MindNode[]`（含根节点）；划线不存在返回 404。

### POST /api/v1/reader/:bookId/mind-nodes

手动添加节点（`kind` 为 `custom`）。

```json
{ "parentId": "挂在该节点下", "chapterIndex": 3, "label": "1 到 60 字", "note": "可选，最长 2000 字" }
```

`parentId` 与 `chapterIndex` 必须恰好给一个：给 `parentId` 时挂在该节点下（须是本人的节点），章节与划线归属继承父节点；给 `chapterIndex` 时挂在该章下。返回 201 与 `MindNode`；参数不符 422；书不存在或父节点不存在 404。

### PATCH /api/v1/reader/:bookId/mind-nodes/:id

```json
{ "label": "新名称，1 到 60 字", "note": "批注，最长 2000 字；空字符串或 null 清除" }
```

两个字段至少给一个，返回更新后的 `MindNode`。节点不存在或不是本人的返回 404；划线根节点（`kind` 为 `highlight`）的名称就是划线原文、批注就是划线批注（用 `PATCH /highlights/:id` 修改），改它的名称或写非空批注返回 403 `FORBIDDEN`；传 `note: null` 或空字符串清除可以。

### DELETE /api/v1/reader/:bookId/mind-nodes/:id

删除节点及其子树，返回 `{ deleted: 数量 }`；不存在返回 404。

### 笔记整理（学习版）

把一本书的划线与导图节点（统称「笔记」）交给 AI 整理成按主题分组的文档（界面上叫「笔记整理」，下文简称「总结」），用户可以继续手动编辑，每次变化都会留下可恢复的版本。接口前缀为 `/api/v1/study`，全部需要登录，只能访问自己的总结。

整体流程：

1. `GET /study/summaries` 看哪些书有笔记、哪些已有总结。
2. `POST /study/books/:bookId/summary/jobs` 启动整理任务（后台执行，返回 202），再轮询 `GET .../summary/jobs/current` 直到任务结束。
3. `GET /study/books/:bookId/summary` 读取总结；`PUT` 手动保存；`.../versions` 查看与恢复历史版本。

#### 文档模型

总结正文（`doc`）是 Tiptap（ProseMirror）风格的 JSON 树，根节点为 `{ "type": "doc", "content": [...] }`。**节点类型白名单**（其他类型保存时返回 422）：

| type | 说明 | attrs / 备注 |
|---|---|---|
| `doc` | 根节点 | 仅作根 |
| `heading` | 标题 | `attrs.level` 必须是 `2` 或 `3`；AI 生成的「主题」是 2 级标题 |
| `paragraph` | 段落 | 内含 `text`、`hardBreak`、`noteRef` |
| `bulletList` / `orderedList` | 无序 / 有序列表 | `orderedList` 可带 `attrs.start`（整数或 `null`）与 `attrs.type`（字符串或 `null`）；内含 `listItem` |
| `listItem` | 列表项 | 内含段落与嵌套列表 |
| `codeBlock` | 代码块 | 可带 `attrs.language`（字符串或 `null`） |
| `hardBreak` | 换行 | — |
| `text` | 文字 | `text` 字段（非空字符串）；可带 `marks`，类型只能是 `bold`、`italic`、`code`、`aiAdded`（AI 补充，见下） |
| `noteRef` | 引用某条笔记 | `attrs.ref`：引用标识，格式见下 |
| `table` | 表格 | 只能在 `doc` 顶层；内含 `tableRow` |
| `tableRow` | 表格的一行 | 内含 `tableHeader` 或 `tableCell` |
| `tableHeader` / `tableCell` | 表头格 / 普通格 | 可带 `attrs.colspan`、`attrs.rowspan`（只能是 `1` 或 `null`）、`attrs.colwidth`（只能是 `null`）——不支持合并单元格与列宽 |

**内容模型**（父节点能包含哪些子节点，不符合时保存返回 422）：

| 父节点 | 允许的子节点 |
|---|---|
| `doc` | 块级：`heading`、`paragraph`、`bulletList`、`orderedList`、`codeBlock`、`table`（至少一个） |
| `heading`、`paragraph` | 行内：`text`、`hardBreak`、`noteRef`（可为空） |
| `codeBlock` | 不带 `marks` 的 `text`（可为空） |
| `bulletList`、`orderedList` | `listItem`（至少一个） |
| `listItem` | 第一个必须是 `paragraph`，之后可接 `paragraph`、`bulletList`、`orderedList`、`codeBlock`（不能是标题） |
| `table` | `tableRow`（至少一个，最多 200 行） |
| `tableRow` | `tableHeader`、`tableCell`（至少一个，最多 8 个；同一表格每行个数必须相同） |
| `tableHeader`、`tableCell` | 只能是 `paragraph`（至少一个），不能放列表、代码块或表格 |
| `text`、`hardBreak`、`noteRef` | 叶子节点，不能有 `content` |

`doc` 只能出现在根上；`text` 的 `text` 不能是空字符串（编辑器无法载入空文字节点）。

示例：

```json
{
  "type": "doc",
  "content": [
    { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "渔夫的坚持" }] },
    { "type": "paragraph", "content": [
      { "type": "text", "text": "老人连续八十四天没有捕到鱼，", "marks": [{ "type": "bold" }] },
      { "type": "text", "text": "仍然出海。" },
      { "type": "noteRef", "attrs": { "ref": "h:21904119-cdb3-40f7-8175-11b208951f81" } }
    ] }
  ]
}
```

**表格**：习惯上第一行用 `tableHeader` 作表头（列名），其余行用 `tableCell`。第三方客户端没有专用的「加行 / 改格子」接口：用 `format=json` 读出整篇，直接修改表格节点（加一行就是在 `table.content` 里插入一个格子数相同的 `tableRow`），再用 `PUT` 整篇保存（带 `revision`）。示例：

```json
{ "type": "table", "content": [
  { "type": "tableRow", "content": [
    { "type": "tableHeader", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "命令" }] }] },
    { "type": "tableHeader", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "作用" }] }] }
  ] },
  { "type": "tableRow", "content": [
    { "type": "tableCell", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "ls", "marks": [{ "type": "code" }] }] }] },
    { "type": "tableCell", "content": [{ "type": "paragraph", "content": [
      { "type": "text", "text": "列出目录内容" },
      { "type": "noteRef", "attrs": { "ref": "h:21904119-cdb3-40f7-8175-11b208951f81" } }
    ] }] }
  ] }
] }
```

空格子写成 `{ "type": "tableCell", "content": [{ "type": "paragraph" }] }`。

**AI 补充标记 `aiAdded`**：用户允许 AI 补充时（见「学习偏好」），AI 整理结果中笔记里没有、由 AI 补上的文字带 `aiAdded` 标记（无属性，可与其他标记叠加）。客户端应把它显示得与普通文字有区别；去掉标记即表示用户认可这段内容。

文档限制：嵌套深度不超过 20 层、节点总数不超过 20000、序列化（`JSON.stringify`）后不超过 2,000,000 字符。不允许出现未列出的节点类型、属性或 marks。

**引用标识（ref）**：`h:<划线 id>` 指向一条划线，`n:<导图节点 id>` 指向一个导图节点（非划线类）。id 是 UUID。引用对应的笔记可能后来被删除，客户端应容错（见 `refs` 接口）。

**blocks 结构**：不想解析 Tiptap 树的客户端（小程序、原生 App）用 `?format=blocks` 获得扁平化的块列表：

```json
[
  { "type": "h", "level": 2, "text": "渔夫的坚持" },
  { "type": "p", "parts": [
    { "text": "老人连续八十四天没有捕到鱼，", "bold": true },
    { "text": "仍然出海。" },
    { "ref": "h:21904119-cdb3-40f7-8175-11b208951f81" }
  ] },
  { "type": "list", "ordered": false, "items": [[{ "text": "要点一" }], [{ "text": "要点二" }]] },
  { "type": "code", "text": "print('hi')" },
  { "type": "table", "header": [[{ "text": "命令" }], [{ "text": "作用" }]],
    "rows": [[[{ "text": "ls", "code": true }], [{ "text": "列出目录内容" }, { "text": "，-a 显示隐藏文件", "ai": true }]]] }
]
```

块类型为 `h`（`level` 为 2 或 3）、`p`、`list`（`ordered`，`items` 是若干个 `parts` 数组；嵌套层级用行首空格 `text` 表示）、`code`、`table`。`parts` 的元素是 `{ text, bold?, italic?, code?, ai? }`（文字，样式字段只在为真时出现；`ai` 表示 AI 补充）或 `{ ref }`（引用）；`hardBreak` 输出为 `{ "text": "\n" }`，即文字中的换行符 `\n`。

`table` 块：`header` 是表头各格的 `parts`（第一行全是 `tableHeader` 时取第一行，否则为空数组、所有行都在 `rows` 里），`rows` 是数据行，每行是各格 `parts` 的数组。**以后可能新增块类型，客户端遇到不认识的 `type` 应忽略该块。**

#### GET /api/v1/study/summaries

可选查询参数 `q`：按书名或总结正文模糊过滤。返回有笔记或有总结的书（书已删除且没有总结的不返回），按总结更新时间倒序（没有总结的排在最后）：

```json
[{
  "bookId": "e36eaa58-…", "bookTitle": "老人与海", "hasSummary": true,
  "themes": ["渔夫的坚持", "与自然的关系"],
  "noteCount": 12, "newNoteCount": 3,
  "updatedAt": "2026-11-06 04:01:28", "lastSource": "ai_update",
  "job": null
}]
```

`noteCount` 为全部笔记数，`newNoteCount` 为尚未被总结纳入的新笔记数；`bookTitle` 为 `null` 表示书已被删除；`lastSource` 见下文「版本」；`job` 为该书最近一次任务（见下）或 `null`。

#### GET /api/v1/study/books/:bookId/summary

查询参数 `format`：`json`（默认）、`blocks`、`markdown`，其他值返回 422。

```json
{
  "summary": {
    "id": "…", "book_id": "…", "revision": 3,
    "included_refs": ["h:…", "n:…"],
    "created_at": "2026-11-06 04:01:28", "updated_at": "2026-11-06 04:20:00",
    "doc": { "type": "doc", "content": [{ "type": "paragraph" }] }
  },
  "bookTitle": "老人与海", "noteCount": 12, "newNoteCount": 3,
  "job": null
}
```

- 还没有总结时 `summary` 为 `null`（仍返回笔记数与 `job`）。
- `format=blocks` 时 `summary.doc` 换成 `summary.blocks`；`format=markdown` 时换成 `summary.markdown`（字符串，标题为「书名 · 笔记整理」，引用输出为「（出自：书名 章节标题）」，章节标题取不到时用「第 N 章」，已删除的笔记写「原笔记已删除」；表格输出为 GFM 表格，格子里的 `|` 转义、换行变空格；AI 补充的文字后加「（AI 补充）」）。
- `revision` 是修订号，保存时要原样带回（见下）。`included_refs` 是已被总结纳入的笔记引用，用来计算新笔记。

#### PUT /api/v1/study/books/:bookId/summary

手动保存整篇文档：

```json
{ "doc": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "内容" }] }] }, "revision": 3 }
```

可选字段（采用 AI 整理结果时使用，见「AI 整理预览」）：

- `source`：只能是 `"ai_tidy"`。传了就**总是新建一个版本**（来源「AI 整理」），不与 30 分钟内「我」的版本合并。不传时与原来完全相同（来源「我」）。
- `description`：版本简述，1–50 字，例如「整理成表格（3 列 5 行）」；缺省为「AI 整理」。只能与 `source` 一起使用，单独传返回 422。

成功返回 200 与最新 `summary`（`revision` 加 1）。

**修订号与 409**：`revision` 必须等于服务器当前修订号，否则说明总结已在别处（另一个客户端、AI 任务）被改过，返回 409 `BUSINESS_CONFLICT`，`data` 为最新的 `summary`：

```json
{ "success": false, "code": "BUSINESS_CONFLICT", "message": "整理内容已在别处更新", "data": { "id": "…", "revision": 4, "doc": {} } }
```

`message` 有两种：「整理内容已在别处更新」（修订号过期）与「正在整理中，请稍后再改」（该书有 AI 任务正在运行）。客户端的处理：用 `data` 里的最新内容让用户决定（放弃本地修改、或在最新内容上重新编辑后再保存），再用新的 `revision` 提交；整理中则等任务结束后重试。

其他错误：`doc` 不合法（含非白名单节点、不符合内容模型）或序列化后超过 2,000,000 字符返回 422；该书还没有总结返回 404。

#### POST /api/v1/study/books/:bookId/summary/jobs

启动后台整理任务：

```json
{ "kind": "generate" }
```

`kind` 为 `generate`（首次生成，已有总结时不可用）或 `update`（把新笔记并入已有总结，只追加，不改动已有内容）。**还没有总结时请求 `update` 会按 `generate` 处理**。成功返回 **202**，`data` 为任务对象；该书已有任务在运行时不会重复启动，同样返回 202 与那个任务。

错误：未配置 AI 返回 400 `AI_NOT_CONFIGURED`；书不存在（含书已被删除）404；422 `VALIDATION_ERROR`，`message` 为「这本书还没有笔记」「没有新笔记」或「已经整理过，请使用更新」。

**任务对象**：

```json
{ "id": "…", "book_id": "…", "kind": "generate", "status": "running", "done": 1, "total": 3,
  "error": null, "created_at": "2026-11-06 04:01:28", "finished_at": null }
```

`status` 取值：`running`（进行中，`done / total` 为已完成批次与总批次）、`done`（成功，总结已写入）、`failed`（失败，`error` 为原因）。服务重启时遗留的运行中任务会被标记为 `failed`。

**客户端轮询流程**：启动任务（202）后，每约 2 秒请求一次 `GET /study/books/:bookId/summary/jobs/current`，用 `done / total` 显示进度；`status` 变为 `done` 后重新读取总结；变为 `failed` 则显示 `error`，允许用户重试。进入页面时也先查一次 `jobs/current`，若为 `running` 就直接接着轮询。任务运行期间手动保存、恢复版本、删除总结都会被拒绝（409）。

#### GET /api/v1/study/books/:bookId/summary/jobs/current

返回该书最近一次任务（任务对象，见上），没有任何任务时 `data` 为 `null`。

#### DELETE /api/v1/study/books/:bookId/summary

删除总结及其全部版本，返回 `{ "deleted": true }`；没有总结 404；有任务正在运行 409。

#### 版本

每次总结内容变化都会记一个版本，用于查看与恢复。版本的 `source` 取值：

| source | 含义 |
|---|---|
| `ai_generate` | AI 首次生成 |
| `ai_update` | AI 追加新笔记 |
| `user` | 用户手动保存 |
| `restore` | 恢复到某个旧版本 |
| `ai_tidy` | 采用 AI 整理成列表 / 表格的结果（`PUT` 时带 `source: "ai_tidy"`） |

**30 分钟内连续的手动保存会合并为一个版本**（滑动窗口：每次手动保存都会刷新该版本的 `updated_at`，只要距上一次手动保存不超过 30 分钟，就覆盖同一个 `user` 版本而不新增；上一个版本不是 `user`，或已超过 30 分钟，则新建）。因此版本的时间以 `updated_at` 为准。

#### GET /api/v1/study/books/:bookId/summary/versions

按时间倒序返回版本列表（不含正文）：

```json
[{ "id": "…", "source": "user", "description": "手动修改", "created_at": "…", "updated_at": "…" }]
```

#### GET /api/v1/study/books/:bookId/summary/versions/:versionId

返回单个版本：`{ id, doc, source, description, updated_at }`；不存在 404。

#### POST /api/v1/study/books/:bookId/summary/versions/:versionId/restore

```json
{ "revision": 3 }
```

把总结恢复为该版本的内容，并新增一个 `source` 为 `restore` 的版本（不会删除其他版本），版本描述为「恢复到『<被恢复版本的来源>』版本」，来源为「AI 生成」「AI 补充」「我」「恢复」「AI 整理」之一（不含时间，时间看版本的 `updated_at`）。返回 200 与最新 `summary`。

恢复只替换正文，**不改变「已整理的笔记」集合（`included_refs`）**：恢复点之后才被整理进总结的笔记仍算已整理，之后「更新」不会再把它们补充进来；如需重新整理，可手动编辑或删除总结后重新生成。`revision` 与 409 的规则同 `PUT`；总结或版本不存在 404。

#### POST /api/v1/study/books/:bookId/summary/tidy

AI 整理预览：把总结中选中的一段内容交给 AI 整理成列表或表格。**同步返回结果，不写库、不产生版本**；客户端展示给用户确认后，自己把结果放进文档（替换选中的那些块），再用 `PUT .../summary` 带 `source: "ai_tidy"` 整篇保存。

```json
{
  "mode": "table",
  "content": [
    { "type": "paragraph", "content": [{ "type": "text", "text": "ls 列出目录内容，-l 显示详细信息" }, { "type": "noteRef", "attrs": { "ref": "h:…" } }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "chmod 改文件权限，常用 755、644" }] }
  ],
  "columns": ["命令", "作用", "常用参数"]
}
```

| 字段 | 说明 |
|---|---|
| `mode` | `list`（整理成一个无序列表）或 `table`（整理成一张第一行为表头的表格） |
| `content` | 选中的**顶层块**（Tiptap JSON 节点数组，按上文文档模型校验）。建议按整块提交：选区碰到的段落、列表、表格整块算入。不能包含二级标题（只能在一个主题内整理），文字总量不超过 6000 字 |
| `columns` | 仅 `table` 可用，可选，2–6 个列名，每个 1–20 字。不传则由 AI 自定列名；传了则 AI 按这些列名重排 |

是否允许 AI 补充由该用户的「学习偏好」`allowAiAddition` 决定，请求里不传。

响应 `data`：

```json
{
  "nodes": [{ "type": "table", "content": [] }],
  "columns": ["命令", "作用", "常用参数"],
  "missingRefs": ["h:…"],
  "aiAddedCount": 2
}
```

- `nodes`：整理结果，一个 `table` 或一个 `bulletList` 节点（数组形式，便于直接替换）。表格最多 200 行（含表头）、列数等于 `columns` 个数。
- `columns`：表格实际使用的列名（列表模式为空数组），可让用户修改后再请求一次。
- `missingRefs`：`content` 里出现过、但结果里没有保留下来的引用。结果中只会出现 `content` 里出现过的引用。
- `aiAddedCount`：结果中带 `aiAdded` 标记（AI 补充）的片段数。

错误：参数不合规、`content` 含二级标题（「请在一个主题内选择」）、超长（「选中的内容太多，请分段整理」）返回 422 `VALIDATION_ERROR`；未配置 AI 400 `AI_NOT_CONFIGURED`；书或总结不存在 404；该书有生成 / 更新任务正在运行 409 `BUSINESS_CONFLICT`；AI 返回无法解析 422 `AI_BAD_OUTPUT`（「AI 返回的内容无法解析，请重试」）；其他 AI 错误 500。AI 调用通常需要十几秒，客户端请把超时设长一些。

#### 学习偏好

每个账号各自一份，所有书共用。

`GET /api/v1/study/prefs` → `{ "allowAiAddition": false }`（没保存过时返回默认值）。

`PUT /api/v1/study/prefs`，body `{ "allowAiAddition": true }` → 返回保存后的偏好；字段缺失、类型不对或有多余字段返回 422。

| 字段 | 说明 |
|---|---|
| `allowAiAddition` | 「整理笔记时允许 AI 补充内容」，默认 `false`。只影响「AI 整理预览」：关闭时 AI 只重新组织选中的内容；打开时 AI 可补上笔记里没写的常识，补充的文字带 `aiAdded` 标记。不影响生成 / 更新任务 |

#### GET /api/v1/study/books/:bookId/refs/:ref

解析总结里的一个引用标识（`:ref` 形如 `h:<id>` 或 `n:<id>`），用来在界面上显示出处、跳转回原文：

```json
{ "exists": true, "type": "node", "text": "概念甲：说明",
  "target": { "chapter": 3, "find": "概念甲" }, "later": true, "canOpen": true }
```

- `exists: false`：笔记已被删除、不属于当前用户或标识不合法，此时没有其他字段（`{ "exists": false }`）。
- `type`：`highlight`（划线）或 `node`（导图节点）；`text` 为划线原文或「名称：摘要」，最长 200 字。
- `target`（跳转目标）：划线为 `{ "highlight": "<划线 id>" }`；导图节点为 `{ "chapter": 章节序号(0 起), "find": "要在章内查找的文字" }`，没有记录出处的节点只有 `chapter`（取节点所在章）。章节序号与 `reader/:bookId/chapters` 的 `index` 一致。
- `later`：该节点的出处是否在用户阅读边界之后（可能剧透，客户端建议提示或折叠）；划线恒为 `false`。
- `canOpen`：书与书文件是否可读；为 `false` 时只能显示 `text`，不能跳转。

## 9. 阅读偏好

每个用户一份，由客户端自行定义内容（字号、主题等），网页版也存在这里。

### GET /api/v1/settings/reader-prefs

返回保存的对象，没有时为 `null`。

### PUT /api/v1/settings/reader-prefs

请求体是**扁平**的对象：值只能是字符串（最长 200）、数字或布尔值，最多 30 个字段，总大小不超过 4KB。整个对象会**替换**原值。

和网页版共用这份设置时，请先读出原有内容，修改后整体写回，保留不认识的字段。

## 10. 最小示例

```bash
BASE=http://nas.local:3000/api/v1

# 登录
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"reader","password":"******"}' | jq -r .data.accessToken)

# 书架、目录、第一章内容
curl -s $BASE/shelf -H "Authorization: Bearer $TOKEN"
curl -s $BASE/reader/<bookId>/chapters -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/reader/<bookId>/chapter/0?format=blocks" -H "Authorization: Bearer $TOKEN"

# 保存进度
curl -s -X POST $BASE/reader/<bookId>/progress -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"chapterIndex":0,"scrollTop":0,"paragraphIndex":5}'
```
