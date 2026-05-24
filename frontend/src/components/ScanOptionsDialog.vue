<template>
  <el-dialog
    v-model="visible"
    title="扫描选项"
    width="500px"
    @close="onClose"
  >
    <el-form label-width="120px">
      <el-form-item label="处理模式">
        <el-radio-group v-model="form.mode">
          <el-radio value="review">暂存审核（推荐）</el-radio>
          <el-radio value="auto">自动写入</el-radio>
          <el-radio value="hybrid">混合模式</el-radio>
        </el-radio-group>
        <div class="mode-hint">
          <span v-if="form.mode === 'review'">扫描结果先入暂存批次，admin 审核后再应用</span>
          <span v-else-if="form.mode === 'auto'">AI 判定直接落库，无审核环节</span>
          <span v-else>硬重复自动入库；AI 判定 + 系列归类进审核</span>
        </div>
      </el-form-item>

      <el-form-item label="AI 功能">
        <div class="ai-toggles">
          <el-checkbox v-model="form.ai_dedup">AI 去重判定</el-checkbox>
          <el-checkbox v-model="form.ai_series">AI 系列归类</el-checkbox>
          <el-checkbox v-model="form.ai_fill" disabled>
            AI 批量填充（Plan 3 启用）
          </el-checkbox>
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
      <el-button type="primary" @click="onConfirm">开始扫描</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import type { ScanStartOptions } from '@/types'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  'confirm': [ScanStartOptions]
}>()

const visible = ref(props.modelValue)
watch(() => props.modelValue, (v) => { visible.value = v })
watch(visible, (v) => emit('update:modelValue', v))

const form = reactive<ScanStartOptions>({
  mode: 'review',
  ai_dedup: false,
  ai_series: false,
  ai_fill: false,
  full_rescan: false,
})

function onClose(): void {
  visible.value = false
}

function onConfirm(): void {
  emit('confirm', { ...form })
  visible.value = false
}
</script>

<style scoped>
.mode-hint {
  font-size: 12px;
  color: var(--text-2);
  margin-top: 6px;
  line-height: 1.5;
}
.ai-toggles {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
