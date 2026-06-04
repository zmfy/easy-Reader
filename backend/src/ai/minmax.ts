import { AiPlugin, Book } from '../types';
import { buildFillPrompt } from './fill-prompt';

// MiniMax - OpenAI 兼容接口，base URL: https://api.minimaxi.com/v1
// 当前可用模型：MiniMax-M2、MiniMax-M2.7、MiniMax-M2.7-highspeed 等
const minmaxPlugin: AiPlugin = {
  name: 'minmax',
  label: 'MiniMax',
  fields: ['apiKey', 'model'],
  placeholders: {
    model: 'MiniMax-M2 / MiniMax-M2.7 / MiniMax-M2.7-highspeed',
  },

  async fillBookInfo(rawText: string, config: Record<string, string>, hint?: { title?: string; author?: string }): Promise<Partial<Book>> {
    const model = config.model || 'MiniMax-M2';

    const prompt = buildFillPrompt(rawText, config, hint);

    const resp = await fetch('https://api.minimaxi.com/v1/chat/completions', {
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
    const model = config.model || 'MiniMax-M2';

    const prompt = `书名：${bookInfo.title || '未知'}，简介：${bookInfo.summary || '无'}
请从以下分类中选一个最合适的：玄幻、修真、都市、历史、科幻、悬疑、言情、武侠、游戏、综合
只返回分类名，不需要解释。`;

    const resp = await fetch('https://api.minimaxi.com/v1/chat/completions', {
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

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`MiniMax API error: ${resp.status} - ${errText}`);
    }

    const data = await resp.json() as Record<string, unknown>;
    const choices = data.choices as Array<{ message: { content: string } }> | null | undefined;
    return choices?.[0]?.message?.content?.trim() || '综合';
  },

  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const model = config.model || 'MiniMax-M2';

    const resp = await fetch('https://api.minimaxi.com/v1/chat/completions', {
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
