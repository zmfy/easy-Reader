import * as fs from 'fs';
import * as path from 'path';
import { parseChangelog, compareVersions, newerReleases, hasActionRequired } from '../../src/services/changelog';

const SAMPLE = `# 更新日志

<!-- 发版：## [9.9.9] - 2000-01-01 这是注释 -->

## [Unreleased]

### 修复

- 未发布的修复

## [Unreleased-study]

### 新增

- 学习版未发布

## [1.2.0-study] - 2026-11-06

### 新增

- 学习版功能

## [1.2.0] - 2026-11-06

### 其他变化

- 其他条目

### 修复

- 修复条目

### 新增

- 新增条目

## [1.1.0] - 2026-11-01

首个说明。
`;

describe('parseChangelog', () => {
  it('parses version sections and skips Unreleased', () => {
    const rs = parseChangelog(SAMPLE, '');
    expect(rs.map(r => r.version)).toEqual(['1.2.0', '1.1.0']);
    expect(rs[0].date).toBe('2026-11-06');
  });

  it('main ignores -study sections and study ignores plain sections', () => {
    expect(parseChangelog(SAMPLE, '').map(r => r.version)).toEqual(['1.2.0', '1.1.0']);
    const study = parseChangelog(SAMPLE, '-study');
    expect(study.map(r => r.version)).toEqual(['1.2.0']);
    expect(study[0].sections[0].items[0].text).toBe('学习版功能');
  });

  it('classifies 新增/修复/other and orders them', () => {
    const [r] = parseChangelog(SAMPLE, '');
    expect(r.sections.map(s => [s.kind, s.title])).toEqual([
      ['added', '新增'],
      ['fixed', '修复'],
      ['other', '其他变化'],
    ]);
  });

  it('marks 【需操作】 items', () => {
    const md = `## [2.0.0] - 2026-12-01\n\n### 新增\n\n- 【需操作】请迁移数据目录\n- 普通条目\n`;
    const rs = parseChangelog(md, '');
    const items = rs[0].sections[0].items;
    expect(items[0]).toEqual({ text: '请迁移数据目录', actionRequired: true });
    expect(items[1]).toEqual({ text: '普通条目', actionRequired: false });
    expect(hasActionRequired(rs)).toBe(true);
    expect(hasActionRequired(parseChangelog(SAMPLE, ''))).toBe(false);
  });

  it('joins continuation lines and handles CRLF', () => {
    const md = '## [1.0.1] - 2026-11-06\r\n\r\n### 修复\r\n\r\n- 第一行\r\n  续行\r\n- 第二条\r\n';
    const [r] = parseChangelog(md, '');
    expect(r.sections[0].items.map(i => i.text)).toEqual(['第一行 续行', '第二条']);
  });

  it('keeps intro text before first subsection', () => {
    const md = fs.readFileSync(path.resolve(__dirname, '../../../CHANGELOG.md'), 'utf8');
    const rs = parseChangelog(md, '');
    const r = rs.find(x => x.version === '1.0.0')!;
    expect(r.intro).toBe('首个正式版本。');
    expect(r.date).toBe('2026-11-05');
    expect(r.sections.length).toBeGreaterThan(0);
    expect(rs.some(x => x.version.includes('nreleased'))).toBe(false);
  });

  it('tolerates missing date and empty sections', () => {
    const md = `## [1.0.2]\n\n### 新增\n\n### 修复\n\n- a\n`;
    const [r] = parseChangelog(md, '');
    expect(r.date).toBeNull();
    expect(r.intro).toBe('');
    expect(r.sections.find(s => s.kind === 'added')!.items).toEqual([]);
    expect(r.sections.find(s => s.kind === 'fixed')!.items).toHaveLength(1);
  });
});

describe('versions', () => {
  it('compareVersions and newerReleases', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    const rs = parseChangelog(SAMPLE, '');
    expect(newerReleases(rs, '1.1.0').map(r => r.version)).toEqual(['1.2.0']);
    expect(newerReleases(rs, '1.2.0')).toEqual([]);
  });

  it('newerReleases returns [] when current is null', () => {
    expect(newerReleases(parseChangelog(SAMPLE, ''), null)).toEqual([]);
  });
});
