import fs from 'fs';
import os from 'os';
import path from 'path';
import { readTxtLines } from '../../../src/services/txt-organize/lines';
import { Candidate } from '../../../src/services/txt-organize/candidates';
import { Label } from '../../../src/services/txt-organize/judge';
import { buildStructure, displayTitle, isStrictStrayNumber, verifyVerbatim, OrgStructure } from '../../../src/services/txt-organize/structure';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-struct-'));
let seq = 0;
const write = (text: string) => {
  const f = path.join(dir, `b${seq++}.txt`);
  fs.writeFileSync(f, text);
  return f;
};

type L = Omit<Label, 'id'>;

/**
 * 按行号给出判定结果，构造与 collectCandidates 同口径的候选行（bodyChars 为到下一候选行之间非空正文字数）。
 * labelsByLine：行号 → 标签；返回的 candidates / labels 下标对齐。
 */
async function prepare(text: string, labelsByLine: Record<number, L>) {
  const f = write(text);
  const candidates: Candidate[] = [];
  const labels: Label[] = [];
  for await (const line of readTxtLines(f)) {
    const t = line.text.trim();
    if (!t) continue;
    const lab = labelsByLine[line.lineNo];
    if (lab) {
      const id = candidates.length;
      candidates.push({
        id, lineNo: line.lineNo, byteStart: line.byteStart, byteEnd: line.byteEnd, text: t,
        bodyChars: 0, bodyLines: 0, prevSnippet: '', nextSnippet: '', ruleHint: 'none',
      });
      labels.push({ id, ...lab });
    } else if (candidates.length > 0) {
      candidates[candidates.length - 1].bodyChars += t.length;
      candidates[candidates.length - 1].bodyLines++;
    }
  }
  const fileSize = fs.statSync(f).size;
  return { f, candidates, labels, fileSize, structure: buildStructure(candidates, labels, fileSize) };
}

/** 按结构切出各章正文（模拟 EPUB 渲染：去掉 dropLines，段落以 \n 分隔） */
async function render(f: string, s: OrgStructure): Promise<string[]> {
  const ranges = [...(s.preface ? [s.preface] : []), ...s.sections.map(x => ({ srcStart: x.srcStart, srcEnd: x.srcEnd }))];
  const out = ranges.map(() => [] as string[]);
  for await (const line of readTxtLines(f)) {
    if (s.dropLines.has(line.lineNo)) continue;
    const i = ranges.findIndex(r => line.byteStart >= r.srcStart && line.byteStart < r.srcEnd);
    expect(i).toBeGreaterThanOrEqual(0);
    out[i].push(line.text);
  }
  return out.map(x => x.join('\n'));
}

async function* iter(arr: string[]) {
  for (const x of arr) yield x;
}

const chap = (): L => ({ type: 'chapter' });

describe('isStrictStrayNumber', () => {
  it('整行只有「第 N 章 / 节 / 回 / 集」才算', () => {
    expect(isStrictStrayNumber('第2章')).toBe(true);
    expect(isStrictStrayNumber(' 第 十二 回 ')).toBe(true);
    expect(isStrictStrayNumber('第〇三集')).toBe(true);
    expect(isStrictStrayNumber('第两百节')).toBe(true);
    expect(isStrictStrayNumber('第2章韩立说')).toBe(false);
    expect(isStrictStrayNumber('第2卷')).toBe(false);
    expect(isStrictStrayNumber('第章')).toBe(false);
  });
});

