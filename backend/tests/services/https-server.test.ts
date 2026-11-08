import fs from 'fs';
import os from 'os';
import path from 'path';
import net from 'net';
import tls from 'tls';
import { X509Certificate } from 'crypto';
import { createHttpsManager } from '../../src/services/https-server';
import { writeCertFiles, deleteCertFiles } from '../../src/services/https-cert';

const FIX = path.join(__dirname, '../fixtures/certs');
const read = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf8');
const CERT = read('cert.pem');
const KEY = read('key.pem');
const OTHER_CERT = read('other-cert.pem');
const OTHER_KEY = read('other-key.pem');

const fingerprint = (pem: string) => new X509Certificate(pem).fingerprint256;

function freePort(): Promise<number> {
  return new Promise(resolve => {
    const s = net.createServer().listen(0, () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

// 握手时保持证书校验：把期望的测试证书作为受信任 CA
function handshake(port: number, ca: string, servername: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ port, host: '127.0.0.1', servername, ca }, () => {
      const fp = sock.getPeerX509Certificate()?.fingerprint256 ?? '';
      sock.end();
      resolve(fp);
    });
    sock.on('error', reject);
  });
}

const handler = (_req: unknown, res: { end: (s: string) => void }) => res.end('ok');

describe('https manager', () => {
  let dir: string;
  let managers: Array<{ close(): Promise<void> }> = [];
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'https-mgr-')); managers = []; });
  afterEach(async () => { for (const m of managers) await m.close(); });
  const make = async () => {
    const port = await freePort();
    const m = createHttpsManager(handler as never, { dir, port });
    managers.push(m);
    return { m, port };
  };

  it('does not listen and reports why when files are missing or broken', async () => {
    const { m } = await make();
    await m.check();
    // 两个文件都没有：未配置 HTTPS，不算错误
    expect(m.state()).toMatchObject({ listening: false, cert: null, lastError: null });
    fs.writeFileSync(path.join(dir, 'privkey.pem'), KEY);
    await m.check();
    expect(m.state()).toMatchObject({ listening: false, lastError: '缺少证书文件' });
    fs.writeFileSync(path.join(dir, 'fullchain.pem'), 'garbage');
    await m.check();
    expect(m.state()).toMatchObject({ listening: false, lastError: '无法解析证书' });
  });

  it('starts serving once a valid pair appears and hot-swaps on change', async () => {
    const { m, port } = await make();
    writeCertFiles(dir, CERT, KEY);
    await m.check();
    expect(m.state()).toMatchObject({ listening: true, port, lastError: null });
    expect(m.state().cert?.domains).toEqual(['book.example.com']);
    expect(await handshake(port, CERT, 'book.example.com')).toBe(fingerprint(CERT));
    writeCertFiles(dir, OTHER_CERT, OTHER_KEY);
    await m.check();
    expect(m.state().cert?.domains).toEqual(['other.example.com']);
    expect(await handshake(port, OTHER_CERT, 'other.example.com')).toBe(fingerprint(OTHER_CERT));
  });

  it('keeps serving the last good certificate when the new pair does not match', async () => {
    const { m, port } = await make();
    writeCertFiles(dir, CERT, KEY);
    await m.check();
    fs.writeFileSync(path.join(dir, 'privkey.pem'), OTHER_KEY);
    await m.check();
    expect(m.state()).toMatchObject({ listening: true, lastError: '证书与私钥不匹配' });
    expect(m.state().cert?.domains).toEqual(['book.example.com']);
    expect(await handshake(port, CERT, 'book.example.com')).toBe(fingerprint(CERT));
    // 配对恢复后错误清除
    fs.writeFileSync(path.join(dir, 'privkey.pem'), KEY);
    await m.check();
    expect(m.state().lastError).toBeNull();
  });

  it('closes the server when both files are deleted', async () => {
    const { m, port } = await make();
    writeCertFiles(dir, CERT, KEY);
    await m.check();
    deleteCertFiles(dir);
    await m.check();
    expect(m.state()).toMatchObject({ listening: false, cert: null, lastError: null });
    await expect(handshake(port, CERT, 'book.example.com')).rejects.toBeTruthy();
  });

  it('reports a busy port without throwing', async () => {
    const port = await freePort();
    const blocker = net.createServer();
    await new Promise<void>(r => blocker.listen(port, () => r()));
    try {
      const m = createHttpsManager(handler as never, { dir, port });
      managers.push(m);
      writeCertFiles(dir, CERT, KEY);
      await m.check();
      expect(m.state()).toMatchObject({ listening: false, lastError: `HTTPS 端口 ${port} 被占用` });
    } finally {
      await new Promise<void>(r => blocker.close(() => r()));
    }
  });
});
