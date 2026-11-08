<template>
  <div class="summary-editor" :class="{ readonly: isReadonly }">
    <el-alert
      v-if="contentError"
      class="se-error"
      type="error"
      :closable="false"
      show-icon
      title="内容格式异常，已切换为只读，请联系管理员或用接口修复"
    />
    <div v-if="!isReadonly && editor" class="se-toolbar">
      <el-tooltip v-for="b in buttons" :key="b.name" :content="b.tip" placement="top" :show-after="300">
        <button
          type="button"
          class="se-btn"
          :class="{ active: b.active?.() }"
          :disabled="b.disabled?.()"
          :aria-label="b.tip"
          @click="b.run"
        >
          <component :is="b.icon" :size="18" />
        </button>
      </el-tooltip>
      <span class="se-tidy" :title="tidyHint || 'AI 整理选中的内容'">
        <el-dropdown trigger="click" :disabled="!!tidyHint" @command="onTidy">
          <button type="button" class="se-tidy-btn" :disabled="!!tidyHint" aria-label="AI 整理">
            <IconSparkles :size="16" /><span>AI 整理</span><IconChevronDown :size="14" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="list">整理成列表</el-dropdown-item>
              <el-dropdown-item command="table">整理成表格</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </span>
    </div>
    <div v-if="!isReadonly && editor && editor.isActive('table')" class="se-table-tools">
      <el-tooltip v-for="b in tableButtons" :key="b.tip" :content="b.tip" placement="top" :show-after="300">
        <button type="button" class="se-tbtn" :aria-label="b.tip" @click="b.run">
          <component :is="b.icon" :size="18" />
        </button>
      </el-tooltip>
    </div>
    <editor-content
      :editor="editor"
      class="se-content"
      @click="onClick"
      @mouseover="onHover"
    />
    <bubble-menu
      v-if="!isReadonly && editor"
      :editor="editor"
      :tippy-options="{ duration: 100, placement: 'top' }"
      class="se-bubble"
    >
      <button type="button" class="se-bbtn" :class="{ active: editor.isActive('bold') }" aria-label="加粗" @click="editor.chain().focus().toggleBold().run()"><IconBold :size="16" /></button>
      <button type="button" class="se-bbtn" :class="{ active: editor.isActive('italic') }" aria-label="斜体" @click="editor.chain().focus().toggleItalic().run()"><IconItalic :size="16" /></button>
      <button type="button" class="se-bbtn" :class="{ active: editor.isActive('bulletList') }" aria-label="无序列表" @click="editor.chain().focus().toggleBulletList().run()"><IconList :size="16" /></button>
      <span class="se-bubble-tidy" :title="tidyHint || 'AI 整理选中的内容'">
        <el-dropdown trigger="click" :disabled="!!tidyHint" @command="onTidy">
          <button type="button" class="se-bbtn se-bbtn-text" :disabled="!!tidyHint">
            <IconSparkles :size="16" /><span>AI 整理</span><IconChevronDown :size="12" />
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="list">整理成列表</el-dropdown-item>
              <el-dropdown-item command="table">整理成表格</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </span>
    </bubble-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Editor, EditorContent, BubbleMenu, createDocument } from '@tiptap/vue-3'
import { EditorState } from '@tiptap/pm/state'
import {
  IconBold, IconItalic, IconH2, IconH3, IconList, IconListNumbers,
  IconCode, IconSourceCode, IconArrowBackUp, IconArrowForwardUp,
  IconTablePlus, IconEraser, IconSparkles, IconChevronDown,
  IconRowInsertTop, IconRowInsertBottom, IconRowRemove,
  IconColumnInsertLeft, IconColumnInsertRight, IconColumnRemove, IconTableOff,
} from '@tabler/icons-vue'
import { summaryExtensions } from '../utils/note-ref-extension'
import { selectionBlocks, tidyDisabledReason, type SelectionBlocks } from '../utils/summary-tidy'
import type { DocNode } from '../types/study'

const props = defineProps<{
  modelValue: DocNode; readonly: boolean; allowedRefs?: string[]
  /** 父组件允许 AI 整理（已配置 AI、无任务、非只读）；为 false 时用 tidyDisabledHint 提示 */
  tidyEnabled?: boolean; tidyDisabledHint?: string
}>()
const emit = defineEmits<{
  (e: 'tidy', mode: 'list' | 'table', sel: SelectionBlocks): void
  (e: 'update:modelValue', doc: DocNode): void
  (e: 'ref-click', ref: string, el: HTMLElement): void
  (e: 'ref-hover', ref: string, el: HTMLElement): void
}>()

