import { AiPlugin, Book } from '../types';
import { buildFillPrompt } from './fill-prompt';

const ollamaPlugin: AiPlugin = {
  name: 'ollama',
  label: 'Ollama 本地模型',
  fields: ['baseUrl', 'model'],

  async fillBookInfo(rawText: string, config: Record<string, string>, hint?: { title?: string; author?: string }): Promise<Partial<Book>> {
    const baseUrl = config.baseUrl || 'http://localhost:11434';
    const model = config.model || 'llama3';

    const prompt = buildFillPrompt(rawText, config, hint);

    const resp = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });

    if (!resp.ok) throw new Error(`Ollama API error: ${resp.status}`);

    const data = await resp.json() as { response: string };
    try {
      const jsonMatch = data.response.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return {};
    }
  },

  async classifyBook(bookInfo: Partial<Book>, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'http://localhost:11434';
    const model = config.model || 'llama3';


    const prompt = `书名：${bookInfo.title || '未知'}，简介：${bookInfo.summary || '无'}
请从以下分类中选一个最合适的：玄幻、修真、都市、历史、科幻、悬疑、言情、武侠、游戏、综合
只返回分类名。`;

    const resp = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });

    if (!resp.ok) throw new Error(`Ollama API error: ${resp.status}`);

    const data = await resp.json() as { response: string };
    return data.response?.trim() || '综合';
  },

  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'http://localhost:11434';
    const model = config.model || 'llama3';
    const resp = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { temperature: 0.1 },
      }),
    });
    if (!resp.ok) throw new Error(`Ollama API error: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    const msg = data.message as { content?: string } | undefined;
    return msg?.content || '';
  },
};

export default ollamaPlugin;
