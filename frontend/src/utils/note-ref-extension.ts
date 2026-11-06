import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'

// 原文引用：只能由系统/AI 生成，用户可删除，不能手写或粘贴伪造
export const NoteRef = Node.create({
  name: 'noteRef',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      ref: {
        default: null,
        parseHTML: el => el.getAttribute('data-ref'),
        renderHTML: attrs => ({ 'data-ref': attrs.ref }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span.note-ref[data-ref]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ class: 'note-ref' }, HTMLAttributes), '📖']
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // 粘贴的 HTML 去掉 data-ref，noteRef 无法被解析出来
          transformPastedHTML: html => html.replace(/\sdata-ref\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, ''),
        },
      }),
    ]
  },
})

// 只产出后端 isValidDoc 白名单内的节点与标记
export function summaryExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      blockquote: false,
      horizontalRule: false,
      strike: false,
    }),
    NoteRef,
  ]
}
