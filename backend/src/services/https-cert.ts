// 用户自带证书：检查（解析、配对、有效期）与存储（DATA_DIR/certs 下固定文件名）
// 不申请 / 不续签证书；任何返回值与日志都不包含私钥
import fs from 'fs';
import path from 'path';
import { X509Certificate, createPrivateKey } from 'crypto';

export interface CertInfo {
  domains: string[];
  issuer: string;
  notBefore: string;
  notAfter: string;
  expired: boolean;
  notYetValid: boolean;
  daysLeft: number;
}

export type CertError = '缺少证书文件' | '无法解析证书' | '无法解析私钥' | '证书与私钥不匹配';
export type CertCheck = { ok: true; info: CertInfo } | { ok: false; error: CertError };

const CERT_FILE = 'fullchain.pem';
const KEY_FILE = 'privkey.pem';
const DAY_MS = 86400e3;
const WARN_DAYS = 14;

/** 证书链里的第一张（叶子证书） */
function leafPem(chain: string): string {
  const m = chain.replace(/\r\n/g, '\n').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  return m ? m[0] : chain;
}

function domainsOf(x509: X509Certificate): string[] {
  const san = (x509.subjectAltName || '')
    .split(',').map(s => s.trim()).filter(s => s.startsWith('DNS:')).map(s => s.slice(4));
  if (san.length) return san;
  const cn = x509.subject.split('\n').find(l => l.startsWith('CN='));
  return cn ? [cn.slice(3)] : [];
}

export function inspectCertificate(certPem: string | null, keyPem: string | null, now: Date = new Date()): CertCheck {
  if (!certPem || !certPem.trim() || !keyPem || !keyPem.trim()) return { ok: false, error: '缺少证书文件' };
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(leafPem(certPem.trim()));
  } catch {
    return { ok: false, error: '无法解析证书' };
  }
  let key;
  try {
    key = createPrivateKey(keyPem.trim().replace(/\r\n/g, '\n'));
  } catch {
    return { ok: false, error: '无法解析私钥' };
  }
  if (!x509.checkPrivateKey(key)) return { ok: false, error: '证书与私钥不匹配' };
  const from = new Date(x509.validFrom);
  const to = new Date(x509.validTo);
  return {
    ok: true,
    info: {
      domains: domainsOf(x509),
      issuer: x509.issuer.replace(/\n/g, ', '),
      notBefore: from.toISOString(),
      notAfter: to.toISOString(),
      expired: now.getTime() > to.getTime(),
      notYetValid: now.getTime() < from.getTime(),
      daysLeft: Math.floor((to.getTime() - now.getTime()) / DAY_MS),
    },
  };
}

/** 到期提醒：已过期，或剩余不超过 14 天 */
export function certWarning(info: CertInfo): string | null {
  const domains = info.domains.join(', ');
  if (info.expired) return `HTTPS 证书已过期（${domains}）`;
  if (info.daysLeft <= WARN_DAYS) return `HTTPS 证书将在 ${info.daysLeft} 天后到期（${domains}）`;
  return null;
}

export function certDir(dataDir: string): string {
  return path.join(dataDir, 'certs');
}

function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function readCertFiles(dir: string): { cert: string | null; key: string | null } {
  return { cert: readOrNull(path.join(dir, CERT_FILE)), key: readOrNull(path.join(dir, KEY_FILE)) };
}

// 先写临时文件再改名：重新加载时不会读到写了一半的文件
function writeAtomic(file: string, content: string, mode: number): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

export function writeCertFiles(dir: string, cert: string, key: string): void {
  fs.mkdirSync(dir, { recursive: true });
  // 私钥先写：避免出现「新证书 + 旧私钥」的中间状态被当成不匹配
  writeAtomic(path.join(dir, KEY_FILE), key, 0o600);
  writeAtomic(path.join(dir, CERT_FILE), cert, 0o644);
}

export function deleteCertFiles(dir: string): void {
  for (const f of [CERT_FILE, KEY_FILE]) fs.rmSync(path.join(dir, f), { force: true });
}

/** 设置页上传：校验通过才写文件（不动原有证书）；过期 / 尚未生效照样接受并给出警告 */
export function saveUploadedCert(
  dir: string, cert: string, key: string, now: Date = new Date(),
): { ok: true; info: CertInfo; warnings: string[] } | { ok: false; error: CertError } {
  const checked = inspectCertificate(cert, key, now);
  if (!checked.ok) return checked;
  writeCertFiles(dir, cert.trim() + '\n', key.trim() + '\n');
  const warnings: string[] = [];
  if (checked.info.expired) warnings.push('证书已过期');
  if (checked.info.notYetValid) warnings.push('证书尚未生效');
  return { ok: true, info: checked.info, warnings };
}
