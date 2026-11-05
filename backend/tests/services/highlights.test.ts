import Database from 'better-sqlite3';
import { HIGHLIGHTS_DDL, listHighlights, createHighlight, updateHighlightNote, deleteHighlight } from '../../src/services/highlights';

function makeDb() {
  const d = new Database(':memory:');
  d.exec(HIGHLIGHTS_DDL);
  return d;
}

const hl = (chapterIndex: number, startOffset: number, endOffset: number) => ({ chapterIndex, startOffset, endOffset, text: 't' });

describe('highlights service', () => {
  it('creates and lists in reading order', () => {
    const d = makeDb();
    createHighlight(d, 'u1', 'b1', hl(2, 0, 4));
    createHighlight(d, 'u1', 'b1', hl(0, 10, 12));
    createHighlight(d, 'u1', 'b1', hl(0, 3, 5));
    const list = listHighlights(d, 'u1', 'b1');
    expect(list.map(h => [h.chapter_index, h.start_offset])).toEqual([[0, 3], [0, 10], [2, 0]]);
    expect(list[0].note).toBeNull();
    expect(list[0].id).toBeTruthy();
  });

  it('is private per user and per book', () => {
    const d = makeDb();
    createHighlight(d, 'u1', 'b1', hl(0, 0, 1));
    createHighlight(d, 'u2', 'b1', hl(0, 0, 1));
    createHighlight(d, 'u1', 'b2', hl(0, 0, 1));
    expect(listHighlights(d, 'u1', 'b1')).toHaveLength(1);
  });

  it('updates note, empty string clears it', () => {
    const d = makeDb();
    const h = createHighlight(d, 'u1', 'b1', hl(0, 0, 1));
    expect(updateHighlightNote(d, 'u1', 'b1', h.id, '项羽本纪开篇')!.note).toBe('项羽本纪开篇');
    expect(updateHighlightNote(d, 'u1', 'b1', h.id, '')!.note).toBeNull();
  });

  it("cannot touch other users' rows", () => {
    const d = makeDb();
    const h = createHighlight(d, 'u1', 'b1', hl(0, 0, 1));
    expect(updateHighlightNote(d, 'u2', 'b1', h.id, 'x')).toBeNull();
    expect(deleteHighlight(d, 'u2', 'b1', h.id)).toBe(false);
    expect(deleteHighlight(d, 'u1', 'b1', h.id)).toBe(true);
    expect(listHighlights(d, 'u1', 'b1')).toEqual([]);
  });
});
