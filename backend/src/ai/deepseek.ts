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


    const summaryLen = parseInt(config.summary_length ?? '100') || 100;
    const prompt = `你是一个熟悉中文网络小说的助手。请根据书名从你的知识库中查找该小说的准确信息，优先使用你已知的信息，不要从下方文本中分析。

${rawText}

只返回如下JSON格式，不含其他任何文字：
{"title":"正确书名","author":"作者名","summary":"${summaryLen}字左右的故事简介","category":"分类（玄幻/修真/都市/历史/科幻/悬疑/言情/武侠等）","is_finished":true,"platform":"首发连载平台（如起点中文网）","start_date":"开始连载年月（如2007年12月）","end_date":"完本年月（已完结时填写，如2023年8月）"}
is_finished为true表示已完结，false表示连载中。如果不确定某字段，省略该字段，不要猜测。`;

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

  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    const baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';
    const model = config.model || 'deepseek-chat';

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
    return ((data.choices as Array<{ message: { content: string } }> | null | undefined))?.[0]?.message?.content || '';
  },
};

export default deepseekPlugin;
