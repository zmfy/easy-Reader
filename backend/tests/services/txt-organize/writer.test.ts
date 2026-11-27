import fs from 'fs';
import os from 'os';
import path from 'path';
import { readTxtLines } from '../../../src/services/txt-organize/lines';
import { Candidate } from '../../../src/services/txt-organize/candidates';
import { Label } from '../../../src/services/txt-organize/judge';
import { buildStructure, OrgStructure } from '../../../src/services/txt-organize/structure';
import { writeOrganizedEpub, organizedDir } from '../../../src/services/txt-organize/writer';
import { EpubParser } from '../../../src/plugins/parser-epub';

// 校验失败用例：让 verifyVerbatim 返回不一致（其余用例走真实实现）
let forceVerifyFail = false;
jest.mock('../../../src/services/txt-organize/structure', () => {
  const actual = jest.requireActual('../../../src/services/txt-organize/structure');
  return {
    ...actual,
    verifyVerbatim: (...args: unknown[]) =>
      forceVerifyFail ? Promise.resolve({ ok: false, firstDiffAt: 0 }) : actual.verifyVerbatim(...args),
  };
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-writer-'));
process.env.DATA_DIR = path.join(dir, 'data');
let seq = 0;
const write = (text: string | Buffer) => {
  const f = path.join(dir, `b${seq++}.txt`);
  fs.writeFileSync(f, text);
  return f;
};

type L = Omit<Label, 'id'>;
const chap = (title: string): L => ({ type: 'chapter', title });

/** 按行号给出判定结果，生成结构（同 structure.test.ts 的 prepare） */
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
  return { f, structure: buildStructure(candidates, labels, fs.statSync(f).size) };
}

/** EPUB 章节 HTML → 段落纯文本 */
const paragraphs = (html: string) =>
  [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m =>
    m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));

async function readBack(file: string) {
  const p = new EpubParser();
  await p.load(file);
  const chapters = await p.getChapters();
  const bodies: string[][] = [];
  for (const c of chapters) bodies.push(paragraphs(await p.getChapterContent(c.index)));
  return { chapters, bodies };
}

// 《鬼吹灯》式三层：前言 + 部（只有标题）+ 卷（带引言）+ 章；CRLF；含需要转义的字符
const GUI = [
  '书名：鬼吹灯', '作者：天下霸唱', '',
  '第一部', '', '第一卷 精绝古城', '引言：<沙漠> & "深处"。', '第一章 牛心山', '　　正文A', '第二章 古墓',
  '第二章 古墓', '正文B', '', '正文B2', '第二卷 龙岭迷窟', '第1章', '', '第三章 盗洞', '正文C',
].join('\r\n');
const GUI_LABELS: Record<number, L> = {
  3: { type: 'part', title: '第一部' },
  5: { type: 'volume', title: '第一卷 精绝古城' },
  7: chap('第一章 牛心山'),
  9: chap('第二章 古墓'),
  10: { type: 'duplicate' },
  14: { type: 'volume', title: '第二卷 龙岭迷窟' },
  15: { type: 'noise', noiseKind: 'stray_number' },
  17: chap('第三章 盗洞'),
};

