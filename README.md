# easyReader

NAS 自托管小说阅读平台，单容器部署。把书库目录挂进来，扫描入库，就能在浏览器里阅读、听书，并用 AI 补全书籍信息。

https://easyreader.ucool.uk/

---

## 功能特性

### 阅读

- **多格式**：TXT / EPUB / PDF / UMD，插件化架构可扩展
- **大文件优化**：TXT 流式扫描建立章节字节索引，按需读取单章，万章大书秒开
- **外观可调**：10 种阅读主题（默认「靛青」）、10 种中文字体，字号、行距、字间距、页宽均可调，滚动 / 瀑布流两种浏览模式
- **目录面板**：目录与书签分 Tab，当前章节高亮，已读过的章节标题显示为浅灰
- **进度同步**：按用户记录章节、段落与滚动位置，换设备打开自动还原
- **书签**：按章节添加带备注的书签，每本书自动保留最近 10 个

### 听书

- 朗读当前章节并自动续读下一章，语速 0.8× ~ 2×，可定时停止（15 / 30 / 60 分钟或本章读完）
- 配置 MiniMax 语音合成后使用 AI 语音；**未配置时自动降级为浏览器内置语音**，开箱即用
- 合成结果按文本缓存，同一段重听不再计费

### AI 辅助

- **前情提要 / 问书**：只读取你当前阅读位置之前的内容，不会剧透
- **AI 填充**：自动识别书名、作者、简介、分类，先预览再决定是否应用；支持整库批量填充与失败重试
- **3 家服务商**：DeepSeek / MiniMax / Ollama（本地模型）

### 书库管理（管理员）

- **扫描审核**：扫描结果先进入待审核批次，逐条确认后才写入书库；上一批未处理完不允许发起新扫描
- **判重与纠错**：文件指纹判重、乱码检测，可疑书籍集中在「问题书籍」页处理
- **人工覆盖**：把误判的判重 / 系列归类固化下来，后续扫描不再重复犯同样的错
- **系列归类**、**章节规范化**、**审计日志**
- **用户管理**：邀请码注册（复制链接或 SMTP 发信）、角色与密码管理

---

## 快速启动

### 1. 克隆项目

```bash
git clone https://github.com/zmfy/easy-Reader.git
cd easy-Reader
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少修改 JWT_SECRET
```

### 3. 准备书库目录

```bash
mkdir -p books data
# 把 .txt / .epub / .pdf / .umd 文件放进 books/
# 或修改 docker-compose.yml 的 volumes，直接挂载 NAS 上的书库路径
```

### 4. 启动

```bash
docker compose up -d --build
```

首次构建约 3-5 分钟（需编译 C++ 原生模块），之后重建大部分层会命中缓存。

构建默认使用官方源。国内网络拉取慢时，在 `.env` 里设置 `NODE_IMAGE`、`NPM_REGISTRY`、`DEBIAN_MIRROR` 改用国内源（`.env.example` 里已写好 DaoCloud、npmmirror、阿里云，复制为 `.env` 即可；海外部署删掉这三行）。

访问 **http://localhost:8080**

### 默认管理员账户

| 用户名 | 密码 |
|---|---|
| `admin` | `admin123` |

首次用默认密码登录后必须先修改密码，改完才能使用其他功能（API 客户端同样如此）。之后所有用户都可以在侧栏「修改密码」中自己改密码。

### 版本与升级

