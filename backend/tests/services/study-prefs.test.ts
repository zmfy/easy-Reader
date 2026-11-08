import Database from 'better-sqlite3';
import { getStudyPrefs, setStudyPrefs } from '../../src/services/study-prefs';

function makeDb() {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  return d;
}

describe('study-prefs', () => {
  it('returns default when nothing saved and round-trips per user', () => {
    const db = makeDb();
    expect(getStudyPrefs(db, 'u1')).toEqual({ allowAiAddition: false });
    expect(setStudyPrefs(db, 'u1', { allowAiAddition: true })).toEqual({ allowAiAddition: true });
    expect(getStudyPrefs(db, 'u1')).toEqual({ allowAiAddition: true });
    expect(getStudyPrefs(db, 'u2')).toEqual({ allowAiAddition: false });
    const row = db.prepare("SELECT value FROM settings WHERE key = 'study_prefs_u1'").get() as { value: string };
    expect(JSON.parse(row.value)).toEqual({ allowAiAddition: true });
  });

  it('falls back to default on corrupt or mistyped stored JSON', () => {
    const db = makeDb();
    db.prepare("INSERT INTO settings VALUES ('study_prefs_u1', 'oops'), ('study_prefs_u2', '{\"allowAiAddition\":\"yes\"}')").run();
    expect(getStudyPrefs(db, 'u1')).toEqual({ allowAiAddition: false });
    expect(getStudyPrefs(db, 'u2')).toEqual({ allowAiAddition: false });
  });
});
