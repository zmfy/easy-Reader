<template>
  <el-dialog v-model="visible" title="⚠️ AI 调用费用提示" width="500px" :close-on-click-modal="false">
    <div class="warning-content">
      <el-alert
        :type="tierAlertType"
        :title="tierTitle"
        :description="tierDescription"
        show-icon
        :closable="false"
      />
      <div class="breakdown">
        <div v-if="estimate.dedup > 0">AI 去重判定：约 <strong>{{ estimate.dedup }}</strong> 次</div>
        <div v-if="estimate.series > 0">AI 系列归类：约 <strong>{{ estimate.series }}</strong> 次</div>
        <div v-if="estimate.fill > 0">AI 批量填充：约 <strong>{{ estimate.fill }}</strong> 次</div>
        <div class="total">合计：约 <strong>{{ estimate.total }}</strong> 次 API 调用</div>
      </div>
      <div class="confirm-text">
        本次扫描将产生上述 AI 调用。<span v-if="tier === 'high'">⚠️ 当前使用的是<strong>高费用</strong> AI 模型，请评估成本后再继续。</span>
      </div>
    </div>
    <template #footer>
      <el-button @click="onCancel">取消</el-button>
      <el-button :type="tier === 'high' ? 'danger' : 'primary'" @click="onConfirm">确认继续</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CostEstimate } from '@/types'

const props = defineProps<{
  modelValue: boolean
  estimate: CostEstimate
}>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: []
  cancel: []
}>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, v => { visible.value = v })
watch(visible, v => emit('update:modelValue', v))

const tier = computed(() => props.estimate.tier)
const tierAlertType = computed<'success' | 'info' | 'warning' | 'error'>(() => {
  if (tier.value === 'free') return 'success'
  if (tier.value === 'low') return 'info'
  if (tier.value === 'high') return 'error'
  return 'warning'
})
const tierTitle = computed(() => {
  const plugin = props.estimate.active_plugin ?? '未配置'
  return `当前 AI 插件：${plugin}（${tierLabel(tier.value)}）`
})
const tierDescription = computed(() => {
  switch (tier.value) {
    case 'free': return 'Ollama 本地模型，零费用'
    case 'low': return '低费用 API，整体成本通常可忽略'
    case 'high': return '⚠️ 高费用 API（OpenAI / Claude），单次调用可达 $0.01 量级'
    case 'unknown': return '未识别的 AI 插件，无法估算费用'
  }
  return ''
})
function tierLabel(t: string): string {
  const map: Record<string, string> = { free: '免费', low: '低费用', high: '高费用', unknown: '未知' }
  return map[t] ?? t
}

function onConfirm(): void { emit('confirm'); visible.value = false }
function onCancel(): void { emit('cancel'); visible.value = false }
</script>

<style scoped>
.warning-content > * + * { margin-top: 16px; }
.breakdown {
  background: var(--el-color-info-light-9);
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 14px;
}
.breakdown > * + * { margin-top: 4px; }
.total { margin-top: 8px !important; padding-top: 8px; border-top: 1px solid var(--el-border-color-light); font-size: 15px; }
.confirm-text { color: var(--text-2); line-height: 1.6; }
</style>
