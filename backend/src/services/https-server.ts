// HTTPS 服务：按 DATA_DIR/certs 里的证书启停与热更新（不重启进程）
// 新证书不可用时保留上一张可用证书；证书过期照常使用（只在状态里标出）
import fs from 'fs';
import https from 'https';
import type { RequestListener } from 'http';
import { inspectCertificate, readCertFiles, CertInfo } from './https-cert';

export interface HttpsState { listening: boolean; port: number; cert: CertInfo | null; lastError: string | null }

interface ManagerOpts { dir: string; port: number; pollMs?: number }

export function createHttpsManager(handler: RequestListener, opts: ManagerOpts) {
  let server: https.Server | null = null;
  let loaded: { cert: string; key: string } | null = null;
  let info: CertInfo | null = null;
  let lastError: string | null = null;
  let running: Promise<void> | null = null;

  function closeServer(): Promise<void> {
    const s = server;
    server = null;
    loaded = null;
    if (!s) return Promise.resolve();
    return new Promise(resolve => {
      s.close(() => resolve());
      s.closeAllConnections?.();
    });
  }

  function listen(cert: string, key: string): Promise<void> {
    return new Promise(resolve => {
      let s: https.Server;
      try {
        s = https.createServer({ cert, key }, handler);
      } catch {
        lastError = '证书无法用于 HTTPS';
        resolve();
        return;
      }
      s.once('error', (err: NodeJS.ErrnoException) => {
        lastError = err.code === 'EADDRINUSE' ? `HTTPS 端口 ${opts.port} 被占用` : `HTTPS 启动失败：${err.code || err.message}`;
        resolve();
      });
      s.listen(opts.port, () => {
        // 启动成功后换成常驻监听：之后的运行期错误只记日志，不影响状态与进程
        s.removeAllListeners('error');
        s.on('error', err => console.error('[https] 服务错误', err.message));
        server = s;
        loaded = { cert, key };
        lastError = null;
        resolve();
      });
    });
  }

  async function doCheck(): Promise<void> {
    const files = readCertFiles(opts.dir);
    // 两个文件都没有：未配置 HTTPS
    if (!files.cert && !files.key) {
      await closeServer();
      info = null;
      lastError = null;
      return;
    }
    const checked = inspectCertificate(files.cert, files.key);
    if (!checked.ok) {
      // 保留当前在用的证书（例如续签工具写了一半），只记录原因
      lastError = checked.error;
      return;
    }
    const cert = files.cert!;
    const key = files.key!;
    if (server && loaded && loaded.cert === cert && loaded.key === key) {
      info = checked.info;  // 刷新剩余天数
      lastError = null;
      return;
    }
    if (server) {
      try {
        server.setSecureContext({ cert, key });
      } catch {
        lastError = '证书无法用于 HTTPS';  // 保留当前在用的证书
        return;
      }
      loaded = { cert, key };
      info = checked.info;
      lastError = null;
      return;
    }
    await listen(cert, key);
    if (server) info = checked.info;
  }

  return {
    /** 读取证书文件并启停 / 热更新；并发调用合并为一次 */
    check(): Promise<void> {
      if (!running) running = doCheck().finally(() => { running = null; });
      return running;
    },
    state(): HttpsState {
      return { listening: !!server, port: opts.port, cert: server ? info : null, lastError };
    },
    close: closeServer,
  };
}

let manager: ReturnType<typeof createHttpsManager> | null = null;

/** 进程启动时调用：立即检查一次，之后定时检查（Docker 挂载目录上 fs.watch 不可靠，轮询兜底） */
export function startHttpsManager(handler: RequestListener, opts: ManagerOpts): void {
  manager = createHttpsManager(handler, opts);
  const m = manager;
  const check = () => { m.check().catch(err => console.error('[https] 检查证书失败', err instanceof Error ? err.message : err)); };
  check();
  setInterval(check, opts.pollMs ?? 60_000).unref();
  try {
    fs.mkdirSync(opts.dir, { recursive: true });
    let timer: NodeJS.Timeout | null = null;
    fs.watch(opts.dir, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 1000);  // 续签工具会先后写两个文件，稍等再读
    }).unref();
  } catch { /* 不支持 watch 时只靠轮询 */ }
}

export function getHttpsState(): HttpsState {
  return manager ? manager.state() : { listening: false, port: 0, cert: null, lastError: null };
}

export async function recheckHttps(): Promise<HttpsState> {
  if (manager) await manager.check();
  return getHttpsState();
}