每个版本的变化见 [CHANGELOG.md](CHANGELOG.md) 和 [GitHub Releases](https://github.com/zmfy/easy-Reader/releases)。Docker Hub 镜像 `dls7788/easy-reader` 提供这些 tag：

| tag | 内容 |
|---|---|
| `latest` | 最新发布的正式版本 |
| `1.0.0`、`1.0` 等 | 固定版本 / 固定次版本（只接收修订更新） |
| `edge` | `main` 分支最新代码，尝鲜用，可能不稳定 |

升级：`docker pull dls7788/easy-reader:latest` 后重建容器即可，书库和 `data` 目录中的数据会自动迁移。

---

## 使用指南

### 导入书籍

1. 以管理员登录，进入**书库**页，点击右上角的「扫描导入」。扫描在后台异步执行，可随时查看进度或取消。
2. 扫描完成后生成一个**待审核批次**。进入「扫描批次」逐条核对识别出的书名、作者、判重与系列归类，需要时直接修改。
3. 确认无误后点「应用」，这一批才真正写入书库。
4. 被判定为重复或乱码的文件不会入库，集中在「问题书籍」页处理。若是误判，处理时可登记为**人工覆盖**，下次扫描不会再误判同一本。

### 补全书籍信息

先在设置页的「AI 插件设置」里配置好服务商和 API Key，然后：

- **单本**：书籍详情页点「AI 填充」，弹窗里预览 AI 给出的结果，满意再应用。
- **整库**：书库页点「批量 AI 填充」。已填充过的书会自动跳过以节省 token，失败的可单独重置后重试。

### 阅读

进入阅读器后，顶栏与左侧工具栏都有图标按钮：列表图标打开目录面板（目录 / 书签分 Tab），齿轮图标打开阅读设置，可调主题、字体、字号、行距、字间距、页宽与浏览模式。阅读进度自动保存，换台设备登录同一账号即可接着读。

### 听书

点耳机图标开始朗读，从当前阅读位置所在段落起，读完自动进入下一章。底部会出现播放条，可调语速与定时停止，锁屏或切到后台也会继续播放。

默认使用浏览器内置语音，无需任何配置。想要更自然的 AI 语音，在设置页的「AI 插件设置 → MiniMax」里填入 API Key 并打开听书开关，按钮上会出现 `AI` 角标 —— 这个开关独立于当前选中的 AI 插件，两者互不影响。

### AI 前情提要与问书

侧边工具栏有「前情提要」和「问书」两个按钮（鼠标悬停可见名称），前者快速回顾剧情，后者可就剧情、人物提问。两者都只会读取你当前位置之前的内容，不会剧透后文。

### 自己开发客户端（API）

网页版的全部读者功能都可以通过 JSON API 使用，可以据此开发手机 / 桌面阅读 App。接口文档见 [`docs/api.md`](docs/api.md)，部署后也可以在 `http://<服务器地址>/api/docs` 在线查看。第三方客户端请使用带版本的 `/api/v1`。

---

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `JWT_SECRET` | 是 | — | JWT 签名密钥，生产环境必须改成随机字符串 |
| `PORT` | 否 | `3000` | 容器内监听端口（对外映射见 `docker-compose.yml`） |
| `BOOKS_DIR` | 否 | `/app/books` | 书库目录（容器内路径） |
| `DATA_DIR` | 否 | `/app/data` | 数据库目录（容器内路径） |
| `TRUST_PROXY` | 否 | — | 经反向代理（Nginx、Caddy、群晖反代等）访问时设置，一层代理填 `1`。不设置时所有访问者都被当作代理的 IP，登录限流会互相影响；直接暴露端口时不要设置 |
| `CORS_ORIGINS` | 否 | — | 允许跨域访问 API 的网页来源，逗号分隔（如 `https://reader.example.com`）；只有运行在其他网址上的网页客户端需要，原生 App 不需要 |
| `UPDATE_CHECK` | 否 | 开启 | 设为 `off` 关闭更新检查（不再访问外网）；默认每天检查一次，有新版本时在管理员的设置页提醒 |
| `UPDATE_CHANGELOG_URL` | 否 | 官方仓库（GitHub，失败回退 jsDelivr） | 自定义更新来源：一个可访问的 CHANGELOG.md 地址，用于自建镜像等场景 |
| `CHANGELOG_PATH` | 否 | `/app/CHANGELOG.md` | 本站 CHANGELOG 文件路径，用于判断当前版本；一般不用改 |
| `NODE_IMAGE` | 否 | `node:22-slim` | 构建用基础镜像；国内可填 `docker.m.daocloud.io/library/node:22-slim` |
| `NPM_REGISTRY` | 否 | `https://registry.npmjs.org` | 构建时的 npm 源；国内可填 `https://registry.npmmirror.com` |
| `DEBIAN_MIRROR` | 否 | —（官方 `deb.debian.org`） | 构建时的 apt 源；国内可填 `http://mirrors.aliyun.com` |

NAS 上的实际路径在 `docker-compose.yml` 的 `volumes` 里配置：

```yaml
volumes:
  - /your/nas/books:/app/books
  - ./data:/app/data
```

---

## AI 服务商

在设置页的「AI 插件设置」中选择服务商并填写 API Key：

| 插件 | 服务商 | 接口地址 | 地址可改 |
|---|---|---|---|
| DeepSeek | 深度求索 | `https://api.deepseek.com/v1` | ✅ |
| Ollama | 本地模型 | `http://localhost:11434` | ✅ |
| MiniMax | MiniMax | `https://api.minimax.cn/v1` | ❌ 固定 |

DeepSeek 和 Ollama 可以在设置里填自定义 Base URL；MiniMax 的地址写死在代码里，只需填 API Key 和模型。

> **Ollama 用户**：容器内访问宿主机上的 Ollama，Base URL 填 `http://host.docker.internal:11434`（`docker-compose.yml` 已配好 `extra_hosts`）。
>
> **听书**：使用 MiniMax 的语音合成接口，在 MiniMax 插件设置里单独开关，与元信息填充用哪家服务商无关。

---

## 技术栈

单容器运行，**不依赖任何外部数据库或中间件**——数据全部存在 `DATA_DIR` 下的 SQLite 文件里，备份直接拷目录即可。

- 前端：Vue 3 + Vite + TypeScript + Element Plus
- 后端：Node.js 22 + Express + TypeScript，同时托管 API 与前端静态文件
- 数据库：SQLite（better-sqlite3）

---

## 开发

目录结构、API 列表、本地开发与测试见 [docs/development.md](docs/development.md)。

---

## 许可证

MIT
