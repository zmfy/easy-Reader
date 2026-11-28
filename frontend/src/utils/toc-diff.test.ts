import { describe, it, expect } from 'vitest'
import { diffToc } from './toc-diff'

const t = (title: string, level = 1) => ({ title, level })

describe('diffToc', () => {
  it('完全相同 → same', () => {
    const toc = [t('第1章 开端'), t('第2章 风起')]
    expect(diffToc(toc, toc)).toEqual([
      { kind: 'same', original: '第1章 开端', organized: '第1章 开端', level: 1 },
      { kind: 'same', original: '第2章 风起', organized: '第2章 风起', level: 1 },
    ])
  })

  it('「第5章 X」「第0005章X？？」两条合并为一条 → 一个 merged', () => {
    const original = [t('第4章 W'), t('第5章 X'), t('第0005章X？？'), t('第6章 Y')]
    const organized = [t('第4章 W'), t('第5章 X'), t('第6章 Y')]
    const rows = diffToc(original, organized)
    expect(rows.map(r => r.kind)).toEqual(['same', 'merged', 'same'])
    expect(rows[1]).toEqual({ kind: 'merged', original: '第5章 X / 第0005章X？？', organized: '第5章 X', level: 1 })
  })

  it('标题去掉附言 → renamed', () => {
    const rows = diffToc([t('第3章 夜行（求月票）'), t('第四章 归来')], [t('第3章 夜行'), t('第四章 归来')])
    expect(rows).toEqual([
      { kind: 'renamed', original: '第3章 夜行（求月票）', organized: '第3章 夜行', level: 1 },
      { kind: 'same', original: '第四章 归来', organized: '第四章 归来', level: 1 },
    ])
  })

  it('另一套编号「第2章」被去掉 → removed', () => {
    const original = [t('第10章 风起'), t('第2章', 2), t('第11章 云涌')]
    const organized = [t('第10章 风起'), t('第11章 云涌')]
    expect(diffToc(original, organized)).toEqual([
      { kind: 'same', original: '第10章 风起', organized: '第10章 风起', level: 1 },
      { kind: 'removed', original: '第2章', level: 2 },
      { kind: 'same', original: '第11章 云涌', organized: '第11章 云涌', level: 1 },
    ])
  })

  it('原目录没有的标题 → added；中文数字与阿拉伯数字视为同一章', () => {
    const rows = diffToc([t('第五章 X'), t('第6章 Y')], [t('第一卷 起', 0), t('第5章 X'), t('第6章 Y')])
    expect(rows.map(r => r.kind)).toEqual(['added', 'renamed', 'same'])
    expect(rows[0]).toEqual({ kind: 'added', organized: '第一卷 起', level: 0 })
  })

  it('去掉卷名前缀 → renamed（同一章号，整理版是原文删字所得）', () => {
    const rows = diffToc(
      [t('第五卷名震一方第六百四十七章 灵婴'), t('第五卷名震一方第六百四十八章至木灵婴')],
      [t('第六百四十七章 灵婴'), t('第六百四十八章至木灵婴')],
    )
    expect(rows).toEqual([
      { kind: 'renamed', original: '第五卷名震一方第六百四十七章 灵婴', organized: '第六百四十七章 灵婴', level: 1 },
      { kind: 'renamed', original: '第五卷名震一方第六百四十八章至木灵婴', organized: '第六百四十八章至木灵婴', level: 1 },
    ])
  })

  it('章号不同不算同一章，即使整理版能由原文删字得到（第五卷…第六百五十九章 ≠ 第五百五十九章）', () => {
    const rows = diffToc([t('第五卷名震一方第六百五十九章四叔祖')], [t('第五百五十九章四叔祖')])
    expect(rows.map(r => r.kind).sort()).toEqual(['added', 'removed'])
  })

  it('章号写法不同视为同一章：0005 / ５ / 五；一千零五 / 1005', () => {
    const rows = diffToc(
      [t('第0005章 风起'), t('第６章 云涌'), t('第一千零五章 终')],
      [t('第五章 风起'), t('第6章 云涌'), t('第1005章 终')],
    )
    expect(rows.map(r => r.kind)).toEqual(['renamed', 'renamed', 'renamed'])
  })

  // 原目录：第 0–9 条无前缀，第 10–29 条带卷名前缀「第五卷名震一方」，第 15–19 条后面重复了一遍；整理版去掉前缀和重复块
  const prefixedBook = (n: number, dupFrom: number, dupTo: number) => {
    const name = (i: number) => `第${600 + i}章 名字${i}`
    const orig = (i: number) => (i >= 10 ? `第五卷名震一方${name(i)}` : name(i))
    const original: { title: string; level: number }[] = []
    for (let i = 0; i < n; i++) {
      original.push(t(orig(i)))
      if (i === dupTo) for (let d = dupFrom; d <= dupTo; d++) original.push(t(orig(d)))
    }
    const organized = Array.from({ length: n }, (_, i) => t(name(i)))
    return { original, organized }
  }

  it('长串卷名前缀 + 一段重复块：前缀的算 renamed，只有重复块是 removed，没有 added', () => {
    const { original, organized } = prefixedBook(30, 15, 19)
    expect(original).toHaveLength(35)
    const rows = diffToc(original, organized)
    const count = (k: string) => rows.filter(r => r.kind === k).length
    expect(count('same')).toBe(10)
    expect(count('renamed')).toBe(20)
    expect(count('removed')).toBe(5)
    expect(count('added')).toBe(0)
    expect(count('merged')).toBe(0)
    expect(rows.filter(r => r.kind === 'removed').map(r => r.original)).toEqual(
      [15, 16, 17, 18, 19].map(i => `第五卷名震一方第${600 + i}章 名字${i}`),
    )
    // 重复块紧跟在第 19 章之后
    const idx = rows.findIndex(r => r.kind === 'removed')
    expect(rows[idx - 1]).toMatchObject({ kind: 'renamed', organized: '第619章 名字19' })
  })

  it('大目录（超出整表对齐上限）同样对齐：重复块 removed，没有 added', () => {
    const { original, organized } = prefixedBook(4000, 2000, 2099)
    const rows = diffToc(original, organized)
    const count = (k: string) => rows.filter(r => r.kind === k).length
    expect(count('same')).toBe(10)
    expect(count('renamed')).toBe(3990)
    expect(count('removed')).toBe(100)
    expect(count('added')).toBe(0)
  })
})