// 内容不符合 schema：Tiptap 会剥掉非法部分再显示，此时一旦编辑就会覆盖原文，故切为只读
const contentError = ref(false)
const isReadonly = computed(() => props.readonly || contentError.value)

const editor = new Editor({
  extensions: summaryExtensions({ allowedRefs: () => props.allowedRefs || [] }),
  content: props.modelValue,
  editable: !props.readonly,
  enableContentCheck: true,
  onContentError: () => { contentError.value = true },
  onUpdate: ({ editor: e }) => emit('update:modelValue', e.getJSON() as DocNode),
})

// 第二个参数 false：切换只读不触发 update，否则父组件会当成一次编辑去保存
watch(isReadonly, v => editor.setEditable(!v, false), { immediate: true })

// 外部载入新内容；内容与编辑器一致时跳过，避免丢失光标。
// 重建 state（保留插件）而不是 setContent：不触发 update，且清空撤销历史，
// 否则 Ctrl+Z 会撤回 AI 刚追加或别处更新的内容并被自动保存
watch(() => props.modelValue, v => {
  if (JSON.stringify(v) === JSON.stringify(editor.getJSON())) return
  let doc
  try {
    doc = createDocument(v, editor.schema, editor.options.parseOptions, { errorOnInvalidContent: true })
    contentError.value = false
  } catch {
    contentError.value = true
    doc = createDocument(v, editor.schema, editor.options.parseOptions, { errorOnInvalidContent: false })
  }
  const state = EditorState.create({ doc, plugins: editor.view.state.plugins })
  editor.view.updateState(state)
  // vue-3 的 Editor 另存一份响应式 state，只在 beforeTransaction 时更新；updateState 不经过事务，需同步一次
  editor.emit('beforeTransaction', { editor, transaction: state.tr, nextState: state })
})

onBeforeUnmount(() => editor.destroy())

const refEl = (ev: Event): HTMLElement | null => (ev.target as HTMLElement | null)?.closest?.('span.note-ref[data-ref]') as HTMLElement | null

function onClick(ev: MouseEvent) {
  const el = refEl(ev)
  if (el) emit('ref-click', el.getAttribute('data-ref') || '', el)
}
function onHover(ev: MouseEvent) {
  const el = refEl(ev)
  if (el) emit('ref-hover', el.getAttribute('data-ref') || '', el)
}

// 选区不可整理的原因（null = 可整理）
const tidyHint = computed(() => {
  if (!props.tidyEnabled) return props.tidyDisabledHint || '暂不可用'
  return tidyDisabledReason(selectionBlocks(editor.state))
})

function onTidy(mode: 'list' | 'table') {
  const sel = selectionBlocks(editor.state)
  if (!props.tidyEnabled || tidyDisabledReason(sel)) return
  // 收起选区：浮动工具栏随之隐藏（否则会浮在整理弹框上方）；整理按 sel 记下的块位置进行
  editor.commands.setTextSelection(editor.state.selection.to)
  emit('tidy', mode, sel!)
}

// 光标处或选区内有 AI 补充标记
function hasAiMark(): boolean {
  const { from, to, empty } = editor.state.selection
  if (empty) return editor.isActive('aiAdded')
  return editor.state.doc.rangeHasMark(from, to, editor.schema.marks.aiAdded)
}

function removeAiMark() {
  const chain = editor.chain().focus()
  if (editor.state.selection.empty) chain.extendMarkRange('aiAdded')
  chain.unsetMark('aiAdded').run()
}

const TABLE_SIZE = { rows: 2, cols: 3, withHeaderRow: true }

