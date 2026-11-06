import { describe, it, expect } from 'vitest'
import { boldSegments } from './inline-bold'

describe('boldSegments', () => {
  it('splits paired bold markers', () => {
    expect(boldSegments('**设置**：修复 **a** 问题')).toEqual([
      { text: '设置', bold: true },
      { text: '：修复 ', bold: false },
      { text: 'a', bold: true },
      { text: ' 问题', bold: false },
    ])
  })

  it('keeps unpaired markers as text', () => {
    expect(boldSegments('a **b')).toEqual([{ text: 'a **b', bold: false }])
  })

  it('no markers returns single segment', () => {
    expect(boldSegments('plain')).toEqual([{ text: 'plain', bold: false }])
  })

  it('does not interpret html', () => {
    expect(boldSegments('<b>x</b>')).toEqual([{ text: '<b>x</b>', bold: false }])
  })
})
