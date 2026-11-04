import fs from 'fs';
import os from 'os';
import path from 'path';

// cover.ts 在导入时根据 DATA_DIR 决定封面目录，因此先设置环境变量再 require
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-file-'));
process.env.DATA_DIR = TMP;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { saveCoverFile } = require('../../src/utils/cover') as typeof import('../../src/utils/cover');
const COVERS = path.join(TMP, 'covers');

afterAll(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

describe('saveCoverFile', () => {
  it('writes a versioned file and removes only this book\'s older covers', () => {
    fs.writeFileSync(path.join(COVERS, 'b1.jpg'), 'old');
    fs.writeFileSync(path.join(COVERS, 'b1-old.png'), 'old');
    fs.writeFileSync(path.join(COVERS, 'b2.jpg'), 'other');
    fs.writeFileSync(path.join(COVERS, 'b10.jpg'), 'other book whose id starts with b1');

    const url = saveCoverFile('b1', '<svg/>', 'svg');

    expect(url).toMatch(/^\/covers\/b1-[0-9a-z]+\.svg$/);
    const name = url.replace('/covers/', '');
    expect(fs.readFileSync(path.join(COVERS, name), 'utf-8')).toBe('<svg/>');
    expect(fs.existsSync(path.join(COVERS, 'b1.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(COVERS, 'b1-old.png'))).toBe(false);
    expect(fs.existsSync(path.join(COVERS, 'b2.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(COVERS, 'b10.jpg'))).toBe(true);
  });

  it('returns a different file name on every call', () => {
    const a = saveCoverFile('b3', Buffer.from('x'), 'jpg');
    const b = saveCoverFile('b3', Buffer.from('y'), 'jpg');
    expect(a).not.toBe(b);
    expect(fs.readdirSync(COVERS).filter(f => f.startsWith('b3'))).toEqual([b.replace('/covers/', '')]);
  });
});
