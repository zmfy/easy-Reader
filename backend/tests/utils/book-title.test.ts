import { cleanBookTitle, coverTitle } from '../../src/utils/book-title';
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

describe('coverTitle（默认封面上的书名）', () => {
  it('去掉开头编号和任意长度的括号说明', () => {
    expect(coverTitle('0361. 名侦探柯南（第9部：卷65~卷72） (超人气连载26年！无法逾越的推理日漫经典！日本国民级悬疑推理漫画！执着如一地追寻，因为真相只有一个！官方授权Kindle正式上架！)')).toBe('名侦探柯南');
    expect(coverTitle('0171. 现代兵器大百科（套装共12册）【“铁血军事”论坛版主倾力奉献，军事科普读物，军事迷必读！精心挑选二战以来世界各国的百余种兵器精心讲解！】')).toBe('现代兵器大百科');
    expect(coverTitle('0299. 《外研社双语读库·社会文化书系》')).toBe('外研社双语读库·社会文化书系');
    expect(coverTitle('0498. 找寻真实的蒋介石：蒋介石日记解读（1、2套装）')).toBe('找寻真实的蒋介石：蒋介石日记解读');
    expect(coverTitle('克莱因文集(经典套装全4册)')).toBe('克莱因文集');
  });
  it('普通书名不变；整个书名都在括号里时退回 cleanBookTitle', () => {
    expect(coverTitle('呐喊')).toBe('呐喊');
    expect(coverTitle('1984')).toBe('1984');
    expect(coverTitle('（无题）')).toBe(cleanBookTitle('（无题）'));
  });
});
