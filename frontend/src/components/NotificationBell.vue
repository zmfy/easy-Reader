<template>
  <button ref="btnRef" class="bell-btn" type="button" :aria-label="count ? `系统提醒（${count} 条）` : '系统提醒'" @click="onBellClick">
    <el-badge :value="count" :hidden="count === 0" :max="99" type="danger" class="bell-badge">
      <IconBell :size="19" :stroke-width="1.75" />
    </el-badge>
  </button>

  <!-- 宽屏 popover / 手机底部抽屉，内容共用一份 -->
  <component :is="isNarrow ? ElDrawer : ElPopover" ref="containerRef" v-bind="containerProps">
    <div class="nb-panel">
      <div v-if="!isNarrow" class="nb-head">系统提醒</div>

      <div v-if="!noticeStore.configWarning && !latest" class="nb-empty">暂无提醒</div>

      <div v-if="noticeStore.configWarning" class="nb-notice nb-notice--warning">
        <IconAlertTriangle class="nb-notice-icon" :size="17" :stroke-width="2" />
        <div class="nb-notice-body">
          <div class="nb-notice-text">{{ noticeStore.configWarning }}</div>
          <el-button size="small" type="warning" plain @click="goSettings">去设置</el-button>
        </div>
      </div>

      <div v-if="latest" class="nb-notice" :class="noticeStore.actionRequired ? 'nb-notice--warning' : 'nb-notice--info'">
        <IconInfoCircle class="nb-notice-icon" :size="17" :stroke-width="2" />
        <div class="nb-notice-body">
          <div class="nb-notice-text">
            有新版本 v{{ latest.version }}<template v-if="noticeStore.status?.currentVersion">（当前 v{{ noticeStore.status.currentVersion }}）</template>
            <span v-if="noticeStore.actionRequired" class="nb-tag nb-tag--inline">含需操作项</span>
          </div>
          <button class="nb-expand" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
            {{ expanded ? '收起更新内容' : '查看更新内容' }}
            <IconChevronDown class="nb-expand-arrow" :class="{ open: expanded }" :size="14" :stroke-width="2" />
          </button>
          <div v-if="expanded" class="nb-releases">
            <div v-for="release in noticeStore.status?.newer ?? []" :key="release.version" class="nb-release">
              <div class="nb-release-title">
                v{{ release.version }}<template v-if="release.date"> · <span class="nb-date">{{ release.date }}</span></template>
              </div>
              <div v-if="release.intro" class="nb-intro">{{ release.intro }}</div>
              <div v-for="(item, ai) in actionItems(release)" :key="'a' + ai" class="nb-item">
                <span class="nb-tag">需操作</span>
                <span class="nb-text"><template v-for="(seg, k) in boldSegments(item.text)" :key="k"><strong v-if="seg.bold">{{ seg.text }}</strong><template v-else>{{ seg.text }}</template></template></span>
              </div>
              <div v-for="(section, si) in release.sections" :key="si">
                <template v-if="section.items.some(i => !i.actionRequired)">
                  <div class="nb-section-title">{{ section.title }}</div>
                  <template v-for="(item, i) in section.items" :key="i">
                    <div v-if="!item.actionRequired" class="nb-item">
                      <span class="nb-text"><template v-for="(seg, k) in boldSegments(item.text)" :key="k"><strong v-if="seg.bold">{{ seg.text }}</strong><template v-else>{{ seg.text }}</template></template></span>
                    </div>
                  </template>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </component>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { ElDrawer, ElPopover } from 'element-plus'
import { IconAlertTriangle, IconBell, IconChevronDown, IconInfoCircle } from '@tabler/icons-vue'
import { useSystemNoticeStore } from '@/stores/system-notice'
import { boldSegments } from '@/utils/inline-bold'
import type { Release, ReleaseItem } from '@/types'

const router = useRouter()
const noticeStore = useSystemNoticeStore()
const isNarrow = useMediaQuery('(max-width: 768px)')

