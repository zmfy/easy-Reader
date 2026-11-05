# 开发文档

面向改代码的人。只想部署和使用请看 [README](../README.md)。

---

## 技术栈

| 层级 | 选型 |
|---|---|
| 前端 | Vue 3 + Vite + TypeScript + Pinia + Vue Router |
| UI | Element Plus |
| 后端 | Node.js 22 + Express + TypeScript |
| 数据库 | SQLite（better-sqlite3） |
| 认证 | JWT（Access Token 2h + Refresh Token 30d） |
| 容器 | Docker 单容器，Express 同时托管 API 与前端静态文件 |
| 测试 | 后端 Jest、前端 Vitest |

---

## 本地开发

```bash
# 后端（热重载）
cd backend && npm install && npm run dev   # http://localhost:3000

# 前端（热重载，代理 /api 到 :3000）
cd frontend && npm install && npm run dev  # http://localhost:8080
```

### 测试与类型检查

```bash
cd backend  && npm test            # Jest
cd frontend && npm test            # Vitest
cd frontend && npm run typecheck   # vue-tsc --noEmit
cd frontend && npm run build       # vue-tsc + vite build
```

---

## 目录结构

```
easyReader/
├── Dockerfile              # 三阶段构建（前端 + 后端 + 运行时）
├── docker-compose.yml
├── .env.example
│
├── frontend/src/
│   ├── api/                # HTTP 封装：auth / library / reader / shelf / settings
│   │                       #            scan-batches / scan-task / series / audit-log / http
│   ├── assets/styles/      # CSS 设计变量
│   ├── components/         # AI 填充预览、扫描选项/进度、判重与系列卡片、PDF 页等
│   ├── composables/        # useAuth / useReader / useListen / useBookDelete
│   ├── layouts/            # DefaultLayout（导航栏）
│   ├── router/             # 路由与权限守卫
│   ├── stores/             # Pinia：auth / reader / scan-task
│   ├── types/              # DTO 类型定义
│   ├── utils/              # 纯函数：阅读样式、快捷键、AI 文本处理、TTS 分段、浏览器语音等
│   └── views/              # 15 个页面视图
│       ├── Login.vue / Register.vue
│       ├── Library.vue / Bookshelf.vue / BookDetail.vue
│       ├── Reader.vue / Settings.vue / ChangePassword.vue
│       ├── BookMap.vue                               # 学习导图（/book/:bookId/map）
│       ├── ScanBatchList.vue / ScanBatchReview.vue   # 扫描批次审核
│       ├── ProblemBooks.vue                          # 重复 / 乱码书籍
│       ├── SeriesDetail.vue
│       ├── ManualOverridesAdmin.vue                  # 人工覆盖
│       └── AuditLogView.vue
│
├── backend/src/
│   ├── ai/                 # AI 插件。ai-manager.ts 的 aiPlugins 数组决定哪些可选，
│   │                       # 目前只注册了 deepseek / minmax / ollama；
│   │                       # qwen / openai / claude 有实现但未注册（见下）
│   │                       # + ai-manager（插件调度）、fill-prompt（填充提示词）
│   ├── middleware/         # auth.ts：JWT 认证 + 管理员校验
│   ├── plugins/            # 文件解析：parser-txt / parser-epub / parser-pdf / parser-umd
│   │                       # + plugin-manager（按扩展名分派）
│   ├── routes/             # 9 个路由模块（见下）
│   ├── services/           # 业务逻辑：扫描、判重、批次、AI 填充、听书、审计等
│   ├── utils/              # 指纹、编码探测、书名规范化、封面、路径安全、响应封装等
│   ├── db.ts               # SQLite Schema 初始化与幂等迁移
│   ├── index.ts            # Express 入口 + 静态文件托管
│   └── types/index.ts      # 共享接口定义
│
├── docs/superpowers/       # 各功能的设计稿与实现计划
├── books/                  # 书库目录（挂载宿主机路径）
└── data/                   # SQLite 持久化目录
```

### 关键 service

