import Database from 'better-sqlite3';
import { aiPlugins, isAiConfigured, getAiConfigWarning } from '../../src/ai/ai-manager';

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

describe('getAiConfigWarning', () => {
  it('null when no plugin is active', () => {
    expect(getAiConfigWarning(makeDb())).toBeNull();
  });

  it('warns when minmax is active with the retired MiniMax-M2 model', () => {
    const w = getAiConfigWarning(makeDb({ ai_plugin: 'minmax', ai_minmax_apiKey: 'k', ai_minmax_model: 'MiniMax-M2' }));
    expect(w).toContain('已下线');
  });

  it('null for minmax with a current model, or when the stale value belongs to an inactive plugin', () => {
    expect(getAiConfigWarning(makeDb({ ai_plugin: 'minmax', ai_minmax_model: 'MiniMax-M3' }))).toBeNull();
    expect(getAiConfigWarning(makeDb({ ai_plugin: 'deepseek', ai_minmax_model: 'MiniMax-M2' }))).toBeNull();
  });
});

describe('aiPlugins registry', () => {
  it('includes ollama', () => {
    expect(aiPlugins.map(p => p.name)).toContain('ollama');
  });

  it('ollama declares no apiKey field', () => {
    const ollama = aiPlugins.find(p => p.name === 'ollama')!;
    expect(ollama.fields).not.toContain('apiKey');
    expect(ollama.fields).toEqual(expect.arrayContaining(['baseUrl', 'model']));
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
