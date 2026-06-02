import { AiPlugin, Book } from '../types';

// MiniMax - OpenAI 兼容接口，base URL: https://api.minimaxi.com/v1
// 当前可用模型：MiniMax-M2、MiniMax-M2.7、MiniMax-M2.7-highspeed 等
const minmaxPlugin: AiPlugin = {
  name: 'minmax',
  label: 'MiniMax',
  fields: ['apiKey', 'model'],
  placeholders: {
    model: 'MiniMax-M2 / MiniMax-M2.7 / MiniMax-M2.7-highspeed',
  },

  async fillBookInfo(rawText: string, config: Record<string, string>): Promise<Partial<Book>> {
    const model = config.model || 'MiniMax-M2';

    const summaryLen = parseInt(config.summary_length ?? '100') || 100;
    const prompt = `你是一个熟悉中文网络小说的助手。请根据书名从你的知识库中查找该小说的准确信息，优先使用你已知的信息，不要从下方文本中分析。

${rawText}

只返回如下JSON格式，不含其他任何文字：
{"title":"正确书名","author":"作者名","summary":"${summaryLen}字左右的故事简介","category":"分类（玄幻/修真/都市/历史/科幻/悬疑/言情/武侠等）","is_finished":true,"platform":"首发连载平台（如起点中文网）","start_date":"开始连载年月（如2007年12月）","end_date":"完本年月（已完结时填写，如2023年8月）","recommended_tags":["标签1","标签2","标签3"],"similar_works":[{"title":"类似书1","author":"作者","reason":"相似原因"},{"title":"类似书2","author":"作者","reason":"相似原因"}]}
is_finished为true表示已完结，false表示连载中。如果不确定某字段，省略该字段，不要猜测。`;

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
