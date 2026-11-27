import fs from 'fs';
import os from 'os';
import path from 'path';
import { TxtParser, looksLikeSentence, chapterNumberValue, stripTitlePromo } from '../../src/plugins/parser-txt';

async function chaptersOf(text: string) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'txt-')), 'book.txt');
  fs.writeFileSync(file, text, 'utf-8');
  const p = new TxtParser();
  await p.load(file);
  return (await p.getChapters()).map(c => c.title);
}

describe('TxtParser chapter detection', () => {
  it('splits 章 headings', async () => {
    expect(await chaptersOf('第一章 开端\n正文一\n第二章 发展\n正文二\n')).toEqual(['第一章 开端', '第二章 发展']);
  });

  it('splits 回 headings used by classic novels (章回体)', async () => {
    const titles = await chaptersOf('第一回     灵根育孕源流出　心性修持大道生\n诗曰\n第二回　悟彻菩提真妙理\n正文\n第十回：老龙王拙计犯天条\n正文\n');
    expect(titles).toEqual(['第一回     灵根育孕源流出　心性修持大道生', '第二回　悟彻菩提真妙理', '第十回：老龙王拙计犯天条']);
  });

  it('does not treat prose that merely starts with 第 as a heading', async () => {
    expect(await chaptersOf('第一章 开端\n第二天一早，他就出发了。\n')).toEqual(['第一章 开端']);
  });

  it('正文句子以「第一回」开头时不算标题（《社戏》）', async () => {
    const titles = await chaptersOf(
      '第一章 社戏\n我在倒数上去的二十年中，只看过两回中国戏。\n'
      + '第一回是民国元年我初到北京的时候，当时一个朋友对我说，北京戏\n最好，你不去见见世面么？\n'
      + '第二回忘记了那一年，总之是募集湖北水灾捐而谭叫天还没有死。捐法是两\n正文\n'
      + '第二章 风波\n临河的土场上\n',
    );
    expect(titles).toEqual(['第一章 社戏', '第二章 风波']);
  });

  it('标题里有一个逗号仍算标题', async () => {
    expect(await chaptersOf('第十章 风起，云涌\n正文\n第十一章 落幕\n正文\n')).toEqual(['第十章 风起，云涌', '第十一章 落幕']);
  });
});

describe('looksLikeSentence', () => {
  it.each([
    ['第一回是民国元年我初到北京的时候，当时一个朋友对我说，北京戏', true],
    ['第二回忘记了那一年，总之是募集湖北水灾捐而谭叫天还没有死。捐法是两', true],
    ['第二十七章 赌运气？', false],
    ['第一千九十八章冲阶化神!', false],
    ['第一千一百三十九章神念附灵。', false],
    ['第二百一十四章 一个恩赐，或者，一个诅咒', false],
    ['第十章 风起，云涌', false],
    ['第一回 灵根育孕源流出　心性修持大道生', false],
  ])('%s → %s', (line, expected) => {
    expect(looksLikeSentence(line)).toBe(expected);
  });
});

describe('TxtParser web-scraped books that repeat each heading', () => {
  // 网页抓取的《水浒传》：每回先有完整标题行，空一行后又是「第二回」+ 标题后半两行
  const SCRAPED = '第一回王教头私走延安府\r\n\r\n第一回\r\n王教头私走延安府\r\n\r\n正文一。\r\n且听下回分解\r\n\r\n第二回史大郎夜走华阴县\r\n\r\n第二回\r\n史大郎夜走华阴县\r\n\r\n正文二。\r\n';

  async function load(text: string) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'txt-')), 'book.txt');
    fs.writeFileSync(file, text, 'utf-8');
    const p = new TxtParser();
    await p.load(file);
    return p;
  }

  it('merges a heading that has no body into the next one, keeping the fuller title', async () => {
    const p = await load(SCRAPED);
    expect((await p.getChapters()).map(c => c.title)).toEqual(['第一回王教头私走延安府', '第二回史大郎夜走华阴县']);
  });

  it('drops the repeated heading lines so the title only shows once', async () => {
    const p = await load(SCRAPED);
    expect(await p.getChapterContent(1)).toBe('<p>第二回史大郎夜走华阴县</p>\n<p>正文二。</p>');
    expect(await p.getChapterContent(0)).toBe('<p>第一回王教头私走延安府</p>\n<p>正文一。</p>\n<p>且听下回分解</p>');
  });

  it('keeps the longer title when the short heading comes first', async () => {
    const p = await load('第一回\n\n第一回 开端\n正文。\n第二回 发展\n正文。\n');
    expect((await p.getChapters()).map(c => c.title)).toEqual(['第一回 开端', '第二回 发展']);
  });

  it('does not touch normal books where every heading has a body', async () => {
    const p = await load('第一回 开端\n话说当年。\n第二回 发展\n正文。\n');
    expect((await p.getChapters()).map(c => c.title)).toEqual(['第一回 开端', '第二回 发展']);
    expect(await p.getChapterContent(0)).toBe('<p>第一回 开端</p>\n<p>话说当年。</p>');
  });
});

