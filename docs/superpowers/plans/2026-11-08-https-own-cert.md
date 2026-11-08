# 使用自己的证书提供 HTTPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户把证书放进 `DATA_DIR/certs/` 或在设置页上传，简单书房在单独端口直接提供 HTTPS（热更新、到期提醒），HTTP 不受影响。

**Architecture:** 后端新增纯函数的证书检查与存储模块、负责启停与热更新的 HTTPS 管理器（轮询文件 + 保留上一张可用证书）、管理员接口；`index.ts` 关闭 HSTS 并启动管理器。前端设置页新增「HTTPS 证书」卡片，通知铃铛接入证书到期提醒。

**Tech Stack:** Node（`https`、`tls`、`crypto.X509Certificate`）+ Express + jest；Vue 3 + Element Plus + vitest（happy-dom）。

**Spec:** `docs/superpowers/specs/2026-11-08-https-own-cert-design.md`

## Global Constraints

- 分支 `feature/https`（基于 `main`），完成后与 `feature/pwa` 一起合入 `main`，再合并进 `study`。
- 证书目录：`path.join(DATA_DIR, 'certs')`，文件名固定 `fullchain.pem`（证书链）、`privkey.pem`（私钥）。私钥写入后权限 `0o600`。
- 端口：环境变量 `HTTPS_PORT`，默认 `3443`；HTTP 的 `PORT` 不变。docker-compose 映射 `8443:3443`。
- 过期 / 尚未生效的证书（用户决定）：照常加载使用，只标状态与提醒；上传时接受并附警告。仅「缺文件 / 无法解析 / 不匹配」拒绝（上传 422；放文件时不开启或保留上一张可用证书）。
- 到期提醒：剩余 ≤ 14 天起提醒；已过期时提醒「已过期」。
- 测试与手动验证不关闭 TLS 证书校验（不用 `rejectUnauthorized: false` / `curl -k`），改为把自签名测试证书作为受信任 CA（`ca` / `--cacert`）。
- 不发送 `Strict-Transport-Security`（helmet `hsts: false`）。不做 HTTP→HTTPS 跳转。不申请 / 不续签证书。
- 任何接口、日志都不输出私钥；接口只返回证书的域名、颁发者、有效期等元数据。
- 上传接口仅管理员；`cert`、`key` 各 ≤ 64 KB。
- 文案（逐字）：「HTTPS 证书」「HTTPS 已开启」「HTTPS 未开启」「已过期」「尚未生效」「还有 N 天到期」；错误「缺少证书文件」「无法解析证书」「无法解析私钥」「证书与私钥不匹配」「HTTPS 端口 N 被占用」；上传警告「证书已过期」「证书尚未生效」；铃铛「HTTPS 证书将在 N 天后到期（域名）」「HTTPS 证书已过期（域名）」。
- 颜色用主题变量，图标用 Tabler。新接口写进 `docs/api.md`（只加不改）。

## Review Focus

1. **续签工具先写证书、后写私钥**（中间状态不匹配）：继续用上一张证书提供 HTTPS，下一次检查配对后自动切到新证书。→ Task 2 测试 `keeps serving the last good certificate when the new pair does not match`。
2. **启动时 `certs/` 里只有一个文件 / 文件损坏**：HTTP 正常启动，HTTPS 不监听，状态给出原因。→ Task 2 测试 `does not listen and reports why when files are missing or broken`。
3. **HTTPS 端口被占用**：不影响 HTTP 和进程存活，状态显示「HTTPS 端口 N 被占用」。→ Task 2 测试 `reports a busy port without throwing`。
4. **私钥泄露**：状态接口、上传返回值、日志都不含私钥。→ Task 3 测试 `saveUploadedCert result never contains the private key`。
5. **证书链里带多张证书 / 带 CRLF 换行 / 首尾空白**：按第一张（叶子证书）解析域名与有效期，照常可用。→ Task 1 测试 `inspects the leaf of a chain and tolerates CRLF and whitespace`。

