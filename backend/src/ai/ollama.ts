import { AiPlugin, Book } from '../types';
import { buildFillPrompt } from './fill-prompt';

// Ollama 本地模型 - 无需 API Key
// Docker 部署时容器内的 localhost 指向容器自身，需填宿主机地址
// （docker-compose 已配置 host.docker.internal → host-gateway）
const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3';

/** 解析 baseUrl / model，并去掉 baseUrl 末尾斜杠避免 `//api/chat`。 */
function resolve(config: Record<string, string>): { baseUrl: string; model: string } {
  return {
    baseUrl: (config.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    model: (config.model || DEFAULT_MODEL).trim(),
  };
}

/** 统一走 /api/chat（会套用模型自身的 chat template），非流式。 */
async function ollamaChat(prompt: string, config: Record<string, string>, temperature: number): Promise<string> {
  const { baseUrl, model } = resolve(config);

  const resp = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { temperature },
    }),
  });

  if (!resp.ok) throw new Error(`Ollama API error: ${resp.status}`);

  const data = await resp.json() as Record<string, unknown>;
  const msg = data.message as { content?: string } | undefined;
  return msg?.content || '';
}

const ollamaPlugin: AiPlugin = {
  name: 'ollama',
  label: 'Ollama 本地模型',
  fields: ['baseUrl', 'model'],
  placeholders: {
    baseUrl: 'http://localhost:11434（Docker 部署填 host.docker.internal）',
    model: 'llama3 / qwen2.5 / gemma3',
  },

  async fillBookInfo(rawText: string, config: Record<string, string>, hint?: { title?: string; author?: string }): Promise<Partial<Book>> {
    const content = await ollamaChat(buildFillPrompt(rawText, config, hint), config, 0.3);

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      return {};
    }
  },

  async classifyBook(bookInfo: Partial<Book>, config: Record<string, string>): Promise<string> {
    const prompt = `书名：${bookInfo.title || '未知'}，简介：${bookInfo.summary || '无'}
请从以下分类中选一个最合适的：玄幻、修真、都市、历史、科幻、悬疑、言情、武侠、游戏、综合
只返回分类名，不需要解释。`;

    const content = await ollamaChat(prompt, config, 0.1);
    return content.trim() || '综合';
  },

  async chat(prompt: string, config: Record<string, string>): Promise<string> {
    return ollamaChat(prompt, config, 0.1);
  },
};

export default ollamaPlugin;
