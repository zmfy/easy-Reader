import { Mark, mergeAttributes } from '@tiptap/core'

// AI 补充：AI 整理时补上的、笔记里没有的文字。去掉标记即表示用户已核实
export const AiAdded = Mark.create({
  name: 'aiAdded',
  // 在标记文字末尾继续输入，新打的字不带标记
  inclusive: false,

  parseHTML() {
    return [{ tag: 'span.ai-added' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'ai-added', title: 'AI 补充，未出自你的笔记' }, HTMLAttributes), 0]
  },
})