describe('writeOrganizedEpub', () => {
  beforeEach(() => { forceVerifyFail = false; });

  it('organizedDir 在 DATA_DIR/organized 下，不存在时创建', () => {
    const d = organizedDir();
    expect(d).toBe(path.join(process.env.DATA_DIR!, 'organized'));
    expect(fs.existsSync(d)).toBe(true);
  });

  it('生成的 EPUB 用 EpubParser 读回：章节数、标题、层级与结构一致', async () => {
    const { f, structure } = await prepare(GUI, GUI_LABELS);
    const res = await writeOrganizedEpub({ newBookId: 'gui1', sourcePath: f, structure, title: '鬼吹灯（整理版）', author: '天下霸唱' });
    expect(res.filePath).toBe(path.join(organizedDir(), 'gui1.epub'));
    const { chapters } = await readBack(res.filePath);
    expect(chapters.map(c => [c.title, c.level ?? 0])).toEqual([
      ['前言', 0],
      ['第一部', 0],
      ['第一卷 精绝古城', 1],
      ['第一章 牛心山', 2],
      ['第二章 古墓', 2],
      ['第二卷 龙岭迷窟', 1],
      ['第三章 盗洞', 2],
    ]);
  });

  it('读回的全部正文与原文（去掉标题行等）逐字一致', async () => {
    const { f, structure } = await prepare(GUI, GUI_LABELS);
    const res = await writeOrganizedEpub({ newBookId: 'gui2', sourcePath: f, structure, title: '鬼吹灯（整理版）' });
    const { bodies } = await readBack(res.filePath);
    expect(bodies).toEqual([
      ['书名：鬼吹灯', '作者：天下霸唱'],
      [],
      ['引言：<沙漠> & "深处"。'],
      ['正文A'],
      ['正文B', '正文B2'],
      [],
      ['正文C'],
    ]);
  });

  it('chapterMap 的 chapterIndex 与 EpubParser 章节序号对应，区间覆盖原文', async () => {
    const { f, structure } = await prepare(GUI, GUI_LABELS);
    const res = await writeOrganizedEpub({ newBookId: 'gui3', sourcePath: f, structure, title: '书' });
    const { chapters } = await readBack(res.filePath);
    expect(res.chapterMap.map(m => m.chapterIndex)).toEqual(chapters.map(c => c.index));
    const s = structure.sections;
    expect(res.chapterMap[0]).toEqual({ chapterIndex: 0, srcStart: 0, srcEnd: s[0].srcStart });
    // 只有标题的部 / 卷：区间为空，落在标题行开头
    expect(res.chapterMap[1]).toEqual({ chapterIndex: 1, srcStart: s[0].srcStart, srcEnd: s[0].srcStart });
    expect(res.chapterMap[5]).toEqual({ chapterIndex: 5, srcStart: s[4].srcStart, srcEnd: s[4].srcStart });
    expect(res.chapterMap[3]).toEqual({ chapterIndex: 3, srcStart: s[2].srcStart, srcEnd: s[2].srcEnd });
    // 区间首尾相接覆盖整个文件（只有标题的部 / 卷占的是它在原文里的标题行区间）
    const ends = res.chapterMap.map((m, i) => (i > 0 && s[i - 1].groupOnly ? s[i - 1].srcEnd : m.srcEnd));
    expect(res.chapterMap[0].srcStart).toBe(0);
    for (let i = 1; i < res.chapterMap.length; i++) expect(res.chapterMap[i].srcStart).toBe(ends[i - 1]);
    expect(ends[ends.length - 1]).toBe(fs.statSync(f).size);
  });

  it('前言只有空行和要去掉的行时不生成「前言」章', async () => {
    const { f, structure } = await prepare('\n第2章\n\n第一章 开端\n正文\n', {
      1: { type: 'noise', noiseKind: 'stray_number' },
      3: chap('第一章 开端'),
    });
    expect(structure.preface).not.toBeNull();
    const res = await writeOrganizedEpub({ newBookId: 'np', sourcePath: f, structure, title: '书' });
    const { chapters, bodies } = await readBack(res.filePath);
    expect(chapters.map(c => c.title)).toEqual(['第一章 开端']);
    expect(bodies).toEqual([['正文']]);
    expect(res.chapterMap).toEqual([{ chapterIndex: 0, srcStart: structure.sections[0].srcStart, srcEnd: fs.statSync(f).size }]);
  });

  it('GBK 文件也逐字写出', async () => {
    const iconv = (await import('iconv-lite')).default;
    const text = '第一章 开端\n这是一段足够长的中文正文，用来让编码识别认出它是简体中文的国标编码文本。\n第二章 继续\n又是一段中文。\n';
    const f = write(iconv.encode(text, 'gbk'));
    const candidates: Candidate[] = [];
    const labels: Label[] = [];
    for await (const line of readTxtLines(f)) {
      if (line.lineNo === 0 || line.lineNo === 2) {
        const id = candidates.length;
        candidates.push({ id, lineNo: line.lineNo, byteStart: line.byteStart, byteEnd: line.byteEnd, text: line.text,
          bodyChars: 1, bodyLines: 1, prevSnippet: '', nextSnippet: '', ruleHint: 'none' });
        labels.push({ id, ...chap(line.text) });
      }
    }
    const structure = buildStructure(candidates, labels, fs.statSync(f).size);
    const res = await writeOrganizedEpub({ newBookId: 'gbk', sourcePath: f, structure, title: '书' });
    const { bodies } = await readBack(res.filePath);
    expect(bodies).toEqual([['这是一段足够长的中文正文，用来让编码识别认出它是简体中文的国标编码文本。'], ['又是一段中文。']]);
  });

  it('校验失败时不留下文件', async () => {
    const { f, structure } = await prepare(GUI, GUI_LABELS);
    forceVerifyFail = true;
    await expect(writeOrganizedEpub({ newBookId: 'bad', sourcePath: f, structure, title: '书' }))
      .rejects.toThrow('整理结果与原文不一致');
    expect(fs.existsSync(path.join(organizedDir(), 'bad.epub'))).toBe(false);
  });

  it('结构与原文对不上（只有标题的卷里其实有正文）时报错，不悄悄丢字', async () => {
    const { f, structure } = await prepare(GUI, GUI_LABELS);
    const bad: OrgStructure = { ...structure, sections: structure.sections.map((s, i) => (i === 1 ? { ...s, groupOnly: true } : s)) };
    await expect(writeOrganizedEpub({ newBookId: 'bad2', sourcePath: f, structure: bad, title: '书' }))
      .rejects.toThrow('整理结果与原文不一致');
    expect(fs.existsSync(path.join(organizedDir(), 'bad2.epub'))).toBe(false);
  });

  it('正文开头有与标题相同的行（AI 把重复标题判成 noise:text）→ 整理成功，这一行保留', async () => {
    const { f, structure } = await prepare('第一章 开端\n第一章 开端\n正文\n', {
      0: chap('第一章 开端'), 1: { type: 'noise', noiseKind: 'text' },
    });
    expect(structure.dropLines.has(1)).toBe(false);
    const res = await writeOrganizedEpub({ newBookId: 'dup', sourcePath: f, structure, title: '书' });
    const { chapters, bodies } = await readBack(res.filePath);
    expect(chapters.map(c => c.title)).toEqual(['第一章 开端']);
    expect(bodies).toEqual([['第一章 开端', '正文']]);
  });

  it('从标题前缀推断出的部 / 卷：EPUB 读回为只有标题的分组，层级嵌套，正文不变', async () => {
    const text = [
      '第一部第一卷《精绝古城》第一章 牛心山', '正文A',
      '第二章 古墓', '正文B',
      '第一部第二卷《龙岭迷窟》第三章 盗洞', '正文C', '',
    ].join('\n');
    const { f, structure } = await prepare(text, {
      0: chap('第一章 牛心山'), 2: chap('第二章 古墓'), 4: chap('第三章 盗洞'),
    });
    const res = await writeOrganizedEpub({ newBookId: 'infer', sourcePath: f, structure, title: '书' });
    const { chapters, bodies } = await readBack(res.filePath);
    expect(chapters.map(c => [c.title, c.level ?? 0])).toEqual([
      ['第一部', 0],
      ['第一卷《精绝古城》', 1],
      ['第一章 牛心山', 2],
      ['第二章 古墓', 2],
      ['第二卷《龙岭迷窟》', 1],
      ['第三章 盗洞', 2],
    ]);
    expect(bodies).toEqual([[], [], ['正文A'], ['正文B'], [], ['正文C']]);
    expect(res.chapterMap[0]).toEqual({ chapterIndex: 0, srcStart: 0, srcEnd: 0 });
  });

  it('原文里的控制字符写 EPUB 时去掉，校验两边同一口径，整理成功', async () => {
    const { f, structure } = await prepare('第一章 开端\n正文\u0001甲\n\u0002\n乙\n', { 0: chap('第一章 开端') });
    const res = await writeOrganizedEpub({ newBookId: 'ctl', sourcePath: f, structure, title: '书' });
    const { bodies } = await readBack(res.filePath);
    expect(bodies).toEqual([['正文甲', '乙']]);
  });

  it('30MB 合成文本：写出期间主线程最长占用 < 200ms（process.threadCpuUsage）', async () => {
    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    // 伪随机汉字：难压缩，接近真实小说的压缩开销
    const hardText = (n: number) => Array.from({ length: n }, () => String.fromCharCode(0x4e00 + (rand() % 3000))).join('');
    const f = path.join(dir, 'big.txt');
    const fd = fs.openSync(f, 'w');
    const sections: OrgStructure['sections'] = [];
    const dropLines = new Set<number>();
    let pos = 0;
    let lineNo = 0;
    const CHAPTERS = 3200;
    for (let i = 0; i < CHAPTERS; i++) {
      const head = `第${i + 1}章 标题${i + 1}\n`;
      sections.push({ level: 0, title: `第${i + 1}章 标题${i + 1}`, groupOnly: false, srcStart: pos, srcEnd: 0 });
      dropLines.add(lineNo);
      const body = Array.from({ length: 10 }, () => `　　${hardText(330)}\n`).join('');
      const buf = Buffer.from(head + body);
      fs.writeSync(fd, buf);
      pos += buf.length;
      lineNo += 11;
    }
    fs.closeSync(fd);
    sections.forEach((s, i) => { s.srcEnd = i + 1 < sections.length ? sections[i + 1].srcStart : pos; });
    expect(pos).toBeGreaterThan(29 * 1024 * 1024);

    // 量的是两次定时器之间主线程自己用掉的 CPU 时间（同 epub-builder.test.ts）
    const threadCpu = (prev?: NodeJS.CpuUsage): NodeJS.CpuUsage =>
      (process as unknown as { threadCpuUsage(p?: NodeJS.CpuUsage): NodeJS.CpuUsage }).threadCpuUsage(prev);
    // 校验在写出时流式比对，不整本读回 EPUB
    const loadSpy = jest.spyOn(EpubParser.prototype, 'load');
    const rssBefore = process.memoryUsage().rss;
    let rssPeak = rssBefore;
    let last = threadCpu();
    let maxGap = 0;
    const timer = setInterval(() => {
      const d = threadCpu(last);
      maxGap = Math.max(maxGap, (d.user + d.system) / 1000);
      rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
      last = threadCpu();
    }, 5);
    const res = await writeOrganizedEpub({
      newBookId: 'big', sourcePath: f, structure: { sections, dropLines, preface: null, notes: [] }, title: '大书',
    });
    clearInterval(timer);
    expect(maxGap).toBeLessThan(200);
    // 内存增长与文件大小无关（整本 30MB 原文 / EPUB 不会同时在内存里）
    expect((rssPeak - rssBefore) / 1048576).toBeLessThan(150);
    expect(loadSpy).not.toHaveBeenCalled();
    loadSpy.mockRestore();
    expect(res.chapterMap).toHaveLength(CHAPTERS);
    expect(fs.existsSync(res.filePath)).toBe(true);
  }, 180000);
});
