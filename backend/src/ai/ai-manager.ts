import Database from 'better-sqlite3';
import { AiPlugin, Book } from '../types';
import deepseekPlugin from './deepseek';
import minmaxPlugin from './minmax';

export const aiPlugins: AiPlugin[] = [
  deepseekPlugin,
  minmaxPlugin,
];

function getActivePlugin(db: Database.Database): { plugin: AiPlugin; config: Record<string, string> } | null {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;

  const pluginName = settings['ai_plugin'];
  if (!pluginName) return null;

  const plugin = aiPlugins.find(p => p.name === pluginName);
  if (!plugin) return null;

  const config: Record<string, string> = {};
  for (const field of plugin.fields) {
    const value = settings[`ai_${pluginName}_${field}`];
    if (value) config[field] = value;
  }

  return { plugin, config };
}

export interface AiDedupCandidate {
  index: number;
  title: string;
  author?: string;
  chapter_count?: number;
  first_chapter_preview: string;   // 第一章前 300 字
}

export interface AiDedupResult {
  /** 按 input 数组 index 引用；每组的 canonical_index + duplicate_indices */
  groups: Array<{
    canonical_index: number;
    duplicate_indices: number[];
  }>;
}

export interface AiSeriesCandidate {
  index: number;
  title: string;
  author?: string;
}

export interface AiSeriesResult {
  is_series: boolean;
  series_name?: string;
  /** 按 input index 引用的成员顺序 */
  members?: Array<{ index: number; sequence: number }>;
  confidence?: 'high' | 'medium' | 'low';
}

function readSummaryLength(db: Database.Database): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai_summary_length'").get() as
    | { value: string }
    | undefined;
  const n = parseInt(row?.value ?? '100', 10);
  if (!Number.isFinite(n) || n < 30 || n > 1000) return '100';
  return String(n);
}

export const aiManager = {
  async fillBookInfo(rawText: string, db: Database.Database): Promise<Partial<Book>> {
    const active = getActivePlugin(db);
    if (!active) throw new Error('未配置 AI 插件');
    return active.plugin.fillBookInfo(rawText, {
      ...active.config,
      summary_length: readSummaryLength(db),
    });
  },

  async classifyBook(bookInfo: Partial<Book>, db: Database.Database): Promise<string> {
    const active = getActivePlugin(db);
    if (!active) throw new Error('未配置 AI 插件');
    return active.plugin.classifyBook(bookInfo, active.config);
  },

  async chat(prompt: string, db: Database.Database): Promise<string> {
    const active = getActivePlugin(db);
    if (!active) throw new Error('未配置 AI 插件');
    return active.plugin.chat(prompt, active.config);
  },

  async judgeDuplicates(
    candidates: AiDedupCandidate[],
    db: Database.Database,
  ): Promise<AiDedupResult> {
    if (candidates.length < 2) return { groups: [] };
    const prompt = buildDedupPrompt(candidates);
    const raw = await this.chat(prompt, db);
    return parseDedupResponse(raw, candidates.length);
  },

  async judgeSeries(
    candidates: AiSeriesCandidate[],
    db: Database.Database,
  ): Promise<AiSeriesResult> {
    if (candidates.length < 2) return { is_series: false };
    const prompt = buildSeriesPrompt(candidates);
    const raw = await this.chat(prompt, db);
    return parseSeriesResponse(raw, candidates.length);
  },

  async judgeGarbled(sample: string, db: Database.Database): Promise<{ is_garbled: boolean; reason?: string }> {
    if (!sample || sample.trim().length === 0) return { is_garbled: true, reason: 'empty sample' };
    const prompt = `下面是一段从文件中读出的文本（前 512 字符）。请判断这是否为乱码：

---
${sample.slice(0, 512)}
---

判定准则：
- 正常的中文小说内容（即使有少量繁体字、古文、罕用字、夹杂英文）= 不是乱码
- 完全无法阅读的随机字符 / 大段问号方框 / 字符错位 = 乱码

请按以下 JSON 格式返回，**只输出 JSON**：
{"is_garbled": true, "reason": "简短说明"}
或
{"is_garbled": false}`;
    try {
      const raw = await this.chat(prompt, db);
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return { is_garbled: true, reason: 'AI response unparseable' };
      const parsed = JSON.parse(m[0]) as { is_garbled?: boolean; reason?: string };
      return { is_garbled: parsed.is_garbled !== false, reason: parsed.reason };
    } catch (err) {
      return { is_garbled: true, reason: (err as Error).message };
    }
  },
};

