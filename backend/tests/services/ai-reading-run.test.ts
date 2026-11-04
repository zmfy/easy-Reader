import Database from 'better-sqlite3';
import { generateRecap, answerQuestion } from '../../src/services/ai-reading-run';
import { aiManager } from '../../src/ai/ai-manager';
import { getReaderPlugin } from '../../src/plugins/plugin-manager';
import { Book } from '../../src/types';

jest.mock('../../src/ai/ai-manager', () => ({ aiManager: { chat: jest.fn() } }));
jest.mock('../../src/plugins/plugin-manager', () => ({ getReaderPlugin: jest.fn() }));

const chat = aiManager.chat as jest.Mock;

// 第 0–5 章；第 5 章（当前章之后）含剧透
const CHAPTERS = [
  { title: '第一章 绯红', html: '<p>周明瑞醒来。梅丽莎是他的妹妹。</p>' },
  { title: '第二章 情况', html: '<p>他了解了处境。</p>' },
  { title: '第三章 梅丽莎', html: '<p>梅丽莎做了早餐。</p>' },
  { title: '第四章 占卜', html: '<p>他去占卜。</p>' },
  { title: '第五章 仪式', html: '<p>段一</p><p>段二</p><p>段三：仪式尚未开始</p>' },
  { title: '第六章 剧透', html: '<p>梅丽莎其实是幕后黑手（剧透）。</p>' },
];

const book = { id: 'b1', title: '诡秘之主', file_path: '/x', file_format: 'txt' } as Book;
let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE ai_recaps (
    book_id TEXT NOT NULL, chapter_index INTEGER NOT NULL, paragraph_index INTEGER NOT NULL,
    content TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (book_id, chapter_index, paragraph_index))`);
  chat.mockReset();
  (getReaderPlugin as jest.Mock).mockResolvedValue({
    getChapters: async () => CHAPTERS.map((c, index) => ({ index, title: c.title })),
    getChapterContent: async (i: number) => CHAPTERS[i].html,
  });
});

describe('generateRecap', () => {
  it('sends the previous 3 chapters and the read part of the current chapter, never later text', async () => {
    chat.mockResolvedValue('<think>…</think>前情：他去占卜。');
    const r = await generateRecap(db, book, 4, 1);
    const prompt = chat.mock.calls[0][0] as string;
    expect(prompt).toContain('第二章 情况');
    expect(prompt).toContain('第四章 占卜');
    expect(prompt).not.toContain('第一章 绯红');
    expect(prompt).toContain('段二');
    expect(prompt).not.toContain('段三');
    expect(prompt).not.toContain('剧透');
    expect(r).toEqual({ content: '前情：他去占卜。', cached: false, chapters: ['第二章 情况', '第三章 梅丽莎', '第四章 占卜', '第五章 仪式'] });
  });

  it('returns the cached recap for the same position without calling AI again', async () => {
    chat.mockResolvedValue('前情A');
    await generateRecap(db, book, 4, 1);
    const again = await generateRecap(db, book, 4, 1);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(again.content).toBe('前情A');
    expect(again.cached).toBe(true);
  });

  it('throws when AI returns nothing', async () => {
    chat.mockResolvedValue('  ');
    await expect(generateRecap(db, book, 2, 0)).rejects.toThrow();
  });
});

describe('answerQuestion', () => {
  it('finds earlier chapters by name, cites them, and never includes text after the current position', async () => {
    chat.mockResolvedValue('梅丽莎是周明瑞的妹妹。');
    const r = await answerQuestion(db, book, { question: '梅丽莎是谁？', chapterIndex: 4, paragraphIndex: 1, history: [] });
    const prompt = chat.mock.calls[0][0] as string;
    expect(prompt).toContain('梅丽莎是他的妹妹');
    expect(prompt).not.toContain('幕后黑手');
    expect(prompt).not.toContain('段三');
    expect(r.answer).toBe('梅丽莎是周明瑞的妹妹。');
    expect(r.sources.map(s => s.chapterIndex)).toEqual([0, 2]);
  });

  it('falls back to the previous chapter when the question has no searchable terms', async () => {
    chat.mockResolvedValue('上一章他去占卜。');
    const r = await answerQuestion(db, book, { question: '上一章发生了什么？', chapterIndex: 4, paragraphIndex: 0, history: [{ q: '你好', a: '你好' }] });
    const prompt = chat.mock.calls[0][0] as string;
    expect(prompt).toContain('他去占卜');
    expect(prompt).toContain('问：你好');
    expect(r.sources.map(s => s.chapterIndex)).toEqual([3]);
  });
});
