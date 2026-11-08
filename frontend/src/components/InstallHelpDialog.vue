<template>
  <el-dialog
    :model-value="modelValue"
    title="安装到桌面"
    width="min(92vw, 380px)"
    append-to-body
    @update:model-value="v => emit('update:modelValue', v)"
  >
    <p v-if="mode === 'insecure'" class="install-text">
      需要通过 HTTPS 访问才能安装到桌面
      <a :href="SITE_URL" target="_blank" rel="noopener noreferrer">查看说明</a>
    </p>
    <p v-else-if="mode === 'ios'" class="install-text">点底部的分享按钮 → 选择『添加到主屏幕』</p>
    <p v-else-if="mode === 'menu'" class="install-text">请在浏览器菜单中选择『安装应用』或『添加到主屏幕』</p>
    <p v-else class="install-text">当前浏览器不支持安装，请使用 Chrome、Edge 或 Safari</p>
    <template #footer>
      <el-button type="primary" @click="emit('update:modelValue', false)">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { InstallMode } from '@/utils/pwa-install'
import { SITE_URL } from '@/utils/links'

defineProps<{ modelValue: boolean; mode: Exclude<InstallMode, 'installed' | 'prompt'> }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<style scoped>
.install-text { margin: 0; line-height: 1.8; color: var(--text-0); }
.install-text a { margin-left: 6px; color: var(--accent); }
</style>
