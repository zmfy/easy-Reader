import { readApiDocs, renderApiDocsPage } from '../../src/utils/api-docs';

describe('API docs', () => {
  it('finds docs/api.md in the repository', () => {
    const md = readApiDocs();
    expect(md).not.toBeNull();
    expect(md).toContain('/api/v1');
  });

  it('renders markdown into a standalone HTML page', () => {
    const html = renderApiDocsPage('# 标题\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n`code`');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<table>');
    expect(html).toContain('<code>code</code>');
  });
});
