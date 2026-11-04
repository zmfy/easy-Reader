import {
  chapterParagraphs,
  readPart,
  clipMiddle,
  extractQueryTerms,
  findRelevantSnippets,
  buildRecapPrompt,
  buildAskPrompt,
  cleanAiText,
} from '../../src/services/ai-reading';

describe('chapterParagraphs', () => {
  it('splits block html into trimmed plain-text paragraphs', () => {
    expect(chapterParagraphs('<p>第一章 绯红</p>\n<p>  痛！&amp;好痛</p><div>他醒了。<br>天亮了。</div>'))
      .toEqual(['第一章 绯红', '痛！&好痛', '他醒了。', '天亮了。'])
  })

  it('treats plain text without tags as newline-separated paragraphs', () => {
    expect(chapterParagraphs('甲\n\n乙')).toEqual(['甲', '乙'])
  })
})

describe('readPart', () => {
  it('keeps paragraphs up to and including the reading position', () => {
    expect(readPart('<p>a</p><p>b</p><p>c</p>', 1)).toBe('a\nb')
  })

  it('keeps everything when the position is past the end', () => {
    expect(readPart('<p>a</p><p>b</p>', 9)).toBe('a\nb')
  })
})

describe('clipMiddle', () => {
  it('returns short text unchanged', () => {
    expect(clipMiddle('abcdef', 10)).toBe('abcdef')
  })

  it('keeps the beginning and the end of long text', () => {
    const out = clipMiddle('0123456789ABCDEFGHIJ', 10)
    expect(out.startsWith('0123')).toBe(true)
    expect(out.endsWith('FGHIJ')).toBe(true)
    expect(out).toContain('……')
    expect(out.length).toBeLessThanOrEqual(12)
  })
})

describe('extractQueryTerms', () => {
  const corpus = '克莱恩·莫雷蒂醒来。梅丽莎是克莱恩的妹妹。班森在公司上班。周明瑞想起塔罗会。'

  it('finds names from the question that appear in the read text, longest first', () => {
    expect(extractQueryTerms('梅丽莎是谁？', corpus)).toEqual(['梅丽莎'])
  })

  it('ignores question words and terms absent from the text', () => {
    const terms = extractQueryTerms('克莱恩和班森之前发生过什么事情？', corpus)
    expect(terms).toEqual(expect.arrayContaining(['克莱恩', '班森']))
    expect(terms).not.toContain('什么')
    expect(terms).not.toContain('发生')
  })

  it('does not return a shorter term already covered by a longer one', () => {
    expect(extractQueryTerms('塔罗会是什么', corpus)).toEqual(['塔罗会'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(extractQueryTerms('今天天气怎么样', corpus)).toEqual([])
  })
})

describe('findRelevantSnippets', () => {
  const chapters = [
    { index: 0, title: '第一章', text: '开头。梅丽莎第一次出现，她是克莱恩的妹妹。其他内容其他内容。' },
    { index: 1, title: '第二章', text: '无关的段落。'.repeat(20) },
    { index: 2, title: '第三章', text: '梅丽莎做了早餐。梅丽莎去上学。梅丽莎回家。' },
  ]

  it('includes the chapter where a term first appears and the highest scoring chapter', () => {
    const snippets = findRelevantSnippets(['梅丽莎'], chapters, { window: 10, maxChars: 2000 })
    const idx = snippets.map(s => s.chapterIndex)
    expect(idx).toContain(0)
    expect(idx).toContain(2)
    expect(idx).not.toContain(1)
    expect(snippets.every(s => s.text.includes('梅丽莎'))).toBe(true)
  })

  it('orders snippets by chapter and respects the character budget', () => {
    const snippets = findRelevantSnippets(['梅丽莎'], chapters, { window: 10, maxChars: 30 })
    const total = snippets.reduce((n, s) => n + s.text.length, 0)
    expect(total).toBeLessThanOrEqual(30)
    const idx = snippets.map(s => s.chapterIndex)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })

  it('returns nothing without terms', () => {
    expect(findRelevantSnippets([], chapters)).toEqual([])
  })
})

describe('prompts', () => {
  it('recap prompt contains the book, chapter titles, text and the no-spoiler rule', () => {
    const p = buildRecapPrompt('诡秘之主', [
      { title: '第一章 绯红', text: '周明瑞醒来' },
      { title: '第二章 情况', text: '他了解了处境' },
    ])
    expect(p).toContain('《诡秘之主》')
    expect(p).toContain('第一章 绯红')
    expect(p).toContain('他了解了处境')
    expect(p).toMatch(/不要.*(后续|后文)/)
  })

  it('ask prompt contains question, snippets with sources, current chapter, history and the no-spoiler rule', () => {
    const p = buildAskPrompt({
      bookTitle: '诡秘之主',
      question: '梅丽莎是谁？',
      snippets: [{ chapterIndex: 0, title: '第一章', text: '梅丽莎是妹妹' }],
      current: { title: '第三章 梅丽莎', text: '梅丽莎做了早餐' },
      history: [{ q: '克莱恩是谁', a: '主角' }],
    })
    expect(p).toContain('梅丽莎是谁？')
    expect(p).toContain('第一章')
    expect(p).toContain('梅丽莎是妹妹')
    expect(p).toContain('第三章 梅丽莎')
    expect(p).toContain('克莱恩是谁')
    expect(p).toMatch(/不要.*(透露|猜测)/)
  })
})

describe('cleanAiText', () => {
  it('drops thinking blocks and trims', () => {
    expect(cleanAiText('<think>推理……</think>\n\n  前情：他醒了。 ')).toBe('前情：他醒了。')
  })
})
