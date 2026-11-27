import { decodeHtmlEntities, escapeHtml, unescapeHtml } from '../../src/utils/html';

describe('escapeHtml / unescapeHtml', () => {
  it('escapes &, < and >', () => {
    expect(escapeHtml('a<b && c>d')).toBe('a&lt;b &amp;&amp; c&gt;d');
  });
  it('round-trips', () => {
    const s = '<<天龙八部>> & "引号" &lt; 原样';
    expect(unescapeHtml(escapeHtml(s))).toBe(s);
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes hex / decimal numeric entities and common named ones', () => {
    expect(decodeHtmlEntities('&#x3010;样本&#12305; a&amp;b &lt;i&gt; &quot;x&quot; &nbsp;')).toBe('【样本】 a&b <i> "x"  ');
  });
  it('leaves unknown or out-of-range entities as they are', () => {
    expect(decodeHtmlEntities('&foo; &#x110000;')).toBe('&foo; &#x110000;');
  });
});
