export interface FillHint { title?: string; author?: string }

/** 构造 fillBookInfo 的 prompt（6 个插件共用，避免分叉）。 */
export function buildFillPrompt(
  rawText: string,
  config: Record<string, string>,
  hint?: FillHint,
): string {
  const summaryLen = parseInt(config.summary_length ?? '100') || 100;
  const known: string[] = [];
  if (hint?.title) known.push(`书名：《${hint.title}》`);
  if (hint?.author) known.push(`作者：${hint.author}`);
  const knownBlock = known.length
    ? `已知信息：${known.join('，')}。请据此从你的知识库中查找该小说；若无法确认是这本书，请将 author 与 summary 都留空，不要猜测。\n`
    : '';
  return `你是一个熟悉中文网络小说的助手。请根据书名从你的知识库中查找该小说的准确信息，优先使用你已知的信息，不要从下方文本中分析。
${knownBlock}
${rawText}

只返回如下JSON格式，不含其他任何文字：
{"title":"正确书名","author":"作者名","summary":"${summaryLen}字左右的故事简介","category":"分类（玄幻/修真/都市/历史/科幻/悬疑/言情/武侠等）","is_finished":true,"platform":"首发连载平台（如起点中文网）","start_date":"开始连载年月（如2007年12月）","end_date":"完本年月（已完结时填写，如2023年8月）","recommended_tags":["标签1","标签2","标签3"],"similar_works":[{"title":"类似书1","author":"作者","reason":"相似原因"},{"title":"类似书2","author":"作者","reason":"相似原因"}]}
is_finished为true表示已完结，false表示连载中。如果不确定某字段，省略该字段，不要猜测。`;
}