describe('displayTitle', () => {
  it('去掉行首「正文」（及其后的空白 / 冒号）', () => {
    expect(displayTitle('正文 第一百二十章 风起', {})).toBe('第一百二十章 风起');
    expect(displayTitle('正文：第一章 开端', {})).toBe('第一章 开端');
  });

  it('去掉后面紧跟编号的《书名》前缀', () => {
    expect(displayTitle('《鬼吹灯之龙岭迷窟》 第四十八章 香鞋', {})).toBe('第四十八章 香鞋');
    // 后面不是编号：不去
    expect(displayTitle('《山海经》读后', {})).toBe('《山海经》读后');
  });

  it('去掉后面紧跟数字的《书名》前缀', () => {
    expect(displayTitle('《鬼吹灯之昆仑神宫》 178 死亡收藏者', {})).toBe('178 死亡收藏者');
    expect(displayTitle('《鬼吹灯之昆仑神宫》１７９ 冰川', {})).toBe('１７９ 冰川');
  });

  it('放在该卷下的章去掉卷名前缀', () => {
    expect(displayTitle('第五卷名震一方第六百四十八章至木灵婴', { volumePrefix: '第五卷名震一方' })).toBe('第六百四十八章至木灵婴');
  });

  it('放在该部下的卷去掉部名前缀', () => {
    expect(displayTitle('第一部第二卷《龙岭迷窟》', { partPrefix: '第一部' })).toBe('第二卷《龙岭迷窟》');
  });

  it('去掉行尾附言', () => {
    expect(displayTitle('  第0118章 医术高人【求月票！！】 ', {})).toBe('第0118章 医术高人');
  });

  it('编号和正文里的「第N…」原样保留', () => {
    expect(displayTitle('第一O一章 车祸', {})).toBe('第一O一章 车祸');
    expect(displayTitle('第五章 第十二回合', {})).toBe('第五章 第十二回合');
  });

  it('不在该卷下（卷前缀与所在卷不同）的章保留卷名前缀', () => {
    expect(displayTitle('第五卷名震一方第六百五十三章 乱入', {})).toBe('第五卷名震一方第六百五十三章 乱入');
    expect(displayTitle('第五卷名震一方第六百五十三章 乱入', { volumePrefix: '第六卷通天灵宝' })).toBe('第五卷名震一方第六百五十三章 乱入');
  });

  it('去掉后为空时返回原文', () => {
    expect(displayTitle('正文', {})).toBe('正文');
    expect(displayTitle('第五卷名震一方', { volumePrefix: '第五卷名震一方' })).toBe('第五卷名震一方');
  });
});

describe('buildStructure', () => {
  it('《凡人修仙传》写法：chapter + stray_number 合并，第2章行进 dropLines，正文连续', async () => {
    const text = '第一章 山边小村\n韩立出生在山村。\n第2章\n他有个哥哥。\n第二章 青牛镇\n镇上很安静。\n';
    const { f, structure } = await prepare(text, {
      0: chap(),
      2: { type: 'noise', noiseKind: 'stray_number' },
      4: chap(),
    });
    expect(structure.sections.map(s => [s.level, s.title, s.groupOnly])).toEqual([
      [0, '第一章 山边小村', false], [0, '第二章 青牛镇', false],
    ]);
    expect([...structure.dropLines].sort()).toEqual([0, 2, 4]);
    expect(structure.preface).toBeNull();
    const second = Buffer.byteLength('第一章 山边小村\n韩立出生在山村。\n第2章\n他有个哥哥。\n');
    expect(structure.sections[0]).toMatchObject({ srcStart: 0, srcEnd: second });
    expect(structure.sections[1]).toMatchObject({ srcStart: second, srcEnd: Buffer.byteLength(text) });
    const chapters = await render(f, structure);
    expect(chapters[0]).toBe('韩立出生在山村。\n他有个哥哥。');
    expect(await verifyVerbatim(f, structure, iter(chapters))).toEqual({ ok: true });
  });

  it('AI 把含正文的行判成 stray_number（如「第2章韩立说」）→ 不删，当正文', async () => {
    const text = '第一章 开端\n正文一。\n第2章韩立说\n正文二。\n';
    const { f, structure } = await prepare(text, {
      0: chap(),
      2: { type: 'noise', noiseKind: 'stray_number' },
    });
    expect(structure.dropLines.has(2)).toBe(false);
    expect([...structure.dropLines]).toEqual([0]);
    const chapters = await render(f, structure);
    expect(chapters[0]).toBe('正文一。\n第2章韩立说\n正文二。');
    expect(await verifyVerbatim(f, structure, iter(chapters))).toEqual({ ok: true });
  });

  it('《鬼吹灯》写法：part/volume/chapter 三层，带引言的卷不是 groupOnly', async () => {
    const text = [
      '第一部', '', '第一卷 精绝古城', '引言：沙漠深处。', '第一章 牛心山', '正文A', '第二章 古墓',
      '第二章 古墓', '正文B', '第二卷 龙岭迷窟', '第1章', '', '第三章 盗洞', '正文C',
      '第二部', '第四章 云南', '正文D', '',
    ].join('\r\n');
    const { f, structure } = await prepare(text, {
      0: { type: 'part' },
      2: { type: 'volume' },
      4: chap(),
      6: chap(),
      7: { type: 'duplicate' },
      9: { type: 'volume' },
      10: { type: 'noise', noiseKind: 'stray_number' },
      12: chap(),
      14: { type: 'part' },
      15: chap(),
    });
    expect(structure.sections.map(s => [s.level, s.title, s.groupOnly])).toEqual([
      [0, '第一部', true],
      [1, '第一卷 精绝古城', false],
      [2, '第一章 牛心山', false],
      [2, '第二章 古墓', false],
      [1, '第二卷 龙岭迷窟', true],
      [2, '第三章 盗洞', false],
      [0, '第二部', true],
      // 第二部下没有卷：章取部的下一层，不跳级
      [1, '第四章 云南', false],
    ]);
    expect([...structure.dropLines].sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 7, 9, 10, 12, 14, 15]);
    const chapters = await render(f, structure);
    expect(chapters[1]).toBe('引言：沙漠深处。');
    expect(await verifyVerbatim(f, structure, iter(chapters))).toEqual({ ok: true });
  });

  it('只有 noise:text 夹在卷后也算正文，卷不是 groupOnly', async () => {
    const text = '第一卷 起\n第一卷《起》开篇说明\n第一章 甲\n正文\n';
    const { structure } = await prepare(text, {
      0: { type: 'volume' },
      1: { type: 'noise', noiseKind: 'text' },
      2: chap(),
    });
    expect(structure.sections[0].groupOnly).toBe(false);
    expect(structure.dropLines.has(1)).toBe(false);
  });

  it('只有 chapter 的书 level 全为 0；章不在卷里时不跳级', async () => {
    const a = await prepare('第一章 甲\n正文\n第二章 乙\n正文\n', { 0: chap(), 2: chap() });
    expect(a.structure.sections.map(s => s.level)).toEqual([0, 0]);

    const b = await prepare('楔子\n正文\n第一卷 起\n第一章 甲\n正文\n', {
      0: chap(), 2: { type: 'volume' }, 3: chap(),
    });
    expect(b.structure.sections.map(s => [s.level, s.title])).toEqual([[0, '楔子'], [0, '第一卷 起'], [1, '第一章 甲']]);

    // 有部的书：部之前的卷不在部里 → 0；部前的章 → 卷下一层
    const c = await prepare('第一卷 起\n第一章 甲\n正文\n第一部\n第二卷 承\n第二章 乙\n正文\n', {
      0: { type: 'volume' }, 1: chap(),
      3: { type: 'part' }, 4: { type: 'volume' }, 5: chap(),
    });
    expect(c.structure.sections.map(s => s.level)).toEqual([0, 1, 0, 1, 2]);
  });

  it('前言：第一个标题之前的内容成为 preface', async () => {
    const text = '书名：测试\n作者：某人\n\n第2章\n第一章 开端\n正文\n';
    const { f, structure } = await prepare(text, {
      3: { type: 'noise', noiseKind: 'stray_number' },
      4: chap(),
    });
    const first = Buffer.byteLength('书名：测试\n作者：某人\n\n第2章\n');
    expect(structure.preface).toEqual({ srcStart: 0, srcEnd: first });
    expect(structure.sections[0].srcStart).toBe(first);
    const chapters = await render(f, structure);
    expect(chapters[0]).toBe('书名：测试\n作者：某人\n');
    expect(await verifyVerbatim(f, structure, iter(chapters))).toEqual({ ok: true });
  });
});

