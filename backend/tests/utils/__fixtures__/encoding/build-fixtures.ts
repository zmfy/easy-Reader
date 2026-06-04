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

// gbk 对话密集（中文弯引号 “”‘’ + 省略号 … + 破折号 —）。
// 这些标点在 General Punctuation / CJK Compatibility Forms 区块，曾被
// printableRatio 漏算，导致整本被压到 0.95 以下而误判为乱码。
const dialogue =
  '第一章 风云起\n“你来了。”他淡淡地说，眼神里却藏着一丝不易察觉的波澜……\n' +
  '‘究竟是谁？’她在心里反复地问着自己——答案却始终模糊不清。\n' +
  '“我不知道你在说什么，”少年低下头，声音里满是疲惫，“也许……一切早就注定了吧。”\n' +
  '那一刻，天地间仿佛只剩下风声呼啸而过，卷起漫天黄沙。\n';
fs.writeFileSync(path.join(dir, 'gbk-dialogue.txt'), iconv.encode(dialogue.repeat(60), 'gbk'));

// utf-16 LE（带 BOM，模拟真实小说文件如《绿林七宗罪大史记》）
fs.writeFileSync(path.join(dir, 'utf16le-fixable.txt'), iconv.encode(sample, 'utf-16le', { addBOM: true }));

// utf-16 BE（带 BOM）
fs.writeFileSync(path.join(dir, 'utf16be-fixable.txt'), iconv.encode(sample, 'utf-16be', { addBOM: true }));

// 真乱码：随机字节
const garbled = Buffer.alloc(2048);
for (let i = 0; i < garbled.length; i++) garbled[i] = Math.floor(Math.random() * 256);
fs.writeFileSync(path.join(dir, 'garbled-random.txt'), garbled);

console.log('Fixtures generated.');
