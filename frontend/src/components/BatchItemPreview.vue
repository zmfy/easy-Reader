<template>
  <el-popover
    placement="right"
    :width="400"
    trigger="click"
    @show="loadPreview"
  >
    <template #reference>
      <el-button size="small" link>预览第一章</el-button>
    </template>
    <div class="preview-content">
      <div v-if="loading" class="loading">加载中…</div>
      <div v-else-if="error" class="error">{{ error }}</div>
      <pre v-else>{{ content }}</pre>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { scanBatchesApi } from '@/api/scan-batches'

const props = defineProps<{
  batchId: string
  filePath: string
}>()

const content = ref('')
const loading = ref(false)
const error = ref('')

async function loadPreview(): Promise<void> {
  if (content.value) return
  loading.value = true
  error.value = ''
  try {
    const resp = await scanBatchesApi.preview(props.batchId, props.filePath)
    content.value = resp.data.data.content
  } catch {
    error.value = '加载失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.preview-content {
  max-height: 300px;
  overflow-y: auto;
}
.preview-content pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  margin: 0;
}
.loading, .error {
  color: var(--text-2);
  font-size: 13px;
}
</style>
