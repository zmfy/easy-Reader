<template>
  <DefaultLayout>
    <div v-loading="loading" class="series-detail-page">
      <div class="page-header">
        <el-button link @click="$router.back()">← 返回</el-button>
        <h1 v-if="detail">{{ detail.series.name }}</h1>
        <div v-if="detail" class="meta">
          <el-tag type="primary" size="small">系列</el-tag>
          <span>{{ detail.members.length }} 本</span>
          <span v-if="detail.series.author">· {{ detail.series.author }}</span>
        </div>
      </div>

      <div v-if="detail?.series.summary" class="summary">{{ detail.series.summary }}</div>

      <div v-if="detail" class="members-grid">
        <BookCard
          v-for="b in detail.members"
          :key="b.id"
          :book="b"
          @click="router.push(`/book/${b.id}`)"
          @read="router.push(`/reader/${b.id}`)"
          @detail="router.push(`/book/${b.id}`)"
        />
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import BookCard from '@/components/BookCard.vue'
import { seriesApi } from '@/api/series'
import type { SeriesDetail as SeriesDetailType } from '@/types'

const route = useRoute()
const router = useRouter()
const detail = ref<SeriesDetailType | null>(null)
const loading = ref(false)

async function fetchSeries(): Promise<void> {
  loading.value = true
  try {
    const resp = await seriesApi.get(route.params.id as string)
    detail.value = resp.data.data!
  } finally {
    loading.value = false
  }
}

onMounted(fetchSeries)
</script>

<style scoped>
.series-detail-page { padding: 32px; min-height: 100%; }
.page-header { margin-bottom: 24px; }
.page-header h1 { margin: 8px 0; font-size: 26px; font-weight: 600; color: var(--text-0); letter-spacing: 1px; }
.meta { color: var(--text-2); font-size: 13px; display: flex; align-items: center; gap: 8px; }
.summary {
  background: rgba(124, 92, 255, 0.06);
  border: 1px solid rgba(124, 92, 255, 0.12);
  padding: 16px 20px;
  border-radius: var(--radius-md);
  margin-bottom: 24px;
  color: var(--text-1);
  font-size: 14px;
  line-height: 1.7;
}
.members-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
  gap: 22px;
}
</style>
