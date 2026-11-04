import { rewriteEpubAssetUrls } from '../../src/utils/epub-asset-url';

const BOOK = 'b1';
const HREF = 'OEBPS/Text/cover.xhtml';

describe('rewriteEpubAssetUrls', () => {
  it('rewrites relative <img src>', () => {
    expect(rewriteEpubAssetUrls('<img class="a" src="../Images/p1.jpg" alt="">', BOOK, HREF))
      .toBe('<img class="a" src="/api/reader/b1/asset/OEBPS/Images/p1.jpg" alt="">');
  });

  it('rewrites SVG <image xlink:href> (manga covers)', () => {
    const html = '<svg><image height="1200" width="835" xlink:href="../Images/cover01624.jpeg"></image></svg>';
    expect(rewriteEpubAssetUrls(html, BOOK, HREF))
      .toBe('<svg><image height="1200" width="835" xlink:href="/api/reader/b1/asset/OEBPS/Images/cover01624.jpeg"></image></svg>');
  });

  it('rewrites SVG <image href> and single-quoted attributes', () => {
    expect(rewriteEpubAssetUrls("<image href='../Images/c.png'/>", BOOK, HREF))
      .toBe("<image href='/api/reader/b1/asset/OEBPS/Images/c.png'/>");
    expect(rewriteEpubAssetUrls("<img src='p.jpg'>", BOOK, HREF))
      .toBe("<img src='/api/reader/b1/asset/OEBPS/Text/p.jpg'>");
  });

  it('leaves absolute, data, fragment URLs and non-image tags alone', () => {
    const html = [
      '<img src="https://x.com/a.jpg">',
      '<img src="data:image/png;base64,AA">',
      '<img src="/api/reader/b1/asset/a.jpg">',
      '<image xlink:href="#sprite"/>',
      '<a href="../Text/ch2.xhtml">next</a>',
      '<imagemap src="../x.jpg">',
    ].join('');
    expect(rewriteEpubAssetUrls(html, BOOK, HREF)).toBe(html);
  });
});
