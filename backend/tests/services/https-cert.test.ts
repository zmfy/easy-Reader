import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  inspectCertificate, certWarning, certDir, readCertFiles, writeCertFiles, deleteCertFiles, CertCheck, saveUploadedCert,
} from '../../src/services/https-cert';

const FIX = path.join(__dirname, '../fixtures/certs');
const read = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf8');
const CERT = read('cert.pem');
const KEY = read('key.pem');
const CHAIN = read('chain.pem');
const OTHER_KEY = read('other-key.pem');
const WEAK_CERT = read('weak-cert.pem');
const WEAK_KEY = read('weak-key.pem');

describe('https-cert', () => {
  it('inspects a valid pair', () => {
    const r = inspectCertificate(CERT, KEY);
    expect(r.ok && r.info.domains).toEqual(['book.example.com']);
    expect(r.ok && r.info.expired).toBe(false);
    expect(r.ok && r.info.notYetValid).toBe(false);
    expect(r.ok && r.info.daysLeft).toBeGreaterThan(3000);
    expect(r.ok && r.info.issuer).toContain('book.example.com');
  });

  it('reports expired and not-yet-valid without rejecting', () => {
    const ok = inspectCertificate(CERT, KEY) as Extract<CertCheck, { ok: true }>;
    const after = new Date(Date.parse(ok.info.notAfter) + 86400e3);
    expect(inspectCertificate(CERT, KEY, after)).toMatchObject({ ok: true, info: { expired: true } });
    expect((inspectCertificate(CERT, KEY, after) as Extract<CertCheck, { ok: true }>).info.daysLeft).toBeLessThan(0);
    const before = new Date(Date.parse(ok.info.notBefore) - 86400e3);
    expect(inspectCertificate(CERT, KEY, before)).toMatchObject({ ok: true, info: { notYetValid: true } });
  });

  it('rejects missing, unparsable and mismatched input with exact messages', () => {
    expect(inspectCertificate(null, KEY)).toEqual({ ok: false, error: '缺少证书文件' });
    expect(inspectCertificate(CERT, null)).toEqual({ ok: false, error: '缺少证书文件' });
    expect(inspectCertificate('garbage', KEY)).toEqual({ ok: false, error: '无法解析证书' });
    expect(inspectCertificate(CERT, 'garbage')).toEqual({ ok: false, error: '无法解析私钥' });
    expect(inspectCertificate(CERT, OTHER_KEY)).toEqual({ ok: false, error: '证书与私钥不匹配' });
  });

  it('inspects the leaf of a chain and tolerates CRLF and whitespace', () => {
    const r = inspectCertificate('\n  ' + CHAIN.replace(/\n/g, '\r\n') + '  \n', KEY.replace(/\n/g, '\r\n'));
    expect(r.ok && r.info.domains).toEqual(['book.example.com']);
  });

  it('certWarning follows the 14-day rule', () => {
    const base = { domains: ['a.com', 'b.com'], issuer: 'x', notBefore: '', notAfter: '', expired: false, notYetValid: false };
    expect(certWarning({ ...base, daysLeft: 30 })).toBeNull();
    expect(certWarning({ ...base, daysLeft: 15 })).toBeNull();
    expect(certWarning({ ...base, daysLeft: 14 })).toBe('HTTPS 证书将在 14 天后到期（a.com, b.com）');
    expect(certWarning({ ...base, daysLeft: -1, expired: true })).toBe('HTTPS 证书已过期（a.com, b.com）');
  });

  it('writes, reads and deletes cert files with a private key mode of 600', () => {
    const dir = certDir(fs.mkdtempSync(path.join(os.tmpdir(), 'https-cert-')));
    expect(readCertFiles(dir)).toEqual({ cert: null, key: null });
    writeCertFiles(dir, CERT, KEY);
    expect(readCertFiles(dir)).toEqual({ cert: CERT, key: KEY });
    expect(fs.statSync(path.join(dir, 'privkey.pem')).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir).sort()).toEqual(['fullchain.pem', 'privkey.pem']);
    deleteCertFiles(dir);
    expect(readCertFiles(dir)).toEqual({ cert: null, key: null });
  });

  it('saveUploadedCert rejects bad pairs without touching existing files', () => {
    const dir = certDir(fs.mkdtempSync(path.join(os.tmpdir(), 'https-up-')));
    writeCertFiles(dir, CERT, KEY);
    expect(saveUploadedCert(dir, CERT, OTHER_KEY)).toEqual({ ok: false, error: '证书与私钥不匹配' });
    expect(saveUploadedCert(dir, 'garbage', KEY)).toEqual({ ok: false, error: '无法解析证书' });
    expect(readCertFiles(dir)).toEqual({ cert: CERT, key: KEY });
  });

  it('saveUploadedCert accepts expired certificates with a warning', () => {
    const dir = certDir(fs.mkdtempSync(path.join(os.tmpdir(), 'https-up-')));
    const ok = inspectCertificate(CERT, KEY) as Extract<CertCheck, { ok: true }>;
    const r = saveUploadedCert(dir, CERT, KEY, new Date(Date.parse(ok.info.notAfter) + 86400e3));
    expect(r).toMatchObject({ ok: true, warnings: ['证书已过期'] });
    expect(readCertFiles(dir)).toEqual({ cert: CERT, key: KEY });
    const early = saveUploadedCert(dir, CERT, KEY, new Date(Date.parse(ok.info.notBefore) - 86400e3));
    expect(early).toMatchObject({ ok: true, warnings: ['证书尚未生效'] });
    expect(saveUploadedCert(dir, CERT, KEY)).toMatchObject({ ok: true, warnings: [] });
  });

  it('saveUploadedCert result never contains the private key', () => {
    const dir = certDir(fs.mkdtempSync(path.join(os.tmpdir(), 'https-up-')));
    const json = JSON.stringify(saveUploadedCert(dir, CERT, KEY));
    expect(json).not.toContain('PRIVATE KEY');
    for (const line of KEY.split('\n').filter(l => l.length > 20 && !l.startsWith('-----'))) expect(json).not.toContain(line);
  });

  it('rejects a pair that parses and matches but TLS refuses to use', () => {
    expect(inspectCertificate(WEAK_CERT, WEAK_KEY)).toEqual({ ok: false, error: '证书无法用于 HTTPS' });
    const dir = certDir(fs.mkdtempSync(path.join(os.tmpdir(), 'https-up-')));
    writeCertFiles(dir, CERT, KEY);
    expect(saveUploadedCert(dir, WEAK_CERT, WEAK_KEY)).toEqual({ ok: false, error: '证书无法用于 HTTPS' });
    expect(readCertFiles(dir)).toEqual({ cert: CERT, key: KEY });
  });

  it('writeCertFiles leaves no temporary files behind when a write fails', () => {
    const dir = certDir(fs.mkdtempSync(path.join(os.tmpdir(), 'https-up-')));
    fs.mkdirSync(path.join(dir, 'fullchain.pem'), { recursive: true });  // 目标被目录占用：rename 失败
    expect(() => writeCertFiles(dir, CERT, KEY)).toThrow();
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });
});