function buildDedupPrompt(candidates: AiDedupCandidate[]): string {
  const blocks = candidates.map((c, i) => (
    `[#${i}]\n书名：${c.title}\n作者：${c.author ?? '未知'}\n章节数：${c.chapter_count ?? '?'}\n第一章节选：${c.first_chapter_preview.slice(0, 300)}`
  )).join('\n---\n');
  return `下面有 ${candidates.length} 本疑似重复的小说，请判断哪些是同一本书的不同版本（哪怕排版/章节标题略有不同）。

${blocks}

请按以下 JSON 格式返回，**只输出 JSON，不要任何其他文字**：
{"groups":[{"canonical_index":0,"duplicate_indices":[2,3]}]}

判定准则（必须严格遵守）：
- **同一本书**：书名、作者、第一章内容基本一致即可（章节数可以不同——常见的是同一本书有不同版本，章节数不同但都是同一本书）。
- canonical_index **必须选章节数最多的那本**（最完整版本）。
- duplicate_indices 是除 canonical 外的同一本书的其他版本。
- 如果没有任何重复，返回 {"groups":[]}。
- 不要把不同书名/作者明显不同的书归到同一组。`;
}

function parseDedupResponse(raw: string, total: number): AiDedupResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { groups: [] };
    const parsed = JSON.parse(jsonMatch[0]) as AiDedupResult;
    // sanity check indices
    const valid = (parsed.groups ?? []).filter(g =>
      g.canonical_index >= 0 && g.canonical_index < total &&
      g.duplicate_indices.every(i => i >= 0 && i < total && i !== g.canonical_index)
    );
    return { groups: valid };
  } catch {
    return { groups: [] };
  }
}

function buildSeriesPrompt(candidates: AiSeriesCandidate[]): string {
  const blocks = candidates.map((c, i) => `[#${i}] 书名：${c.title} | 作者：${c.author ?? '未知'}`).join('\n');
  return `下面有 ${candidates.length} 本书，请判断它们是否属于同一个系列（如《女生宿舍 1》《女生宿舍 2》《女生宿舍 3》算一个系列）。

${blocks}

请按以下 JSON 格式返回，**只输出 JSON**：
{"is_series": true, "series_name": "女生宿舍", "members": [{"index": 0, "sequence": 1}, {"index": 1, "sequence": 2}], "confidence": "high"}

或如果不是系列：{"is_series": false}

约定：
- series_name 是去除编号后的公共部分
- sequence 是该书在系列中的序号（从 1 开始）
- confidence: high / medium / low
- 同作者 + 标题仅尾缀不同 → high
- 标题相似但作者不同 → low 或 is_series:false`;
}

function parseSeriesResponse(raw: string, total: number): AiSeriesResult {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { is_series: false };
    const parsed = JSON.parse(jsonMatch[0]) as AiSeriesResult;
    if (!parsed.is_series) return { is_series: false };
    const members = (parsed.members ?? []).filter(m =>
      m.index >= 0 && m.index < total && m.sequence > 0
    );
    if (members.length < 2) return { is_series: false };
    return {
      is_series: true,
      series_name: parsed.series_name,
      members,
      confidence: parsed.confidence ?? 'medium',
    };
  } catch {
    return { is_series: false };
  }
}
