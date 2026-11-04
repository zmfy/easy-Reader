// 听书：MiniMax 语音合成 + 按文本缓存音频（同一段重听不再计费）。
// 设计见 docs/superpowers/specs/2026-11-04-listen-book-design.md
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// https://platform.minimax.cn/docs/api-reference/speech-t2a-http
const T2A_URL = 'https://api.minimax.cn/v1/t2a_v2';
export const DEFAULT_TTS_MODEL = 'speech-2.8-turbo';
export const DEFAULT_TTS_VOICE = 'Chinese (Mandarin)_Radio_Host';
export const TTS_MAX_TEXT = 600;

export interface TtsConfig { enabled: boolean; apiKey: string; model: string; voice: string }

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** 听书配置在 MiniMax 插件设置里：开关为开且填了 Key 才可用（与当前选中的 AI 插件无关） */
export function getTtsConfig(db: Database.Database): TtsConfig {
  const get = (k: string) => (db.prepare('SELECT value FROM settings WHERE key = ?').get(`ai_minmax_${k}`) as { value?: string } | undefined)?.value || '';
  const apiKey = get('apiKey').trim();
  return {
    enabled: get('ttsEnabled') === 'on' && !!apiKey,
    apiKey,
    model: get('ttsModel') || DEFAULT_TTS_MODEL,
    voice: get('ttsVoice') || DEFAULT_TTS_VOICE,
  };
}

/** 调用 MiniMax 合成一段语音，返回 mp3。人声用 24kHz / 64kbps 足够，每小时约 30MB */
export async function synthesizeSpeech(text: string, cfg: TtsConfig, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<Buffer> {
  let resp: Awaited<ReturnType<FetchLike>>;
  try {
    resp = await fetchImpl(T2A_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        text,
        stream: false,
        voice_setting: { voice_id: cfg.voice, speed: 1, vol: 1, pitch: 0 },
        audio_setting: { format: 'mp3', sample_rate: 24000, bitrate: 64000, channel: 1 },
      }),
    });
  } catch (err) {
    // 网络层失败（断网、TLS 握手被断开等），原始信息只有「fetch failed」
    console.error('[tts] MiniMax request failed', err);
    throw new Error('连接不上 MiniMax 语音服务，请检查网络');
  }
  if (!resp.ok) throw new Error(`MiniMax 语音接口错误: HTTP ${resp.status}`);
  const data = await resp.json() as { data?: { audio?: string }; base_resp?: { status_code?: number; status_msg?: string } };
  const code = data.base_resp?.status_code;
  if (code !== 0) throw new Error(`MiniMax 语音合成失败: ${code ?? '未知'} ${data.base_resp?.status_msg ?? ''}`.trim());
  const hex = data.data?.audio;
  if (!hex) throw new Error('MiniMax 没有返回音频');
  return Buffer.from(hex, 'hex');
}

export function ttsCacheRoot(): string {
  return path.join(process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'tts-cache');
}

// 书 ID 只允许字母数字与连字符，防止拼出缓存目录之外的路径
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const inflight = new Map<string, Promise<Buffer>>();

/** 取一段文本的语音：先查缓存，没有再合成并写入；同一段并发请求只合成一次 */
export async function getSpeech(
  db: Database.Database,
  bookId: string,
  text: string,
  { root = ttsCacheRoot(), fetchImpl }: { root?: string; fetchImpl?: FetchLike } = {},
): Promise<Buffer> {
  const cfg = getTtsConfig(db);
  if (!cfg.enabled) throw new Error('听书功能未开启');
  if (!SAFE_ID.test(bookId)) throw new Error('无效的书籍 ID');

  const hash = crypto.createHash('sha1').update(`${cfg.model}\n${cfg.voice}\n${text}`).digest('hex');
  const dir = path.join(root, bookId);
  const file = path.join(dir, `${hash}.mp3`);
  if (fs.existsSync(file)) return fs.promises.readFile(file);

  const pending = inflight.get(file);
  if (pending) return pending;
  const job = (async () => {
    const audio = await synthesizeSpeech(text, cfg, fetchImpl);
    await fs.promises.mkdir(dir, { recursive: true });
    // 先写临时文件再改名，避免中途失败留下不完整的缓存
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, audio);
    await fs.promises.rename(tmp, file);
    return audio;
  })().finally(() => inflight.delete(file));
  inflight.set(file, job);
  return job;
}

/** 删书时删除对应的语音缓存目录 */
export function deleteTtsCache(bookIds: string[], root = ttsCacheRoot()): void {
  for (const id of bookIds) {
    if (!SAFE_ID.test(id)) continue;
    fs.rmSync(path.join(root, id), { recursive: true, force: true });
  }
}
