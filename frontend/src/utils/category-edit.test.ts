import { describe, it, expect } from 'vitest'
import { fromTree, toTree, computeRenames, newEditNode, nameError } from './category-edit'

const tree = [{ name: '小说', children: [{ name: '网络小说', children: [{ name: '玄幻' }] }] }, { name: '其他' }]

describe('category tree editing', () => {
  it('round-trips the tree', () => {
    expect(toTree(fromTree(tree))).toEqual(tree)
  })

  it('computes renames top-down using the new parent path', () => {
    const nodes = fromTree(tree)
    nodes[0].name = '书'
    nodes[0].children[0].name = '网文'
    nodes[0].children[0].children.push(newEditNode('仙侠'))
    expect(computeRenames(nodes)).toEqual([
      { from: '小说', to: '书' },
      { from: '书/网络小说', to: '书/网文' },
    ])
    expect(computeRenames(fromTree(tree))).toEqual([])
  })

  it('validates names against siblings', () => {
    const nodes = fromTree(tree)
    expect(nameError('其他', nodes)).toContain('已有')
    expect(nameError('其他', nodes, nodes[1])).toBeNull()
    expect(nameError('a/b', nodes)).toContain('不能包含')
    expect(nameError(' ', nodes)).toContain('不能为空')
  })
})
