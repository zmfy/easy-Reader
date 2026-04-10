# easyReader

NAS 自托管小说阅读平台，单容器部署。后端 Node.js + Express + TypeScript + SQLite，前端 Vue 3 + Vite + TypeScript + Element Plus。

---

## 功能特性

- **多格式支持**：TXT / PDF / EPUB，插件化架构可扩展
- **大文件优化**：TXT 流式扫描建立章节字节索引，按需读取单章，万章大书秒开
- **AI 辅助管理**：自动填充书名、作者、简介、分类，支持 6 家 AI 服务商
- **阅读进度同步**：精确记录章节与滚动位置，重新打开自动还原
- **书签系统**：按章节添加带备注的书签
- **邀请码注册**：管理员生成邀请码，支持复制链接或 SMTP 邮件发送
- **多主题阅读器**：白天 / 护眼 / 夜间 / 暗黑，字体、字号、行距全部可调

---

## 技术栈

| 层级 | 选型 |
|---|---|
| 前端 | Vue 3 + Vite + TypeScript + Pinia + Vue Router |
| UI | Element Plus |
| 后端 | Node.js 22 + Express + TypeScript |
| 数据库 | SQLite（better-sqlite3） |
| 认证 | JWT（Access Token 30min + Refresh Token 30d） |
| 容器 | Docker（单容器，Express 同时托管 API 与静态文件） |

---

## 快速启动

### 1. 克隆项目

```bash
git clone <repo-url>
cd easyReader
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少修改 JWT_SECRET
```

### 3. 准备书库目录

```bash
mkdir -p books data
# 将 .txt / .epub / .pdf 文件放入 books/ 目录
# 或修改 docker-compose.yml 中 volumes 挂载 NAS 路径
```

### 4. 启动

```bash
docker compose up -d --build
```

首次构建约需 3-5 分钟（编译 C++ 原生模块）。之后修改代码重建时大部分层会命中缓存。

访问 **http://localhost:8080**

### 默认管理员账户

| 用户名 | 密码 |
|---|---|
| `admin` | `admin123` |

登录后进入书库页，点击「扫描书库」导入 `books/` 目录中的文件。

---

## 目录结构

```
easyReader/
├── Dockerfile              # 三阶段构建（前端 + 后端 + 运行时）
├── docker-compose.yml
├── .env.example
├── .gitignore
├── .dockerignore
├── README.md
│
├── frontend/               # Vue 3 前端
│   └── src/
│       ├── api/            # HTTP 请求封装（auth/library/reader/shelf/settings）
│       ├── assets/styles/  # CSS 设计变量
│       ├── composables/    # useReader / useAuth
│       ├── layouts/        # DefaultLayout（导航栏）
│       ├── router/         # 路由与权限守卫
│       ├── stores/         # Pinia（auth / reader）
│       ├── types/          # DTO 类型定义
│       └── views/          # 7 个页面视图
│           ├── Login.vue
│           ├── Register.vue
│           ├── Library.vue
│           ├── Bookshelf.vue
│           ├── BookDetail.vue
│           ├── Reader.vue
│           └── Settings.vue
│
├── backend/                # Node.js 后端
│   └── src/
│       ├── ai/             # AI 插件（6 家服务商）
│       ├── middleware/     # JWT 认证
│       ├── plugins/        # 文件解析（TXT / EPUB / PDF）
│       ├── routes/         # API 路由（5 个模块）
│       ├── utils/          # 响应格式封装
│       ├── db.ts           # SQLite Schema 初始化
│       ├── index.ts        # Express 入口 + 静态文件托管
│       └── types/          # 共享接口定义
│
├── books/                  # 书库目录（挂载宿主机路径）
└── data/                   # SQLite 持久化目录
```

---

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `JWT_SECRET` | 是 | — | JWT 签名密钥，生产环境必须修改 |
| `PORT` | 否 | `3000` | 容器内监听端口 |
| `BOOKS_DIR` | 否 | `/app/books` | 书库目录（容器内路径） |
| `DATA_DIR` | 否 | `/app/data` | 数据库目录（容器内路径） |

NAS 路径在 `docker-compose.yml` 的 `volumes` 中配置：

```yaml
volumes:
  - /your/nas/books:/app/books
  - ./data:/app/data
```

---

## AI 插件

在「系统设置 → AI 设置」中选择服务商并填写 API Key：

| 插件 | 服务商 | 默认 Base URL |
|---|---|---|
| DeepSeek | 深度求索 | `https://api.deepseek.com/v1` |
| 通义千问 | 阿里云 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| MiniMax | MiniMax | `https://api.minimax.chat/v1` |
| OpenAI | OpenAI（可自定义） | `https://api.openai.com/v1` |
| Claude | Anthropic | `https://api.anthropic.com` |
| Ollama | 本地模型 | `http://localhost:11434` |

配置后，在书籍详情页点击「AI 填充」可自动识别元信息。

---

## API 概览

所有响应格式：`{ "success": true, "code": "OK", "data": {} }`

| 模块 | 前缀 |
|---|---|
| 认证 | `POST /api/auth/login` `POST /api/auth/register` `GET /api/auth/me` |
| 书库 | `GET /api/library` `POST /api/library/scan` `PUT /api/library/:id` `POST /api/library/:id/ai-fill` |
| 书架 | `GET /api/shelf` `POST /api/shelf` `DELETE /api/shelf/:bookId` |
| 阅读器 | `GET /api/reader/:id/chapters` `GET /api/reader/:id/chapter/:n` `POST /api/reader/:id/progress` |
| 设置 | `GET/PUT /api/settings` `POST /api/users/invite` |

---

## 本地开发

```bash
# 后端（热重载）
cd backend && npm install && npm run dev   # http://localhost:3000

# 前端（热重载，代理 /api 到 :3000）
cd frontend && npm install && npm run dev  # http://localhost:8080
```

---

## 许可证

MIT
