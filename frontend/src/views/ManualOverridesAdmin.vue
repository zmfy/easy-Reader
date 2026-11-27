<template>
  <DefaultLayout>
    <div class="page page--narrow">
      <PageHeader title="人工修正记录" back="/library">
        <template #actions>
          <el-button type="danger" plain :disabled="overrides.length === 0" @click="onClearAll">清空所有人工修正</el-button>
        </template>
      </PageHeader>
      <p class="page-subtitle">管理员审核时记录的「不是重复」「不属于此系列」等判断。之后的扫描（包括勾选「重建指纹」）都会沿用这些判断，不再重新判定；想让某一对重新参与重复检测，删除对应记录后再扫描。</p>

      <div class="section-card section-card--flush">
      <el-table v-loading="loading" :data="overrides" empty-text="暂无记录">
        <el-table-column prop="type" label="类型" width="200">
          <template #default="{ row }">
            <el-tag :type="tagType(row.type)">{{ typeLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="书 A" prop="book_id_a" min-width="200">
          <template #default="{ row }">
            <router-link v-if="row.book_id_a && row.title_a" :to="`/book/${row.book_id_a}`" class="book-link">{{ row.title_a }}</router-link>
            <span v-else-if="row.book_id_a" class="gone">已删除（<code class="id-short">{{ row.book_id_a.slice(0, 8) }}</code>）</span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="书 B / 系列" min-width="200">
          <template #default="{ row }">
            <template v-if="row.book_id_b">
              <router-link v-if="row.title_b" :to="`/book/${row.book_id_b}`" class="book-link">{{ row.title_b }}</router-link>
              <span v-else class="gone">已删除（<code class="id-short">{{ row.book_id_b.slice(0, 8) }}</code>）</span>
            </template>
            <template v-else-if="row.series_id">
              <span v-if="row.series_name">系列：{{ row.series_name }}</span>
              <span v-else class="gone">系列已删除（<code class="id-short">{{ row.series_id.slice(0, 8) }}</code>）</span>
            </template>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180">
          <template #default="{ row }">{{ formatServerTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" type="danger" link @click="onDelete(row.id)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { formatServerTime } from '@/utils/time'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
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
    await ElMessageBox.confirm('确认删除此修正？删除后下次扫描会重新判定这一组（例如重新检出为重复）。', '确认', { type: 'warning' })
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
.page-subtitle { margin: -12px 0 16px; font-size: 13px; color: var(--text-2); max-width: 600px; }
.id-short { font-family: var(--font-mono); font-size: 12px; }
.book-link { color: var(--accent); text-decoration: none; }
.book-link:hover { text-decoration: underline; }
.gone { color: var(--text-2); }
</style>
