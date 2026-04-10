# easyReader

NAS 自托管小说阅读平台，基于 Docker 部署。后端 Node.js + Express + TypeScript + SQLite，前端 Vue 3 + Vite + TypeScript + Element Plus，支持多格式阅读、AI 辅助书籍信息填充、插件化扩展。

---

## 功能特性

- **多格式支持**：TXT / PDF / EPUB，插件化架构可扩展新格式
- **大文件优化**：TXT 采用流式扫描建立章节字节索引，按需读取单章内容，万章大书秒开
- **AI 辅助管理**：自动识别并填充书名、作者、简介、分类等元信息，支持 6 家 AI 服务商
- **阅读进度同步**：精确记录章节位置与滚动高度，重新打开自动还原
- **书签系统**：按章节添加带备注的书签
- **邀请码注册**：仅管理员生成邀请码，支持复制链接或 SMTP 邮件发送，适合私有部署
- **多主题阅读器**：白天 / 护眼 / 夜间 / 暗黑，字体、字号、行距、字间距全部可调
- **NAS 友好**：SQLite 零依赖，书库目录直接挂载宿主机磁盘，数据持久化简单可靠

---

## 技术栈

| 层级 | 选型 |
|---|---|
| 前端 | Vue 3 + Vite + TypeScript + Pinia + Vue Router |
| UI 组件 | Element Plus |
| 后端 | Node.js 22 + Express + TypeScript |
| 数据库 | SQLite（better-sqlite3） |
| 认证 | JWT（Access Token 30min + Refresh Token 30d） |
| 文件解析 | 插件化：TxtParser / EpubParser / PdfParser |
| 容器化 | Docker + docker-compose |

---

## 快速启动

### 前置条件

- Docker & docker-compose

### 1. 克隆项目

```bash
git clone <repo-url>
cd easyReader
```

### 2. 放置书籍文件

将 `.txt` / `.epub` / `.pdf` 文件放入项目根目录下的 `books/` 目录，或修改 `docker-compose.yml` 挂载 NAS 路径：

```yaml
volumes:
  - /your/nas/path/books:/app/books   # 替换为实际 NAS 路径
  - ./data:/app/data
```

### 3. 配置环境变量（可选）

```bash
# 根目录新建 .env 文件，设置 JWT 密钥
JWT_SECRET=your-secure-random-string-here
```

若不设置，容器会使用默认值（仅限测试环境）。

### 4. 启动服务

```bash
docker compose up -d --build
```

首次构建需要编译 C++ 原生模块（better-sqlite3），约需 3-5 分钟。

| 服务 | 地址 |
|---|---|
| 前端 | http://localhost:8080 |
| 后端 API | http://localhost:3000 |

### 5. 首次登录

| 字段 | 默认值 |
|---|---|
| 用户名 | `admin` |
| 密码 | `admin123` |

登录后进入**书库**页，点击「扫描书库」导入 `books/` 目录中的文件。

---

## 目录结构

```
easyReader/
├── backend/
│   ├── src/
│   │   ├── ai/              # AI 插件（deepseek / qwen / minmax / openai / claude / ollama）
│   │   ├── middleware/      # JWT 认证中间件
│   │   ├── plugins/         # 文件解析插件（txt / epub / pdf）
│   │   ├── routes/          # API 路由（auth / library / shelf / reader / settings）
│   │   ├── db.ts            # SQLite 初始化与 Schema
│   │   ├── index.ts         # Express 入口
│   │   └── types/           # 共享类型定义（AiPlugin / ReaderPlugin 接口）
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/             # 请求封装（auth / library / reader / shelf / settings）
│   │   ├── composables/     # useReader / useAuth / usePagination
│   │   ├── layouts/         # DefaultLayout
│   │   ├── router/          # 路由与权限守卫
│   │   ├── stores/          # Pinia（auth / reader）
│   │   ├── types/           # DTO 与接口类型
│   │   └── views/           # Login / Register / Library / Bookshelf / Reader / Settings / BookDetail
│   └── Dockerfile
├── books/                   # 书库挂载目录
├── data/                    # SQLite 数据库持久化目录
├── docker-compose.yml
└── .gitignore
```

---

## AI 插件配置

在「系统设置 → AI 设置」中选择服务商并填写 API Key，支持：

| 插件 | 服务商 | 默认 BaseURL |
|---|---|---|
| DeepSeek | 深度求索 | `https://api.deepseek.com/v1` |
| 通义千问 | 阿里云 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| MiniMax | MiniMax | `https://api.minimax.chat/v1` |
| OpenAI | OpenAI（可自定义 BaseURL） | `https://api.openai.com/v1` |
| Claude | Anthropic | `https://api.anthropic.com` |
| Ollama | 本地模型 | `http://localhost:11434` |