---

### Task 1: 证书检查与存储（纯函数 + 文件读写）

**Files:**
- Create: `backend/src/services/https-cert.ts`
- Create: `backend/tests/fixtures/certs/`（用 openssl 生成并入库：`cert.pem` + `key.pem`（自签名，CN/SAN `book.example.com`，有效期 10 年）、`chain.pem`（cert.pem 后接另一张自签名证书）、`other-key.pem`（不配对的私钥）、`README.md` 一行说明生成命令）
- Test: `backend/tests/services/https-cert.test.ts`

**Interfaces:**
- Produces:
  - `export interface CertInfo { domains: string[]; issuer: string; notBefore: string; notAfter: string; expired: boolean; notYetValid: boolean; daysLeft: number }`（时间为 ISO 字符串；`daysLeft` 向下取整，可为负）
  - `export type CertCheck = { ok: true; info: CertInfo } | { ok: false; error: '缺少证书文件' | '无法解析证书' | '无法解析私钥' | '证书与私钥不匹配' }`
  - `export function inspectCertificate(certPem: string | null, keyPem: string | null, now?: Date): CertCheck` — 任一为空 → 缺少证书文件；域名取 SAN 的 DNS 项，无 SAN 时取 subject CN。
  - `export function certWarning(info: CertInfo): string | null` — `expired` → 「HTTPS 证书已过期（a, b）」；`daysLeft <= 14` → 「HTTPS 证书将在 N 天后到期（a, b）」；否则 null。
  - `export function certDir(dataDir: string): string`；`readCertFiles(dir): { cert: string | null; key: string | null }`；`writeCertFiles(dir, cert, key): void`（先写临时文件再 rename，私钥 0o600）；`deleteCertFiles(dir): void`。

- [ ] **Step 1: 写失败测试**

```ts
it('inspects a valid pair', () => {
  const r = inspectCertificate(CERT, KEY)
  expect(r.ok && r.info.domains).toEqual(['book.example.com'])
  expect(r.ok && r.info.expired).toBe(false)
})
it('reports expired and not-yet-valid without rejecting', () => {
  const ok = inspectCertificate(CERT, KEY) as Extract<CertCheck, { ok: true }>
  const after = new Date(Date.parse(ok.info.notAfter) + 86400e3)
  expect(inspectCertificate(CERT, KEY, after)).toMatchObject({ ok: true, info: { expired: true } })
  const before = new Date(Date.parse(ok.info.notBefore) - 86400e3)
  expect(inspectCertificate(CERT, KEY, before)).toMatchObject({ ok: true, info: { notYetValid: true } })
})
it('rejects missing, unparsable and mismatched input with exact messages', () => {
  expect(inspectCertificate(null, KEY)).toEqual({ ok: false, error: '缺少证书文件' })
  expect(inspectCertificate('garbage', KEY)).toEqual({ ok: false, error: '无法解析证书' })
  expect(inspectCertificate(CERT, 'garbage')).toEqual({ ok: false, error: '无法解析私钥' })
  expect(inspectCertificate(CERT, OTHER_KEY)).toEqual({ ok: false, error: '证书与私钥不匹配' })
})
it('inspects the leaf of a chain and tolerates CRLF and whitespace', () => {
  const r = inspectCertificate('\n  ' + CHAIN.replace(/\n/g, '\r\n') + '  \n', KEY)
  expect(r.ok && r.info.domains).toEqual(['book.example.com'])
})
it('certWarning follows the 14-day rule', () => {
  const base = { domains: ['a.com'], issuer: 'x', notBefore: '', notAfter: '', expired: false, notYetValid: false }
  expect(certWarning({ ...base, daysLeft: 30 })).toBeNull()
  expect(certWarning({ ...base, daysLeft: 14 })).toBe('HTTPS 证书将在 14 天后到期（a.com）')
  expect(certWarning({ ...base, daysLeft: -1, expired: true })).toBe('HTTPS 证书已过期（a.com）')
})
it('writes, reads and deletes cert files with a private key mode of 600', () => {
  // 临时目录：write → read 内容一致；stat(privkey.pem).mode & 0o777 === 0o600；delete 后 read 得 { cert: null, key: null }
})
```

