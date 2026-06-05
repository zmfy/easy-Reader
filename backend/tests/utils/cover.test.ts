import { parseDoubanRating } from '../../src/utils/cover';

describe('parseDoubanRating', () => {
  it('extracts the rating number from a douban subject page', () => {
    const html = '<div><strong class="ll rating_num" property="v:average"> 8.5 </strong></div>';
    expect(parseDoubanRating(html)).toBe(8.5);
  });
  it('returns undefined when no rating present', () => {
    expect(parseDoubanRating('<div class="rating_num"></div>')).toBeUndefined();
    expect(parseDoubanRating('no rating here')).toBeUndefined();
  });
  it('returns undefined for a zero rating (douban shows 0 when unrated)', () => {
    const html = '<strong class="ll rating_num" property="v:average"> 0.0 </strong>';
    expect(parseDoubanRating(html)).toBeUndefined();
  });
});
