import fs from 'fs';
import os from 'os';
import path from 'path';
import { readTxtLines } from '../../../src/services/txt-organize/lines';
import { Candidate } from '../../../src/services/txt-organize/candidates';
import { Label } from '../../../src/services/txt-organize/judge';
import { buildStructure, isStrictStrayNumber, verifyVerbatim, OrgStructure } from '../../../src/services/txt-organize/structure';

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

const chap = (title: string): L => ({ type: 'chapter', title });

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

describe('buildStructure', () => {
  it('《凡人修仙传》写法：chapter + stray_number 合并，第2章行进 dropLines，正文连续', async () => {
    const text = '第一章 山边小村\n韩立出生在山村。\n第2章\n他有个哥哥。\n第二章 青牛镇\n镇上很安静。\n';
    const { f, structure } = await prepare(text, {
      0: chap('第一章 山边小村'),
      2: { type: 'noise', noiseKind: 'stray_number' },
      4: chap('第二章 青牛镇'),
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
      0: chap('第一章 开端'),
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
      0: { type: 'part', title: '第一部' },
      2: { type: 'volume', title: '第一卷 精绝古城' },
      4: chap('第一章 牛心山'),
      6: chap('第二章 古墓'),
      7: { type: 'duplicate' },
      9: { type: 'volume', title: '第二卷 龙岭迷窟' },
      10: { type: 'noise', noiseKind: 'stray_number' },
      12: chap('第三章 盗洞'),
      14: { type: 'part', title: '第二部' },
      15: chap('第四章 云南'),
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
      0: { type: 'volume', title: '第一卷 起' },
      1: { type: 'noise', noiseKind: 'text' },
      2: chap('第一章 甲'),
    });
    expect(structure.sections[0].groupOnly).toBe(false);
    expect(structure.dropLines.has(1)).toBe(false);
  });

  it('只有 chapter 的书 level 全为 0；章不在卷里时不跳级', async () => {
    const a = await prepare('第一章 甲\n正文\n第二章 乙\n正文\n', { 0: chap('第一章 甲'), 2: chap('第二章 乙') });
    expect(a.structure.sections.map(s => s.level)).toEqual([0, 0]);

    const b = await prepare('楔子\n正文\n第一卷 起\n第一章 甲\n正文\n', {
      0: chap('楔子'), 2: { type: 'volume', title: '第一卷 起' }, 3: chap('第一章 甲'),
    });
    expect(b.structure.sections.map(s => [s.level, s.title])).toEqual([[0, '楔子'], [0, '第一卷 起'], [1, '第一章 甲']]);

    // 有部的书：部之前的卷不在部里 → 0；部前的章 → 卷下一层
    const c = await prepare('第一卷 起\n第一章 甲\n正文\n第一部\n第二卷 承\n第二章 乙\n正文\n', {
      0: { type: 'volume', title: '第一卷 起' }, 1: chap('第一章 甲'),
      3: { type: 'part', title: '第一部' }, 4: { type: 'volume', title: '第二卷 承' }, 5: chap('第二章 乙'),
    });
    expect(c.structure.sections.map(s => s.level)).toEqual([0, 1, 0, 1, 2]);
  });

  it('前言：第一个标题之前的内容成为 preface', async () => {
    const text = '书名：测试\n作者：某人\n\n第2章\n第一章 开端\n正文\n';
    const { f, structure } = await prepare(text, {
      3: { type: 'noise', noiseKind: 'stray_number' },
      4: chap('第一章 开端'),
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
    const { f, structure } = await prepare(text, { 0: chap('第5章 怎么像找对象？'), 1: { type: 'duplicate' } });
    expect(structure.dropLines.has(1)).toBe(true);
    expect(structure.notes).toEqual([]);
    expect(await verifyVerbatim(f, structure, iter(await render(f, structure)))).toEqual({ ok: true });
  });

  it('「第六卷通天灵宝第九百九十一章紫雾」后的「第九百九十一章紫雾」→ 去掉', async () => {
    const text = '第六卷通天灵宝第九百九十一章紫雾\n第九百九十一章紫雾\n正文。\n';
    const { structure } = await prepare(text, { 0: chap('第九百九十一章 紫雾'), 1: { type: 'duplicate' } });
    expect(structure.dropLines.has(1)).toBe(true);
    // 没有「保留为正文」的提醒；卷名前缀推断出一个分卷
    expect(structure.notes).toEqual(['从章节标题前缀推断出 1 个分卷']);
  });

  it('全角数字、编号不同但同名：「第５章」与「第五章」相同；编号不同则保留', async () => {
    const a = await prepare('第五章 夜\n第５章 夜\n正文\n', { 0: chap('第五章 夜'), 1: { type: 'duplicate' } });
    expect(a.structure.dropLines.has(1)).toBe(true);
    const b = await prepare('第五章 夜\n第六章 夜\n正文\n', { 0: chap('第五章 夜'), 1: { type: 'duplicate' } });
    expect(b.structure.dropLines.has(1)).toBe(false);
    expect(b.structure.notes).toHaveLength(1);
  });

  it('AI 把正文句子判成 duplicate → 不删，当正文，记一条 note，逐字校验仍通过', async () => {
    const text = '第二章 青牛镇\n第二章的时候他走进了镇子，看见很多人。\n镇上很安静。\n';
    const { f, structure } = await prepare(text, { 0: chap('第二章 青牛镇'), 1: { type: 'duplicate' } });
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
      0: { type: 'volume', title: '第一卷 起' }, 1: { type: 'duplicate' }, 2: chap('第一章 甲'),
    });
    expect(structure.sections[0].groupOnly).toBe(false);
  });
});