| 文件 | 职责 |
|---|---|
| `scan-walker.ts` / `scan-task.ts` | 遍历书库、异步扫描任务与进度 |
| `scan-versions.ts` | 指纹与 AI 填充的算法版本号，改算法时自增即可触发全量重建 |
| `batch-builder.ts` / `batch-applier.ts` | 扫描结果 → 待审核批次 → 应用入库 |
| `dedup-grouper.ts` / `duplicate-view.ts` | 指纹判重与分组展示 |
| `manual-override.ts` | 人工覆盖：记住管理员对误判的纠正 |
| `ai-fill-preview.ts` / `ai-fill-apply.ts` / `ai-batch-fill.ts` | AI 填充的预览、应用与批量 |
| `ai-reading.ts` / `ai-reading-run.ts` | 前情提要与问书：正文整理、关键词检索、提示词构建 |
| `tts.ts` | 听书：MiniMax 语音合成 + 按文本缓存音频 |
| `chapter-normalize.ts` | 章节规范化 |
| `audit-log.ts` | 管理操作审计 |
| `cost-estimator.ts` | 扫描 / 填充前的 token 成本预估 |

---

## API

统一响应格式：`{ "success": true, "code": "OK", "data": {} }`

标注 **admin** 的端点需要管理员角色，其余需登录。

### 认证 `/api/auth`

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/login` | 登录 |
| POST | `/logout` | 登出 |
| POST | `/register` | 邀请码注册 |
| POST | `/refresh` | 用 Refresh Token 换新 Access Token |
| GET | `/me` | 当前用户 |

### 书库 `/api/library`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 书籍列表（分页，`status` 可筛 `problems` / `garbled` / `duplicate`） |
| GET | `/:id` | 书籍详情 |
| PUT | `/:id` | 修改书籍信息 — admin |
| DELETE | `/:id` | 删除书籍 — admin |
| GET | `/scan/estimate` | 扫描成本预估 — admin |
| POST | `/scan` | 发起扫描（异步任务；有待审核批次时拒绝） — admin |
| GET | `/scan/tasks/active` | 当前运行中的扫描任务 — admin |
| GET | `/scan/tasks/:id` | 扫描任务进度 — admin |
| POST | `/scan/tasks/:id/cancel` | 取消扫描 — admin |
| POST | `/:id/ai-fill/preview` | AI 填充预览 — admin |
| POST | `/:id/ai-fill/apply` | 应用填充结果 — admin |
| GET | `/:id/ai-metadata` | 已保存的 AI 元信息 |
| POST | `/ai-fill-batch` | 整库批量填充 — admin |
| POST | `/ai-fill-reset-failed` | 重置失败项以便重试 — admin |
| POST | `/ai-fill-reset-all` | 重置全部填充状态 — admin |
| GET/POST/DELETE | `/:id/normalize-chapters` | 章节规范化的查询 / 执行 / 撤销 |
| POST | `/:id/cover-test` | 封面抓取测试 — admin |
| GET | `/default-cover` | 默认封面 |
| POST | `/lookup-by-titles` | 按书名批量查书 |

### 扫描批次 `/api/library/scan-batches` — 全部 admin

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 批次列表 |
| GET | `/:id` | 批次详情与条目 |
| GET | `/:batchId/preview` | 条目对应文件的内容预览 |
| PATCH | `/:batchId/items/:itemId` | 修改单个条目（书名、作者、判重、系列归类等） |
| POST | `/:id/apply` | 应用整批到书库 |
| DELETE | `/:id` | 丢弃批次 |

### 人工覆盖 `/api/library/manual-overrides` — 全部 admin

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 列表 |
| POST | `/` | 新增一条覆盖规则 |
| DELETE | `/:id` | 删除 |
| DELETE | `/all` | 清空 |

### 系列 `/api/library/series`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 系列列表 |
| GET | `/:id` | 系列详情与成员书籍 |
| PUT | `/:id` | 修改系列 — admin |

### 审计日志 `/api/library/audit-log`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 查询审计记录（可按 `action` / `user_id` 过滤，`limit` 上限 200） — admin |

### 书架 `/api/shelf`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 我的书架 |
| POST | `/` | 加入书架 |
| DELETE | `/:bookId` | 移出书架 |

### 阅读器 `/api/reader`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/:bookId/chapters` | 章节目录 |
| GET | `/:bookId/chapter/:index` | 单章正文 |
| GET | `/:bookId/raw` | 原始文件 |
| GET | `/:bookId/asset/*` | EPUB 内嵌资源（图片等） |
| GET | `/:bookId/progress` | 读取阅读进度 |
| POST | `/:bookId/progress` | 保存阅读进度（章节 + 段落 + 滚动位置） |
| POST | `/:bookId/recap` | AI 前情提要 |
| POST | `/:bookId/ask` | AI 问书 |
| POST | `/:bookId/tts` | 语音合成（MiniMax） |
| GET | `/:bookId/bookmarks` | 书签列表 |
| POST | `/:bookId/bookmarks` | 新增书签（自动裁剪，每用户每本只留最近 10 条） |
| DELETE | `/:bookId/bookmarks/:id` | 删除书签 |
| GET | `/:bookId/highlights` | 划线/批注列表 |
| POST | `/:bookId/highlights` | 新增划线（可带批注） |
| PATCH | `/:bookId/highlights/:id` | 修改/清除批注 |
| DELETE | `/:bookId/highlights/:id` | 删除划线 |
| POST | `/:bookId/highlights/:id/expand` | AI 展开划线/知识点（防剧透，带缓存） |
| GET | `/:bookId/mind-nodes` | 导图节点列表（可按 `highlightId` 过滤） |
| POST | `/:bookId/mind-nodes/keep` | 保留一条知识点链为导图节点 |
| POST | `/:bookId/mind-nodes` | 手动添加导图节点（`parentId` 或 `chapterIndex` 二选一） |
| PATCH | `/:bookId/mind-nodes/:id` | 改导图节点名称 / 批注（划线根节点不能改名） |
| DELETE | `/:bookId/mind-nodes/:id` | 删除导图节点及其子树 |

