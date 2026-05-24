import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';

const dir = __dirname;
const sample = '第一章 测试章节\n这是一段中文小说内容，主角说道：你好世界。\n第二章 又一章\n继续测试。';

// utf-8 正常
fs.writeFileSync(path.join(dir, 'utf8-normal.txt'), sample, 'utf-8');

// gbk 编码（需被自动修复）
fs.writeFileSync(path.join(dir, 'gbk-fixable.txt'), iconv.encode(sample, 'gbk'));

// gb18030 编码
fs.writeFileSync(path.join(dir, 'gb18030-fixable.txt'), iconv.encode(sample, 'gb18030'));

// 真乱码：随机字节
const garbled = Buffer.alloc(2048);
for (let i = 0; i < garbled.length; i++) garbled[i] = Math.floor(Math.random() * 256);
fs.writeFileSync(path.join(dir, 'garbled-random.txt'), garbled);

console.log('Fixtures generated.');
