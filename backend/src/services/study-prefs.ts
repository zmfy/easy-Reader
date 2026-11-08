// 学习偏好：每个账号各自一份，存在 settings 表 study_prefs_<userId>（JSON）
// 不与阅读器的 reader_prefs_* 混用：那个接口整体覆盖写入，混在一起会互相冲掉
import Database from 'better-sqlite3';

export interface StudyPrefs { allowAiAddition: boolean }

const DEFAULT_PREFS: StudyPrefs = { allowAiAddition: false };

const keyOf = (userId: string) => `study_prefs_${userId}`;

export function getStudyPrefs(db: Database.Database, userId: string): StudyPrefs {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(keyOf(userId)) as { value: string } | undefined;
  if (!row) return { ...DEFAULT_PREFS };
  try {
    const v = JSON.parse(row.value) as Partial<StudyPrefs>;
    return { allowAiAddition: typeof v?.allowAiAddition === 'boolean' ? v.allowAiAddition : DEFAULT_PREFS.allowAiAddition };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setStudyPrefs(db: Database.Database, userId: string, prefs: StudyPrefs): StudyPrefs {
  const value: StudyPrefs = { allowAiAddition: prefs.allowAiAddition };
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(keyOf(userId), JSON.stringify(value));
  return value;
}
