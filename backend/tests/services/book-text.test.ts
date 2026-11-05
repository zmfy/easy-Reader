import { getBookText, clearBookTextCache } from '../../src/services/book-text';
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
});
