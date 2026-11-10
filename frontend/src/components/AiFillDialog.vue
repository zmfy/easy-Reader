<template>
  <div>
    <el-dialog v-model="visible" title="AI 填充" width="540px">
      <div class="fill-body">
        <div v-if="!aiConfigured" class="note note--warning">
          未配置 AI 插件，AI 填充已禁用。请先在「设置 → AI 插件」中配置后使用。
        </div>
        <template v-else>
          <div v-if="fillStatus" class="fill-progress">
            <div>
              全书库已填充 <strong>{{ fillStatus.done }}</strong> / {{ fillStatus.total }} 本<template v-if="fillStatus.remaining > 0">，还剩 <strong>{{ fillStatus.remaining }}</strong> 本</template>
            </div>
            <div v-if="fillStatus.last_task?.status === 'paused'" class="fill-paused">上次已暂停：{{ fillStatus.last_task.error }}</div>
            <div v-if="fillStatus.remaining === 0" class="hint">没有要填充的书。需要重填时，先在下面重置填充记录。</div>
          </div>
          <div v-if="canFill && estimate" class="estimate-summary">
            当前 AI：<strong>{{ estimate.active_plugin ?? '未配置' }}</strong>
            （<IconAlertTriangle v-if="estimate.tier === 'high'" :size="14" class="tier-icon" />{{ tierLabel }}）· 预估调用 <strong>{{ estimate.fill }}</strong> 次
          </div>
          <div class="hint">
            在后台处理书库里没填充过的书，不扫描文件；每 500 本一批，完成一批铃铛提醒去确认。
            空字段且依据明确的结果直接写入；其余结果（改已有内容、低置信、标签、改编作品）和「文件名与正文不符」提示进「AI 建议待确认」。
          </div>
          <div class="hint">
            审核过的书（待确认页采纳 / 忽略、单本书页确认填充）会跳过；「重置全部填充记录」后才会重填。
          </div>
          <div class="reset-row">
            <el-button size="small" @click="onResetFailed">重置「填充失败」记录</el-button>
            <el-button size="small" type="warning" plain @click="onResetAll">重置全部填充记录</el-button>
          </div>
        </template>
      </div>

      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :disabled="!canFill" :loading="startingFill" @click="onFillClick">{{ fillLabel }}</el-button>
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
import { ref, watch, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { IconAlertTriangle } from '@tabler/icons-vue'
import type { AiFillStatus, CostEstimate } from '@/types'
import { libraryApi } from '@/api/library'
import { settingsApi } from '@/api/settings'
import { useScanTaskStore } from '@/stores/scan-task'
import CostWarningDialog from './CostWarningDialog.vue'

/** AI 填充：与扫描分开，只处理书库里已有、还没填充的书 */
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, v => { visible.value = v })
watch(visible, v => emit('update:modelValue', v))

const scanStore = useScanTaskStore()
const aiConfigured = ref(true)
const fillStatus = ref<AiFillStatus | null>(null)
const estimate = ref<CostEstimate | null>(null)
const startingFill = ref(false)
const showCostWarning = ref(false)

const fillLabel = computed(() => fillStatus.value?.last_task?.status === 'paused' ? '继续填充' : '开始填充')
const canFill = computed(() => aiConfigured.value && (fillStatus.value?.remaining ?? 0) > 0)
const tierLabel = computed(() => {
  const labels: Record<string, string> = { free: '免费', low: '低费用', high: '高费用', unknown: '未知' }
  return labels[estimate.value?.tier ?? 'unknown'] ?? ''
})

async function refresh(): Promise<void> {
  try {
    aiConfigured.value = !!(await settingsApi.getAiStatus()).data.data?.configured
  } catch {
    aiConfigured.value = false
  }
  if (!aiConfigured.value) return
  const [status, est] = await Promise.allSettled([
    libraryApi.aiFillStatus(),
    libraryApi.estimate({ ai_fill: true, full_rescan: false }),
  ])
  fillStatus.value = status.status === 'fulfilled' ? status.value.data.data ?? null : null
  estimate.value = est.status === 'fulfilled' ? est.value.data.data ?? null : null
}

watch(visible, (v) => { if (v) void refresh() }, { immediate: true })

/** 费用高的 AI 先弹费用提醒，确认后再开始 */
function onFillClick(): void {
  if (estimate.value?.tier === 'high') {
    showCostWarning.value = true
    return
  }
  void startFill()
}

function onCostConfirmed(): void {
  showCostWarning.value = false
  void startFill()
}

async function startFill(): Promise<void> {
  startingFill.value = true
  try {
    await scanStore.startAiFill()
    ElMessage.success('AI 填充已在后台开始，进度见页面顶部')
    visible.value = false
  } catch (e) {
    const code = (e as { response?: { data?: { code?: string } } }).response?.data?.code
    ElMessage.error(code === 'TASK_RUNNING' ? '已有扫描 / 填充任务在运行' : '启动失败')
  } finally {
    startingFill.value = false
  }
}

async function onResetFailed(): Promise<void> {
  try {
    await ElMessageBox.confirm('将把所有「填充失败」的书重置为未尝试,之后点「开始填充」会重试。继续?', '重置填充失败', { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' })
  } catch { return }
  try {
    const resp = await libraryApi.aiFillResetFailed()
    ElMessage.success(`已重置 ${resp.data.data?.reset ?? 0} 本书的失败记录`)
    void refresh()
  } catch { ElMessage.error('重置失败') }
}

async function onResetAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('将重置全部填充记录(不论成功/失败),审核过的书也会清掉审核标记、重新参与批量填充。之后点「开始填充」会重新处理所有书(已有字段不会被覆盖,只补缺失的评分/封面等)。继续?', '重置全部填充', { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' })
  } catch { return }
  try {
    const resp = await libraryApi.aiFillResetAll()
    ElMessage.success(`已重置 ${resp.data.data?.reset ?? 0} 本书的填充记录`)
    void refresh()
  } catch { ElMessage.error('重置失败') }
}
</script>

<style scoped>
.fill-body { display: flex; flex-direction: column; gap: 10px; }
.fill-progress {
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
}
.fill-paused { font-size: 12px; color: var(--warning); }
.estimate-summary {
  padding: 6px 10px;
  font-size: 13px;
  background: var(--el-color-info-light-9);
  border-radius: var(--radius-sm);
}
.tier-icon { vertical-align: -2px; margin-right: 2px; color: var(--warning); }
.hint { font-size: 12px; color: var(--text-2); line-height: 1.6; }
.reset-row { display: flex; flex-wrap: wrap; gap: 8px; }
.reset-row .el-button + .el-button { margin-left: 0; }
</style>