配置后，在书库书籍详情页点击「AI 填充」可自动识别书名、作者、简介、分类等信息。

---

## 邀请码注册

系统不开放公开注册，仅通过邀请码新增用户：

1. 管理员进入「系统设置 → 用户管理」，点击「生成邀请码」
2. 弹窗中选择：**复制邀请链接** 或 **发送邀请邮件**（需先在「邮件设置」配置 SMTP）
3. 受邀用户访问邀请链接（含 `?code=` 参数），填写用户名和密码完成注册
4. 每个邀请码仅可使用一次，使用后自动失效

---

## 扩展插件

### 新增 AI 插件

在 `backend/src/ai/` 下创建新文件，实现 `AiPlugin` 接口：

```typescript
import { AiPlugin } from '../types';

const myPlugin: AiPlugin = {
  name: 'my-provider',
  label: '我的 AI',
  fields: ['apiKey', 'model'],
  placeholders: { apiKey: '请输入 API Key', model: 'my-model-v1' },

  async fillBookInfo(rawText, config) {
    // 调用 API，返回书籍信息对象
    return { title, author, summary, category };
  },

  async classifyBook(bookInfo, config) {
    // 返回分类字符串
    return '玄幻';
  },
};

export default myPlugin;
```

然后在 `backend/src/ai/ai-manager.ts` 的 `aiPlugins` 数组中注册即可。

### 新增文件格式插件

在 `backend/src/plugins/` 下实现 `ReaderPlugin` 接口，并在 `plugin-manager.ts` 的 `switch` 中添加 `case`：

```typescript
export interface ReaderPlugin {
  load(filePath: string): Promise<void>;
  getChapters(): Chapter[];
  getChapterContent(index: number): Promise<string>;
  getTotalProgress(): number;
  getProgress(): number;
}
```

---

## API 概览

所有响应格式：

```json
{ "success": true, "code": "OK", "message": "...", "data": {} }
```

分页响应额外携带 `pagination: { page, pageSize, total, totalPages }`。

### 认证

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录，返回 accessToken + refreshToken |
| POST | `/api/auth/logout` | 登出 |
| POST | `/api/auth/register` | 注册（需邀请码） |
| GET | `/api/auth/me` | 当前用户信息 |
| POST | `/api/auth/refresh` | 刷新 Access Token |

### 书库

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/library` | 书籍列表（分页 / 搜索 / 过滤） |
| POST | `/api/library/scan` | 扫描目录导入新书 |
| GET | `/api/library/:id` | 书籍详情 |
| PUT | `/api/library/:id` | 更新书籍信息 |
| DELETE | `/api/library/:id` | 移除书籍 |
| POST | `/api/library/:id/ai-fill` | AI 自动填充 |

### 阅读器

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/reader/:bookId/chapters` | 章节目录 |
| GET | `/api/reader/:bookId/chapter/:index` | 章节内容 |
| GET | `/api/reader/:bookId/progress` | 获取阅读进度 |
| POST | `/api/reader/:bookId/progress` | 保存阅读进度 |
| GET | `/api/reader/:bookId/bookmarks` | 书签列表 |
| POST | `/api/reader/:bookId/bookmarks` | 添加书签 |
| DELETE | `/api/reader/:bookId/bookmarks/:id` | 删除书签 |

### 书架 / 设置

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/shelf` | 我的书架 |
| POST | `/api/shelf` | 添加到书架 |
| DELETE | `/api/shelf/:bookId` | 从书架移除 |
| GET/PUT | `/api/settings` | 系统设置 |
| GET | `/api/settings/ai-plugins` | 可用 AI 插件列表 |
| GET | `/api/users` | 用户列表（管理员） |
| POST | `/api/users/invite` | 生成邀请码 |
| POST | `/api/users/invite/send-email` | 邮件发送邀请 |

### 错误码

| HTTP | code | 场景 |
|---|---|---|
| 401 | `AUTH_UNAUTHORIZED` | Token 缺失或无效 |
| 403 | `AUTH_FORBIDDEN` | 权限不足 |
| 404 | `RESOURCE_NOT_FOUND` | 资源不存在 |
| 409 | `BUSINESS_CONFLICT` | 业务冲突（如重复加入书架） |
| 422 | `VALIDATION_ERROR` | 参数校验失败 |
| 500 | `INTERNAL_ERROR` | 服务内部异常 |

---

## 本地开发

### 后端

```bash
cd backend
yarn install
yarn dev          # ts-node-dev 热重载，监听 :3000
```

### 前端

```bash
cd frontend
yarn install
yarn dev          # Vite 开发服务器，监听 :5173
```

### 环境变量

```bash
# backend/.env
JWT_SECRET=dev-secret
BOOKS_DIR=../books
DATA_DIR=./data
FRONTEND_URL=http://localhost:5173
PORT=3000
```

---

## 许可证

MIT