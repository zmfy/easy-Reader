export interface FillHint { title?: string; author?: string }

export type FillConfidence = 'high' | 'medium' | 'low';

/**
 * 构造 fillBookInfo 的 prompt（各插件共用，避免分叉）。
 * evidence：文件名 + 文件内置书目信息 + 正文节选（见 services/book-evidence.ts）。
 * config.categories：分类树的全部路径，逗号分隔（由 aiManager 注入）。
 */
export function buildFillPrompt(
  evidence: string,
  config: Record<string, string>,
  hint?: FillHint,
): string {
  const summaryLen = parseInt(config.summary_length ?? '100') || 100;
  const known: string[] = [];
  if (hint?.title) known.push(`书名：《${hint.title}》`);
  if (hint?.author) known.push(`作者：${hint.author}`);
  const knownBlock = known.length
    ? `【已知信息】${known.join('，')}。若依据表明不是这本书，或无法确认，请将 author 与 summary 都留空。\n`
    : '';
  const categories = (config.categories ?? '').split(',').map(c => c.trim()).filter(Boolean);
  const categoryRule = categories.length
    ? `category 必须从下面的分类路径中原样选一个（尽量选到最细一级；拿不准时选上一级；都不合适选「其他」）：\n${categories.join('\n')}`
    : 'category 给出一个简短的中文分类。';

  return `你是个人书库的图书管理员，负责整理书目信息。这本书可能是网络小说，也可能是出版小说、文集、非虚构、漫画等任何出版物，不要预设类型。
判断依据的优先级：① 正文节选（版权页、目录、作者署名最可靠）② 文件内置书目信息 ③ 文件名 ④ 你自己的知识。
你的知识与 ①②③ 冲突时以它们为准；你的知识只能用来补充，且必须确认是同一本书。宁可留空，不要猜测。
${knownBlock}
${evidence}

${categoryRule}
只返回如下 JSON，不含其他任何文字：
{"title":"规范书名（去掉营销语、册数说明等）","author":"作者（译著只写原作者，可保留国籍如[英]）","book_type":"网络小说/出版小说/非虚构/漫画/其他","summary":"${summaryLen}字左右的内容简介","category":"分类路径（如 小说/中国古典小说）","is_finished":true,"recommended_tags":["标签1","标签2","标签3"],"similar_works":[{"title":"类似书","author":"作者","reason":"相似原因"}],"confidence":{"title":"high","author":"high","summary":"medium","category":"high"},"evidence":{"author":"依据（如：版权页署名）","summary":"依据","category":"依据"},"filename_matches":true,"mismatch_reason":"","content_title":"","content_author":""}
规则：
- 文件名或内置书名表明是套装/合集/全集/丛书时，title 用整套的名字，不要用正文开头某一册的书名；summary 介绍整套内容；各册作者不同时 author 留空（有主编则写主编）。
- confidence 取 high / medium / low：依据中直接写明为 high；由正文内容推断为 medium；只凭书名和你的知识为 low。
- 只有网络小说才额外填写 "platform"（首发平台）、"start_date"、"end_date"（连载起止年月），其他类型不要填。
- is_finished：网络小说表示是否完结；出版物填 true。
- filename_matches：正文与文件名是不是同一部作品。套装 / 合集改名、营销语、简繁体、缺作者、合集名与其中某册书名不同，都**不算**不符，填 true；只有正文明显是另一部作品（如文件名是《三国演义》，正文却是另一部网络小说）才填 false，并在 mismatch_reason 里用一句话说明，在 content_title / content_author 里填正文实际的书名和作者（不要填文件名上的）。拿不准时填 true。
- 所有文字使用简体中文，不要夹杂英文单词（书名、人名原文本身是外文的除外）。
- 不确定的字段直接省略。`;
}

/** 取 AI 返回的某字段置信度；未给出视为 medium（兼容不按格式返回的模型） */
export function fieldConfidence(info: Record<string, unknown>, field: string): FillConfidence {
  const conf = info.confidence;
  const v = conf && typeof conf === 'object' ? (conf as Record<string, unknown>)[field] : undefined;
  return v === 'high' || v === 'low' ? v : 'medium';
}

/** AI 判定正文与文件名不是同一部作品（书名依据不是低置信时才算），返回正文实际的书名等；否则 undefined */
export function detectContentMismatch(info: Record<string, unknown>): { title: string; author?: string; reason?: string } | undefined {
  if (info.filename_matches !== false) return undefined;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  // 优先用专门的 content_title / content_author：模型有时会在 title 里沿用文件名上的书名
  const title = text(info.content_title) || text(info.title);
  if (!title || fieldConfidence(info, 'title') === 'low') return undefined;
  const author = text(info.content_author) || text(info.author) || undefined;
  const reason = typeof info.mismatch_reason === 'string' && info.mismatch_reason.trim() ? info.mismatch_reason.trim().slice(0, 200) : undefined;
  return { title, ...(author ? { author } : {}), ...(reason ? { reason } : {}) };
}
