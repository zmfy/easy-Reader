# 镜像源（构建参数）：默认官方源；国内网络可在 .env 里改用国内源（见 .env.example）
#   NODE_IMAGE     基础镜像，如 docker.m.daocloud.io/library/node:22-slim
#   NPM_REGISTRY   npm 源，如 https://registry.npmmirror.com（lock 文件里的 registry.npmjs.org 会自动替换）
#   DEBIAN_MIRROR  apt 源，如 http://mirrors.aliyun.com（留空则用 deb.debian.org）
ARG NODE_IMAGE=node:22-slim

# Stage 1: Build frontend
# 产物是静态文件，与目标架构无关：多平台构建时固定在构建机架构上运行，避免在 QEMU 模拟下跑 vite
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS frontend-builder
ARG NPM_REGISTRY=https://registry.npmjs.org
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install --no-fund --no-audit --registry=${NPM_REGISTRY}
COPY frontend/ .
RUN npm run build

# Stage 2: Build backend + prune to production deps
# 在目标架构下构建（arm64 由 QEMU 模拟）：better-sqlite3 要编译出对应架构的原生模块
FROM ${NODE_IMAGE} AS backend-builder
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG DEBIAN_MIRROR=
RUN if [ -n "${DEBIAN_MIRROR}" ]; then sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources; fi \
  && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
# better-sqlite3 没有 Node 22 的预编译包，会现场编译；用镜像自带的 Node 头文件，免去从 nodejs.org 下载
ENV npm_config_nodedir=/usr/local
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --no-fund --no-audit --registry=${NPM_REGISTRY}
COPY backend/tsconfig.json .
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

# Stage 3: Runtime (no build tools needed)
FROM ${NODE_IMAGE}
WORKDIR /app
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/dist ./dist
COPY --from=frontend-builder /app/dist ./public
COPY docs/api.md ./docs/api.md
# 更新提醒读取本站版本（后端 cwd 为 /app）
COPY CHANGELOG.md ./CHANGELOG.md
EXPOSE 3000
CMD ["node", "dist/index.js"]
