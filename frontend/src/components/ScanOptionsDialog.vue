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
        <el-button type="primary" @click="onStartScan">开始扫描</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import type { ScanStartOptions } from '@/types'

/** 扫描选项：只管扫描文件；AI 填充在书库页「AI 填充」单独启动（见 AiFillDialog） */
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

function onClose(): void { visible.value = false }

function onStartScan(): void {
  emit('confirm', { ...form })
  visible.value = false
}
</script>

<style scoped>
.mode-hint { font-size: 12px; color: var(--text-2); margin-top: 6px; line-height: 1.5; }
.scan-scope { display: flex; flex-direction: column; gap: 8px; }
.scope-note { font-size: 12px; color: var(--text-2); line-height: 1.6; }
</style>