const tableButtons = computed(() => {
  const c = () => editor.chain().focus()
  return [
    { tip: '上方加行', icon: IconRowInsertTop, run: () => c().addRowBefore().run() },
    { tip: '下方加行', icon: IconRowInsertBottom, run: () => c().addRowAfter().run() },
    { tip: '删除行', icon: IconRowRemove, run: () => c().deleteRow().run() },
    { tip: '左侧加列', icon: IconColumnInsertLeft, run: () => c().addColumnBefore().run() },
    { tip: '右侧加列', icon: IconColumnInsertRight, run: () => c().addColumnAfter().run() },
    { tip: '删除列', icon: IconColumnRemove, run: () => c().deleteColumn().run() },
    { tip: '删除表格', icon: IconTableOff, run: () => c().deleteTable().run() },
  ]
})

// 用一次事务把 [from, to) 的顶层块换成 nodes（可撤销，会触发 update:modelValue），返回新文档
function replaceBlocks(from: number, to: number, nodes: DocNode[]): DocNode {
  const content = nodes.map(n => editor.schema.nodeFromJSON(n))
  editor.view.dispatch(editor.state.tr.replaceWith(from, to, content).scrollIntoView())
  return editor.getJSON() as DocNode
}

defineExpose({ editor, replaceBlocks, getSelectionBlocks: () => selectionBlocks(editor.state) })

const buttons = computed(() => {
  const e = editor
  return [
    { name: 'bold', tip: '加粗', icon: IconBold, run: () => e.chain().focus().toggleBold().run(), active: () => e.isActive('bold') },
    { name: 'italic', tip: '斜体', icon: IconItalic, run: () => e.chain().focus().toggleItalic().run(), active: () => e.isActive('italic') },
    { name: 'h2', tip: '二级标题（主题）', icon: IconH2, run: () => e.chain().focus().toggleHeading({ level: 2 }).run(), active: () => e.isActive('heading', { level: 2 }) },
    { name: 'h3', tip: '三级标题', icon: IconH3, run: () => e.chain().focus().toggleHeading({ level: 3 }).run(), active: () => e.isActive('heading', { level: 3 }) },
    { name: 'bullet', tip: '无序列表', icon: IconList, run: () => e.chain().focus().toggleBulletList().run(), active: () => e.isActive('bulletList') },
    { name: 'ordered', tip: '有序列表', icon: IconListNumbers, run: () => e.chain().focus().toggleOrderedList().run(), active: () => e.isActive('orderedList') },
    { name: 'code', tip: '行内代码', icon: IconCode, run: () => e.chain().focus().toggleCode().run(), active: () => e.isActive('code') },
    { name: 'codeBlock', tip: '代码块', icon: IconSourceCode, run: () => e.chain().focus().toggleCodeBlock().run(), active: () => e.isActive('codeBlock') },
    { name: 'table', tip: '插入表格', icon: IconTablePlus, run: () => e.chain().focus().insertTable(TABLE_SIZE).run(), disabled: () => !e.can().insertTable(TABLE_SIZE) },
    { name: 'unAi', tip: '去掉 AI 标记', icon: IconEraser, run: removeAiMark, disabled: () => !hasAiMark() },
    { name: 'undo', tip: '撤销', icon: IconArrowBackUp, run: () => e.chain().focus().undo().run(), disabled: () => !e.can().undo() },
    { name: 'redo', tip: '重做', icon: IconArrowForwardUp, run: () => e.chain().focus().redo().run(), disabled: () => !e.can().redo() },
  ]
})
</script>