**学习导图**（前端 `BookMap.vue`，路由 `/book/:bookId/map`）：以书的目录为骨架（`utils/book-map.ts` 组装，骨架不入库），划线根节点挂在所在章节下、手动节点挂在所选位置；可平移缩放折叠，导出 PNG / Markdown 大纲。入口在书籍详情页与阅读器顶栏 / 侧边工具栏（PDF 也显示）。
导图跳原文用阅读器查询参数：`/reader/:bookId?chapter=<i>` 跳到该章，加 `&find=<label>` 在该章查找并闪烁知识点，`?highlight=<id>` 跳到划线；这些参数代替本次的进度恢复，处理后用 `router.replace` 去掉；目标无效（章越界、划线已删除）时照常恢复进度并提示「原文位置已失效」。

### 设置 `/api/settings`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/public` | 公开设置（登录页用） |
| GET/PUT | `/` | 系统设置 — admin |
| GET | `/ai-plugins` | 可用 AI 插件及其配置 |
| GET | `/ai-status` | AI 配置状态 |
| GET | `/reader-plugins` | 可用的文件解析插件 |
| GET/PUT | `/reader-prefs` | 当前用户的阅读偏好 |
| GET | `/users` | 用户列表 — admin |
| POST | `/users/invite` | 生成邀请码 — admin |
| POST | `/users/invite/send-email` | 用 SMTP 发送邀请 — admin |
| PUT | `/users/:id/role` | 修改角色 — admin |
| PUT | `/users/:id/password` | 重置密码 — admin |
| DELETE | `/users/:id` | 删除用户 — admin |

### 其他

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查（供 Docker healthcheck 用，**不在 `/api` 下**） |
| GET | `/covers/*` | 封面静态文件 |

---

## 设计文档

各功能的设计稿与实现计划在 `docs/superpowers/` 下，按日期与主题命名，例如：

- `specs/2026-11-04-listen-book-design.md` — 听书
- `specs/2026-11-04-ai-recap-ask-design.md` — 前情提要与问书
- `specs/2026-06-03-scan-refinement-design.md` — 扫描流程重构
