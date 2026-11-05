import { htmlToBlocks } from '../../src/utils/content-blocks';

describe('htmlToBlocks', () => {
  it('turns TXT-style paragraphs into p blocks and strips indentation', () => {
    expect(htmlToBlocks('<p>　　第一段。</p>\n<p>  第二段。 </p>')).toEqual([
      { type: 'p', text: '第一段。', anchor: 0 },
      { type: 'p', text: '第二段。', anchor: 1 },
    ]);
  });

  it('keeps heading levels and merges inline elements', () => {
    expect(htmlToBlocks('<h1>卷一</h1><h3>第一章 <span>开始</span><strong>了</strong></h3><p>正<em>文</em></p>')).toEqual([
      { type: 'h', level: 1, text: '卷一', anchor: 0 },
      { type: 'h', level: 3, text: '第一章 开始了', anchor: 1 },
      { type: 'p', text: '正文', anchor: 2 },
    ]);
  });

  it('splits loose text around nested blocks', () => {
    expect(htmlToBlocks('<div>前言<p>正文</p>结尾</div>')).toEqual([
      { type: 'p', text: '前言', anchor: 0 },
      { type: 'p', text: '正文', anchor: 0 },
      { type: 'p', text: '结尾', anchor: 0 },
    ]);
  });

  it('emits images as their own blocks, splitting the paragraph', () => {
    expect(htmlToBlocks('<p>图前<img src="/api/reader/b/asset/a.jpg" alt="插图">图后</p><img src="x.png">')).toEqual([
      { type: 'p', text: '图前', anchor: 0 },
      { type: 'img', src: '/api/reader/b/asset/a.jpg', alt: '插图', anchor: 1 },
      { type: 'p', text: '图后', anchor: 0 },
      { type: 'img', src: 'x.png', anchor: 2 },
    ]);
  });

  it('reads SVG <image> (manga pages) and ignores the rest of the SVG', () => {
    const html = '<div><svg viewBox="0 0 10 10"><image width="10" xlink:href="/api/reader/b/asset/p1.jpg"></image><text>x</text></svg></div>';
    expect(htmlToBlocks(html)).toEqual([{ type: 'img', src: '/api/reader/b/asset/p1.jpg', anchor: 0 }]);
  });

  it('keeps <br> as a line break inside the paragraph', () => {
    expect(htmlToBlocks('<p>床前明月光，<br>疑是地上霜。<br/></p>')).toEqual([
      { type: 'p', text: '床前明月光，\n疑是地上霜。', anchor: 0 },
    ]);
  });

  it('collapses source whitespace but keeps full-width spaces inside text', () => {
    expect(htmlToBlocks('<p>甲\n   乙　丙</p>')).toEqual([{ type: 'p', text: '甲 乙　丙', anchor: 0 }]);
  });

  it('decodes entities and drops empty paragraphs, scripts and styles', () => {
    expect(htmlToBlocks('<style>p{}</style><p>a&lt;b &amp; c</p><p> </p><p>&nbsp;</p><script>x()</script>')).toEqual([
      { type: 'p', text: 'a<b & c', anchor: 0 },
    ]);
  });

  // anchor 与网页版阅读器的段落计数一致（空段落也计数），两端互相同步进度时位置不偏
  it('counts empty and nested elements in anchor like the web reader', () => {
    expect(htmlToBlocks('<p><br></p><h4>标题</h4><p><br></p><blockquote><p>引文</p></blockquote><p>正文</p>')).toEqual([
      { type: 'h', level: 4, text: '标题', anchor: 1 },
      { type: 'p', text: '引文', anchor: 4 },
      { type: 'p', text: '正文', anchor: 5 },
    ]);
  });

  it('returns an empty list for empty content', () => {
    expect(htmlToBlocks('')).toEqual([]);
  });
});
