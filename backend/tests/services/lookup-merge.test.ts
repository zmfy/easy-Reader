import { confirmedMismatch, doubanNote, trustedConfirmation } from '../../src/services/lookup-merge';
import { ConfirmedBook } from '../../src/services/book-lookup-agent';

const book = (o: Partial<ConfirmedBook> = {}): ConfirmedBook => ({
  hit: { title: '凡人修仙传', url: 'https://book.douban.com/subject/1/', year: '2008' },
  title: '凡人修仙传', author: '忘语', doubanAuthor: '忘语', ...o,
});

describe('doubanNote', () => {
  it('wraps the douban title in 《》', () => {
    expect(doubanNote(book())).toBe('豆瓣：《凡人修仙传》忘语 2008');
  });
  it('does not wrap a douban title that already has 《》', () => {
    const c = book({ hit: { title: '《聊斋志异》 蒲松龄 手稿本', url: 'u' }, doubanAuthor: '蒲松龄', why: '一致' });
    expect(doubanNote(c)).toBe('豆瓣：《聊斋志异》 蒲松龄 手稿本 蒲松龄；一致');
  });
});

describe('confirmedMismatch', () => {
  it('does not produce 。； when the reason ends with a full stop', () => {
    expect(confirmedMismatch({ title: 'x', reason: '正文是凡人修仙传的内容。' }, book()).reason)
      .toBe('正文是凡人修仙传的内容。豆瓣：《凡人修仙传》忘语 2008');
  });
  it('joins with ； otherwise', () => {
    expect(confirmedMismatch({ title: 'x', reason: '正文是凡人修仙传' }, book()).reason)
      .toBe('正文是凡人修仙传；豆瓣：《凡人修仙传》忘语 2008');
  });
});

describe('trustedConfirmation', () => {
  const austen = book({ hit: { title: '理智与情感', url: 'u' }, title: '理智与情感', author: '[英] 简·奥斯丁' });
  it('drops a confirmation whose author conflicts with the known author', () => {
    expect(trustedConfirmation({ confirmed: austen }, { knownAuthor: '忘语' })).toBeUndefined();
  });
  it('keeps it when authors match, the author is unknown, or the book is mismatched', () => {
    expect(trustedConfirmation({ confirmed: austen }, { knownAuthor: '简·奥斯丁' })).toBe(austen);
    expect(trustedConfirmation({ confirmed: austen }, { knownAuthor: '' })).toBe(austen);
    expect(trustedConfirmation({ confirmed: austen }, { knownAuthor: '忘语', mismatch: { title: '理智与情感' } })).toBe(austen);
    expect(trustedConfirmation({ confirmed: book({ author: undefined }) }, { knownAuthor: '别人' })).toBeDefined();
    expect(trustedConfirmation({}, { knownAuthor: '忘语' })).toBeUndefined();
  });
});
