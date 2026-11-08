<template>
  <div class="continue-page" aria-busy="true">
    <el-icon class="is-loading" :size="24"><IconLoader2 /></el-icon>
  </div>
</template>

<script setup lang="ts">
// 从桌面图标打开（PWA start_url）：进入上次读的书；没有或取不到时进书架
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { IconLoader2 } from '@tabler/icons-vue'
import { readerApi } from '@/api/reader'

const router = useRouter()

onMounted(async () => {
  try {
    const resp = await readerApi.lastRead()
    const bookId = resp.data.data?.bookId
    router.replace(bookId ? `/reader/${bookId}` : '/shelf')
  } catch {
    router.replace('/shelf')
  }
})
</script>

<style scoped>
.continue-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; color: var(--text-2); }
</style>
