import fs from 'fs';
import os from 'os';
import path from 'path';
import { getReaderPlugin, PLUGIN_CACHE_MAX } from './plugin-manager';
import { TxtParser } from './parser-txt';
import { Book } from '../types';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-manager-'));

function makeBook(id: string): Book {
  const file = path.join(dir, `${id}.txt`);
  fs.writeFileSync(file, '第一章 开始\n正文内容\n');
  return { id, title: id, file_path: file, file_format: 'txt', is_finished: 0, imported_at: '' } as Book;
}

describe('getReaderPlugin cache', () => {
  afterEach(() => jest.restoreAllMocks());

  it('loads a book only once for concurrent requests', async () => {
    const loadSpy = jest.spyOn(TxtParser.prototype, 'load');
    const book = makeBook('concurrent');
    const [a, b, c] = await Promise.all([getReaderPlugin(book), getReaderPlugin(book), getReaderPlugin(book)]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used book beyond the cache limit', async () => {
    const books = Array.from({ length: PLUGIN_CACHE_MAX + 1 }, (_, i) => makeBook(`lru-${i}`));
    const first = await getReaderPlugin(books[0]);
    const second = await getReaderPlugin(books[1]);
    for (const b of books.slice(2, PLUGIN_CACHE_MAX)) await getReaderPlugin(b);
    // 访问 books[0] 使其变为最近使用，接着加入新书应淘汰 books[1]
    expect(await getReaderPlugin(books[0])).toBe(first);
    await getReaderPlugin(books[PLUGIN_CACHE_MAX]);
    expect(await getReaderPlugin(books[0])).toBe(first);
    expect(await getReaderPlugin(books[1])).not.toBe(second);
  });
});
