import Database from 'better-sqlite3';
import {
  getInstanceId,
  buildUsagePayload,
  isUsageStatsEnabled,
  isUsageStatsEnvDisabled,
  usageStatsUrl,
  sendUsagePing,
} from '../../src/services/usage-ping';
import { EDITION } from '../../src/edition';

function makeDb() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  return db;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ENV_KEYS = ['USAGE_STATS', 'USAGE_STATS_URL'];
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => { ENV_KEYS.forEach(k => { savedEnv[k] = process.env[k]; delete process.env[k]; }); });
afterEach(() => { ENV_KEYS.forEach(k => { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }); });

describe('getInstanceId', () => {
  test('首次生成随机 UUID 并保存，之后复用', () => {
    const db = makeDb();
    const id = getInstanceId(db);
    expect(id).toMatch(UUID_RE);
    expect(getInstanceId(db)).toBe(id);
    expect(getInstanceId(makeDb())).not.toBe(id);
  });
});

describe('buildUsagePayload', () => {
  test('只包含 id / edition / version / arch 四个字段', () => {
    const db = makeDb();
    const p = buildUsagePayload(db);
    expect(Object.keys(p).sort()).toEqual(['arch', 'edition', 'id', 'version']);
    expect(p.id).toBe(getInstanceId(db));
    expect(p.edition).toBe(EDITION);
    expect(p.arch).toBe(process.arch);
    expect(typeof p.version).toBe('string');
    expect(p.version.length).toBeGreaterThan(0);
  });
});

describe('开关', () => {
  test('缺省开启', () => {
    expect(isUsageStatsEnabled(makeDb())).toBe(true);
    expect(isUsageStatsEnvDisabled()).toBe(false);
  });
  test('设置 usage_stats_enabled=false 时关闭', () => {
    const db = makeDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('usage_stats_enabled', 'false')").run();
    expect(isUsageStatsEnabled(db)).toBe(false);
  });
  test('环境变量 USAGE_STATS=off 为总开关', () => {
    process.env.USAGE_STATS = 'off';
    const db = makeDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('usage_stats_enabled', 'true')").run();
    expect(isUsageStatsEnvDisabled()).toBe(true);
    expect(isUsageStatsEnabled(db)).toBe(false);
  });
  test('USAGE_STATS_URL 可覆盖地址', () => {
    expect(usageStatsUrl()).toBe('https://easyreader.ucool.uk/api/metrics/install');
    process.env.USAGE_STATS_URL = 'http://127.0.0.1:9/api/metrics/install';
    expect(usageStatsUrl()).toBe('http://127.0.0.1:9/api/metrics/install');
  });
});

describe('sendUsagePing', () => {
  test('POST JSON，正文就是 payload', async () => {
    const db = makeDb();
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 201 }));
    expect(await sendUsagePing(db, fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl.mock.calls[0] as unknown) as [string, any];
    expect(url).toBe(usageStatsUrl());
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual(buildUsagePayload(db));
  });
  test('关闭时不发送', async () => {
    const db = makeDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('usage_stats_enabled', 'false')").run();
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 201 }));
    expect(await sendUsagePing(db, fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  test('请求失败、非 2xx、超时都不抛错', async () => {
    const db = makeDb();
    expect(await sendUsagePing(db, async () => { throw new Error('ECONNREFUSED'); })).toBe(false);
    expect(await sendUsagePing(db, async () => ({ ok: false, status: 500 }))).toBe(false);
    expect(await sendUsagePing(db, () => new Promise(() => {}), 20)).toBe(false);
  });
});
