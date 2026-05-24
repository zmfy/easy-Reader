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

export const aiManager = {
  async fillBookInfo(rawText: string, db: Database.Database): Promise<Partial<Book>> {
    const active = getActivePlugin(db);
    if (!active) throw new Error('未配置 AI 插件');
    return active.plugin.fillBookInfo(rawText, active.config);
  },

  async classifyBook(bookInfo: Partial<Book>, db: Database.Database): Promise<string> {
    const active = getActivePlugin(db);
    if (!active) throw new Error('未配置 AI 插件');
    return active.plugin.classifyBook(bookInfo, active.config);
  },
};