describe('verifyVerbatim', () => {
  it('verifyVerbatim：正文少一个字 → ok=false 并给出位置；完全一致 → ok=true', async () => {
    const text = '第一章 开端\r\n　　他走进了青牛镇。  \r\n\r\n天色已晚。\r\n第二章 镇上\r\n很安静。\r\n';
    const { f, structure } = await prepare(text, { 0: chap('第一章 开端'), 4: chap('第二章 镇上') });
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
    const { f, structure } = await prepare(text, { 0: chap('第一章 开端') });
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
      0: chap('第六百四十七章 旧章'),
      2: chap('第六百四十八章 至木灵婴'),
      4: chap('第六百四十九章 无前缀'),
      6: chap('第六百五十章 又带前缀'),
      8: chap('第六百五十一章 新卷'),
      10: chap('第六百五十二章 无前缀二'),
      12: chap('第六百五十三章 乱入'),
    });
    expect(structure.sections.map(s => [s.level, s.title, s.groupOnly])).toEqual([
      [0, '第六百四十七章 旧章', false],
      [0, '第五卷名震一方', true],
      [1, '第六百四十八章 至木灵婴', false],
      [1, '第六百四十九章 无前缀', false],
      [1, '第六百五十章 又带前缀', false],
      [0, '第六卷通天灵宝', true],
      [1, '第六百五十一章 新卷', false],
      [1, '第六百五十二章 无前缀二', false],
      [1, '第六百五十三章 乱入', false],
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
      0: { type: 'volume', title: '第十卷魔界之战' },
      1: chap('第一千章 甲'),
      3: { type: 'volume', title: '第十卷魔界之战' },
      4: chap('第一千零一章 乙'),
      6: chap('第一千零二章 丙'),
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
      0: { type: 'volume', title: '第一卷《精绝古城》' },
      1: chap('第一章 牛心山'),
      3: { type: 'volume', title: '第一部第二卷《龙岭迷窟》' },
      4: chap('第二章 盗洞'),
      6: { type: 'part', title: '第二部' },
      7: { type: 'volume', title: '第一卷 黄皮子坟' },
      8: chap('第三章 林场'),
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
      0: chap('第一部分 缘起'), 2: chap('第二部分 经过'),
    });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([[0, '第一部分 缘起'], [0, '第二部分 经过']]);
    expect(structure.notes).toEqual([]);
  });

  it('AI 标成卷、标题只给了卷名，但原文卷名后带章号 → 按章处理，章名取原文去掉卷名前缀', async () => {
    const text = '第六卷通天灵宝第九百八十四章银瞳幻术\n正文\n';
    const { f, structure } = await prepare(text, { 0: { type: 'volume', title: '第六卷通天灵宝' } });
    expect(structure.sections.map(s => [s.level, s.title, s.groupOnly])).toEqual([
      [0, '第六卷通天灵宝', true],
      [1, '第九百八十四章银瞳幻术', false],
    ]);
    expect(await verifyVerbatim(f, structure, iter(await render(f, structure)))).toEqual({ ok: true });
  });

  it('前缀允许空白和全角数字', async () => {
    const { structure } = await prepare('第 ２ 部 第３卷 风起 第１章 甲\n正文\n', { 0: chap('第１章 甲') });
    expect(structure.sections.map(s => [s.level, s.title])).toEqual([
      [0, '第 ２ 部'], [1, '第３卷 风起'], [2, '第１章 甲'],
    ]);
  });
});
