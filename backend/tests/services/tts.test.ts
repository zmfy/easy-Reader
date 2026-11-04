import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getTtsConfig, synthesizeSpeech, getSpeech, deleteTtsCache, DEFAULT_TTS_MODEL, DEFAULT_TTS_VOICE } from '../../src/services/tts';

function makeDb(settings: Record<string, string>) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  for (const [k, v] of Object.entries(settings)) db.prepare('INSERT INTO settings VALUES (?, ?)').run(k, v);
  return db;
}

function okResponse(hex = '494433') {
  return { ok: true, status: 200, json: async () => ({ data: { audio: hex, status: 2 }, base_resp: { status_code: 0, status_msg: 'success' } }) };
}

describe('getTtsConfig', () => {
  it('is enabled only when the MiniMax switch is on and a key is set, with defaults', () => {
    expect(getTtsConfig(makeDb({ ai_minmax_apiKey: 'k', ai_minmax_ttsEnabled: 'on' }))).toEqual({
      enabled: true, apiKey: 'k', model: DEFAULT_TTS_MODEL, voice: DEFAULT_TTS_VOICE,
    });
    expect(getTtsConfig(makeDb({ ai_minmax_apiKey: 'k' })).enabled).toBe(false);
    expect(getTtsConfig(makeDb({ ai_minmax_ttsEnabled: 'on' })).enabled).toBe(false);
  });

  it('uses the configured model and voice', () => {
    const c = getTtsConfig(makeDb({ ai_minmax_apiKey: 'k', ai_minmax_ttsEnabled: 'on', ai_minmax_ttsModel: 'speech-2.8-hd', ai_minmax_ttsVoice: 'female-chengshu' }));
    expect(c.model).toBe('speech-2.8-hd');
    expect(c.voice).toBe('female-chengshu');
  });
});

describe('synthesizeSpeech', () => {
  const cfg = { enabled: true, apiKey: 'k', model: 'speech-2.8-turbo', voice: 'v1' };

  it('posts the text with voice and compact mp3 settings and decodes the hex audio', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse('494433'));
    const buf = await synthesizeSpeech('你好', cfg, fetchImpl);
    expect(buf.toString()).toBe('ID3');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.minimax.cn/v1/t2a_v2');
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      model: 'speech-2.8-turbo', text: '你好', stream: false,
      voice_setting: { voice_id: 'v1', speed: 1 },
      audio_setting: { format: 'mp3', sample_rate: 24000, bitrate: 64000, channel: 1 },
    });
  });

  it('throws with the MiniMax message when status_code is not 0', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ base_resp: { status_code: 1004, status_msg: 'auth failed' } }) });
    await expect(synthesizeSpeech('你好', cfg, fetchImpl)).rejects.toThrow(/1004.*auth failed/);
  });

  it('reports network failures in plain words', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(synthesizeSpeech('你好', cfg, fetchImpl)).rejects.toThrow('连接不上 MiniMax 语音服务，请检查网络');
  });

  it('throws on HTTP errors', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(synthesizeSpeech('你好', cfg, fetchImpl)).rejects.toThrow(/500/);
  });
});

describe('getSpeech cache', () => {
  let root: string;
  const db = makeDb({ ai_minmax_apiKey: 'k', ai_minmax_ttsEnabled: 'on' });
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('synthesizes once and serves the cached file afterwards', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    const a = await getSpeech(db, 'book-1', '第一段', { root, fetchImpl });
    const b = await getSpeech(db, 'book-1', '第一段', { root, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a.equals(b)).toBe(true);
    expect(fs.readdirSync(path.join(root, 'book-1'))).toHaveLength(1);
  });

  it('shares one synthesis between concurrent requests for the same text', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    await Promise.all([getSpeech(db, 'book-1', '同一段', { root, fetchImpl }), getSpeech(db, 'book-1', '同一段', { root, fetchImpl })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('caches separately per voice', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    await getSpeech(db, 'book-1', '段', { root, fetchImpl });
    const other = makeDb({ ai_minmax_apiKey: 'k', ai_minmax_ttsEnabled: 'on', ai_minmax_ttsVoice: 'female-chengshu' });
    await getSpeech(other, 'book-1', '段', { root, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects when listening is disabled', async () => {
    await expect(getSpeech(makeDb({}), 'book-1', '段', { root, fetchImpl: jest.fn() })).rejects.toThrow();
  });

  it('deleteTtsCache removes the book folders and ignores unsafe ids', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    await getSpeech(db, 'book-1', '段', { root, fetchImpl });
    await getSpeech(db, 'book-2', '段', { root, fetchImpl });
    fs.writeFileSync(path.join(root, 'keep.txt'), 'x');
    deleteTtsCache(['book-1', '../keep.txt', '..'], root);
    expect(fs.existsSync(path.join(root, 'book-1'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'book-2'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'keep.txt'))).toBe(true);
  });
});