<style scoped>
.summary-editor { display: flex; flex-direction: column; min-width: 0; }
.se-toolbar {
  display: flex; gap: 4px; padding: 6px 8px; position: sticky; top: 0; z-index: 2;
  background: var(--card-bg, var(--bg-1)); border: 1px solid var(--card-border, var(--bg-2)); border-radius: 10px;
  overflow-x: auto; white-space: nowrap;
}
.se-btn {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 32px; height: 32px; border: 0; border-radius: 8px; cursor: pointer;
  background: transparent; color: var(--text-1);
}
.se-btn:hover:not(:disabled) { background: var(--bg-2); color: var(--text-0); }
.se-btn.active { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); }
.se-btn:disabled { opacity: .35; cursor: not-allowed; }
.se-error { margin-bottom: 10px; }
.se-content { margin-top: 10px; color: var(--text-0); }
.se-content :deep(.ProseMirror) { outline: none; min-height: 240px; line-height: 1.8; font-family: 'Noto Serif SC', serif; }
.se-content :deep(h2) { margin: 1.2em 0 .5em; font-size: 1.35em; padding-bottom: .25em; border-bottom: 1px solid var(--card-border, var(--bg-2)); }
.se-content :deep(h3) { margin: 1em 0 .4em; font-size: 1.12em; }
.se-content :deep(p) { margin: .5em 0; }
.se-content :deep(ul), .se-content :deep(ol) { padding-left: 1.6em; }
.se-content :deep(code) { padding: 1px 5px; border-radius: 4px; background: var(--bg-2); font-size: .9em; }
.se-content :deep(pre) { padding: 10px 12px; border-radius: 8px; background: var(--bg-2); overflow-x: auto; }
.se-content :deep(pre code) { padding: 0; background: transparent; }
.se-content :deep(.note-ref) {
  display: inline-block; margin: 0 2px; padding: 0 3px; border-radius: 4px; cursor: pointer; user-select: none;
  color: var(--accent); line-height: 1;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.se-content :deep(.note-ref svg) { display: block; vertical-align: -0.125em; }
.se-content :deep(.note-ref:hover),
.se-content :deep(.note-ref.ProseMirror-selectednode) { background: color-mix(in srgb, var(--accent) 28%, transparent); }
/* AI 整理入口 */
.se-tidy { display: inline-flex; flex: none; margin-left: 4px; }
.se-tidy-btn, .se-bbtn-text {
  display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 10px; border: 0; border-radius: 8px;
  cursor: pointer; font-size: 13px; color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.se-tidy-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.se-tidy-btn:disabled, .se-bbtn-text:disabled { opacity: .45; cursor: not-allowed; }
/* 表格工具 */
.se-table-tools {
  display: flex; gap: 4px; margin-top: 6px; padding: 4px 8px; overflow-x: auto; white-space: nowrap;
  border: 1px dashed var(--card-border, var(--bg-2)); border-radius: 10px;
}
.se-tbtn {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 30px; height: 30px; border: 0; border-radius: 8px; cursor: pointer; background: transparent; color: var(--text-1);
}
.se-tbtn:hover { background: var(--bg-2); color: var(--text-0); }
/* 浮动工具栏 */
.se-bubble {
  display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 10px;
  background: var(--card-bg, var(--bg-1)); border: 1px solid var(--card-border, var(--bg-2));
  box-shadow: 0 6px 20px rgba(0, 0, 0, .12);
}
.se-bbtn {
  display: inline-flex; align-items: center; justify-content: center; height: 28px; min-width: 28px; padding: 0 4px;
  border: 0; border-radius: 6px; cursor: pointer; background: transparent; color: var(--text-1);
}
.se-bbtn:hover:not(:disabled) { background: var(--bg-2); color: var(--text-0); }
.se-bbtn.active { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.se-bbtn-text { height: 28px; padding: 0 8px; font-size: 12px; }
.se-bubble-tidy { display: inline-flex; }
/* 表格 */
/* 不可调列宽时 Tiptap 不包 .tableWrapper：表格自身横向滚动，tbody 撑满宽度 */
.se-content :deep(table) {
  display: block; max-width: 100%; overflow-x: auto; margin: .8em 0;
  border-collapse: collapse; font-family: 'Noto Sans SC', sans-serif; font-size: .95em;
}
.se-content :deep(table > tbody) { display: table; width: 100%; border-collapse: collapse; }
.se-content :deep(th), .se-content :deep(td) {
  border: 1px solid var(--card-border, var(--bg-2)); padding: 6px 10px; vertical-align: top; min-width: 4em; position: relative;
}
.se-content :deep(th) { background: color-mix(in srgb, var(--accent) 6%, transparent); font-weight: 600; text-align: left; }
.se-content :deep(th p), .se-content :deep(td p) { margin: 0; }
.se-content :deep(.selectedCell)::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; background: color-mix(in srgb, var(--accent) 12%, transparent);
}
/* AI 补充 */
.se-content :deep(.ai-added) {
  text-decoration: underline dashed var(--accent); text-underline-offset: 3px;
  background: color-mix(in srgb, var(--accent) 10%, transparent); border-radius: 2px;
}
@media (max-width: 768px) {
  .se-toolbar { border-radius: 8px; -webkit-overflow-scrolling: touch; }
  /* 手机上浮动工具栏易被系统菜单挡住，用顶部工具栏的入口 */
  .se-bubble { display: none; }
}
</style>
