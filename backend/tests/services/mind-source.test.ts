import { findSource, isAfter } from '../../src/services/mind-source';
import { ChapterParas } from '../../src/services/book-text';

const chapters: ChapterParas[] = [
  { index: 0, title: '项羽本纪', paragraphs: ['项羽者下相人也', '韩信亡楚归汉'] },
  { index: 1, title: '高祖本纪', paragraphs: ['高祖封韩信为王'] },
  { index: 2, title: '淮阴侯列传', paragraphs: ['淮阴人也', '韩信者，韩信少时', '韩信遂去'] },
  { index: 3, title: '刺客列传', paragraphs: ['荆轲者卫人也'] },
];

describe('findSource', () => {
  it('prefers a chapter whose title contains the label', () => {
    expect(findSource(chapters, '项羽')).toEqual({ chapterIndex: 0, paragraphIndex: 0, chapterTitle: '项羽本纪' });
  });

  it('otherwise picks the chapter with most occurrences', () => {
    expect(findSource(chapters, '韩信')).toEqual({ chapterIndex: 2, paragraphIndex: 1, chapterTitle: '淮阴侯列传' });
  });

  it('ties go to the earlier chapter', () => {
    const cs: ChapterParas[] = [
      { index: 0, title: 'A', paragraphs: ['无关', '张良来了'] },
      { index: 1, title: 'B', paragraphs: ['张良走了'] },
    ];
    expect(findSource(cs, '张良')).toEqual({ chapterIndex: 0, paragraphIndex: 1, chapterTitle: 'A' });
  });

  it('returns null when absent or label shorter than 2', () => {
    expect(findSource(chapters, '诸葛亮')).toBeNull();
    expect(findSource(chapters, '项')).toBeNull();
    expect(findSource(chapters, '  项 ')).toBeNull();
  });
});

describe('isAfter', () => {
  it('compares chapter first then paragraph, strictly', () => {
    expect(isAfter({ chapterIndex: 2, paragraphIndex: 0 }, { chapterIndex: 1, paragraphIndex: 9 })).toBe(true);
    expect(isAfter({ chapterIndex: 1, paragraphIndex: 3 }, { chapterIndex: 1, paragraphIndex: 3 })).toBe(false);
    expect(isAfter({ chapterIndex: 1, paragraphIndex: 2 }, { chapterIndex: 1, paragraphIndex: 3 })).toBe(false);
  });
});