describe('TxtParser keeps volume headings separate', () => {
  it('does not merge a volume heading into the first chapter after it', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'txt-')), 'book.txt');
    fs.writeFileSync(file, '第一章 开端\n正文。\n第七卷 倒吊人\n\n第一章 欢迎\n正文。\n', 'utf-8');
    const p = new TxtParser();
    await p.load(file);
    expect((await p.getChapters()).map(c => c.title)).toEqual(['第一章 开端', '第七卷 倒吊人', '第一章 欢迎']);
  });
});

describe('TxtParser merge compares every number in the heading', () => {
  it('keeps 「第十卷…第2130章」 and 「第十卷…第2131章」 apart even when the first has no body', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'txt-')), 'book.txt');
    fs.writeFileSync(file, '第十卷魔界之战第二千一百三十章斗兽\n\n第十卷魔界之战第两千一百三十一章得晶\n正文。\n', 'utf-8');
    const p = new TxtParser();
    await p.load(file);
    expect((await p.getChapters()).map(c => c.title)).toEqual(['第十卷魔界之战第二千一百三十章斗兽', '第十卷魔界之战第两千一百三十一章得晶']);
  });
});

describe('TxtParser volume levels', () => {
  async function chaptersWithLevel(text: string) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'txt-')), 'book.txt');
    fs.writeFileSync(file, text, 'utf-8');
    const p = new TxtParser();
    await p.load(file);
    return (await p.getChapters()).map(c => {
      const { title, level, groupTitle } = c as { title: string; level?: number; groupTitle?: string };
      return groupTitle ? [title, level, groupTitle] : [title, level];
    });
  }

  it('puts body-less 卷 headings at level 0 and the chapters after them at level 1', async () => {
    expect(await chaptersWithLevel('第一章 楔子\n正文。\n第一卷 梦魇\n\n第二章 外乡人\n正文。\n第三章 信\n正文。\n第二卷 阴谋家\n\n第四章 分配\n正文。\n')).toEqual([
      ['第一章 楔子', 0], ['第一卷 梦魇', 0], ['第二章 外乡人', 1], ['第三章 信', 1], ['第二卷 阴谋家', 0], ['第四章 分配', 1],
    ]);
  });

  it('treats 「第十卷…」 chapters that have a body as chapters, not volumes', async () => {
    expect(await chaptersWithLevel('第十卷 魔界之战\n\n第十卷魔界之战第一章 分元\n正文。\n第十卷魔界之战1875\n正文。\n')).toEqual([
      ['第十卷 魔界之战', 0], ['第十卷魔界之战第一章 分元', 1], ['第十卷魔界之战1875', 1],
    ]);
  });

  it('groups chapters under 「第X部 名称」 lines without turning them into chapters', async () => {
    const text = '诡秘之主\n第一部 小丑\n\n第一章 绯红\n正文。\n第二章 情况\n第一部我采取了新写法。\n第一部总结\n第二部 无面人\n第三章 门\n第二部分是暗杀。\n第七卷 倒吊人\n第四章 欢迎\n正文。\n';
    expect(await chaptersWithLevel(text)).toEqual([
      ['第一章 绯红', 1, '第一部 小丑'], ['第二章 情况', 1], ['第三章 门', 1, '第二部 无面人'], ['第七卷 倒吊人', 0], ['第四章 欢迎', 1],
    ]);
  });

  it('adds no level when the book has no volume headings', async () => {
    expect(await chaptersWithLevel('第一章 开端\n正文。\n第二章 发展\n正文。\n')).toEqual([['第一章 开端', undefined], ['第二章 发展', undefined]]);
  });
});

