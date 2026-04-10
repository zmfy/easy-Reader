import { AiPlugin, Book } from '../types';

const deepseekPlugin: AiPlugin = {
  name: 'deepseek',
  label: 'DeepSeek',
  fields: ['apiKey', 'model', 'baseUrl'],
  placeholders: {
    model: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
  },

  async fillBookInfo(rawText: string, config: Record<string, string>): Promise<Partial<Book>> {
    const baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';
    const model = config.model || 'deepseek-chat';


    const prompt = `根据以下小说文本，请提取并返回JSON格式的书籍信息：
文本：${rawText.slice(0, 1000)}

请返回：{"title": "书名", "author": "作者", "summary": "100字以内简介", "category": "分类（如玄幻/都市/历史等）"}`;

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

    if (!resp.ok) throw new Error(`DeepSeek API error: ${resp.status}`);

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
    const baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';
    const model = config.model || 'deepseek-chat';


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

    if (!resp.ok) throw new Error(`DeepSeek API error: ${resp.status}`);

    const data = await resp.json() as Record<string, unknown>;
    return ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content?.trim() || '综合';
  },
};

export default deepseekPlugin;
