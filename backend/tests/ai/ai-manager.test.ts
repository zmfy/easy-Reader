import Database from 'better-sqlite3';
import { aiPlugins, isAiConfigured } from '../../src/ai/ai-manager';

function makeDb(settings: Record<string, string> = {}): Database.Database {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  const ins = d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(settings)) ins.run(k, v);
  return d;
}

describe('isAiConfigured', () => {
  it('false when no ai_plugin is selected', () => {
    expect(isAiConfigured(makeDb())).toBe(false);
  });

  it('false when ai_plugin is set to an unknown plugin', () => {
    expect(isAiConfigured(makeDb({ ai_plugin: 'nope' }))).toBe(false);
  });

  it('false when the selected plugin has no apiKey filled', () => {
    expect(isAiConfigured(makeDb({ ai_plugin: 'deepseek', ai_deepseek_model: 'deepseek-chat' }))).toBe(false);
  });

  it('true when the selected plugin has an apiKey', () => {
    expect(isAiConfigured(makeDb({ ai_plugin: 'deepseek', ai_deepseek_apiKey: 'sk-xxx' }))).toBe(true);
  });
});

describe('aiPlugins registry', () => {
  it('includes ollama', () => {
    expect(aiPlugins.map(p => p.name)).toContain('ollama');
  });

  it('ollama declares no apiKey field', () => {
    const ollama = aiPlugins.find(p => p.name === 'ollama')!;
    expect(ollama.fields).toEqual(['baseUrl', 'model']);
  });

  it('every plugin exposes placeholders for its non-apiKey fields', () => {
    for (const p of aiPlugins) {
      for (const f of p.fields.filter(f => f !== 'apiKey')) {
        expect(p.placeholders?.[f]).toBeTruthy();
      }
    }
  });
});

describe('isAiConfigured with ollama', () => {
  it('true once ollama is selected (no apiKey required)', () => {
    expect(isAiConfigured(makeDb({ ai_plugin: 'ollama' }))).toBe(true);
  });
});