- [ ] **Step 2: 运行确认失败** — `cd backend && npx jest tests/services/https-cert.test.ts`。
- [ ] **Step 3: 生成 fixtures 并实现**（`crypto.X509Certificate`、`createPrivateKey`、`x509.checkPrivateKey`；链只取第一段 PEM）。
- [ ] **Step 4: 运行通过**；`npx tsc --noEmit`。
- [ ] **Step 5: 提交** — `git commit -m "feat: 证书检查与存储"`

---

### Task 2: HTTPS 管理器（启停、热更新、保留可用证书）

**Files:**
- Create: `backend/src/services/https-server.ts`
- Modify: `backend/src/index.ts`（`helmet({ contentSecurityPolicy: false, hsts: false })`；`app.listen` 后 `startHttpsManager(app, { dir: certDir(DATA_DIR), port: Number(process.env.HTTPS_PORT) || 3443 })`）
- Test: `backend/tests/services/https-server.test.ts`

**Interfaces:**
- Consumes: Task 1 `inspectCertificate`、`readCertFiles`、`CertInfo`。
- Produces:
  - `export interface HttpsState { listening: boolean; port: number; cert: CertInfo | null; lastError: string | null }`
  - `export function createHttpsManager(handler: RequestListener, opts: { dir: string; port: number; pollMs?: number }): { check(): Promise<void>; state(): HttpsState; close(): Promise<void> }` — `check()`：读文件 → 有效且（未监听或内容变化）→ 未监听则 `https.createServer` 并 listen，已监听则 `setSecureContext`；无效 → 若从未成功则不监听，若已在用则保留旧证书；`lastError` 记录原因（含「HTTPS 端口 N 被占用」）；文件被删除（两个都不存在）→ 关闭服务器、`cert = null`。
  - `export function startHttpsManager(app, opts): void` — 创建管理器、立即 `check()`、`setInterval(check, pollMs ?? 60000)` 并尝试 `fs.watch(dir)` 加速（失败忽略）；模块级保存实例供 `getHttpsState()` / `recheckHttps()` 使用。
  - `export function getHttpsState(): HttpsState`；`export function recheckHttps(): Promise<HttpsState>`

- [ ] **Step 1: 写失败测试**（临时目录 + 端口 0 / 随机空闲端口；用 `tls.connect({ port, host: 'localhost', servername: 'book.example.com', ca: <当前期望的测试证书> })` 握手（保持证书校验开启，把测试证书作为受信任 CA），再取对端证书比对指纹）

```ts
it('does not listen and reports why when files are missing or broken', async () => { /* 空目录 → listening false, lastError '缺少证书文件'；只写坏证书 → '无法解析证书' */ })
it('starts serving once a valid pair appears and hot-swaps on change', async () => { /* 写 cert/key → check → listening，握手拿到的证书 = CERT；换成另一对有效证书 → check → 握手拿到新证书，端口不变 */ })
it('keeps serving the last good certificate when the new pair does not match', async () => { /* 有效对生效后，把 key 换成 OTHER_KEY → check → 仍 listening、握手仍是旧证书、lastError '证书与私钥不匹配' */ })
it('closes the server when both files are deleted', async () => { /* delete → check → listening false, cert null */ })
it('reports a busy port without throwing', async () => { /* 先占用端口 → check → listening false, lastError 'HTTPS 端口 N 被占用' */ })
```

- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行通过**；`npx jest`、`npx tsc --noEmit`；起开发后端，用 Task 1 fixtures 放进 `DATA_DIR/certs`，`curl --cacert backend/tests/fixtures/certs/cert.pem --resolve book.example.com:3443:127.0.0.1 -sI https://book.example.com:3443/health` 返回 200 且响应头无 `strict-transport-security`；HTTP `:3000` 同样无该头。
- [ ] **Step 5: 提交** — `git commit -m "feat: HTTPS 服务按证书文件启停与热更新"`

