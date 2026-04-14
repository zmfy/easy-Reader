import { AiPlugin, Book } from '../types';

const claudePlugin: AiPlugin = {
  name: 'claude',
  label: 'Anthropic Claude',
  fields: ['apiKey', 'model'],

  async fillBookInfo(rawText: string, config: Record<string, string>): Promise<Partial<Book>> {
    const model = config.model || 'claude-3-haiku-20240307';


    const prompt = `你是一个熟悉中文网络小说的助手。请根据书名从你的知识库中查找该小说的准确信息，优先使用你已知的信息，不要从下方文本中分析。

${rawText}

只返回如下JSON格式，不含其他任何文字：
{"title":"正确书名","author":"作者名","summary":"100字左右的故事简介","category":"分类（玄幻/修真/都市/历史/科幻/悬疑/言情/武侠等）"}
如果不确定某字段，省略该字段，不要猜测。`;

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
};

export default claudePlugin;
