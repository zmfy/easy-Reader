import {
  StudyNote, splitBatches, buildGeneratePrompt, buildUpdatePrompt, parseThemes, SummaryAiOutputError,
} from '../../src/services/summary-ai';

function note(i: number, over: Partial<StudyNote> = {}): StudyNote {
  return { ref: `h:id${i}`, kind: 'highlight', chapterIndex: i, text: `原文${i}`, ...over };
}

describe('summary-ai', () => {
  it('splitBatches respects maxNotes and maxChars and keeps order', () => {
    const notes = Array.from({ length: 7 }, (_, i) => note(i));
    const byCount = splitBatches(notes, { maxNotes: 3 });
    expect(byCount.map(b => b.length)).toEqual([3, 3, 1]);
    expect(byCount.flat().map(n => n.ref)).toEqual(notes.map(n => n.ref));

    const big = Array.from({ length: 4 }, (_, i) => note(i, { text: 'x'.repeat(300) }));
    const byChars = splitBatches(big, { maxChars: 700 });
    expect(byChars.length).toBeGreaterThan(1);
    expect(byChars.flat().map(n => n.ref)).toEqual(big.map(n => n.ref));
    expect(splitBatches([])).toEqual([]);
  });

  it('splitBatches truncates a single oversized note', () => {
    const [[n]] = splitBatches([note(1, { text: '长'.repeat(5000), note: '批'.repeat(5000) })]);
    expect(n.text.length + (n.note || '').length).toBeLessThanOrEqual(1100);
    expect(n.text.endsWith('…') || (n.note || '').endsWith('…')).toBe(true);
  });

  it('buildGeneratePrompt lists notes with refs in chapter order and asks for JSON themes', () => {
    const notes = [note(5, { ref: 'h:late' }), note(1, { ref: 'n:early', kind: 'concept', text: '鸿门宴', summary: '宴会' })];
    const p = buildGeneratePrompt('史记', notes);
    expect(p).toContain('史记');
    expect(p).toContain('[[h:late]]');
    expect(p).toContain('[[n:early]]');
    expect(p.indexOf('[[n:early]]')).toBeLessThan(p.indexOf('[[h:late]]'));
    expect(p).toContain('只输出 JSON');
  });

  it('buildUpdatePrompt includes current theme titles and says existing content must not be rewritten', () => {
    const p = buildUpdatePrompt('史记', ['楚汉之争', '用人之道'], [note(1)]);
    expect(p).toContain('楚汉之争');
    expect(p).toContain('用人之道');
    expect(p).toContain('不要改写');
    expect(p).toContain('[[h:id1]]');
  });

  const valid = new Set(['h:a', 'n:b']);

  it('parseThemes reads fenced json', () => {
    const raw = '```json\n{"themes":[{"title":"主题","paragraphs":["文字 [[h:a]]"]}]}\n```';
    const r = parseThemes(raw, valid);
    expect(r).toHaveLength(1);
    expect(r[0].theme).toBe('主题');
  });

  it('parseThemes splits [[ref]] into ref pieces', () => {
    const raw = JSON.stringify({ themes: [{ title: 'T', paragraphs: ['前 [[h:a]] 中 [[n:b]] 后'] }] });
    expect(parseThemes(raw, valid)[0].paragraphs[0]).toEqual([
      { text: '前 ' }, { ref: 'h:a' }, { text: ' 中 ' }, { ref: 'n:b' }, { text: ' 后' },
    ]);
  });

  it('parseThemes drops unknown refs but keeps text', () => {
    const raw = JSON.stringify({ themes: [{ title: 'T', paragraphs: ['甲 [[h:zzz]] 乙 [[h:a]]'] }] });
    const parts = parseThemes(raw, valid)[0].paragraphs[0];
    expect(parts.some(p => 'ref' in p && p.ref === 'h:zzz')).toBe(false);
    expect(parts.filter(p => 'ref' in p)).toEqual([{ ref: 'h:a' }]);
    expect(parts.map(p => ('text' in p ? p.text : '')).join('')).toContain('甲');
    expect(parts.map(p => ('text' in p ? p.text : '')).join('')).toContain('乙');
  });

  it('parseThemes drops empty titles/paragraphs', () => {
    const raw = JSON.stringify({ themes: [
      { title: '  ', paragraphs: ['x'] },
      { title: 'A', paragraphs: ['', '   ', 5, {}, '[[h:zzz]]', '好'] },
      { title: 'B', paragraphs: [] },
      { title: 3, paragraphs: ['x'] },
      null,
    ] });
    const r = parseThemes(raw, valid);
    expect(r).toHaveLength(1);
    expect(r[0].theme).toBe('A');
    expect(r[0].paragraphs).toEqual([[{ text: '好' }]]);
  });

  it('parseThemes throws SummaryAiOutputError on non-json or no valid themes', () => {
    for (const raw of ['', 'hello', '{bad', '{"themes":"x"}', '{"themes":[]}', '[]', 'null', '{"themes":[{"title":"A","paragraphs":"x"}]}']) {
      expect(() => parseThemes(raw, valid)).toThrow(SummaryAiOutputError);
    }
  });
});