describe('duplicate 兜底', () => {
  it('「第5章 怎么像找对象？」后的「第0005章怎么像找对象？？」→ 去掉', async () => {
    const text = '第5章 怎么像找对象？\n第0005章怎么像找对象？？\n正文。\n';
    const { f, structure } = await prepare(text, { 0: chap(), 1: { type: 'duplicate' } });
    expect(structure.dropLines.has(1)).toBe(true);
    expect(structure.notes).toEqual([]);
    expect(await verifyVerbatim(f, structure, iter(await render(f, structure)))).toEqual({ ok: true });
  });

  it('「第六卷通天灵宝第九百九十一章紫雾」后的「第九百九十一章紫雾」→ 去掉', async () => {
    const text = '第六卷通天灵宝第九百九十一章紫雾\n第九百九十一章紫雾\n正文。\n';
    const { structure } = await prepare(text, { 0: chap(), 1: { type: 'duplicate' } });
    expect(structure.dropLines.has(1)).toBe(true);
    // 没有「保留为正文」的提醒；卷名前缀推断出一个分卷
    expect(structure.notes).toEqual(['从章节标题前缀推断出 1 个分卷']);
  });

  it('全角数字、编号不同但同名：「第５章」与「第五章」相同；编号不同则保留', async () => {
    const a = await prepare('第五章 夜\n第５章 夜\n正文\n', { 0: chap(), 1: { type: 'duplicate' } });
    expect(a.structure.dropLines.has(1)).toBe(true);
    const b = await prepare('第五章 夜\n第六章 夜\n正文\n', { 0: chap(), 1: { type: 'duplicate' } });
    expect(b.structure.dropLines.has(1)).toBe(false);
    expect(b.structure.notes).toHaveLength(1);
  });

  it('AI 把正文句子判成 duplicate → 不删，当正文，记一条 note，逐字校验仍通过', async () => {
    const text = '第二章 青牛镇\n第二章的时候他走进了镇子，看见很多人。\n镇上很安静。\n';
    const { f, structure } = await prepare(text, { 0: chap(), 1: { type: 'duplicate' } });
    expect(structure.dropLines.has(1)).toBe(false);
    expect(structure.notes).toEqual(['第 2 行被判为重复标题，但与上一标题不一致，已保留为正文：第二章的时候他走进了镇子，看见很多人。']);
    const chapters = await render(f, structure);
    expect(chapters[0]).toBe('第二章的时候他走进了镇子，看见很多人。\n镇上很安静。');
    expect(await verifyVerbatim(f, structure, iter(chapters))).toEqual({ ok: true });
  });

  it('前面没有标题的 duplicate → 不删，记 note', async () => {
    const { structure } = await prepare('第一章 开端\n第一章 开端\n正文\n', { 1: { type: 'duplicate' } });
    expect(structure.dropLines.has(1)).toBe(false);
    expect(structure.notes).toHaveLength(1);
  });

  it('被保留的 duplicate 让卷不再是 groupOnly', async () => {
    const { structure } = await prepare('第一卷 起\n第一卷开始的那天下雨了\n第一章 甲\n正文\n', {
      0: { type: 'volume' }, 1: { type: 'duplicate' }, 2: chap(),
    });
    expect(structure.sections[0].groupOnly).toBe(false);
  });
});

