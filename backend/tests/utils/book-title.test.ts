import { cleanBookTitle } from '../../src/utils/book-title';
import { withDisplayTitle } from '../../src/utils/book-view';

describe('cleanBookTitle', () => {
  it.each([
    ['《三国演义》（精校版全本）作者：罗贯中', '三国演义'],
    ['《红楼梦》[校对]作者：曹雪芹', '红楼梦'],
    ['《温暖的人皮》', '温暖的人皮'],
    ['西游记', '西游记'],
    ['诡秘之主-完本', '诡秘之主'],
  ])('%s → %s', (raw, clean) => {
    expect(cleanBookTitle(raw)).toBe(clean);
  });

  it('falls back to the raw title when cleaning would leave nothing', () => {
    expect(cleanBookTitle('（全本）')).toBe('（全本）');
  });
});

describe('withDisplayTitle', () => {
  it('adds display_title to a single book and to each book in a list', () => {
    expect(withDisplayTitle({ id: 'a', title: '《红楼梦》[校对]作者：曹雪芹' })).toEqual({
      id: 'a', title: '《红楼梦》[校对]作者：曹雪芹', display_title: '红楼梦',
    });
    expect(withDisplayTitle([{ title: '西游记' }, { title: '《三国演义》' }]).map(b => b.display_title)).toEqual(['西游记', '三国演义']);
  });

  it('leaves rows without a title untouched', () => {
    expect(withDisplayTitle({ id: 'x' })).toEqual({ id: 'x' });
  });
});
