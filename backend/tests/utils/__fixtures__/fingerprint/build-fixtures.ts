import fs from 'fs';
import path from 'path';

const dir = __dirname;
const chapters = [
  '第一章 序章\n这是序章的内容，主角出场。',
  '第二章 启程\n主角离开家乡，踏上旅途。',
  '第三章 相遇\n主角遇到了导师，开始修炼。',
];

fs.writeFileSync(path.join(dir, 'book-a.txt'), chapters.join('\n'), 'utf-8');
// book-b 与 book-a 完全相同（应该有相同指纹）
fs.writeFileSync(path.join(dir, 'book-b.txt'), chapters.join('\n'), 'utf-8');
// book-c 第一章相同但后续不同
fs.writeFileSync(
  path.join(dir, 'book-c.txt'),
  chapters[0] + '\n第二章 不同\n这里内容不一样。',
  'utf-8',
);

console.log('Fingerprint fixtures generated.');
