import fs from 'fs';
import { getBookText, getChapterText, clearBookTextCache } from '../../src/services/book-text';
import { getReaderPlugin } from '../../src/plugins/plugin-manager';
import { Book } from '../../src/types';

jest.mock('../../src/plugins/plugin-manager', () => ({ getReaderPlugin: jest.fn() }));

const CHAPTERS = [
  { title: '第一章', html: '<p>甲一</p><p>甲二</p>' },
  { title: '', html: '<p>乙一</p>' },
];
const mkBook = (id: string) => ({ id, title: id, file_path: `/x/${id}`, file_format: 'txt' } as Book);
const getChapterContent = jest.fn(async (i: number) => CHAPTERS[i].html);

beforeEach(() => {
  clearBookTextCache();
  getChapterContent.mockClear();
  (getReaderPlugin as jest.Mock).mockReset();
  (getReaderPlugin as jest.Mock).mockResolvedValue({
    getChapters: async () => CHAPTERS.map((c, index) => ({ index, title: c.title })),
    getChapterContent,
  });
});

describe('getBookText', () => {
  it('reads every chapter into paragraphs', async () => {
    const r = await getBookText(mkBook('a'));
    expect(r).toEqual([
      { index: 0, title: '第一章', paragraphs: ['甲一', '甲二'] },
      { index: 1, title: '第 2 章', paragraphs: ['乙一'] },
    ]);
  });

  it('caches per book', async () => {
    await getBookText(mkBook('a'));
    await getBookText(mkBook('a'));
    expect(getChapterContent).toHaveBeenCalledTimes(2);
  });

  it('evicts least recently used beyond 2 books', async () => {
    await getBookText(mkBook('a'));
    await getBookText(mkBook('b'));
    await getBookText(mkBook('a')); // a 变为最近使用
    await getBookText(mkBook('c')); // 淘汰 b
    expect(getChapterContent).toHaveBeenCalledTimes(6);
    await getBookText(mkBook('a')); // 仍在缓存
    expect(getChapterContent).toHaveBeenCalledTimes(6);
    await getBookText(mkBook('b')); // 已被淘汰，重新读取
    expect(getChapterContent).toHaveBeenCalledTimes(8);
  });

  it('yields while reading a large book without changing the result', async () => {
    const big = Array.from({ length: 120 }, (_, i) => `<p>段${i}</p>`);
    (getReaderPlugin as jest.Mock).mockResolvedValue({
      getChapters: async () => big.map((_, index) => ({ index, title: `章${index}` })),
      getChapterContent: async (i: number) => big[i],
    });
    const r = await getBookText(mkBook('big'));
    expect(r).toHaveLength(120);
    expect(r[119]).toEqual({ index: 119, title: '章119', paragraphs: ['段119'] });
  });

  it('shares one read between concurrent cold calls', async () => {
    const [x, y] = await Promise.all([getBookText(mkBook('a')), getBookText(mkBook('a'))]);
    expect(x).toBe(y);
    expect(getChapterContent).toHaveBeenCalledTimes(2);
    expect(getReaderPlugin).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failed read', async () => {
    (getReaderPlugin as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(getBookText(mkBook('a'))).rejects.toThrow('boom');
    await expect(getBookText(mkBook('a'))).resolves.toHaveLength(2);
  });

  it('re-reads when the file mtime changes', async () => {
    const stat = jest.spyOn(fs, 'statSync').mockReturnValue({ mtimeMs: 1 } as fs.Stats);
    try {
      await getBookText(mkBook('a'));
      await getBookText(mkBook('a'));
      expect(getChapterContent).toHaveBeenCalledTimes(2);
      stat.mockReturnValue({ mtimeMs: 2 } as fs.Stats);
      await getBookText(mkBook('a'));
      expect(getChapterContent).toHaveBeenCalledTimes(4);
    } finally {
      stat.mockRestore();
    }
  });
});

describe('getChapterText', () => {
  it('reads a single chapter, or uses the whole-book cache', async () => {
    expect(await getChapterText(mkBook('a'), 1)).toEqual({ index: 1, title: '第 2 章', paragraphs: ['乙一'] });
    expect(getChapterContent.mock.calls).toEqual([[1]]);
    expect(await getChapterText(mkBook('a'), 5)).toBeNull();
    await getBookText(mkBook('a'));
    getChapterContent.mockClear();
    expect(await getChapterText(mkBook('a'), 0)).toEqual({ index: 0, title: '第一章', paragraphs: ['甲一', '甲二'] });
    expect(getChapterContent).not.toHaveBeenCalled();
  });
});