describe('verifyVerbatim', () => {
  it('verifyVerbatim：正文少一个字 → ok=false 并给出位置；完全一致 → ok=true', async () => {
    const text = '第一章 开端\r\n　　他走进了青牛镇。  \r\n\r\n天色已晚。\r\n第二章 镇上\r\n很安静。\r\n';
    const { f, structure } = await prepare(text, { 0: chap(), 4: chap() });
    // 段落首尾空白、空段落不影响比较
    expect(await verifyVerbatim(f, structure, iter(['他走进了青牛镇。\n\n  天色已晚。', '很安静。']))).toEqual({ ok: true });
    // 少一个「晚」字：左边「他走进了青牛镇。\n天色已晚。\n很安静。」第 13 个字符处不同
    expect(await verifyVerbatim(f, structure, iter(['他走进了青牛镇。\n天色已。', '很安静。']))).toEqual({ ok: false, firstDiffAt: 12 });
    // 右边多出一段
    expect(await verifyVerbatim(f, structure, iter(['他走进了青牛镇。\n天色已晚。', '很安静。', '多余'])))
      .toEqual({ ok: false, firstDiffAt: '他走进了青牛镇。\n天色已晚。\n很安静。'.length });
    // 右边少最后一段
    expect(await verifyVerbatim(f, structure, iter(['他走进了青牛镇。\n天色已晚。'])))
      .toEqual({ ok: false, firstDiffAt: '他走进了青牛镇。\n天色已晚。'.length });
    // 改了一个字
    expect(await verifyVerbatim(f, structure, iter(['他走进了青牛镇。\n天色已晚。', '很安净。'])))
      .toEqual({ ok: false, firstDiffAt: '他走进了青牛镇。\n天色已晚。\n很安'.length });
  });

  it('normalizeLine：原文每行先经过它再比较（如去掉控制字符）', async () => {
    const text = '第一章 开端\n正文\u0001甲\n\u0002\n';
    const { f, structure } = await prepare(text, { 0: chap() });
    const strip = (t: string) => t.replace(/[\u0000-\u001F]/g, '');
    expect(await verifyVerbatim(f, structure, iter(['正文甲']))).toMatchObject({ ok: false });
    expect(await verifyVerbatim(f, structure, iter(['正文甲']), strip)).toEqual({ ok: true });
  });
});

