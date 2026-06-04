import { AiPlugin, Book } from '../types';
import { buildFillPrompt } from './fill-prompt';

// 通义千问（阿里云百炼）- 兼容 OpenAI 格式
const qwenPlugin: AiPlugin = {
  name: 'qwen',
  label: '通义千问（阿里云）',
  fields: ['apiKey', 'model', 'baseUrl'],
  placeholders: {
    model: 'qwen-plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },

  async fillBookInfo(rawText: string, config: Record<string, string>, hint?: { title?: string; author?: string }): Promise<Partial<Book>> {
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = config.model || 'qwen-plus';

    const prompt = buildFillPrompt(rawText, config, hint);

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      }),
    });

    if (!resp.ok) throw new Error(`通义千问 API error: ${resp.status}`);

    const data = await resp.json() as Record<string, unknown>;
    const content = ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content || '{}';

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return {};
    }
  },

  async classifyBook(bookInfo: Partial<Book>, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = config.model || 'qwen-plus';


    const prompt = `书名：${bookInfo.title || '未知'}，简介：${bookInfo.summary || '无'}
请从以下分类中选一个最合适的：玄幻、修真、都市、历史、科幻、悬疑、言情、武侠、游戏、综合
只返回分类名，不需要解释。`;

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });

    if (!resp.ok) throw new Error(`通义千问 API error: ${resp.status}`);

    const data = await resp.json() as Record<string, unknown>;
    return ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content?.trim() || '综合';
  },

  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = config.model || 'qwen-plus';

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
    });
    if (!resp.ok) throw new Error(`通义千问 API error: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content || '';
  },
};

export default qwenPlugin;
