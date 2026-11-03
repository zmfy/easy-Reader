import { AiPlugin, Book } from '../types';
import { buildFillPrompt } from './fill-prompt';

const claudePlugin: AiPlugin = {
  name: 'claude',
  label: 'Anthropic Claude',
  fields: ['apiKey', 'model'],

  async fillBookInfo(rawText: string, config: Record<string, string>, hint?: { title?: string; author?: string }): Promise<Partial<Book>> {
    const model = config.model || 'claude-3-haiku-20240307';

    const prompt = buildFillPrompt(rawText, config, hint);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) throw new Error(`Claude API error: ${resp.status}`);

    const data = await resp.json() as Record<string, unknown>;
    const content = (data.content as Array<{ text: string }>)[0]?.text || '{}';

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return {};
    }
  },

  async classifyBook(bookInfo: Partial<Book>, config: Record<string, string>): Promise<string> {
    const model = config.model || 'claude-3-haiku-20240307';


    const prompt = `书名：${bookInfo.title || '未知'}，简介：${bookInfo.summary || '无'}
请从以下分类中选一个最合适的：玄幻、修真、都市、历史、科幻、悬疑、言情、武侠、游戏、综合
只返回分类名，不需要解释。`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 50,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!resp.ok) throw new Error(`Claude API error: ${resp.status}`);

    const data = await resp.json() as Record<string, unknown>;
    return (data.content as Array<{ text: string }>)[0]?.text?.trim() || '综合';
  },

  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const model = config.model || 'claude-3-haiku-20240307';

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Claude API error: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    const content = (data.content as Array<{ text?: string }> | undefined)?.[0]?.text;
    return content || '';
  },
};

export default claudePlugin;
