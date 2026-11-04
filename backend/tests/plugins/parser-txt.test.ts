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
