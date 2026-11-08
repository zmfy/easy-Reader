import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Fragment, Slice, type Node as PmNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import ListItem from '@tiptap/extension-list-item'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { AiAdded } from './ai-added-mark'
import { TableLimits } from './table-limits'

// 递归丢弃 slice 中不在允许集合里的 noteRef（与 HTML 写法无关）
function stripNoteRefs(fragment: Fragment, allowed: Set<string>): Fragment {
  const out: PmNode[] = []
  fragment.forEach(node => {
    if (node.type.name === 'noteRef' && !allowed.has(node.attrs.ref)) return
    out.push(node.isLeaf ? node : node.copy(stripNoteRefs(node.content, allowed)))
  })
  return Fragment.fromArray(out)
}

function docRefs(doc: PmNode): string[] {
  const refs: string[] = []
  doc.descendants(n => {
    if (n.type.name === 'noteRef' && typeof n.attrs.ref === 'string') refs.push(n.attrs.ref)
  })
  return refs
}

export interface NoteRefOptions {
  /** 额外允许粘贴/拖放的引用（如总结的 included_refs），用于剪切后再粘贴 */
  allowedRefs: () => string[]
}

const SVG_NS = 'http://www.w3.org/2000/svg'
// Tabler「book」图标（outline）
const BOOK_ICON: any = [
  `${SVG_NS} svg`,
  { viewBox: '0 0 24 24', width: '1em', height: '1em', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
  [`${SVG_NS} path`, { d: 'M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0' }],
  [`${SVG_NS} path`, { d: 'M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0' }],
  [`${SVG_NS} path`, { d: 'M3 6l0 13' }],
  [`${SVG_NS} path`, { d: 'M12 6l0 13' }],
  [`${SVG_NS} path`, { d: 'M21 6l0 13' }],
]

// 原文引用：只能由系统/AI 生成，用户可删除，不能手写或粘贴伪造
export const NoteRef = Node.create<NoteRefOptions>({
  name: 'noteRef',
  inline: true,

  addOptions() {
    return { allowedRefs: () => [] }
  },
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
    return ['span', mergeAttributes({ class: 'note-ref', 'aria-label': '原文', title: '查看原文' }, HTMLAttributes), BOOK_ICON]
  },

  addProseMirrorPlugins() {
    const getAllowed = this.options.allowedRefs
    return [
      new Plugin({
        props: {
          // 粘贴/拖放（含编辑器内拖动）：只保留当前文档已有或总结已收录的引用，其余视为伪造丢弃
          transformPasted: (slice, view) => {
            const allowed = new Set([...docRefs(view.state.doc), ...getAllowed()])
            return new Slice(stripNoteRefs(slice.content, allowed), slice.openStart, slice.openEnd)
          },
        },
      }),
    ]
  },
})

// listItem 内容与后端内容模型一致：首个为段落，之后只能是段落、列表、代码块（不含标题）
const SummaryListItem = ListItem.extend({
  content: 'paragraph (paragraph | bulletList | orderedList | codeBlock)*',
})

// 格子里只能是段落（与后端内容模型一致；默认是 block+）
const SummaryTableHeader = TableHeader.extend({ content: 'paragraph+' })
const SummaryTableCell = TableCell.extend({ content: 'paragraph+' })

// 只产出后端 isValidDoc 白名单与内容模型内的节点与标记
export function summaryExtensions(opts: Partial<NoteRefOptions> = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      blockquote: false,
      horizontalRule: false,
      strike: false,
      listItem: false,
    }),
    SummaryListItem,
    opts.allowedRefs ? NoteRef.configure({ allowedRefs: opts.allowedRefs }) : NoteRef,
    Table.configure({ resizable: false }),
    TableRow,
    SummaryTableHeader,
    SummaryTableCell,
    TableLimits,
    AiAdded,
  ]
}
