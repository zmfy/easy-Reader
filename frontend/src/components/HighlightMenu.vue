<template>
  <!-- 划线浮层：显示在选区 / 被点击的划线上方（x、y 为视口坐标，指向目标顶部中点） -->
  <div ref="menuRef" class="hl-menu" :style="{ left: `${x}px`, top: `${y}px` }" @pointerdown.stop @click.stop>
    <template v-if="mode === 'new'">
      <button class="hl-menu-btn" @click="emit('highlight')">划线</button>
      <button class="hl-menu-btn" @click="emit('note')">批注</button>
    </template>
    <template v-else>
      <button class="hl-menu-btn" @click="emit('note')">{{ hasNote ? '编辑批注' : '写批注' }}</button>
      <button class="hl-menu-btn danger" @click="emit('delete')">删除划线</button>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

defineProps<{ x: number; y: number; mode: 'new' | 'existing'; hasNote: boolean }>()
const emit = defineEmits<{ highlight: []; note: []; delete: []; close: [] }>()

const menuRef = ref<HTMLElement | null>(null)

// 点击浮层外部或页面滚动时关闭；用 pointerdown 而非 click，避免选区结束时紧随的 click 立刻把菜单关掉
function onPointerDown(e: PointerEvent) {
  if (!menuRef.value?.contains(e.target as Node)) emit('close')
}
function onScroll() { emit('close') }

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('scroll', onScroll, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('scroll', onScroll, true)
})
</script>

<style scoped>
.hl-menu {
  position: fixed;
  z-index: 40;
  transform: translate(-50%, calc(-100% - 10px));
  display: flex;
  gap: 2px;
  padding: 4px;
  background: var(--reader-panel-bg);
  border: 1px solid var(--reader-divider);
  border-radius: 10px;
  box-shadow: var(--reader-panel-shadow);
  white-space: nowrap;
}
.hl-menu-btn {
  border: none;
  background: transparent;
  color: var(--reader-text-secondary);
  font-family: var(--font-sans);
  font-size: 14px;
  padding: 6px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}
.hl-menu-btn:hover { color: var(--reader-text); background: var(--reader-hover-bg); }
.hl-menu-btn.danger:hover { color: var(--el-color-danger); }
</style>