---

### Task 3: 管理员接口（状态、上传、删除）

**Files:**
- Modify: `backend/src/services/https-cert.ts`（加 `saveUploadedCert`）
- Modify: `backend/src/routes/settings.ts`（`GET/PUT/DELETE /https`，均 `authMiddleware, adminMiddleware`）
- Test: `backend/tests/services/https-cert.test.ts`
- Modify: `docs/api.md`（「系统设置（管理员）」下新增三个接口）

**Interfaces:**
- Consumes: Task 1、Task 2（`recheckHttps`、`getHttpsState`）。
- Produces:
  - `export function saveUploadedCert(dir: string, cert: string, key: string, now?: Date): { ok: true; info: CertInfo; warnings: string[] } | { ok: false; error: string }` — 校验失败不写文件；警告：`expired` → 「证书已过期」，`notYetValid` → 「证书尚未生效」。
  - `GET /api(/v1)/settings/https` → `HttpsState & { warning: string | null }`（`warning` = `certWarning(cert)`）。
  - `PUT /api(/v1)/settings/https` body `{ cert: string, key: string }`（zod，各 1–65536 字符）→ 成功 `{ ...state, warning, warnings }`；校验失败 422 `VALIDATION_ERROR`（message 为具体错误）。
  - `DELETE /api(/v1)/settings/https` → 删除文件、`recheckHttps()`、返回新状态。

- [ ] **Step 1: 写失败测试**

```ts
it('saveUploadedCert rejects bad pairs without touching existing files', () => { /* 目录里已有有效对；上传不匹配 → { ok:false, error:'证书与私钥不匹配' }，原文件内容不变 */ })
it('saveUploadedCert accepts expired certificates with a warning', () => { /* now 设为 notAfter 之后 → ok:true, warnings ['证书已过期'] */ })
it('saveUploadedCert result never contains the private key', () => { /* JSON.stringify(result) 不含 'PRIVATE KEY' 与 key 的任意 base64 行 */ })
```

- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**（路由层薄：zod → saveUploadedCert → recheckHttps → 返回）。
- [ ] **Step 4: 运行通过**；curl 验证：非管理员 403；上传 fixtures 后 GET 返回 `listening: true`、域名 `book.example.com`；DELETE 后 `listening: false`；所有响应不含私钥。
- [ ] **Step 5: 提交** — `git commit -m "feat: HTTPS 证书管理接口"`

---

### Task 4: 前端——设置页「HTTPS 证书」与到期提醒

**Files:**
- Modify: `frontend/src/api/settings.ts`、`frontend/src/types/index.ts`（`HttpsState`、`HttpsStatus = HttpsState & { warning: string | null; warnings?: string[] }`）
- Create: `frontend/src/components/HttpsCertCard.vue`
- Modify: `frontend/src/views/Settings.vue`（在「站点信息」区块之后插入 `<HttpsCertCard />`，仅管理员可见——设置页本身已限管理员）
- Modify: `frontend/src/stores/system-notice.ts`、`frontend/src/components/NotificationBell.vue`（新增 `certWarning`：加载提醒时一并取 `GET /settings/https` 的 `warning`；铃铛以警告样式显示该文案，计入红点数）
- Test: `frontend/src/components/HttpsCertCard.test.ts`、`frontend/src/stores/system-notice.test.ts`（若已有同名测试则追加）