const btnRef = ref<HTMLElement | null>(null)
const containerRef = ref<{ hide?: () => void } | null>(null)
const drawerOpen = ref(false)
const expanded = ref(false)

const count = computed(() => noticeStore.count)
const latest = computed(() => noticeStore.latest)

const containerProps = computed(() =>
  isNarrow.value
    ? {
        modelValue: drawerOpen.value,
        'onUpdate:modelValue': (v: boolean) => { drawerOpen.value = v },
        onOpen: () => noticeStore.markOpened(),
        direction: 'btt',
        size: 'auto',
        title: '系统提醒',
        appendToBody: true,
        class: 'nb-drawer',
      }
    : {
        // 由铃铛按钮触发；点外部自动关闭
        virtualRef: btnRef.value,
        virtualTriggering: true,
        trigger: 'click',
        placement: 'right-end',
        width: 360,
        popperClass: 'nb-popover',
        onShow: () => noticeStore.markOpened(),
      },
)

function onBellClick() {
  // 宽屏由 popover 自己监听按钮点击
  if (isNarrow.value) drawerOpen.value = true
}

function close() {
  if (isNarrow.value) drawerOpen.value = false
  else containerRef.value?.hide?.()
}

function actionItems(release: Release): ReleaseItem[] {
  return release.sections.flatMap(s => s.items.filter(i => i.actionRequired))
}

function goSettings() {
  close()
  router.push({ path: '/settings', query: { tab: 'ai' } })
}
</script>

<style scoped>
.bell-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.15s ease;
}
.bell-btn:hover,
.bell-btn:focus-visible { color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.bell-badge { display: inline-flex; }
.bell-badge :deep(.el-badge__content) { font-size: 10px; height: 16px; line-height: 16px; padding: 0 5px; }

.nb-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: min(70vh, 560px);
  overflow-y: auto;
}
.nb-head { font-size: 14px; font-weight: 600; color: var(--text-0); }
.nb-empty { padding: 18px 0; text-align: center; font-size: 13px; color: var(--text-2); }

.nb-notice {
  --notice-color: var(--accent);
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--text-1);
  background: color-mix(in srgb, var(--notice-color) 9%, var(--bg-1));
  border: 1px solid color-mix(in srgb, var(--notice-color) 32%, transparent);
}
.nb-notice--warning { --notice-color: var(--warning); }
.nb-notice-icon { flex: none; margin-top: 2px; color: var(--notice-color); }
.nb-notice-body { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.nb-notice-text { line-height: 1.55; word-break: break-word; }

.nb-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
}
.nb-tag--inline { margin-left: 6px; }

.nb-expand {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--notice-color);
  cursor: pointer;
}
.nb-expand-arrow { transition: transform 0.2s ease; }
.nb-expand-arrow.open { transform: rotate(180deg); }

.nb-releases { align-self: stretch; }
.nb-release + .nb-release { margin-top: 14px; padding-top: 12px; border-top: 1px solid color-mix(in srgb, var(--notice-color) 20%, transparent); }
.nb-release-title { font-size: 14px; font-weight: 600; color: var(--text-0); }
.nb-date { font-size: 12px; font-weight: 400; color: var(--text-2); }
.nb-intro { margin-top: 4px; font-size: 12px; color: var(--text-2); }
.nb-section-title { margin: 8px 0 2px; font-size: 12px; font-weight: 600; color: var(--text-2); }
.nb-item { display: flex; align-items: flex-start; gap: 8px; margin-top: 5px; font-size: 13px; line-height: 1.6; color: var(--text-1); }
.nb-item .nb-tag { flex: none; margin-top: 2px; }
.nb-text { min-width: 0; word-break: break-word; }
</style>

<style>
/* 抽屉、popover 挂在 body 上，scoped 样式够不到外层 */
.nb-drawer.el-drawer { max-height: 80vh; border-radius: 14px 14px 0 0; }
.nb-drawer .el-drawer__header { margin-bottom: 8px; font-weight: 600; color: var(--text-0); }
.nb-drawer .el-drawer__body { padding-top: 0; }
</style>
