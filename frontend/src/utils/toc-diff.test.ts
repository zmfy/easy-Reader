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
})
