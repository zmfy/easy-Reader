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

        <el-form-item label="AI 填充">
          <div class="ai-toggles">
            <div v-if="!aiConfigured" class="note note--warning ai-disabled-hint">
              未配置 AI 插件，AI 填充已禁用。请先在「AI 插件设置」中配置后使用。
            </div>
            <div v-if="aiConfigured && fillStatus && fillStatus.total > 0" class="fill-progress">
              <div>
                全书库已填充 <strong>{{ fillStatus.done }}</strong> / {{ fillStatus.total }} 本<template v-if="fillStatus.remaining > 0">，还剩 <strong>{{ fillStatus.remaining }}</strong> 本</template>
              </div>
              <div v-if="fillStatus.last_task?.status === 'paused'" class="fill-paused">上次已暂停：{{ fillStatus.last_task.error }}</div>
              <div v-if="fillStatus.remaining > 0" class="reset-hint">
                点底部「{{ fillLabel }}」在后台处理没填充过的书，不扫描文件；每 500 本一批，完成一批即可去确认
              </div>
            </div>
            <div v-if="canFill && estimate" class="estimate-summary">
              当前 AI：<strong>{{ estimate.active_plugin ?? '未配置' }}</strong>
              （<IconAlertTriangle v-if="estimate.tier === 'high'" :size="14" class="tier-icon" />{{ tierLabel }}）· 预估调用 <strong>{{ estimate.fill }}</strong> 次
            </div>
            <div class="reset-row">
              <el-button size="small" :disabled="!aiConfigured" @click="onResetFailed">重置「填充失败」记录</el-button>
              <el-button size="small" type="warning" plain :disabled="!aiConfigured" @click="onResetAll">重置全部填充记录</el-button>
            </div>
            <div class="reset-hint">空字段且依据明确的结果直接写入；其余结果（改已有内容、低置信、标签、改编作品）和「文件名与正文不符」提示进书库的「AI 建议待确认」</div>
            <div class="reset-hint">重置后点「AI 填充」即会重填对应书籍。审核过的书(待确认页采纳 / 忽略、单本书页确认填充)批量填充会跳过,「重置全部填充记录」后才会重填</div>
          </div>
        </el-form-item>

        <el-form-item label="扫描范围">
          <div class="scan-scope">
            <div class="scope-note">
              普通扫描即会：导入新增书籍、移除磁盘上已删除的书、重新检测重复——不重读已有文件，速度快。直接「开始扫描」即可。
            </div>
            <el-checkbox v-model="form.full_rescan">重建指纹</el-checkbox>
            <div class="scope-note">重读全部已入库文件，较慢；仅在怀疑重复 / 乱码判定有误时才需要。</div>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button v-if="canFill" type="primary" plain :loading="startingFill" @click="onFillClick">{{ fillLabel }}</el-button>
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
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ScanStartOptions, CostEstimate } from '@/types'
import { libraryApi } from '@/api/library'
import { settingsApi } from '@/api/settings'
import { IconAlertTriangle } from '@tabler/icons-vue'
import CostWarningDialog from './CostWarningDialog.vue'
import { useScanTaskStore } from '@/stores/scan-task'
import type { AiFillStatus } from '@/types'

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
const aiConfigured = ref(true)

async function refreshAiStatus(): Promise<void> {
  try {
    const resp = await settingsApi.getAiStatus()
    aiConfigured.value = !!resp.data.data?.configured
  } catch {
    aiConfigured.value = false
  }
}

async function refreshEstimate(): Promise<void> {
  try {
    // 只有 AI 填充会调用 AI；扫描本身不调用
    const resp = await libraryApi.estimate({ ai_fill: true, full_rescan: false })
    estimate.value = resp.data.data ?? null
  } catch {
    estimate.value = null
  }
}

watch(visible, (v) => { if (v) { void refreshAiStatus(); void refreshEstimate(); void refreshFillStatus() } })

const scanStore = useScanTaskStore()
const fillStatus = ref<AiFillStatus | null>(null)
const startingFill = ref(false)
const fillLabel = computed(() => fillStatus.value?.last_task?.status === 'paused' ? '继续填充' : 'AI 填充')
const canFill = computed(() => aiConfigured.value && (fillStatus.value?.remaining ?? 0) > 0)

async function refreshFillStatus(): Promise<void> {
  try {
    fillStatus.value = (await libraryApi.aiFillStatus()).data.data ?? null
  } catch {
    fillStatus.value = null
  }
}

/** 费用高的 AI 先弹费用提醒，确认后再开始 */
function onFillClick(): void {
  if (estimate.value?.tier === 'high') {
    showCostWarning.value = true
    return
  }
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

const tierLabel = computed(() => {
  const labels: Record<string, string> = { free: '免费', low: '低费用', high: '高费用', unknown: '未知' }
  return labels[estimate.value?.tier ?? 'unknown'] ?? ''
})

function onClose(): void { visible.value = false }

function onStartScan(): void {
  // 扫描只管文件；AI 填充由底部「AI 填充」单独启动
  emit('confirm', { ...form })
  visible.value = false
}

function onCostConfirmed(): void {
  showCostWarning.value = false
  void startFill()
}

/** 重置后刷新进度，「AI 填充」按钮随之出现 */
function afterReset(): void {
  void refreshFillStatus()
  void refreshEstimate()
}

async function onResetFailed(): Promise<void> {
  try {
    await ElMessageBox.confirm('将把所有「填充失败」的书重置为未尝试,之后点「AI 填充」会重试。继续?', '重置填充失败', { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' })
  } catch { return }
  try {
    const resp = await libraryApi.aiFillResetFailed()
    ElMessage.success(`已重置 ${resp.data.data?.reset ?? 0} 本书的失败记录`)
    afterReset()
  } catch { ElMessage.error('重置失败') }
}

async function onResetAll(): Promise<void> {
  try {
    await ElMessageBox.confirm('将重置全部填充记录(不论成功/失败),审核过的书也会清掉审核标记、重新参与批量填充。之后点「AI 填充」会重新处理所有书(已有字段不会被覆盖,只补缺失的评分/封面等)。继续?', '重置全部填充', { type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消' })
  } catch { return }
  try {
    const resp = await libraryApi.aiFillResetAll()
    ElMessage.success(`已重置 ${resp.data.data?.reset ?? 0} 本书的填充记录`)
    afterReset()
  } catch { ElMessage.error('重置失败') }
}
</script>

<style scoped>
.mode-hint { font-size: 12px; color: var(--text-2); margin-top: 6px; line-height: 1.5; }
.ai-toggles { display: flex; flex-direction: column; gap: 4px; }
.estimate-summary {
  margin-top: 8px;
  padding: 6px 10px;
  font-size: 13px;
  background: var(--el-color-info-light-9);
  border-radius: var(--radius-sm);
}
.reset-row { display: flex; gap: 8px; margin-top: 10px; }
.fill-progress {
  margin-top: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.6;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
}
.fill-paused { font-size: 12px; color: var(--warning); }
.reset-hint { font-size: 12px; color: var(--text-2); margin-top: 6px; }
.ai-disabled-hint { font-size: 12px; margin-bottom: 6px; padding: 6px 10px; line-height: 1.5; }
.tier-icon { vertical-align: -2px; margin-right: 2px; color: var(--warning); }
.scan-scope { display: flex; flex-direction: column; gap: 8px; }
.scope-note { font-size: 12px; color: var(--text-2); line-height: 1.6; }
</style>
