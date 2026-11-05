import fs from 'fs';
import os from 'os';
import path from 'path';
import { TxtParser } from '../../src/plugins/parser-txt';

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
    fs.writeFileSync(file, '第十卷魔界之战第两千一百三十章斗兽\n\n第十卷魔界之战第两千一百三十一章得晶\n正文。\n', 'utf-8');
    const p = new TxtParser();
    await p.load(file);
    expect((await p.getChapters()).map(c => c.title)).toEqual(['第十卷魔界之战第两千一百三十章斗兽', '第十卷魔界之战第两千一百三十一章得晶']);
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
