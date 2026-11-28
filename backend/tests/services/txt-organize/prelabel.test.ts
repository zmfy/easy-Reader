import { Candidate } from '../../../src/services/txt-organize/candidates';
import { prelabelCandidates } from '../../../src/services/txt-organize/prelabel';

const cand = (text: string, bodyChars = 500, id = 0): Candidate => ({
  id, lineNo: id, byteStart: 0, byteEnd: 0, text, bodyChars, bodyLines: 1,
  prevSnippet: '', nextSnippet: '', ruleHint: 'none',
});
const run = (items: Array<string | [string, number]>) =>
  prelabelCandidates(items.map((it, i) => (typeof it === 'string' ? cand(it, 500, i) : cand(it[0], it[1], i))));
const CH = { id: 0, type: 'chapter' };
const chapter = (i: number) => ({ ...CH, id: i });
const stray = (i: number) => ({ id: i, type: 'noise', noiseKind: 'stray_number' });
const chaps = (n: number) => Array.from({ length: n }, (_, i) => `第${i + 1}章 名${i + 1}`);

describe('prelabelCandidates', () => {
  it('连续有章名章节且正文足够 → chapter', () => {
    expect(run(['第一章 山村', '第二章 青牛镇', '第三章 七玄门'])).toEqual([chapter(0), chapter(1), chapter(2)]);
  });

  it('正文不足 300 → null', () => {
    expect(run(['第一章 山村', ['第二章 青牛镇', 100], '第三章 七玄门'])).toEqual([chapter(0), null, chapter(2)]);
  });

  it('重复的同一行文字 → 第二次 null', () => {
    const r = run(['第一章 山村', '第二章 青牛镇', '第二章 青牛镇']);
    expect(r[1]).toEqual(chapter(1));
    expect(r[2]).toBeNull();
  });

  it('跳号 → null，随后两个连续章节重建链', () => {
    const r = run(['第1章 a', '第2章 b', '第5章 c', '第6章 d', '第7章 e']);
    expect(r).toEqual([chapter(0), chapter(1), null, null, chapter(4)]);
  });

  it('单个错号不让 last 跳上去', () => {
    const r = run(['第1章 a', '第2章 b', '第1000章 x', '第3章 c', '第5章', '第2章']);
    expect(r).toEqual([chapter(0), chapter(1), null, chapter(3), null, stray(5)]);
  });

  it('孤立编号 ≤ last → stray_number', () => {
    const r = run([...chaps(3), '第2章', '第3章', '第4章']);
    expect(r.slice(3)).toEqual([stray(3), stray(4), null]);
  });

  it('无章名的下一章不标', () => {
    const r = run([...chaps(78), '第七十九章']);
    expect(r[78]).toBeNull();
  });

  it('卷行后规则 2 暂停', () => {
    const r = run([...chaps(3), '第二卷 新地', '第一章', '第二章']);
    expect(r.slice(3)).toEqual([null, null, null]);
  });

  it('每卷重新编号且有章名', () => {
    const r = run([...chaps(3), '第二卷', '第一章 归来', '第二章 再战', '第三章 x']);
    expect(r.slice(3)).toEqual([null, null, null, chapter(6)]);
  });

  it('卷前缀章节', () => {
    const r = run(['第五卷名震一方第一章 甲', '第二章 乙', '第三章 丙']);
    expect(r).toEqual([chapter(0), chapter(1), chapter(2)]);
  });

  it('中文数字解析失败 → null', () => {
    expect(run(['第壹章 甲'])).toEqual([null]);
  });
});
