<template>
  <div class="page-header">
    <el-button v-if="showBack" class="page-header-back" text @click="goBack">
      <IconChevronLeft :size="16" :stroke-width="1.75" />返回
    </el-button>
    <h1 class="page-title">{{ title }}</h1>
    <span v-if="count !== undefined && count !== ''" class="page-header-count">{{ count }}</span>
    <div v-if="$slots.actions" class="page-header-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { IconChevronLeft } from '@tabler/icons-vue'

// back：true = 返回上一页（站内无历史时不显示）；字符串 = 跳转到该路径
const props = defineProps<{
  title: string
  back?: string | boolean
  count?: number | string
}>()

const router = useRouter()

// vue-router 在 history.state.back 记录站内上一页；直接打开 / 新标签页时为 null
const hasHistory = typeof window !== 'undefined' && !!window.history.state?.back

const showBack = computed(() => {
  if (typeof props.back === 'string') return props.back !== ''
  return props.back === true && hasHistory
})

function goBack() {
  if (typeof props.back === 'string') router.push(props.back)
  else router.back()
}
</script>

<style scoped>
.page-header-back {
  margin-left: -8px;
  padding: 0 8px;
  color: var(--text-1);
}
.page-header-back :deep(> span) {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.page-header-back:hover { color: var(--accent); }

.page-header-count {
  font-size: 14px;
  color: var(--text-2);
}

.page-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
