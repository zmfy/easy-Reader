# 简单书房 easy-Reader

面向 NAS 的自托管小说阅读器。把书库目录挂进容器，扫描导入，就能在电脑、平板、手机的浏览器里阅读、听书，并用 AI 补全书籍信息。书和阅读数据只留在你自己的设备上。

- 官网：<https://easyreader.ucool.uk/>
- 源码与问题反馈：<https://github.com/zmfy/easy-Reader>（MIT 协议）
- 更新日志：<https://easyreader.ucool.uk/changelog>
- 部署教程（群晖、威联通、飞牛、Unraid 等）：<https://easyreader.ucool.uk/guides>

![阅读器](https://easyreader.ucool.uk/screenshots/reader.png)

## 功能

- **多格式**：TXT、EPUB、PDF、UMD；TXT 自动识别 GBK / UTF-8 等编码和章节，PDF 按原版逐页显示
- **阅读体验**：10 种阅读主题，字号、行距、字间距、页宽可调，章节翻页 / 瀑布流两种读法，键盘翻页
- **多端同步**：阅读进度、书签、阅读设置跟着账号走，换设备接着读
- **听书**：AI 语音（MiniMax）或浏览器自带语音，段落高亮、自动翻章、定时停止
- **AI 前情提要与问书**：只根据你已经读过的内容回答，不剧透
- **书库自动整理**：AI 补全作者、简介、分类和封面（先预览再保存），豆瓣评分，重复书籍与系列识别
- **家人共用**：邀请码注册，每人有自己的书架和进度
- **离线可用**：阅读不依赖外网，AI 和豆瓣功能可以不开；AI 支持 DeepSeek、MiniMax 和本地 Ollama

![书库](https://easyreader.ucool.uk/screenshots/library.png)

## 快速开始

### docker run

```bash
docker run -d --name easy-reader --restart unless-stopped \
  -p 8080:3000 \
  -v /volume1/books:/app/books \
  -v /volume1/docker/easy-reader:/app/data \
  dls7788/easy-reader:latest
```

把两个路径换成你 NAS 上的书库目录和数据目录，然后访问 `http://你的NAS地址:8080`。

### docker compose

```yaml
services:
  easy-reader:
    image: dls7788/easy-reader:latest
    container_name: easy-reader
    restart: unless-stopped
    ports:
      - "8080:3000"
      - "8443:3443"   # HTTPS：使用自己的证书时生效（放进数据目录 certs/ 或在设置页上传）
    volumes:
      - /volume1/books:/app/books              # 书库目录（txt / epub / pdf / umd）
      - /volume1/docker/easy-reader:/app/data  # 数据库、封面、缓存
    # 使用宿主机上的 Ollama 时需要（Base URL 填 http://host.docker.internal:11434）
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

```bash
docker compose up -d
```

### 首次登录

默认管理员账号 `admin`，密码 `admin123`。首次登录后必须先修改密码，然后在书库页点右上角的「扫描导入」导入书籍。

## 挂载目录

| 容器内路径 | 用途 |
|---|---|
| `/app/books` | 书库目录，需要可写：扫描时会把 GBK、BIG5 等非 UTF-8 编码的 TXT 原地转换为 UTF-8（先写临时文件再替换，保留原权限），其他文件只读取 |
| `/app/data` | SQLite 数据库、封面、听书缓存、自动生成的登录密钥。**升级和迁移时保留这个目录即可** |

## 环境变量

都是可选的，不设置也能正常使用。

| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | 登录令牌签名密钥。不设置时首次启动自动生成并保存在 `/app/data` 中 |
| `TRUST_PROXY` | 经反向代理（Nginx、Caddy、群晖反代等）访问时设置，一层代理填 `1`，登录限流才会按真实 IP 计数；直接暴露端口时不要设置 |
| `CORS_ORIGINS` | 允许跨域访问 API 的网页来源，逗号分隔；只有部署在其他网址上的网页客户端需要 |
| `USAGE_STATS` | 设为 `off` 关闭匿名使用统计（每天发送一次随机实例 ID、版本线、版本号、CPU 架构，不含任何书籍和账号信息）；也可在设置页关闭 |

## 镜像 tag

| tag | 内容 |
|---|---|
| `latest` | 最新发布的正式版本 |
| `1.0.0`、`1.0` 等 | 固定版本 / 固定次版本（只接收修订更新） |
| `edge` | 开发分支最新代码，尝鲜用，可能不稳定 |
| `sha-xxxxxxx` | 对应某次提交的构建 |

镜像支持 x86_64（amd64）和 ARM64（aarch64）两种架构，拉取时自动选择；ARM64 从 1.1.1 之后发布的版本（及 `edge`）开始提供。

## 升级

```bash
docker pull dls7788/easy-reader:latest
docker compose up -d   # 或删除旧容器后用相同参数重新 docker run
```

数据库结构会在启动时自动迁移，书库和 `/app/data` 中的数据保持不变。每个版本的变化见[更新日志](https://easyreader.ucool.uk/changelog)。

## 开发者 API

阅读相关功能都可以通过 JSON API 使用，可以据此开发自己的手机或桌面客户端。文档：<https://easyreader.ucool.uk/developer>，部署后也可以在 `http://你的NAS地址:8080/api/docs` 查看。
