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
  isNoticeEnabled,
  applyUpdateCheckerSetting,
} from '../../src/services/update-check';
import { UPDATE_BRANCH, VERSION_SUFFIX } from '../../src/edition';

// 版本节标题带上当前版本线的后缀，study 分支（EDITION='study'）下同样成立
const V = VERSION_SUFFIX;

const REMOTE_MD = `# 更新日志

## [1.2.0${V}] - 2026-11-10

### 新增

- 【需操作】新功能

## [1.1.0${V}] - 2026-11-01

### 修复

- 老修复
`;
const LOCAL_MD = `# 更新日志

## [Unreleased]

### 新增

- 未发布

## [1.1.0${V}] - 2026-11-01

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

const ENV_KEYS = ['UPDATE_CHECK', 'UPDATE_CHANGELOG_URL', 'CHANGELOG_PATH', 'USAGE_STATS', 'USAGE_STATS_URL'];
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();
let tmp: string;

beforeEach(() => {
  ENV_KEYS.forEach(k => { savedEnv[k] = process.env[k]; delete process.env[k]; });
  // 默认关闭匿名统计，只观察更新检查本身的请求；统计相关行为在下面单独测试
  process.env.USAGE_STATS = 'off';
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
    expect(r.text).toContain(`## [1.2.0${V}]`);
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
    expect(s[0]).toContain(`raw.githubusercontent.com/zmfy/easy-Reader/${UPDATE_BRANCH}/CHANGELOG.md`);
    expect(s[1]).toContain(`cdn.jsdelivr.net/gh/zmfy/easy-Reader@${UPDATE_BRANCH}/CHANGELOG.md`);
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
    expect(cached.branch).toBe(UPDATE_BRANCH);
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

  test('zero releases counts as invalid content', async () => {
    const db = makeDb();
    await checkForUpdates(db, (async () => ok(REMOTE_MD)) as any);
    // 含 "## [" 但解析不出任何版本
    const st = await checkForUpdates(db, (async () => ok('# 更新日志\n\n## [foo]\n\n- x\n')) as any);
    expect(st.error).toMatch(/内容无效/);
    expect(st.newer.map(r => r.version)).toEqual(['1.2.0']);
  });

  test('unknown current version lists all remote releases', async () => {
    delete process.env.CHANGELOG_PATH;
    fs.rmSync(path.join(tmp, 'CHANGELOG.md'));
    const sub = path.join(tmp, 'sub');
    fs.mkdirSync(sub);
    process.chdir(sub);
    const db = makeDb();
    const st = await checkForUpdates(db, (async () => ok(REMOTE_MD)) as any);
    expect(st.currentVersion).toBeNull();
    expect(st.newer.map(r => r.version)).toEqual(['1.2.0', '1.1.0']);
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

// 每个用例结束后停掉模块内的定时器，避免状态串到下一个用例
function stopChecker() {
  const db = makeDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('system_notice_enabled', 'false')").run();
  applyUpdateCheckerSetting(db);
}

describe('startUpdateChecker', () => {
  afterEach(() => {
    stopChecker();
    jest.clearAllTimers();
  });

  test('disabled when UPDATE_CHECK=off', () => {
    process.env.UPDATE_CHECK = 'off';
    jest.useFakeTimers();
    const spy = jest.spyOn(global, 'setTimeout');
    startUpdateChecker(makeDb());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('schedules first check after 60s with unref', () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(global, 'setTimeout');
    startUpdateChecker(makeDb());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe(60000);
    spy.mockRestore();
  });

  test('notice disabled stops timer and skips checks', () => {
    jest.useFakeTimers();
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async () => ok(REMOTE_MD)) as any);
    const db = makeDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('system_notice_enabled', 'false')").run();
    expect(isNoticeEnabled(db)).toBe(false);
    // 关闭时启动不排定时器
    startUpdateChecker(db);
    expect(jest.getTimerCount()).toBe(0);
    // 先开启运行，再关闭：定时器被清除，之后不再检查
    db.prepare("UPDATE settings SET value = 'true' WHERE key = 'system_notice_enabled'").run();
    startUpdateChecker(db);
    expect(jest.getTimerCount()).toBe(1);
    db.prepare("UPDATE settings SET value = 'false' WHERE key = 'system_notice_enabled'").run();
    applyUpdateCheckerSetting(db);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(3 * 24 * 60 * 60 * 1000);
    expect(fetchSpy).not.toHaveBeenCalled();
    const st = getUpdateStatus(db);
    expect(st.checkedAt).toBeNull();
    expect(st.noticeEnabled).toBe(false);
    expect(st.envDisabled).toBe(false);
    fetchSpy.mockRestore();
  });

  test('enabling restarts checker', () => {
    jest.useFakeTimers();
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async () => ok(REMOTE_MD)) as any);
    const db = makeDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('system_notice_enabled', 'false')").run();
    applyUpdateCheckerSetting(db);
    expect(jest.getTimerCount()).toBe(0);
    db.prepare("UPDATE settings SET value = 'true' WHERE key = 'system_notice_enabled'").run();
    expect(isNoticeEnabled(db)).toBe(true);
    // 多次开启不叠加定时器
    applyUpdateCheckerSetting(db);
    applyUpdateCheckerSetting(db);
    startUpdateChecker(db);
    expect(jest.getTimerCount()).toBe(1);
    // 5 秒后检查一次，之后只保留一个 24 小时的 interval
    jest.advanceTimersByTime(4999);
    expect(fetchSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // 反复关开后仍只有一个周期定时器
    db.prepare("UPDATE settings SET value = 'false' WHERE key = 'system_notice_enabled'").run();
    applyUpdateCheckerSetting(db);
    db.prepare("UPDATE settings SET value = 'true' WHERE key = 'system_notice_enabled'").run();
    applyUpdateCheckerSetting(db);
    jest.advanceTimersByTime(5000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    fetchSpy.mockRestore();
  });

  test('db error in scheduled run does not crash and keeps the interval', () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async () => ok(REMOTE_MD)) as any);
    const db = makeDb();
    startUpdateChecker(db);
    // 定时回调里的同步 SQLite 调用抛错（连接已关闭）
    db.close();
    expect(() => jest.advanceTimersByTime(60000)).not.toThrow();
    expect(jest.getTimerCount()).toBe(1);
    // better-sqlite3 的原生错误与 jest 沙箱不同 realm，instanceof Error 不成立，这里只断言已记录
    expect(warn).toHaveBeenCalledWith('[update-check] 检查失败:', expect.anything());
    expect(() => jest.advanceTimersByTime(24 * 60 * 60 * 1000)).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    warn.mockRestore();
  });

  test('scheduled run also sends usage ping when enabled', async () => {
    delete process.env.USAGE_STATS;
    process.env.USAGE_STATS_URL = 'http://stats.test/api/metrics/install';
    jest.useFakeTimers();
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async (url: string) =>
      url === 'http://stats.test/api/metrics/install' ? ({ ok: true, status: 201 } as any) : ok(REMOTE_MD)) as any);
    const db = makeDb();
    startUpdateChecker(db);
    jest.advanceTimersByTime(60000);
    const urls = fetchSpy.mock.calls.map(c => String(c[0]));
    expect(urls).toContain('http://stats.test/api/metrics/install');
    expect(urls.filter(u => u === 'http://stats.test/api/metrics/install')).toHaveLength(1);
    fetchSpy.mockRestore();
  });

  test('usage ping skipped when usage_stats_enabled=false', () => {
    delete process.env.USAGE_STATS;
    process.env.USAGE_STATS_URL = 'http://stats.test/api/metrics/install';
    jest.useFakeTimers();
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation((async () => ok(REMOTE_MD)) as any);
    const db = makeDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('usage_stats_enabled', 'false')").run();
    startUpdateChecker(db);
    jest.advanceTimersByTime(60000);
    const urls = fetchSpy.mock.calls.map(c => String(c[0]));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls).not.toContain('http://stats.test/api/metrics/install');
    const st = getUpdateStatus(db);
    expect(st.usageStatsEnabled).toBe(false);
    expect(st.usageStatsEnvDisabled).toBe(false);
    fetchSpy.mockRestore();
  });

  test('status reports usage stats env switch', () => {
    process.env.USAGE_STATS = 'off';
    const st = getUpdateStatus(makeDb());
    expect(st.usageStatsEnabled).toBe(false);
    expect(st.usageStatsEnvDisabled).toBe(true);
    delete process.env.USAGE_STATS;
    expect(getUpdateStatus(makeDb()).usageStatsEnabled).toBe(true);
  });

  test('env off overrides setting', () => {
    process.env.UPDATE_CHECK = 'off';
    jest.useFakeTimers();
    const db = makeDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('system_notice_enabled', 'true')").run();
    expect(isNoticeEnabled(db)).toBe(false);
    applyUpdateCheckerSetting(db);
    startUpdateChecker(db);
    expect(jest.getTimerCount()).toBe(0);
    const st = getUpdateStatus(db);
    expect(st.noticeEnabled).toBe(false);
    expect(st.envDisabled).toBe(true);
  });
});
