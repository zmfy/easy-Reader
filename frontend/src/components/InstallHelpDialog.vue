<template>
  <el-dialog
    :model-value="modelValue"
    title="安装到桌面"
    width="min(92vw, 380px)"
    append-to-body
    @update:model-value="v => emit('update:modelValue', v)"
  >
    <p v-if="mode === 'insecure'" class="install-text">需要通过 HTTPS 访问才能安装到桌面</p>
    <p v-else-if="mode === 'ios'" class="install-text">点底部的分享按钮 → 选择『添加到主屏幕』</p>
    <p v-else-if="mode === 'menu'" class="install-text">请在浏览器菜单中选择『安装应用』或『添加到主屏幕』</p>
    <p v-else class="install-text">当前浏览器不支持安装，请使用 Chrome、Edge 或 Safari</p>
    <GuideLink
      v-if="mode === 'insecure'"
      class="install-guide"
      :guide="GUIDES.pwaSetup"
      label="域名、证书到安装的完整流程参考"
    />
    <GuideLink
      v-else
      class="install-guide"
      :guide="GUIDES.pwaInstall"
      :anchor="mode === 'ios' ? 'iphone-ipad-safari' : undefined"
      label="详细安装步骤参考"
    />
    <template #footer>
      <el-button type="primary" @click="emit('update:modelValue', false)">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import type { InstallMode } from '@/utils/pwa-install'
import GuideLink from './GuideLink.vue'
import { GUIDES } from '@/utils/links'

defineProps<{ modelValue: boolean; mode: Exclude<InstallMode, 'installed' | 'prompt'> }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<style scoped>
.install-text { margin: 0; line-height: 1.8; color: var(--text-0); }
.install-guide { margin-top: 12px; }
</style>
