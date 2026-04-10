import { AiPlugin, Book } from '../types';

const ollamaPlugin: AiPlugin = {
  name: 'ollama',
  label: 'Ollama 本地模型',
  fields: ['baseUrl', 'model'],

  async fillBookInfo(rawText: string, config: Record<string, string>): Promise<Partial<Book>> {
    const baseUrl = config.baseUrl || 'http://localhost:11434';
    const model = config.model || 'llama3';


    const prompt = `根据以下小说文本，请提取并返回JSON格式的书籍信息：
文本：${rawText.slice(0, 1000)}

请返回：{"title": "书名", "author": "作者", "summary": "100字以内简介", "category": "分类"}`;

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
};

export default ollamaPlugin;
