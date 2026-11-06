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

`currentVersion` 取自本站 CHANGELOG，读不到时为 `null`（此时 `newer` 为空）；`enabled` 为 `false` 表示用环境变量 `UPDATE_CHECK=off` 关闭了更新检查（此时 `envDisabled` 为 `true`）；`noticeEnabled` 为「系统提醒」开关的实际状态（环境变量关闭时恒为 `false`），关闭时前端隐藏铃铛、后台停止定时检查；`error` 是最近一次检查失败的原因（失败时 `newer` 仍保留上次成功的结果）。

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