describe('TxtParser 网文抓取的大文件（《校花的贴身高手》《剑来》的写法）', () => {
  async function load(text: string, encoding: BufferEncoding = 'utf-8') {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'txt-')), 'book.txt');
    fs.writeFileSync(file, Buffer.from(text, encoding));
    const p = new TxtParser();
    await p.load(file);
    return p;
  }
  const text = async (p: TxtParser, i: number) => (await p.getChapterContent(i)).replace(/<\/?p>/g, '').split('\n');

  it('chapterNumberValue：阿拉伯数字（含补零）和中文数字按数值比较', () => {
    expect(chapterNumberValue('0005')).toBe(5);
    expect(chapterNumberValue('五')).toBe(5);
    expect(chapterNumberValue('十二')).toBe(12);
    expect(chapterNumberValue('一千零五')).toBe(1005);
    expect(chapterNumberValue('两千一百三十')).toBe(2130);
    expect(chapterNumberValue('一万二千')).toBe(12000);
  });

  it('「第5章 …」后紧跟「第0005章…」：并为一章，保留第一个标题，正文里不再多一行标题', async () => {
    const p = await load('第5章 怎么像找对象？\r\n\r\n第0005章怎么像找对象？？\r\n    正文五。\r\n第6章 这土包子是谁？\r\n\r\n第0006章挡箭牌【有推荐票的，请不吝投几张，谢谢！】\r\n    正文六。\r\n');
    expect((await p.getChapters()).map(c => c.title)).toEqual(['第5章 怎么像找对象？', '第6章 这土包子是谁？']);
    expect(await text(p, 0)).toEqual(['第5章 怎么像找对象？', '正文五。']);
    expect(await text(p, 1)).toEqual(['第6章 这土包子是谁？', '正文六。']);
  });

  it('后一个标题在章名后多出文字（「太极」→「太极图」）用后一个；多出的是「，到网址」这类水印则保留第一个', async () => {
    const p = await load('第二千零二章太极\n第二千零二章太极图\n正文一。\n第二千一百三十章斗兽\n第二千一百三十章斗兽，到网址\n正文二。\n');
    expect((await p.getChapters()).map(c => c.title)).toEqual(['第二千零二章太极图', '第二千一百三十章斗兽']);
    expect(await text(p, 0)).toEqual(['第二千零二章太极图', '正文一。']);
    expect(await text(p, 1)).toEqual(['第二千一百三十章斗兽', '正文二。']);
  });

  it('同一标题一字不差写两遍：正文里保留一份', async () => {
    const p = await load('第53章 请神\n第53章 请神\n正文。\n第54章 下一章\n正文。\n');
    expect(await text(p, 0)).toEqual(['第53章 请神', '正文。']);
  });

  it('标题末尾的求票附言：照样识别为标题，目录和正文首行都去掉附言', async () => {
    const p = await load('第0118章 医术高人【求月票！！！月票啊！读者们，你们的月票可以给我么？？】\n正文一。\n第0119章挡箭牌【有推荐票的，请不吝投几张，谢谢！】\n正文二。\n第120章 山洞奇遇（上）\n正文三。\n');
    expect((await p.getChapters()).map(c => c.title)).toEqual(['第0118章 医术高人', '第0119章挡箭牌', '第120章 山洞奇遇（上）']);
    expect(await text(p, 1)).toEqual(['第0119章挡箭牌', '正文二。']);
  });

  it('stripTitlePromo 只去求票类附言，「（上）」这类正常括号保留', () => {
    expect(stripTitlePromo('第1768章 迷蜃幻境（第一更）')).toBe('第1768章 迷蜃幻境');
    expect(stripTitlePromo('第12章 山洞奇遇（上）')).toBe('第12章 山洞奇遇（上）');
    expect(stripTitlePromo('第3章 【序】')).toBe('第3章 【序】');
  });

  it('卷名后跟一行分隔线：仍识别为分卷', async () => {
    const p = await load('------------\n\n第一卷 神奇的任务\n\n------------\n\n第1章 神奇的任务\n正文。\n第2章 骗局\n正文。\n');
    expect((await p.getChapters()).map(c => [c.title, c.level])).toEqual([['第一卷 神奇的任务', 0], ['第1章 神奇的任务', 1], ['第2章 骗局', 1]]);
  });

  it('章节标题带着卷名（「第一卷 笼中雀 第一章 惊蛰」）：目录和正文首行去掉卷名', async () => {
    const p = await load('第一卷 笼中雀\n\n第一卷 笼中雀 第一章 惊蛰\n正文一。\n第一卷 笼中雀 第二章 开门\n正文二。\n第二卷 山水郎\n第二卷 山水郎 第一章 走\n正文三。\n');
    expect((await p.getChapters()).map(c => [c.title, c.level])).toEqual([
      ['第一卷 笼中雀', 0], ['第一章 惊蛰', 1], ['第二章 开门', 1], ['第二卷 山水郎', 0], ['第一章 走', 1],
    ]);
    expect(await text(p, 1)).toEqual(['第一章 惊蛰', '正文一。']);
  });

  it('卷末说明「第二卷《山水郎》结束。」是正文；之后没写卷名的章节回到第一层', async () => {
    const p = await load('第一卷 笼中雀\n第一卷 笼中雀 第一章 惊蛰\n正文一。\n第二卷 山水郎\n第二卷 山水郎 第二章 走\n正文二。\n    第二卷《山水郎》结束。\n------------\n第三章 添土\n正文三。\n');
    expect((await p.getChapters()).map(c => [c.title, c.level])).toEqual([
      ['第一卷 笼中雀', 0], ['第一章 惊蛰', 1], ['第二卷 山水郎', 0], ['第二章 走', 1], ['第三章 添土', 0],
    ]);
    expect(await text(p, 3)).toContain('第二卷《山水郎》结束。');
  });

  it('「第一回跟皇帝老爷打交道，钱俊说话都不利索了。」是正文句子，不是标题', async () => {
    expect(looksLikeSentence('第一回跟皇帝老爷打交道，钱俊说话都不利索了。')).toBe(true);
    expect(looksLikeSentence('第一千一百三十九章神念附灵。')).toBe(false);
  });

  it('全角空格 / 不换行空格缩进的标题照样识别；超长的「第…」行算正文', async () => {
    const long = '第一天' + '很长的正文'.repeat(100);
    const p = await load(`\u3000\u3000第一章 开端\n${long}\n\u00a0第二章 发展\n正文。\n`);
    expect((await p.getChapters()).map(c => c.title)).toEqual(['第一章 开端', '第二章 发展']);
    expect((await text(p, 0))[1]).toBe(long);
  });
});
