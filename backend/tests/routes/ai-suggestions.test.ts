import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-suggestions-'));
process.env.DATA_DIR = DATA;

jest.mock('../../src/middleware/auth', () => {
  const actual = jest.requireActual('../../src/middleware/auth');
  return {
    ...actual,
    authMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = req.header('x-test-role');
      if (!role) { res.status(401).json({ success: false }); return; }
      (req as unknown as { user: unknown }).user = { userId: 'u1', role };
      next();
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const libraryRoutes = require('../../src/routes/library').default;
const { getDb } = require('../../src/db');
const { saveSuggestion, recordContentMismatch } = require('../../src/services/ai-suggestions');
/* eslint-enable @typescript-eslint/no-var-requires */

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/library', libraryRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/library`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

const call = (method: string, url: string, body?: unknown, role = 'admin') => fetch(base + url, {
  method, headers: { 'content-type': 'application/json', 'x-test-role': role },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const json = async (r: Response) => (await r.json()).data;

function seed() {
  const db = getDb();
  db.prepare('DELETE FROM books').run();
  db.prepare('DELETE FROM ai_suggestions').run();
  const ins = db.prepare("INSERT INTO books (id, title, author, summary, category, file_path, file_format, status, manually_edited_fields) VALUES (?, ?, ?, ?, ?, ?, 'txt', 'normal', ?)");
  ins.run('b1', '西游记', '佚名', '旧简介', null, '/b/1.txt', '["author"]');
  ins.run('b2', '三国演义', '罗贯中', null, null, '/b/2.txt', null);
  saveSuggestion(db, 'b1', {
    fields: {
      author: { value: '吴承恩', current: '佚名', confidence: 'high', locked: true },
      summary: { value: '唐僧师徒取经', current: '旧简介', confidence: 'medium' },
      category: { value: '小说/中国古典小说', current: null, confidence: 'low' },
    },
    recommended_tags: ['神魔'],
    adaptations: [{ type: '电视剧', title: '西游记', year: '1986', source: 'douban', url: 'https://movie.douban.com/subject/1/' }],
  });
  saveSuggestion(db, 'b2', { fields: { summary: { value: '东汉末年', current: null, confidence: 'high' } } });
  recordContentMismatch(db, 'b2', { title: '诡秘之主', author: '爱潜水的乌贼' });
}

describe('AI suggestion routes', () => {
  beforeEach(seed);

  it('is admin-only and lists suggestions with current values, mismatched books first', async () => {
    expect((await call('GET', '/ai-suggestions', undefined, 'user')).status).toBe(403);
    const list = await json(await call('GET', '/ai-suggestions'));
    expect(list.map((s: { book_id: string }) => s.book_id)).toEqual(['b2', 'b1']);
    expect(list[0].content_mismatch).toEqual({ title: '诡秘之主', author: '爱潜水的乌贼' });
    expect(list[1].data.fields.author).toMatchObject({ value: '吴承恩', locked: true });
    expect(await json(await call('GET', '/ai-suggestions/count'))).toEqual({ count: 2 });
  });

  it('applies only the selected parts through the normal AI-fill rules and removes the suggestion', async () => {
    const res = await json(await call('POST', '/ai-suggestions/apply', {
      items: [{ book_id: 'b1', fields: ['author', 'summary'], tags: true, similar: false, adaptations: true }],
    }));
    expect(res).toEqual({ applied: ['b1'], failed: [] });
    const db = getDb();
    expect(db.prepare("SELECT author, summary, category, manually_edited_fields FROM books WHERE id='b1'").get())
      .toEqual({ author: '吴承恩', summary: '唐僧师徒取经', category: null, manually_edited_fields: '[]' });  // 采纳 AI 值解除锁定
    const meta = db.prepare("SELECT recommended_tags, adaptations FROM book_ai_metadata WHERE book_id='b1'").get();
    expect(JSON.parse(meta.recommended_tags)).toEqual(['神魔']);
    expect(JSON.parse(meta.adaptations)[0].title).toBe('西游记');
    expect(db.prepare("SELECT COUNT(*) n FROM ai_suggestions WHERE book_id='b1'").get()).toEqual({ n: 0 });
    // 已处理的建议再采纳：报告失败而不是 500
    const again = await json(await call('POST', '/ai-suggestions/apply', { items: [{ book_id: 'b1', fields: [], tags: false, similar: false, adaptations: false }] }));
    expect(again.failed[0].book_id).toBe('b1');
  });

  it('dismisses suggestions', async () => {
    expect(await json(await call('POST', '/ai-suggestions/dismiss', { book_ids: ['b1', 'b2'] }))).toEqual({ dismissed: 2 });
    expect(await json(await call('GET', '/ai-suggestions/count'))).toEqual({ count: 0 });
    // 忽略也算审核过：之后批量填充跳过
    const reviewed = getDb().prepare('SELECT COUNT(*) AS n FROM books WHERE ai_reviewed_at IS NOT NULL').get();
    expect(reviewed).toEqual({ n: 2 });
  });

  it('filters mismatched books, and stops flagging after「不是错标」for the same detection', async () => {
    const titles = async () => (await json(await call('GET', '/?mismatch=1', undefined, 'admin'))).map((b: { id: string }) => b.id);
    expect(await titles()).toEqual(['b2']);
    expect((await call('POST', '/b2/content-mismatch/dismiss')).status).toBe(200);
    expect(await titles()).toEqual([]);
    recordContentMismatch(getDb(), 'b2', { title: '诡秘之主' });   // 再次判定为同一本：保持忽略
    expect(await titles()).toEqual([]);
    recordContentMismatch(getDb(), 'b2', { title: '凡人修仙传' }); // 判定成别的书：重新提示
    expect(await titles()).toEqual(['b2']);
    recordContentMismatch(getDb(), 'b2', undefined);                // 不再判定为不符：清除
    expect(await titles()).toEqual([]);
    expect((await call('POST', '/b1/content-mismatch/dismiss')).status).toBe(404);
  });

  describe('错标的书：书名改为正文书名', () => {
    const titleOf = (id: string) => (getDb().prepare('SELECT title, content_mismatch, manually_edited_fields FROM books WHERE id = ?').get(id));

    it('列表里错标的书带「书名」建议，正常的书没有', async () => {
      const list = await json(await call('GET', '/ai-suggestions'));
      expect(list[0].data.fields.title).toEqual({ value: '诡秘之主', current: '三国演义', confidence: 'medium' });
      expect(list[1].data.fields.title).toBeUndefined();
    });

    it('勾选书名采纳：书名改为正文书名、错标提示清除、记为手动改过、日志里有 title', async () => {
      const res = await json(await call('POST', '/ai-suggestions/apply', {
        items: [{ book_id: 'b2', fields: ['title', 'summary'], tags: false, similar: false, adaptations: false }],
      }));
      expect(res).toEqual({ applied: ['b2'], failed: [] });
      expect(titleOf('b2')).toEqual({ title: '诡秘之主', content_mismatch: null, manually_edited_fields: '["title"]' });
      const audit = getDb().prepare("SELECT details FROM audit_log WHERE action = 'ai_suggestion_apply' AND resource_id = 'b2' ORDER BY created_at DESC").get();
      expect(JSON.parse(audit.details).applied).toEqual(['title', 'summary']);
    });

    it('不勾书名：书名不变，错标提示保留', async () => {
      await call('POST', '/ai-suggestions/apply', { items: [{ book_id: 'b2', fields: ['summary'], tags: false, similar: false, adaptations: false }] });
      expect(titleOf('b2')).toMatchObject({ title: '三国演义' });
      expect(titleOf('b2').content_mismatch).not.toBeNull();
    });

    it('点「不是错标」后书名建议消失，勾了书名也不改', async () => {
      await call('POST', '/b2/content-mismatch/dismiss');
      expect((await json(await call('GET', '/ai-suggestions')))[0].data.fields.title).toBeUndefined();
      await call('POST', '/ai-suggestions/apply', { items: [{ book_id: 'b2', fields: ['title'], tags: false, similar: false, adaptations: false }] });
      expect(titleOf('b2')).toMatchObject({ title: '三国演义' });
    });

    it('书详情页「改书名」：已采纳过的书也能改正；没有错标时 404，非管理员 403', async () => {
      expect((await call('POST', '/b2/content-mismatch/accept', undefined, 'user')).status).toBe(403);
      const r = await call('POST', '/b2/content-mismatch/accept');
      expect(r.status).toBe(200);
      expect((await json(r)).title).toBe('诡秘之主');
      expect(titleOf('b2')).toMatchObject({ title: '诡秘之主', content_mismatch: null });
      expect((await call('POST', '/b2/content-mismatch/accept')).status).toBe(404);
      expect((await call('POST', '/b1/content-mismatch/accept')).status).toBe(404);
    });
  });
});
