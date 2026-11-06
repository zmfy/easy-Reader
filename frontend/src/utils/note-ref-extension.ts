import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Fragment, Slice } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'

// 递归丢弃 slice 中所有 noteRef（与 HTML 写法无关）
function stripNoteRefs(fragment: Fragment): Fragment {
  const out: any[] = []
  fragment.forEach(node => {
    if (node.type.name === 'noteRef') return
    out.push(node.isLeaf ? node : node.copy(stripNoteRefs(node.content)))
  })
  return Fragment.fromArray(out)
}

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
          // 粘贴/拖放进来的内容一律不保留 noteRef（含编辑器内复制的 📖，直接丢弃）
          transformPasted: slice => new Slice(stripNoteRefs(slice.content), slice.openStart, slice.openEnd),
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
