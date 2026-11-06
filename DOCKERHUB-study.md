# 简单书房学习版 easy-Learner

[简单书房](https://hub.docker.com/r/dls7788/easy-reader)的学习版：在看书版全部功能的基础上，加入划线批注、学习导图、AI 展开知识点和笔记整理，适合边读边学。书和笔记只留在你自己的设备上。

- 看书版镜像：[dls7788/easy-reader](https://hub.docker.com/r/dls7788/easy-reader)（只想看书用它就够了）
- 源码与问题反馈：<https://github.com/zmfy/easy-Reader>（`study` 分支，AGPL-3.0 协议；源自看书版的代码保留 MIT 声明，见仓库中的 NOTICE）
- 部署教程（群晖、威联通、飞牛、Unraid 等）：<https://easyreader.ucool.uk/guides>

## 学习功能

- **划线与批注**：阅读时选中文字划线，写下自己的理解
- **学习导图**：整本书的目录骨架加上你的划线与知识点画成一张导图，可改名、批注、增删节点，导出 PNG 图片或 Markdown 大纲
- **AI 展开知识点**：从一条划线出发，让 AI 展开相关的人物、事件、概念，只参考你已读到的内容，不剧透；结果先作为候选，你决定保留哪些
- **笔记整理**：AI 把一本书的笔记按主题整理成文，可继续手动编辑，每次修改都留有可恢复的版本，可导出 Markdown

看书版的功能（TXT / EPUB / PDF / UMD、多端同步进度、听书、AI 补全书籍信息、家人共用等）学习版全部都有。

## 快速开始

### docker run

```bash
docker run -d --name easy-learner --restart unless-stopped \
  -p 8080:3000 \
  -v /volume1/books:/app/books \
  -v /volume1/docker/easy-learner:/app/data \
  dls7788/easy-learner:latest
```

把两个路径换成你 NAS 上的书库目录和数据目录，然后访问 `http://你的NAS地址:8080`。

### docker compose

```yaml
services:
  easy-learner:
    image: dls7788/easy-learner:latest
    container_name: easy-learner
    restart: unless-stopped
    ports:
      - "8080:3000"
    volumes:
      - /volume1/books:/app/books               # 书库目录（txt / epub / pdf / umd）
      - /volume1/docker/easy-learner:/app/data  # 数据库、封面、缓存、笔记
    # 使用宿主机上的 Ollama 时需要（Base URL 填 http://host.docker.internal:11434）
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### 首次登录

默认管理员账号 `admin`，密码 `admin123`。首次登录后必须先修改密码，然后在书库页点右上角的「扫描导入」导入书籍。AI 展开与笔记整理需要先在「设置 → AI 设置」里配置 AI。

挂载目录与环境变量和看书版相同，见[看书版说明](https://hub.docker.com/r/dls7788/easy-reader)。

## 镜像 tag

| tag | 内容 |
|---|---|
| `latest` | 最新发布的学习版 |
| `1.1.1`、`1.1` 等 | 固定版本 / 固定次版本 |
| `edge` | `study` 分支最新代码，尝鲜用，可能不稳定 |
| `sha-xxxxxxx` | 对应某次提交的构建 |

学习版的版本号跟随看书版（同一版本号的学习版包含该版本看书版的全部内容），更新日志中记为 `X.Y.Z-study`。

## 升级

```bash
docker pull dls7788/easy-learner:latest
docker compose up -d   # 或删除旧容器后用相同参数重新 docker run
```

数据库结构会在启动时自动迁移，书库和 `/app/data` 中的数据保持不变。
