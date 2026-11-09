import { AiPlugin, Book } from '../types';
import { buildFillPrompt } from './fill-prompt';

// MiniMax - OpenAI 兼容接口（https://platform.minimax.cn/docs/api-reference/text-openai-api）
// 当前可用模型：MiniMax-M3.1-Flash、MiniMax-M3（MiniMax-M2 系列已下线，返回 2069）
// temperature 已不可调（固定为 1，传入会被忽略），因此不再传递
const CHAT_URL = 'https://api.minimax.cn/v1/chat/completions';
const DEFAULT_MODEL = 'MiniMax-M3.1-Flash';

// 推理强度（reasoning_effort）：仅 MiniMax-M3.1-Flash 生效，其他模型会忽略；不设置时官方默认 max
function requestBody(prompt: string, config: Record<string, string>): string {
  const body: Record<string, unknown> = {
    model: config.model || DEFAULT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  };
  if (config.reasoningEffort) body.reasoning_effort = config.reasoningEffort;
  return JSON.stringify(body);
}

// 2069：模型已下线 / 不可用（如 MiniMax-M2 系列）
async function apiError(resp: { status: number; text(): Promise<string> }, config: Record<string, string>): Promise<Error> {
  const errText = await resp.text();
  let code: unknown;
  try { code = JSON.parse(errText)?.base_resp?.status_code; } catch { /* 非 JSON */ }
  if (code === 2069 || /"status_code"\s*:\s*"?2069"?/.test(errText)) {
    return new Error(`MiniMax 模型「${config.model || DEFAULT_MODEL}」已下线或不可用，请到「设置 → AI 插件」重新选择模型`);
  }
  return new Error(`MiniMax API error: ${resp.status} - ${errText}`);
}

const minmaxPlugin: AiPlugin = {
  name: 'minmax',
  label: 'MiniMax',
  // 听书（ttsEnabled / ttsModel / ttsVoice）：语音合成见 services/tts.ts，与当前选中的 AI 插件无关
  fields: ['apiKey', 'model', 'reasoningEffort', 'ttsEnabled', 'ttsModel', 'ttsVoice'],
  placeholders: {
    model: 'MiniMax-M3.1-Flash / MiniMax-M3',
    reasoningEffort: '默认（max）',
    ttsEnabled: '关闭',
    ttsModel: 'speech-2.8-turbo',
    ttsVoice: '电台男主播',
  },
  options: {
    ttsEnabled: [
      { value: '', label: '关闭' },
      { value: 'on', label: '开启（阅读器显示「听书」）' },
    ],
    ttsModel: [
      { value: '', label: 'speech-2.8-turbo（约 2 元 / 万字符）' },
      { value: 'speech-2.8-hd', label: 'speech-2.8-hd（音质更好，约 3.5 元 / 万字符）' },
    ],
    ttsVoice: [
      { value: '', label: '电台男主播（默认）' },
      { value: 'Chinese (Mandarin)_Gentleman', label: '温润男声' },
      { value: 'Chinese (Mandarin)_Male_Announcer', label: '播报男声' },
      { value: 'Chinese (Mandarin)_Sincere_Adult', label: '真诚青年' },
      { value: 'Chinese (Mandarin)_Lyrical_Voice', label: '抒情男声' },
      { value: 'Chinese (Mandarin)_Reliable_Executive', label: '沉稳高管' },
      { value: 'Chinese (Mandarin)_Gentle_Senior', label: '温柔学姐' },
      { value: 'Chinese (Mandarin)_News_Anchor', label: '新闻女声' },
      { value: 'Chinese (Mandarin)_Wise_Women', label: '阅历姐姐' },
      { value: 'Chinese (Mandarin)_Warm_Girl', label: '温暖少女' },
      { value: 'female-chengshu', label: '成熟女性' },
    ],
    reasoningEffort: [
      { value: '', label: '默认（max）' },
      { value: 'low', label: 'low（最快、消耗最少）' },
      { value: 'medium', label: 'medium' },
      { value: 'high', label: 'high' },
      { value: 'xhigh', label: 'xhigh' },
      { value: 'max', label: 'max（最慢、最仔细）' },
    ],
  },

  // MiniMax-M2 系列已下线：仍保存着旧模型名时提醒用户重新设置
  configWarning(config: Record<string, string>): string | null {
    if ((config.model || '').trim().toLowerCase().startsWith('minimax-m2')) {
      return `MiniMax-M2 系列模型已下线，请在「设置 → AI 插件」中重新选择模型（清空模型即使用默认的 ${DEFAULT_MODEL}）`;
    }
    return null;
  },

  async fillBookInfo(rawText: string, config: Record<string, string>, hint?: { title?: string; author?: string }): Promise<Partial<Book>> {
    const prompt = buildFillPrompt(rawText, config, hint);

    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      // 填充是依据书目信息整理，不需要深度推理：未设置推理强度时用 low（默认 max 一本要一两分钟）
      body: requestBody(prompt, { reasoningEffort: 'low', ...config }),
    });

    if (!resp.ok) throw await apiError(resp, config);

    const data = await resp.json() as Record<string, unknown>;
    const choices = data.choices as Array<{ message: { content: string } }> | null | undefined;
    const content = choices?.[0]?.message?.content || '{}';

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return {};
    }
  },

  async classifyBook(bookInfo: Partial<Book>, config: Record<string, string>): Promise<string> {
    const prompt = `书名：${bookInfo.title || '未知'}，简介：${bookInfo.summary || '无'}
请从以下分类中选一个最合适的：玄幻、修真、都市、历史、科幻、悬疑、言情、武侠、游戏、综合
只返回分类名，不需要解释。`;

    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: requestBody(prompt, config),
    });

    if (!resp.ok) throw await apiError(resp, config);

    const data = await resp.json() as Record<string, unknown>;
    const choices = data.choices as Array<{ message: { content: string } }> | null | undefined;
    return choices?.[0]?.message?.content?.trim() || '综合';
  },

  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: requestBody(prompt, config),
    });
    if (!resp.ok) throw await apiError(resp, config);
    const data = await resp.json() as Record<string, unknown>;
    const choices = data.choices as Array<{ message: { content: string } }> | null | undefined;
    return choices?.[0]?.message?.content || '';
  },
};

export default minmaxPlugin;