describe('按标题前缀推断分部 / 分卷', () => {
  it('《凡人修仙传》写法：部分章节带「第五卷名震一方」等前缀 → 推断出分卷，无前缀的章留在当前卷', async () => {
    const text = [
      '第六百四十七章 旧章', '正文0',
      '第五卷名震一方第六百四十八章至木灵婴', '正文1',
      '第六百四十九章 无前缀', '正文2',
      '第五卷名震一方第六百五十章 又带前缀', '正文3',
      '第六卷通天灵宝第六百五十一章 新卷', '正文4',
      '第六百五十二章 无前缀二', '正文5',
      // 乱入的旧前缀：编号不比当前大，不建卷
      '第五卷名震一方第六百五十三章 乱入', '正文6',
      '',
    ].join('\n');
    const { f, structure } = await prepare(text, {
      0: chap(),
      2: chap(),
      4: chap(),
      6: chap(),
      8: chap(),
      10: chap(),
      12: chap(),
    });
    expect(structure.sections.map(s => [s.level, s.title, s.groupOnly])).toEqual([
      [0, '第六百四十七章 旧章', false],
      [0, '第五卷名震一方', true],
      [1, '第六百四十八章至木灵婴', false],
      [1, '第六百四十九章 无前缀', false],
      [1, '第六百五十章 又带前缀', false],
      [0, '第六卷通天灵宝', true],
      [1, '第六百五十一章 新卷', false],
      [1, '第六百五十二章 无前缀二', false],
      // 乱入的旧卷前缀：不在该卷下，标题保留前缀
      [1, '第五卷名震一方第六百五十三章 乱入', false],
    ]);
    // 推断出的卷：区间为空，落在触发它的章的开头
    const vol5 = structure.sections[1];
    expect(vol5.srcStart).toBe(structure.sections[2].srcStart);
    expect(vol5.srcEnd).toBe(vol5.srcStart);
    expect([...structure.dropLines].sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(structure.notes).toEqual(['从章节标题前缀推断出 2 个分卷']);
    const chapters = await render(f, structure);
    expect(chapters[1]).toBe('');
    expect(chapters[2]).toBe('正文1');
    expect(await verifyVerbatim(f, structure, iter(chapters))).toEqual({ ok: true });
  });

  it('单独的「第十卷魔界之战」出现两次 → 只有一个卷，第二行去掉（不当正文），记 note', async () => {
    const text = [
      '第十卷魔界之战', '第一千章 甲', '正文1',
      '第十卷魔界之战', '第一千零一章 乙', '正文2',
      '第十一卷真仙降世第一千零二章 丙', '正文3', '',
    ].join('\n');
    const { f, structure } = await prepare(text, {
      0: { type: 'volume' },
      1: chap(),
      3: { type: 'volume' },
      4: chap(),
      6: chap(),
    });
    expect(structure.sections.map(s => [s.level, s.title, s.groupOnly])).toEqual([
      [0, '第十卷魔界之战', true],
      [1, '第一千章 甲', false],
      [1, '第一千零一章 乙', false],
      [0, '第十一卷真仙降世', true],
      [1, '第一千零二章 丙', false],
    ]);
    expect(structure.dropLines.has(3)).toBe(true);
    expect(structure.notes).toEqual([
      '第 4 行是重复的分卷标题，已去掉：第十卷魔界之战',
      '从章节标题前缀推断出 1 个分卷',
    ]);
    const chapters = await render(f, structure);
    expect(chapters[1]).toBe('正文1');
    expect(await verifyVerbatim(f, structure, iter(chapters))).toEqual({ ok: true });
  });

  it('《鬼吹灯》写法：「第一部第一卷《精绝古城》」推断出第一部，卷名不重复部名', async () => {
    const text = [
      '第一部第一卷《精绝古城》', '第一章 牛心山', '正文A',
      '第一部第二卷《龙岭迷窟》', '第二章 盗洞', '正文B',
      '第二部', '第一卷 黄皮子坟', '第三章 林场', '正文C', '',
    ].join('\n');
    const { f, structure } = await prepare(text, {
      0: { type: 'volume' },
      1: chap(),
      3: { type: 'volume' },
      4: chap(),
      6: { type: 'part' },
      7: { type: 'volume' },
      8: chap(),
    });
    expect(structure.sections.map(s => [s.level, s.title, s.groupOnly])).toEqual([
      [0, '第一部', true],
      [1, '第一卷《精绝古城》', true],
      [2, '第一章 牛心山', false],
      [1, '第二卷《龙岭迷窟》', true],
      [2, '第二章 盗洞', false],
      [0, '第二部', true],
      [1, '第一卷 黄皮子坟', true],
      [2, '第三章 林场', false],
    ]);
    expect(structure.sections[0]).toMatchObject({ srcStart: 0, srcEnd: 0 });
    expect(structure.notes).toEqual(['从章节标题前缀推断出 1 个分部']);
    expect(await verifyVerbatim(f, structure, iter(await render(f, structure)))).toEqual({ ok: true });
  });

  it('「第一部分 / 第二部分」被标成章 → 不推断分部，标题不被剥掉', async () => {
    const { structure } = await prepare('第一部分 缘起\n正文\n第二部分 经过\n正文\n', {
      0: chap(), 2: chap(),
    });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([[0, '第一部分 缘起'], [0, '第二部分 经过']]);
    expect(structure.notes).toEqual([]);
  });

  it('AI 标成卷，但原文卷名后带章号 → 按章处理，章名取原文去掉卷名前缀', async () => {
    const text = '第六卷通天灵宝第九百八十四章银瞳幻术\n正文\n';
    const { f, structure } = await prepare(text, { 0: { type: 'volume' } });
    expect(structure.sections.map(s => [s.level, s.title, s.groupOnly])).toEqual([
      [0, '第六卷通天灵宝', true],
      [1, '第九百八十四章银瞳幻术', false],
    ]);
    expect(await verifyVerbatim(f, structure, iter(await render(f, structure)))).toEqual({ ok: true });
  });

  it('前缀允许空白和全角数字', async () => {
    const { structure } = await prepare('第 ２ 部 第３卷 风起 第１章 甲\n正文\n', { 0: chap() });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '第 ２ 部'], [1, '第３卷 风起'], [2, '第１章 甲'],
    ]);
  });
});

