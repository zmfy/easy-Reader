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
    </div>
    <editor-content
      :editor="editor"
      class="se-content"
      @click="onClick"
      @mouseover="onHover"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Editor, EditorContent, createDocument } from '@tiptap/vue-3'
import { EditorState } from '@tiptap/pm/state'
import {
  IconBold, IconItalic, IconH2, IconH3, IconList, IconListNumbers,
  IconCode, IconSourceCode, IconArrowBackUp, IconArrowForwardUp,
} from '@tabler/icons-vue'
import { summaryExtensions } from '../utils/note-ref-extension'
import type { DocNode } from '../types/study'

const props = defineProps<{ modelValue: DocNode; readonly: boolean; allowedRefs?: string[] }>()
const emit = defineEmits<{
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
@media (max-width: 768px) {
  .se-toolbar { border-radius: 8px; -webkit-overflow-scrolling: touch; }
}
</style>
