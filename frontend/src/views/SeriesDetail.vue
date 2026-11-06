<template>
  <DefaultLayout>
    <div v-loading="loading" class="page page--narrow">
      <PageHeader :title="detail?.series.name ?? ''" back>
        <template v-if="detail" #actions>
          <div class="meta">
            <el-tag type="primary" size="small">系列</el-tag>
            <span>{{ detail.members.length }} 本</span>
            <span v-if="detail.series.author">· {{ detail.series.author }}</span>
          </div>
        </template>
      </PageHeader>

      <div v-if="detail?.series.summary" class="note summary">{{ detail.series.summary }}</div>

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
import PageHeader from '@/components/PageHeader.vue'
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
.meta { color: var(--text-2); font-size: 13px; display: flex; align-items: center; gap: 8px; }
.summary {
  padding: 16px 20px;
  margin-bottom: 24px;
  font-size: 14px;
  line-height: 1.7;
}
.members-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
  gap: 22px;
}
</style>