describe('按 AI 指出的 volumeTitle 建卷、同名卷合并', () => {
  const vt = (volumeTitle: string): L => ({ type: 'chapter', volumeTitle });

  it('volumeTitle 建卷：之后的章挂在新卷下，记 note', async () => {
    const text = [
      '第一卷 甲', '第一章 子', '正文1', '第二章 丑', '正文2',
      '《鬼吹灯之云南虫谷》 第三章 寅', '正文3', '第四章 卯', '正文4', '',
    ].join('\n');
    const { f, structure } = await prepare(text, {
      0: { type: 'volume' }, 1: chap(), 3: chap(), 5: vt('云南虫谷'), 7: chap(),
    });
    expect(structure.sections.map(s => [s.level, s.title, s.groupOnly])).toEqual([
      [0, '第一卷 甲', true],
      [1, '第一章 子', false],
      [1, '第二章 丑', false],
      [0, '云南虫谷', true],
      [1, '第三章 寅', false],
      [1, '第四章 卯', false],
    ]);
    // 推断卷：区间为空，落在触发它的章的开头
    expect(structure.sections[3].srcStart).toBe(structure.sections[4].srcStart);
    expect(structure.sections[3].srcEnd).toBe(structure.sections[3].srcStart);
    expect(structure.notes).toContain('AI 指出 1 处新分卷：云南虫谷');
    expect(await verifyVerbatim(f, structure, iter(await render(f, structure)))).toEqual({ ok: true });
  });

  it('与上一独立卷同名不新建', async () => {
    const text = '第一部第二卷《龙岭迷窟》\n《鬼吹灯之龙岭迷窟》 第一章 甲\n正文\n';
    const { structure } = await prepare(text, { 0: { type: 'volume' }, 1: vt('龙岭迷窟') });
    expect(structure.sections.filter(s => s.title.includes('龙岭')).length).toBe(1);
    expect(structure.sections.map(s => s.title)).toEqual(['第一部', '第二卷《龙岭迷窟》', '第一章 甲']);
    expect(structure.notes.some(n => n.startsWith('AI 指出'))).toBe(false);
  });

  it('同一卷多次给出 volumeTitle 不重复建卷', async () => {
    const text = '《云南虫谷》 第一章 甲\n正文\n《云南虫谷》 第二章 乙\n正文\n';
    const { structure } = await prepare(text, { 0: vt('云南虫谷'), 2: vt('云南虫谷') });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '云南虫谷'], [1, '第一章 甲'], [1, '第二章 乙'],
    ]);
    expect(structure.notes).toContain('AI 指出 1 处新分卷：云南虫谷');
  });

  it('推断卷后同名前缀不新建，章去掉卷名前缀', async () => {
    const text = [
      '《鬼吹灯之巫峡棺山》 第四十四章 入峡', '正文1',
      '第四卷 巫峡棺山 第四十五章 奇遇', '正文2', '',
    ].join('\n');
    const { f, structure } = await prepare(text, { 0: vt('巫峡棺山'), 2: chap() });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '巫峡棺山'], [1, '第四十四章 入峡'], [1, '第四十五章 奇遇'],
    ]);
    expect(structure.notes).toEqual(['AI 指出 1 处新分卷：巫峡棺山']);
    expect(await verifyVerbatim(f, structure, iter(await render(f, structure)))).toEqual({ ok: true });
  });

  it('命中前缀分支的行忽略其 volumeTitle', async () => {
    const text = '第五卷名震一方第六百四十八章 甲\n正文\n';
    const { structure } = await prepare(text, { 0: vt('名震一方') });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([[0, '第五卷名震一方'], [1, '第六百四十八章 甲']]);
    expect(structure.notes).toEqual(['从章节标题前缀推断出 1 个分卷']);
  });

  it('短卷名与长卷名视为同卷', async () => {
    const text = '第二卷《龙岭迷窟》\n龙岭 第一章 甲\n正文\n';
    const { structure } = await prepare(text, { 0: { type: 'volume' }, 1: vt('龙岭') });
    expect(structure.sections.map(s => s.title)).toEqual(['第二卷《龙岭迷窟》', '龙岭 第一章 甲']);
  });

  it('不同卷名不误合并', async () => {
    const text = '《云南虫谷》 第一章 甲\n正文\n《昆仑神宫》 第二章 乙\n正文\n';
    const { structure } = await prepare(text, { 0: vt('云南虫谷'), 2: vt('昆仑神宫') });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '云南虫谷'], [1, '第一章 甲'], [0, '昆仑神宫'], [1, '第二章 乙'],
    ]);
    expect(structure.notes).toContain('AI 指出 2 处新分卷：云南虫谷、昆仑神宫');
  });

  it('volumeTitle 卷之后出现同名独立卷行 → 视为重复卷标题去掉', async () => {
    const text = '《云南虫谷》 第一章 甲\n正文1\n第三卷 云南虫谷\n第二章 乙\n正文2\n';
    const { f, structure } = await prepare(text, { 0: vt('云南虫谷'), 2: { type: 'volume' }, 3: chap() });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '云南虫谷'], [1, '第一章 甲'], [1, '第二章 乙'],
    ]);
    expect(structure.dropLines.has(2)).toBe(true);
    expect(structure.notes).toContain('第 3 行是重复的分卷标题，已去掉：第三卷 云南虫谷');
    expect(await verifyVerbatim(f, structure, iter(await render(f, structure)))).toEqual({ ok: true });
  });

  it('编号不同的两个独立卷，卷名互相包含也不合并（「风起 / 风起云涌」）', async () => {
    const text = '第一卷 风起\n第一章 甲\n正文1\n第二卷 风起云涌\n第二章 乙\n正文2\n';
    const { structure } = await prepare(text, { 0: { type: 'volume' }, 1: chap(), 3: { type: 'volume' }, 4: chap() });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '第一卷 风起'], [1, '第一章 甲'], [0, '第二卷 风起云涌'], [1, '第二章 乙'],
    ]);
    expect(structure.dropLines.has(3)).toBe(true);
    expect(structure.notes.some(n => n.includes('重复的分卷标题'))).toBe(false);
  });

  it('编号不同的两个独立卷，「江湖 上 / 江湖」也不合并', async () => {
    const text = '第一卷 江湖 上\n第一章 甲\n正文1\n第二卷 江湖\n第二章 乙\n正文2\n';
    const { structure } = await prepare(text, { 0: { type: 'volume' }, 1: chap(), 3: { type: 'volume' }, 4: chap() });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '第一卷 江湖 上'], [1, '第一章 甲'], [0, '第二卷 江湖'], [1, '第二章 乙'],
    ]);
  });

  it('前缀分支：当前卷有编号时，编号不同的同名前缀不按名称合并（编号不倒退）', async () => {
    const text = '第三卷 龙岭\n第一章 甲\n正文1\n第二卷龙岭第二章 乙\n正文2\n第三卷龙岭第三章 丙\n正文3\n';
    const { structure } = await prepare(text, { 0: { type: 'volume' }, 1: chap(), 3: chap(), 5: chap() });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '第三卷 龙岭'], [1, '第一章 甲'],
      // 乱入的旧卷前缀：不在该卷下，标题保留前缀
      [1, '第二卷龙岭第二章 乙'],
      // 当前卷仍是第三卷：去掉卷名前缀
      [1, '第三章 丙'],
    ]);
  });

  it('有编号无卷名、尚无章的卷后紧跟带 volumeTitle 的章 → 只补卷名，不另建卷', async () => {
    const text = '第三卷\n《鬼吹灯之云南虫谷》 第一章 甲\n正文1\n第二章 乙\n正文2\n第三卷 云南虫谷\n第三章 丙\n正文3\n';
    const { f, structure } = await prepare(text, { 0: { type: 'volume' }, 1: vt('云南虫谷'), 3: chap(), 5: { type: 'volume' }, 6: chap() });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '第三卷'], [1, '第一章 甲'], [1, '第二章 乙'], [1, '第三章 丙'],
    ]);
    expect(structure.notes.some(n => n.startsWith('AI 指出'))).toBe(false);
    expect(structure.notes).toContain('第 6 行是重复的分卷标题，已去掉：第三卷 云南虫谷');
    expect(await verifyVerbatim(f, structure, iter(await render(f, structure)))).toEqual({ ok: true });
  });

  it('有编号无卷名的卷下已有章时，volumeTitle 照常建新卷', async () => {
    const text = '第三卷\n第一章 甲\n正文1\n《鬼吹灯之云南虫谷》 第二章 乙\n正文2\n';
    const { structure } = await prepare(text, { 0: { type: 'volume' }, 1: chap(), 3: vt('云南虫谷') });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '第三卷'], [1, '第一章 甲'], [0, '云南虫谷'], [1, '第二章 乙'],
    ]);
  });

  it('进入新部后同名卷名不再合并', async () => {
    const text = '《云南虫谷》 第一章 甲\n正文\n第二部\n《云南虫谷》 第二章 乙\n正文\n';
    const { structure } = await prepare(text, { 0: vt('云南虫谷'), 2: { type: 'part' }, 3: vt('云南虫谷') });
    expect(structure.sections.map(s => s.title)).toEqual(['云南虫谷', '第一章 甲', '第二部', '云南虫谷', '第二章 乙']);
  });
});

