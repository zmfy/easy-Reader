<template>
  <div>
    <el-dialog
      v-model="visible"
      title="扫描选项"
      width="540px"
      @close="onClose"
    >
      <el-form label-width="120px">
        <el-form-item label="处理模式">
          <el-radio-group v-model="form.mode">
            <el-radio value="review">暂存审核（推荐）</el-radio>
            <el-radio value="auto">自动写入</el-radio>
          </el-radio-group>
          <div class="mode-hint">
            <span v-if="form.mode === 'review'">扫描结果先入暂存批次，admin 审核后再应用</span>
            <span v-else>结果直接落库，无审核环节</span>
          </div>
        </el-form-item>

        <el-form-item label="AI 功能">
          <div class="ai-toggles">
            <el-checkbox v-model="form.ai_fill">
              AI 批量填充
              <span v-if="estimate" class="toggle-meta">（预估 {{ estimate.fill }} 次）</span>
            </el-checkbox>
            <div v-if="estimate" class="estimate-summary">
              当前 AI：<strong>{{ estimate.active_plugin ?? '未配置' }}</strong>
              （{{ tierLabel }}）· 总调用 <strong>{{ estimate.total }}</strong> 次
            </div>
          </div>
        </el-form-item>

        <el-form-item label="扫描范围">
          <el-checkbox v-model="form.full_rescan">
            包含已入库书籍重新检测（重建指纹）
          </el-checkbox>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="onStartScan">开始扫描</el-button>
      </template>
    </el-dialog>

    <CostWarningDialog
      v-if="estimate"
      v-model="showCostWarning"
      :estimate="estimate"
      @confirm="onCostConfirmed"
      @cancel="showCostWarning = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from 'vue'
import type { ScanStartOptions, CostEstimate } from '@/types'
import { libraryApi } from '@/api/library'
import CostWarningDialog from './CostWarningDialog.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [ScanStartOptions]
}>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, v => { visible.value = v })
watch(visible, v => emit('update:modelValue', v))

const form = reactive<ScanStartOptions>({
  mode: 'review',
  ai_fill: false,
  full_rescan: false,
})

const estimate = ref<CostEstimate | null>(null)
const showCostWarning = ref(false)

async function refreshEstimate(): Promise<void> {
  try {
    const resp = await libraryApi.estimate({ ai_fill: form.ai_fill, full_rescan: form.full_rescan })
    estimate.value = resp.data.data ?? null
  } catch {
    estimate.value = null
  }
}

watch([() => form.ai_fill, () => form.full_rescan], () => { void refreshEstimate() })
watch(visible, (v) => { if (v) void refreshEstimate() })

const tierLabel = computed(() => {
  const labels: Record<string, string> = { free: '免费', low: '低费用', high: '⚠️ 高费用', unknown: '未知' }
  return labels[estimate.value?.tier ?? 'unknown'] ?? ''
})

function onClose(): void { visible.value = false }

function onStartScan(): void {
  if (form.ai_fill && estimate.value?.tier === 'high') {
    showCostWarning.value = true
    return
  }
  emitConfirm()
}

function onCostConfirmed(): void {
  showCostWarning.value = false
  emitConfirm()
}

function emitConfirm(): void {
  emit('confirm', { ...form })
  visible.value = false
}
</script>

<style scoped>
.mode-hint { font-size: 12px; color: var(--text-2); margin-top: 6px; line-height: 1.5; }
.ai-toggles { display: flex; flex-direction: column; gap: 4px; }
.toggle-meta { font-size: 12px; color: var(--text-2); margin-left: 4px; }
.estimate-summary {
  margin-top: 8px;
  padding: 6px 10px;
  font-size: 13px;
  background: var(--el-color-info-light-9);
  border-radius: 4px;
}
</style>