**Interfaces:**
- Consumes: Task 3 接口。
- Produces:
  - `settingsApi.getHttps()`、`settingsApi.uploadHttps(cert: string, key: string)`、`settingsApi.deleteHttps()`。
  - `HttpsCertCard.vue`：区块标题「HTTPS 证书」；状态行「HTTPS 已开启」（端口 N）/「HTTPS 未开启」+ `lastError`；证书信息（域名、颁发者、到期日、「已过期」/「尚未生效」/「还有 N 天到期」）；上传区：两个文件选择（读取为文本）或展开两个文本框粘贴，「上传并启用」；有证书时「删除证书」（`ElMessageBox.confirm`，确认后调用删除）；上传成功显示 `warnings`（`ElMessage.warning`）；说明文字一行：「也可以把 fullchain.pem 与 privkey.pem 放进数据目录的 certs 文件夹，替换后自动生效」。

- [ ] **Step 1: 写失败测试**（mock `settingsApi`）

```ts
it('shows status, domains and days left', async () => { /* getHttps → listening true, port 3443, cert daysLeft 40 → 「HTTPS 已开启」「book.example.com」「还有 40 天到期」 */ })
it('shows the load error when HTTPS is off', async () => { /* listening false, lastError '证书与私钥不匹配' → 「HTTPS 未开启」与该错误 */ })
it('uploads pasted PEM text and surfaces warnings', async () => { /* 填两个文本框 → 点「上传并启用」 → uploadHttps(cert, key)；返回 warnings ['证书已过期'] → ElMessage.warning 被调用 */ })
it('confirms before deleting the certificate', async () => {})
it('notice store counts a certificate warning', async () => { /* getHttps 返回 warning 'HTTPS 证书将在 3 天后到期（a.com）' → store.certWarning 为该文案，count 增加 1 */ })
```

- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行通过**；`npx vue-tsc --noEmit`。
- [ ] **Step 5: 提交** — `git commit -m "feat: 设置页 HTTPS 证书与到期提醒"`

---

### Task 5: 部署文档与整体验证

**Files:**
- Modify: `docker-compose.yml`（`ports` 增加 `- "8443:3443"`，注释：「HTTPS（使用自己的证书时启用，见 README）」）；`.env.example` 若列出端口变量则加 `HTTPS_PORT`
- Modify: `README.md`（「使用自己的证书开启 HTTPS」一节：两种方式、路由器转发 8443、Cloudflare 记录需灰色云朵、续签由用户负责，可让续签工具把文件写进 `certs/` 实现全自动、证书过期仍可用但浏览器会警告）、`DOCKERHUB.md`（同上简版）、`CHANGELOG.md`（`## [Unreleased]` → `### 新增`：「- **部署**：可使用自己的证书直接提供 HTTPS（放进数据目录 certs/ 或在设置页上传，替换后自动生效，到期前提醒）；如需使用，docker-compose 增加 HTTPS 端口映射（默认 8443:3443）」）、`tasks/todo.md`

- [ ] **Step 1: 全量检查** — `cd backend && npx jest && npx tsc --noEmit && cd ../frontend && npx vitest run && npx vue-tsc --noEmit`。
- [ ] **Step 2: 浏览器验证**（开发后端 + vite，数据副本）：
  - 设置页上传 fixtures → 状态变为「HTTPS 已开启」，`https://localhost:3443` 可打开（自签名需手动信任），HTTP 页面照常。
  - 在 `certs/` 里直接替换为另一对有效证书 → 1 分钟内（或 fs.watch 立即）新证书生效，设置页刷新显示新信息。
  - 替换成不匹配的私钥 → HTTPS 继续用旧证书，设置页显示「证书与私钥不匹配」。
  - 删除证书 → 「HTTPS 未开启」，3443 不再监听。
  - 用 now 偏移不易实测到期提醒：以单测为准；铃铛在 `warning` 非空时显示（可临时用快到期的自签名证书 `-days 3` 验证）。
- [ ] **Step 3: Docker 构建** — `docker build` 成功；容器挂载含 fixtures 的 data 目录、映射 3443 → `curl --cacert backend/tests/fixtures/certs/cert.pem --resolve book.example.com:<port>:127.0.0.1 https://book.example.com:<port>/health` 返回 200。
- [ ] **Step 4: 提交** — `git commit -m "docs: 使用自己的证书开启 HTTPS 的部署说明"`