describe('卷前言归位', () => {
  it('卷标题行后无正文：前言章放到该卷之下，逐字校验通过', async () => {
    const text = [
      '第三卷 怒晴湘西 前言', '前言正文', '第三卷 怒晴湘西', '', '第一章 琉璃厂', '正文1', '',
    ].join('\n');
    const { f, structure } = await prepare(text, { 0: chap(), 2: { type: 'volume' }, 4: chap() });
    expect(structure.sections.map(s => [s.level, s.title, s.groupOnly])).toEqual([
      [0, '第三卷 怒晴湘西', true],
      [1, '第三卷 怒晴湘西 前言', false],
      [1, '第一章 琉璃厂', false],
    ]);
    // 字节区间按原文位置
    const [vol, pre, ch1] = structure.sections;
    expect(pre.srcStart).toBe(0);
    expect(pre.srcEnd).toBe(vol.srcStart);
    expect(vol.srcEnd).toBe(ch1.srcStart);
    expect(structure.preface).toBeNull();
    // 按输出顺序切出正文（只有标题的卷不输出正文），与原文逐字一致
    const out: string[] = [];
    for (const s of structure.sections) {
      const parts: string[] = [];
      for await (const line of readTxtLines(f)) {
        if (s.groupOnly || structure.dropLines.has(line.lineNo)) continue;
        if (line.byteStart >= s.srcStart && line.byteStart < s.srcEnd) parts.push(line.text);
      }
      out.push(parts.join('\n'));
    }
    expect(out.slice(0, 2)).toEqual(['', '前言正文']);
    expect(out[2].trim()).toBe('正文1');
    expect(await verifyVerbatim(f, structure, iter(out))).toEqual({ ok: true });
    expect(structure.notes).toEqual([]);
  });

  it('卷标题后有正文：不重排，记 note', async () => {
    const text = [
      '第三卷 怒晴湘西 前言', '前言正文', '第三卷 怒晴湘西', '卷首语', '第一章 琉璃厂', '正文1', '',
    ].join('\n');
    const { structure } = await prepare(text, { 0: chap(), 2: { type: 'volume' }, 4: chap() });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '第三卷 怒晴湘西 前言'], [0, '第三卷 怒晴湘西'], [1, '第一章 琉璃厂'],
    ]);
    expect(structure.notes).toEqual(['第 1 行像是卷前言，但卷标题后有正文，未调整位置：第三卷 怒晴湘西 前言']);
  });

  it('卷编号不同不当卷前言', async () => {
    const text = '第二卷 甲 后记\n正文\n第三卷 乙\n第一章 子\n正文\n';
    const { structure } = await prepare(text, { 0: chap(), 2: { type: 'volume' }, 3: chap() });
    expect(structure.sections.map(s => s.title)).toEqual(['第二卷 甲 后记', '第三卷 乙', '第一章 子']);
    expect(structure.notes).toEqual([]);
  });
});
