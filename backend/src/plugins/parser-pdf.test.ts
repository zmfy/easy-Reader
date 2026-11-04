import { buildPageText, PdfTextItem } from './parser-pdf';

// Item at (x, y) with font size `size`; width defaults to size per character (CJK)
function item(str: string, x: number, y: number, size = 14.25, width = str.length * size): PdfTextItem {
  return { str, transform: [size, 0, 0, size, x, y], width };
}

describe('buildPageText', () => {
  it('drops fake-bold duplicates drawn at nearly the same position', () => {
    const items = [
      item('心想事成', 208.5, 784.9),
      item('心想事成', 208.5, 785.33),
      item('心想事成', 208.8, 785.2),
      item('心想事成', 208.93, 784.9),
    ];
    expect(buildPageText(items)).toBe('心想事成');
  });

  it('drops fake-bold copies drawn after the rest of the line', () => {
    const line = (dx: number, dy: number) => [
      item('有个男', 63 + dx, 626.65 + dy), item('子一天下', 105 + dx, 626.65 + dy), item('班的时候', 162 + dx, 626.65 + dy),
    ];
    const items = [...line(0, 0), ...line(0, 0.43), ...line(0.3, 0.3), ...line(0.43, 0)];
    expect(buildPageText(items)).toBe('有个男子一天下班的时候');
  });

  it('keeps genuinely repeated text at different positions', () => {
    expect(buildPageText([item('哈', 63, 700), item('哈', 77.25, 700)])).toBe('哈哈');
  });

  it('joins adjacent fragments without spaces, adds a space only for real gaps between non-CJK words', () => {
    const items = [
      item('ht', 322.5, 784.9, 9, 7),
      item('t', 329.25, 784.9, 9, 2.5),
      item('p:', 332.25, 784.9, 9, 7),
      item('//', 339, 784.9, 9, 5),
      item('xxsc.com', 344.25, 784.9, 9, 30),
      item('Hello', 63, 700, 12, 28),
      item('world', 93.5, 700, 12, 30),
    ];
    expect(buildPageText(items)).toBe('http://xxsc.com\nHello world');
  });

  it('merges wrapped lines of a paragraph and splits paragraphs on larger line gaps', () => {
    const items = [
      item('在一个停滞的', 63, 748.15), item('阶段不知', 147.75, 748.15),
      item('有心领神会的', 63, 717.4), item('一刻。', 147.75, 717.4),
      item('我写这本书的', 63, 672.4), item('动机，是', 147.75, 672.4),
      item('来自于一', 63, 641.65),
    ];
    expect(buildPageText(items)).toBe('在一个停滞的阶段不知有心领神会的一刻。\n我写这本书的动机，是来自于一');
  });

  it('orders lines top to bottom even when the content stream draws the footer first', () => {
    const items = [
      item('页脚', 63, 52.9, 12),
      item('正文第一行', 63, 748.15),
    ];
    expect(buildPageText(items)).toBe('正文第一行\n页脚');
  });

  it('starts a new paragraph after a short line or an indented line', () => {
    const items = [
      item('第一段很长的一行文字到右边', 63, 700),
      item('结束。', 63, 669.25),
      item('第二段也很长的一行文字到右', 63, 638.5),
      item('续行文字', 63, 607.75),
      item('缩进开头的段落', 91.5, 577),
    ];
    expect(buildPageText(items)).toBe('第一段很长的一行文字到右边结束。\n第二段也很长的一行文字到右续行文字\n缩进开头的段落');
  });

  it('ignores whitespace-only items and returns empty string for pages without text', () => {
    expect(buildPageText([])).toBe('');
    expect(buildPageText([item('  ', 63, 700)])).toBe('');
  });
});
