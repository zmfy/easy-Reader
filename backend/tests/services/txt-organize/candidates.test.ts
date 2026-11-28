import fs from 'fs';
import os from 'os';
import path from 'path';
import iconv from 'iconv-lite';
import { TxtParser } from '../../../src/plugins/parser-txt';
import { readTxtLines } from '../../../src/services/txt-organize/lines';
import { collectCandidates } from '../../../src/services/txt-organize/candidates';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-org-'));
const write = (name: string, buf: Buffer | string) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, buf);
  return f;
};
const linesOf = async (f: string) => {
  const out = [];
  for await (const l of readTxtLines(f)) out.push(l);
  return out;
};
const loaded = async (f: string) => {
  const p = new TxtParser();
  await p.load(f);
  return p;
};

const TEXT = '第一章 开端\n他走进了青牛镇，天色已晚。\n第二章 青牛镇\n镇上很安静，没有人说话。\n第2章\n夹在正文里的编号。\n';

describe('readTxtLines', () => {
  it('UTF-8 / GBK / UTF-16LE / 只用 CR 换行的同一文本，readTxtLines 给出相同的行文字', async () => {
    const text = '第一章 开端\n他走进了青牛镇，天色已晚。\n第二章 青牛镇\n镇上很安静，没有人说话。\n最后一行没有换行';
    const files = [
      write('u8.txt', text),
      write('gbk.txt', iconv.encode(text, 'gbk')),
      write('u16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, 'utf-16le')])),
      write('cr.txt', text.replace(/\n/g, '\r')),
    ];
    const expected = text.split('\n');
    for (const f of files) {
      expect((await linesOf(f)).map(l => l.text)).toEqual(expected);
    }
  });

  it('byteStart 与 TxtParser 章节 startByte 一致', async () => {
    const text = '前言一行\n第一章 开端\n他走进了青牛镇，天色已晚。\n第二章 青牛镇\n镇上很安静。\n';
    const files = [
      write('a8.txt', text),
      write('agbk.txt', iconv.encode(text, 'gbk')),
      write('a16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, 'utf-16le')])),
      write('acr.txt', text.replace(/\n/g, '\r')),
    ];
    for (const f of files) {
      const starts = (await loaded(f)).getHeadingStarts();
      expect(starts.length).toBe(2);
      const lineStarts = new Set((await linesOf(f)).map(l => l.byteStart));
      for (const s of starts) expect(lineStarts.has(s.byte)).toBe(true);
    }
  });

  it('只读指定字节区间（从某行开头起）：行与整本读取时的同一批行一致', async () => {
    const text = '前言一行\r\n第一章 开端\r\n他走进了青牛镇，天色已晚。\r\n第二章 青牛镇\r\n镇上很安静。';
    const files = [
      write('r8.txt', text),
      write('rgbk.txt', iconv.encode(text, 'gbk')),
      write('r16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, 'utf-16le')])),
    ];
    for (const f of files) {
      const all = await linesOf(f);
      const sub = [];
      for await (const l of readTxtLines(f, { start: all[1].byteStart, end: all[3].byteStart })) sub.push(l);
      expect(sub.map(l => [l.byteStart, l.byteEnd, l.text])).toEqual(all.slice(1, 3).map(l => [l.byteStart, l.byteEnd, l.text]));
      // 不给 end：读到文件末尾
      const tail = [];
      for await (const l of readTxtLines(f, { start: all[3].byteStart })) tail.push(l);
      expect(tail.map(l => l.text)).toEqual(['第二章 青牛镇', '镇上很安静。']);
    }
  });
});

describe('collectCandidates', () => {
  it('挑出各类候选行，并算出 bodyChars / 前后片段', async () => {
    const text = [
      '第二章青牛镇',
      '镇上很安静。',
      '第2章',
      '夹在正文里的编号，',
      '又一行正文',
      '第二卷《山水郎》结束。',
      '【求月票】',
      '这是一行普通正文。',
      '',
      '  《书名》',
      '尾声',
    ].join('\n') + '\n';
    const f = write('c.txt', text);
    const { candidates, totalLines } = await collectCandidates(f, await loaded(f));
    expect(totalLines).toBe(11);
    expect(candidates.map(c => c.text)).toEqual(['第二章青牛镇', '第2章', '第二卷《山水郎》结束。', '【求月票】', '《书名》', '尾声']);
    expect(candidates.map(c => c.id)).toEqual([0, 1, 2, 3, 4, 5]);
    const n2 = candidates[1];
    expect(n2.bodyChars).toBe('夹在正文里的编号，'.length + '又一行正文'.length);
    expect(n2.bodyLines).toBe(2);
    expect(n2.prevSnippet).toBe('镇上很安静。');
    expect(n2.nextSnippet).toBe('夹在正文里的编号，');
    expect(candidates[0].prevSnippet).toBe('');
    expect(candidates[0].ruleHint).toBe('heading');
    expect(n2.ruleHint).toBe('none');
    expect(candidates[3].bodyChars).toBe('这是一行普通正文。'.length);
  });

  it('长正文行和非候选开头的行不是候选', async () => {
    const long = '第' + '很长的正文'.repeat(20);
    const f = write('d.txt', `第一章 开端\n他说话了\n${long}\n普通行\n`);
    const { candidates } = await collectCandidates(f, await loaded(f));
    expect(candidates.map(c => c.text)).toEqual(['第一章 开端']);
  });

  it('数字＋章名进候选', async () => {
    const f = write('n1.txt', '第一章 开端\n他说话了\n165 天崩\n他说话了\n158影骨\n他又说\n183 古格银眼\n他说了\n1．10：古物的命名方式\n他说了\n');
    const { candidates } = await collectCandidates(f, await loaded(f));
    expect(candidates.map(c => c.text)).toEqual(['第一章 开端', '165 天崩', '158影骨', '183 古格银眼', '1．10：古物的命名方式']);
    expect(candidates.slice(1).every(c => c.ruleHint === 'none')).toBe(true);
  });

  it('数字开头但含句内或句末标点的行不进候选', async () => {
    const f = write('n2.txt', '第一章 开端\n3年后他回来了。\n2010年，他来了\n普通行\n');
    const { candidates } = await collectCandidates(f, await loaded(f));
    expect(candidates.map(c => c.text)).toEqual(['第一章 开端']);
  });

  it('数字＋章名超过 24 字不进候选', async () => {
    const f = write('n3.txt', '第一章 开端\n12 ' + '字'.repeat(23) + '\n普通行\n');
    const { candidates } = await collectCandidates(f, await loaded(f));
    expect(candidates.map(c => c.text)).toEqual(['第一章 开端']);
  });

  it('纯数字行不进候选', async () => {
    const f = write('n4.txt', '第一章 开端\n2010\n普通行\n');
    const { candidates } = await collectCandidates(f, await loaded(f));
    expect(candidates.map(c => c.text)).toEqual(['第一章 开端']);
  });

  it('分卷标题的 ruleHint 为 volume', async () => {
    const f = write('v.txt', '第一卷 风起\n第一章 开端\n他拔出剑来\n第二章 发展\n她转身离去\n');
    const p = await loaded(f);
    const { candidates } = await collectCandidates(f, p);
    expect(candidates.map(c => c.ruleHint)).toEqual(['volume', 'heading', 'heading']);
  });

  it('30MB 合成文本流式处理，heapUsed 增长 < 100MB', async () => {
    const f = path.join(dir, 'big.txt');
    const fd = fs.openSync(f, 'w');
    const body = '这是一行用来撑大文件的正文内容，没有任何特殊含义。'.repeat(8) + '\n';
    let written = 0;
    let n = 1;
    while (written < 30 * 1024 * 1024) {
      let chunk = `第${n++}章 标题\n`;
      for (let i = 0; i < 400; i++) chunk += body;
      written += fs.writeSync(fd, chunk);
    }
    fs.closeSync(fd);
    const p = await loaded(f);
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    const { candidates } = await collectCandidates(f, p);
    const growth = process.memoryUsage().heapUsed - before;
    expect(candidates.length).toBeGreaterThan(100);
    expect(growth).toBeLessThan(100 * 1024 * 1024);
  }, 60000);
});
