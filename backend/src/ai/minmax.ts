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

const minmaxPlugin: AiPlugin = {
  name: 'minmax',
  label: 'MiniMax',
  fields: ['apiKey', 'model', 'reasoningEffort'],
  placeholders: {
    model: 'MiniMax-M3.1-Flash / MiniMax-M3',
    reasoningEffort: '默认（max）',
  },
  options: {
    reasoningEffort: [
      { value: '', label: '默认（max）' },
      { value: 'low', label: 'low（最快、消耗最少）' },
      { value: 'medium', label: 'medium' },
      { value: 'high', label: 'high' },
      { value: 'xhigh', label: 'xhigh' },
      { value: 'max', label: 'max（最慢、最仔细）' },
    ],
  },

  async fillBookInfo(rawText: string, config: Record<string, string>, hint?: { title?: string; author?: string }): Promise<Partial<Book>> {
    const prompt = buildFillPrompt(rawText, config, hint);

    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: requestBody(prompt, config),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`MiniMax API error: ${resp.status} - ${errText}`);
    }

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

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`MiniMax API error: ${resp.status} - ${errText}`);
    }

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
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`MiniMax API error: ${resp.status} - ${errText}`);
    }
    const data = await resp.json() as Record<string, unknown>;
    const choices = data.choices as Array<{ message: { content: string } }> | null | undefined;
    return choices?.[0]?.message?.content || '';
  },
};

export default minmaxPlugin;
