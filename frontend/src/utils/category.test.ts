import { describe, it, expect } from 'vitest'
import { toCategoryOptions, categoryLabel, categoryLeaf, categoryPaths } from './category'

const tree = [{ name: '小说', children: [{ name: '网络小说', children: [{ name: '玄幻' }] }, { name: '外国小说' }] }, { name: '其他' }]

describe('category utils', () => {
  it('builds cascader options with full-path values and optional counts', () => {
    expect(toCategoryOptions(tree, { '小说': 3, '小说/网络小说': 2, '小说/网络小说/玄幻': 2 })).toEqual([
      { value: '小说', label: '小说（3）', children: [
        { value: '小说/网络小说', label: '网络小说（2）', children: [{ value: '小说/网络小说/玄幻', label: '玄幻（2）' }] },
        { value: '小说/外国小说', label: '外国小说' },
      ] },
      { value: '其他', label: '其他' },
    ])
    expect(toCategoryOptions([{ name: '其他' }])).toEqual([{ value: '其他', label: '其他' }])
  })

  it('formats labels and leaves', () => {
    expect(categoryLabel('小说/网络小说/玄幻')).toBe('小说 › 网络小说 › 玄幻')
    expect(categoryLeaf('小说/网络小说/玄幻')).toBe('玄幻')
    expect(categoryLeaf('言情')).toBe('言情')
    expect(categoryLabel(null)).toBe('')
    expect(categoryPaths(tree)).toEqual(['小说', '小说/网络小说', '小说/网络小说/玄幻', '小说/外国小说', '其他'])
  })
})
