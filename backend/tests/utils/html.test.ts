import { escapeHtml, unescapeHtml } from '../../src/utils/html';

describe('escapeHtml / unescapeHtml', () => {
  it('escapes &, < and >', () => {
    expect(escapeHtml('a<b && c>d')).toBe('a&lt;b &amp;&amp; c&gt;d');
  });
  it('round-trips', () => {
    const s = '<<天龙八部>> & "引号" &lt; 原样';
    expect(unescapeHtml(escapeHtml(s))).toBe(s);
  });
});
