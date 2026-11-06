export interface ReleaseItem {
  text: string;
  actionRequired: boolean;
}

export interface ReleaseSection {
  title: string;
  kind: 'added' | 'fixed' | 'other';
  items: ReleaseItem[];
}

export interface Release {
  version: string; // 去掉后缀的 X.Y.Z
  date: string | null;
  intro: string;
  sections: ReleaseSection[];
}

const ACTION_PREFIX = '【需操作】';
const KIND_ORDER = { added: 0, fixed: 1, other: 2 };

// 线性剥离 HTML 注释；找不到闭合的 `-->` 时丢弃余下内容（避免正则对大量未闭合 `<!--` 的二次方回溯）
function stripHtmlComments(text: string): string {
  let out = '';
  let pos = 0;
  for (;;) {
    const start = text.indexOf('<!--', pos);
    if (start < 0) return out + text.slice(pos);
    out += text.slice(pos, start);
    const end = text.indexOf('-->', start + 4);
    if (end < 0) return out;
    pos = end + 3;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sectionKind(title: string): ReleaseSection['kind'] {
  if (title === '新增') return 'added';
  if (title === '修复') return 'fixed';
  return 'other';
}

/** 解析 CHANGELOG.md，只取 `## [X.Y.Z<suffix>]` 的版本节（suffix 精确匹配），按文件顺序（新→旧）返回。
 *  条目文字中的「【需操作】」前缀会被去掉，由 actionRequired 标记表示。 */
export function parseChangelog(md: string, suffix: string): Release[] {
  const text = stripHtmlComments(md.replace(/\r\n?/g, '\n'));
  const headRe = new RegExp('^## \\[(\\d{1,6}\\.\\d{1,6}\\.\\d{1,6})' + escapeRegExp(suffix) + '\\](?:\\s*-\\s*(\\d{4}-\\d{2}-\\d{2}))?\\s*$');
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: ReleaseSection | null = null;
  let lastItem: ReleaseItem | null = null;
  const introLines: string[] = [];

  const finish = () => {
    if (!release) return;
    release.intro = introLines.join('\n');
    release.sections.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    releases.push(release);
    release = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (/^## /.test(line)) {
      finish();
      section = null;
      lastItem = null;
      introLines.length = 0;
      const m = headRe.exec(line);
      if (m) release = { version: m[1], date: m[2] || null, intro: '', sections: [] };
      continue;
    }
    if (!release) continue;
    const sub = /^### (.+)$/.exec(line);
    if (sub) {
      const title = sub[1].trim();
      section = { title, kind: sectionKind(title), items: [] };
      release.sections.push(section);
      lastItem = null;
      continue;
    }
    if (!section) {
      if (line.trim()) introLines.push(line.trim());
      continue;
    }
    if (line.startsWith('- ')) {
      let body = line.slice(2).trim();
      const actionRequired = body.startsWith(ACTION_PREFIX);
      if (actionRequired) body = body.slice(ACTION_PREFIX.length).trim();
      lastItem = { text: body, actionRequired };
      section.items.push(lastItem);
    } else if (lastItem && /^\s+\S/.test(line)) {
      lastItem.text += ' ' + line.trim();
    }
  }
  finish();
  return releases;
}

/** 只比较 X.Y.Z 数字 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 比当前版本新的发布；current 为 null（本站无版本）时返回 []，避免误报 */
export function newerReleases(remote: Release[], current: string | null): Release[] {
  if (!current) return [];
  return remote.filter(r => compareVersions(r.version, current) > 0);
}

export function hasActionRequired(releases: Release[]): boolean {
  return releases.some(r => r.sections.some(s => s.items.some(i => i.actionRequired)));
}
