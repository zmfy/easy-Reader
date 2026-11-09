import { AiPlugin, Book } from '../types';
import { buildFillPrompt } from './fill-prompt';
import { parseFillResponse } from './json-extract';

// 模型：deepseek-flash / deepseek-v4-pro（https://api-docs.deepseek.com/zh-cn/quick_start/pricing）
// 两者默认开启思考模式；默认关闭以保持速度与费用，用户可在设置中开启并选择强度
// （https://api-docs.deepseek.com/zh-cn/guides/thinking_mode）
const DEFAULT_MODEL = 'deepseek-flash';

// thinking 为空 = 关闭；low / high / max = 开启并设置 reasoning_effort。
// 思考模式下 temperature 无效，只在关闭时传
function requestBody(prompt: string, config: Record<string, string>, temperature: number): string {
  const body: Record<string, unknown> = {
    model: config.model || DEFAULT_MODEL,
    messages: [{ role: 'user', content: prompt }],
  };
  if (config.thinking) {
    body.thinking = { type: 'enabled' };
    body.reasoning_effort = config.thinking;
  } else {
    body.thinking = { type: 'disabled' };
    body.temperature = temperature;
  }
  return JSON.stringify(body);
}

const deepseekPlugin: AiPlugin = {
  name: 'deepseek',
  label: 'DeepSeek',
  fields: ['apiKey', 'model', 'baseUrl', 'thinking'],
  placeholders: {
    model: 'deepseek-flash / deepseek-v4-pro',
    baseUrl: 'https://api.deepseek.com/v1',
    thinking: '关闭（默认）',
  },
  options: {
    thinking: [
      { value: '', label: '关闭（默认，速度快、费用低）' },
      { value: 'low', label: '开启 · low' },
      { value: 'high', label: '开启 · high' },
      { value: 'max', label: '开启 · max（最慢、最仔细）' },
    ],
  },

  async fillBookInfo(rawText: string, config: Record<string, string>, hint?: { title?: string; author?: string }): Promise<Partial<Book>> {
    const baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';

    const prompt = buildFillPrompt(rawText, config, hint);

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: requestBody(prompt, config, 0.3),
    });

    if (!resp.ok) throw new Error(`DeepSeek API error: ${resp.status}`);

    const data = await resp.json() as Record<string, unknown>;
    const content = ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content || '{}';

    return parseFillResponse(content, 'deepseek') as Partial<Book>;
  },

  async classifyBook(bookInfo: Partial<Book>, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';


    const prompt = `书名：${bookInfo.title || '未知'}，简介：${bookInfo.summary || '无'}
请从以下分类中选一个最合适的：玄幻、修真、都市、历史、科幻、悬疑、言情、武侠、游戏、综合
只返回分类名，不需要解释。`;

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: requestBody(prompt, config, 0.1),
    });

    if (!resp.ok) throw new Error(`DeepSeek API error: ${resp.status}`);

    const data = await resp.json() as Record<string, unknown>;
    return ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content?.trim() || '综合';
  },

  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: requestBody(prompt, config, 0.1),
    });

    if (!resp.ok) throw new Error(`DeepSeek API error: ${resp.status}`);

    const data = await resp.json() as Record<string, unknown>;
    return ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content || '';
  },
};

export default deepseekPlugin;
