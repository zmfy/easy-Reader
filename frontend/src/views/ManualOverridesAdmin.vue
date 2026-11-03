<template>
  <DefaultLayout>
    <div class="overrides-page">
      <div class="page-header">
        <div>
          <el-button link @click="$router.push('/library')">← 返回书库</el-button>
          <h1>人工修正记录</h1>
          <div class="subtitle">admin 在审核时记录的"不是重复"/"不在系列"等判断。下次扫描会绕过 AI 重新判断这些组合。</div>
        </div>
        <el-button type="danger" plain :disabled="overrides.length === 0" @click="onClearAll">清空所有人工修正</el-button>
      </div>

      <el-table v-loading="loading" :data="overrides" empty-text="暂无记录">
        <el-table-column prop="type" label="类型" width="200">
          <template #default="{ row }">
            <el-tag :type="tagType(row.type)">{{ typeLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="书 A" prop="book_id_a">
          <template #default="{ row }">
            <code class="id-short">{{ row.book_id_a?.slice(0,8) ?? '-' }}</code>
          </template>
        </el-table-column>
        <el-table-column label="书 B / 系列">
          <template #default="{ row }">
            <code class="id-short">{{ (row.book_id_b ?? row.series_id)?.slice(0,8) ?? '-' }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" type="danger" link @click="onDelete(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { libraryApi } from '@/api/library'
import type { ManualOverride } from '@/types'

const overrides = ref<ManualOverride[]>([])
const loading = ref(false)

async function fetchOverrides(): Promise<void> {
  loading.value = true
  try {
    const resp = await libraryApi.manualOverrides.list()
    overrides.value = resp.data.data ?? []
  } finally {
    loading.value = false
  }
}

function typeLabel(t: string): string {
  const map: Record<string, string> = {
    not_duplicate: '不是重复',
    not_in_series: '不属于此系列',
    forced_duplicate: '强制重复',
    forced_series_member: '强制系列成员',
  }
  return map[t] ?? t
}

function tagType(t: string): 'warning' | 'primary' {
  return t.startsWith('not_') ? 'warning' : 'primary'
}

async function onDelete(id: string): Promise<void> {
  try {
    await ElMessageBox.confirm('确认删除此修正？删除后 AI 重扫时该判定可能恢复。', '确认', { type: 'warning' })
  } catch { return }
  await libraryApi.manualOverrides.remove(id)
  ElMessage.success('已删除')
  await fetchOverrides()
}

async function onClearAll(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认清空全部 ${overrides.value.length} 条人工修正？\n\n清空后 AI 在下次扫描时会重新自由判断，可能恢复之前否决过的重复/系列。`,
      '清空确认',
      { type: 'warning', confirmButtonText: '确认清空', cancelButtonText: '取消' },
    )
  } catch { return }
  const r = await libraryApi.manualOverrides.removeAll()
  ElMessage.success(`已清空 ${r.data.data?.deleted ?? 0} 条`)
  await fetchOverrides()
}

onMounted(fetchOverrides)
</script>

<style scoped>
.overrides-page { padding: 24px 32px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  gap: 16px;
}
.page-header h1 { margin: 8px 0 4px 0; }
.subtitle { font-size: 13px; color: var(--text-2); max-width: 600px; }
.id-short { font-family: monospace; font-size: 12px; }
</style>
