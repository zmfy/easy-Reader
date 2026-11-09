/**
 * 从模型回复中取出第一个完整的 JSON 对象。
 *
 * 不用贪婪正则 /\{[\s\S]*\}/：模型偶尔会把同一个对象连续输出两遍（`{...}{...}`），
 * 或在 JSON 后附带含花括号的说明，贪婪匹配会把它们拼在一起导致解析失败。
 * 这里按括号配对（跳过字符串内的括号与转义）逐个取顶层对象，返回第一个能解析的。
 */
export function extractJsonObject(text: string): Record<string, unknown> | undefined {
  let start = text.indexOf('{');
  while (start !== -1) {
    const end = matchingBrace(text, start);
    if (end === -1) return undefined;  // 没有闭合（如输出被截断），不去猜里面的子对象
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* 这一段不是合法 JSON，继续找后面的顶层对象 */ }
    start = text.indexOf('{', end + 1);
  }
  return undefined;
}

function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

/** 书目填充的回复：取不到 JSON 时记一条警告（便于排查「AI 填充没有结果」）并返回空对象 */
export function parseFillResponse(content: string, plugin: string): Record<string, unknown> {
  const parsed = extractJsonObject(content);
  if (!parsed) {
    console.warn(`[ai-fill] ${plugin} 回复中没有可解析的 JSON：${content.replace(/\s+/g, ' ').slice(0, 300)}`);
    return {};
  }
  return parsed;
}
