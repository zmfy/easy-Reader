import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'

// 不去掉标记的事务：粘贴 / 拖放（搬动已有内容）、撤销重做、程序写入整理结果（setMeta('keepAiAdded', true)）
function keepsMarks(tr: Transaction): boolean {
  const ui = tr.getMeta('uiEvent')
  return ui === 'paste' || ui === 'drop' || !!tr.getMeta('history$') || !!tr.getMeta('keepAiAdded')
}

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

  // 用户在标记文字中间打的字（含输入法）也会沿用所在位置的标记：新插入的内容一律去掉标记
  addProseMirrorPlugins() {
    const type = this.type
    return [
      new Plugin({
        key: new PluginKey('aiAddedTyping'),
        appendTransaction(trs, _old, state) {
          const ranges: Array<[number, number]> = []
          trs.forEach((tr, ti) => {
            if (!tr.docChanged || keepsMarks(tr)) return
            tr.steps.forEach((step, si) => {
              step.getMap().forEach((_os, _oe, ns, ne) => {
                if (ne <= ns) return
                let from = tr.mapping.slice(si + 1).map(ns, 1)
                let to = tr.mapping.slice(si + 1).map(ne, -1)
                for (let k = ti + 1; k < trs.length; k++) {
                  from = trs[k].mapping.map(from, 1)
                  to = trs[k].mapping.map(to, -1)
                }
                if (to > from) ranges.push([from, to])
              })
            })
          })
          if (!ranges.length) return null
          const tr = state.tr
          for (const [from, to] of ranges) {
            if (state.doc.rangeHasMark(from, to, type)) tr.removeMark(from, to, type)
          }
          return tr.steps.length ? tr : null
        },
      }),
    ]
  },
})
