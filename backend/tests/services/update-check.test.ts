import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  readLocalChangelog,
  updateSources,
  fetchRemoteChangelog,
  checkForUpdates,
  getUpdateStatus,
  startUpdateChecker,
} from '../../src/services/update-check';

const REMOTE_MD = `# 更新日志

## [1.2.0] - 2026-11-10

### 新增

- 【需操作】新功能

## [1.1.0] - 2026-11-01

### 修复

- 老修复
`;
const LOCAL_MD = `# 更新日志

## [Unreleased]

### 新增

- 未发布

## [1.1.0] - 2026-11-01

### 修复

- 老修复
`;

function makeDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  return db;
}
const ok = (text: string) => ({ ok: true, status: 200, text: async () => text } as any);
const never = () => new Promise<any>(() => {});

const ENV_KEYS = ['UPDATE_CHECK', 'UPDATE_CHANGELOG_URL', 'CHANGELOG_PATH'];
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();
let tmp: string;

beforeEach(() => {
  ENV_KEYS.forEach(k => { savedEnv[k] = process.env[k]; delete process.env[k]; });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'update-check-'));
});
afterEach(() => {
  ENV_KEYS.forEach(k => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; });
  process.chdir(savedCwd);
  jest.useRealTimers();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('fetchRemoteChangelog', () => {
  test('falls back to jsdelivr when github times out', async () => {
    const fetchImpl = jest.fn((url: string) => (url.includes('githubusercontent') ? never() : Promise.resolve(ok(REMOTE_MD))));
    const r = await fetchRemoteChangelog(updateSources(), fetchImpl as any, 20);
    expect(r.source).toContain('jsdelivr');
    expect(r.text).toContain('## [1.2.0]');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('treats HTML error page as failure', async () => {
    const fetchImpl = jest.fn(async (url: string) => (url.includes('githubusercontent') ? ok('<html>Not Found</html>') : ok(REMOTE_MD)));
    const r = await fetchRemoteChangelog(updateSources(), fetchImpl as any, 20);
    expect(r.source).toContain('jsdelivr');
  });

  test('oversized response falls back', async () => {
    const big = REMOTE_MD + 'x'.repeat(1024 * 1024 + 1);
    const fetchImpl = jest.fn(async (url: string) => (url.includes('githubusercontent') ? ok(big) : ok(REMOTE_MD)));
    const r = await fetchRemoteChangelog(updateSources(), fetchImpl as any, 20);
    expect(r.source).toContain('jsdelivr');
  });

  test('all failures throw without leaking remote body', async () => {
    const fetchImpl = jest.fn(async () => ok('<html>SECRET-BODY</html>'));
    await expect(fetchRemoteChangelog(['https://a.example/x', 'https://b.example/x'], fetchImpl as any, 20))
      .rejects.toThrow(/a\.example.*b\.example/s);
    await expect(fetchRemoteChangelog(['https://a.example/x'], fetchImpl as any, 20))
      .rejects.not.toThrow(/SECRET-BODY/);
  });

  test('non-2xx is failure', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 404, text: async () => REMOTE_MD } as any));
    await expect(fetchRemoteChangelog(['https://a.example/x'], fetchImpl as any, 20)).rejects.toThrow(/404/);
  });
});

describe('updateSources', () => {
  test('custom URL replaces default sources', () => {
    process.env.UPDATE_CHANGELOG_URL = 'http://127.0.0.1:9/CHANGELOG.md';
    expect(updateSources()).toEqual(['http://127.0.0.1:9/CHANGELOG.md']);
  });
  test('defaults use branch', () => {
    const s = updateSources();
    expect(s).toHaveLength(2);
    expect(s[0]).toContain('raw.githubusercontent.com/zmfy/easy-Reader/main/CHANGELOG.md');
    expect(s[1]).toContain('cdn.jsdelivr.net/gh/zmfy/easy-Reader@main/CHANGELOG.md');
  });
});

describe('checkForUpdates / getUpdateStatus', () => {
  beforeEach(() => {
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), LOCAL_MD);
    process.env.CHANGELOG_PATH = path.join(tmp, 'CHANGELOG.md');
  });

  test('getUpdateStatus lists newer releases only', async () => {
    const db = makeDb();
    const st = await checkForUpdates(db, (async () => ok(REMOTE_MD)) as any);
    expect(st.currentVersion).toBe('1.1.0');
    expect(st.newer.map(r => r.version)).toEqual(['1.2.0']);
    expect(st.error).toBeNull();
    expect(st.checkedAt).not.toBeNull();
    const cached = getUpdateStatus(db);
    expect(cached.newer.map(r => r.version)).toEqual(['1.2.0']);
    expect(cached.branch).toBe('main');
    expect(cached.enabled).toBe(true);
  });

  test('failed check keeps previous result and records error', async () => {
    const db = makeDb();
    await checkForUpdates(db, (async () => ok(REMOTE_MD)) as any);
    const st = await checkForUpdates(db, (async () => ({ ok: false, status: 500, text: async () => 'boom-body' })) as any);
    expect(st.error).toMatch(/500/);
    expect(st.error).not.toMatch(/boom-body/);
    expect(st.newer.map(r => r.version)).toEqual(['1.2.0']);
    expect(getUpdateStatus(db).error).toMatch(/500/);
  });

  test('no current version means no newer', async () => {
    delete process.env.CHANGELOG_PATH;
    fs.rmSync(path.join(tmp, 'CHANGELOG.md'));
    const sub = path.join(tmp, 'sub');
    fs.mkdirSync(sub);
    process.chdir(sub);
    const db = makeDb();
    const st = await checkForUpdates(db, (async () => ok(REMOTE_MD)) as any);
    expect(st.currentVersion).toBeNull();
    expect(st.newer).toEqual([]);
  });

  test('getUpdateStatus on empty db', () => {
    const st = getUpdateStatus(makeDb());
    expect(st.checkedAt).toBeNull();
    expect(st.error).toBeNull();
    expect(st.newer).toEqual([]);
  });
});

describe('readLocalChangelog', () => {
  test('finds ../CHANGELOG.md from backend cwd', () => {
    const backend = path.join(tmp, 'backend');
    fs.mkdirSync(backend);
    fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), LOCAL_MD);
    process.chdir(backend);
    const r = readLocalChangelog();
    expect(r.missing).toBe(false);
    expect(r.currentVersion).toBe('1.1.0');
    expect(r.releases.map(x => x.version)).toEqual(['1.1.0']);
  });

  test('missing changelog returns missing true', () => {
    process.chdir(tmp);
    const r = readLocalChangelog();
    expect(r).toEqual({ releases: [], currentVersion: null, missing: true });
  });

  test('reloads when file mtime changes', () => {
    const f = path.join(tmp, 'CHANGELOG.md');
    process.env.CHANGELOG_PATH = f;
    fs.writeFileSync(f, LOCAL_MD);
    expect(readLocalChangelog().currentVersion).toBe('1.1.0');
    fs.writeFileSync(f, REMOTE_MD);
    fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
    expect(readLocalChangelog().currentVersion).toBe('1.2.0');
  });
});

describe('startUpdateChecker', () => {
  test('disabled when UPDATE_CHECK=off', () => {
    process.env.UPDATE_CHECK = 'off';
    jest.useFakeTimers();
    const spy = jest.spyOn(global, 'setTimeout');
    startUpdateChecker();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('schedules first check after 60s with unref', () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(global, 'setTimeout');
    startUpdateChecker();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(60000);
    spy.mockRestore();
    jest.clearAllTimers();
  });
});
