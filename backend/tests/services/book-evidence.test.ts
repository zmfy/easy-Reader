import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildBookEvidence } from '../../src/services/book-evidence';

describe('buildBookEvidence', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-')); });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('txt: uses the opening text and the author in the file name', async () => {
    const file = path.join(dir, '《温暖的人皮》作者：焚琴煮鹤.txt');
    fs.writeFileSync(file, '温暖的人皮\n作者：焚琴煮鹤\n内容简介：一个悬疑故事。');
    const ev = await buildBookEvidence({ id: 't', title: '温暖的人皮', file_path: file, file_format: 'txt' });
    expect(ev.excerpt).toContain('内容简介');
    expect(ev.text).toContain('【文件名标注的作者】焚琴煮鹤');
    expect(ev.text).toContain('【正文节选】\n温暖的人皮');
  });

  it('unreadable file: falls back to the file name only', async () => {
    const ev = await buildBookEvidence({ id: 'e', title: 'x', file_path: path.join(dir, 'missing.epub'), file_format: 'epub' });
    expect(ev.metadata).toEqual({});
    expect(ev.text).toContain('【文件名】missing.epub');
    expect(ev.text).toContain('无法读取正文');
  });
});
