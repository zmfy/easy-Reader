<template>
  <el-dialog
    :model-value="modelValue"
    :title="mode === 'table' ? 'AI 整理成表格' : 'AI 整理成列表'"
    :width="isNarrow ? '96%' : '1080px'"
    top="5vh"
    class="tidy-dialog"
    destroy-on-close
    @update:model-value="close"
  >
    <div class="td-panes" :class="{ narrow: isNarrow }">
      <section class="td-pane">
        <div class="td-label">改前</div>
        <div class="td-box">
          <SummaryEditor :model-value="beforeDoc" readonly />
        </div>
      </section>
      <section class="td-pane">
        <div class="td-label">改后</div>
        <div class="td-box" :class="{ center: state !== 'done' }">
          <div v-if="state === 'loading'" class="td-status">
            <el-icon class="is-loading" :size="22"><IconLoader2 /></el-icon>
            <span>AI 正在整理…</span>
          </div>
          <div v-else-if="state === 'error'" class="td-status">
            <span class="td-error">{{ error }}</span>
            <el-button size="small" @click="run">重试</el-button>
          </div>
          <SummaryEditor v-else-if="result" :model-value="afterDoc" readonly />
        </div>
        <div v-if="state === 'done' && result" class="td-notes">
          <p v-if="result.missingRefs.length" class="note note--warning">有 {{ result.missingRefs.length }} 处原文出处没有保留，可重新整理</p>
          <p v-if="result.aiAddedCount" class="td-ai-note">含 {{ result.aiAddedCount }} 处 AI 补充</p>
        </div>
        <div v-if="mode === 'table' && columns.length" class="td-columns">
          <div class="td-columns-head">
            <span>列名</span>
            <span class="form-hint">可修改后点「重新整理」，2–6 列</span>
          </div>
          <div class="td-columns-list">
            <div v-for="(_, i) in columns" :key="i" class="td-col">
              <el-input v-model="columns[i]" size="small" maxlength="20" :aria-label="`第 ${i + 1} 列`" />
              <button type="button" class="td-col-del" :disabled="columns.length <= 2" :aria-label="`删除第 ${i + 1} 列`" @click="columns.splice(i, 1)">
                <IconX :size="14" />
              </button>
            </div>
            <button type="button" class="td-col-add" :disabled="columns.length >= 6" aria-label="添加一列" @click="columns.push('')">
              <IconPlus :size="14" />
            </button>
          </div>
        </div>
      </section>
    </div>
    <template #footer>
      <el-button @click="close">放弃</el-button>
      <el-button :disabled="state === 'loading' || !columnsValid" @click="run">重新整理</el-button>
      <el-button type="primary" :disabled="state !== 'done'" @click="adopt">采用</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { IconLoader2, IconPlus, IconX } from '@tabler/icons-vue'
import SummaryEditor from './SummaryEditor.vue'
import { studyApi } from '@/api/study'
import type { DocNode, TidyMode, TidyResult } from '@/types/study'

const props = defineProps<{ modelValue: boolean; bookId: string; mode: TidyMode; content: DocNode[] }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'adopt', nodes: DocNode[], description: string): void
}>()

const isNarrow = useMediaQuery('(max-width: 768px)')
const state = ref<'idle' | 'loading' | 'done' | 'error'>('idle')
const result = ref<TidyResult | null>(null)
const error = ref('')
const columns = ref<string[]>([])
let seq = 0

const beforeDoc = computed<DocNode>(() => ({ type: 'doc', content: props.content }))
const afterDoc = computed<DocNode>(() => ({ type: 'doc', content: result.value?.nodes || [] }))
const columnsValid = computed(() => {
  if (props.mode !== 'table' || !columns.value.length) return true
  const cols = columns.value.map(c => c.trim())
  return cols.length >= 2 && cols.length <= 6 && cols.every(c => c.length > 0 && c.length <= 20)
})

async function run() {
  const my = ++seq
  state.value = 'loading'
  error.value = ''
  const body: { mode: TidyMode; content: DocNode[]; columns?: string[] } = { mode: props.mode, content: props.content }
  // 有列名（上一次的结果或用户改过的）就按列名重排
  if (props.mode === 'table' && columns.value.length) body.columns = columns.value.map(c => c.trim())
  try {
    const { data } = await studyApi.tidy(props.bookId, body)
    if (my !== seq) return
    const r = data.data!
    result.value = r
    if (props.mode === 'table') columns.value = [...r.columns]
    state.value = 'done'
  } catch (err) {
    if (my !== seq) return
    const e = err as { response?: { data?: { message?: string } } }
    error.value = e.response?.data?.message || 'AI 整理失败，请重试'
    state.value = 'error'
  }
}

watch(() => props.modelValue, v => {
  if (v) {
    result.value = null
    columns.value = []
    run()
  } else {
    seq++
    state.value = 'idle'
  }
})

function close() {
  emit('update:modelValue', false)
}

function describe(r: TidyResult): string {
  const node = r.nodes[0]
  if (props.mode === 'table') return `整理成表格（${r.columns.length} 列 ${Math.max(0, (node?.content?.length || 1) - 1)} 行）`
  return `整理成列表（${node?.content?.length || 0} 项）`
}

function adopt() {
  if (state.value !== 'done' || !result.value) return
  emit('adopt', result.value.nodes, describe(result.value))
}
</script>

<style scoped>
.td-panes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.td-panes.narrow { grid-template-columns: 1fr; }
.td-pane { display: flex; flex-direction: column; min-width: 0; }
.td-label { margin-bottom: 6px; font-size: 13px; font-weight: 600; color: var(--text-1); }
.td-box {
  flex: 1; min-height: 200px; max-height: 60vh; overflow: auto; padding: 4px 14px;
  border: 1px solid var(--card-border, var(--bg-2)); border-radius: 10px; background: var(--card-bg, var(--bg-1));
}
.td-panes.narrow .td-box { max-height: 36vh; min-height: 140px; }
.td-box.center { display: flex; align-items: center; justify-content: center; }
.td-box :deep(.se-content) { margin-top: 0; }
.td-box :deep(.ProseMirror) { min-height: 0; }
.td-status { display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--text-2); font-size: 14px; }
.td-error { color: var(--danger); text-align: center; }
.td-notes { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.td-notes p { margin: 0; }
.td-ai-note { font-size: 13px; color: var(--accent); }
.td-columns { margin-top: 10px; }
.td-columns-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; font-size: 13px; color: var(--text-1); }
.td-columns-list { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.td-col { display: inline-flex; align-items: center; gap: 2px; width: 140px; }
.td-col-del, .td-col-add {
  display: inline-flex; align-items: center; justify-content: center; flex: none;
  width: 24px; height: 24px; border: 0; border-radius: 6px; cursor: pointer; background: transparent; color: var(--text-2);
}
.td-col-add { border: 1px dashed var(--card-border, var(--bg-2)); }
.td-col-del:hover:not(:disabled), .td-col-add:hover:not(:disabled) { background: var(--bg-2); color: var(--text-0); }
.td-col-del:disabled, .td-col-add:disabled { opacity: .35; cursor: not-allowed; }
</style>
