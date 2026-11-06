<template>
  <div v-if="configWarning || showUpdate" class="system-notices">
    <div v-if="configWarning" class="notice notice--warning">
      <IconAlertTriangle class="notice-icon" :size="18" :stroke-width="2" />
      <span class="notice-text">{{ configWarning }}</span>
      <el-button size="small" type="warning" plain @click="goSettings">去设置</el-button>
    </div>

    <div v-if="showUpdate && latest" class="notice" :class="hasActionRequired ? 'notice--warning' : 'notice--info'">
      <IconInfoCircle class="notice-icon" :size="18" :stroke-width="2" />
      <span class="notice-text">
        有新版本 v{{ latest.version }}<template v-if="status?.currentVersion">（当前 v{{ status.currentVersion }}）</template>
        <span v-if="hasActionRequired" class="notice-tag">含需操作项</span>
      </span>
      <el-button size="small" :type="hasActionRequired ? 'warning' : 'primary'" plain @click="dialogVisible = true">查看更新内容</el-button>
      <button class="notice-close" aria-label="关闭提示" @click="closeUpdate">
        <IconX :size="16" :stroke-width="2" />
      </button>
    </div>

    <el-dialog v-model="dialogVisible" title="更新内容" width="min(640px, 92vw)" append-to-body>
      <div v-for="release in status?.newer ?? []" :key="release.version" class="nb-release">
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
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { IconAlertTriangle, IconInfoCircle, IconX } from '@tabler/icons-vue'
import { settingsApi } from '@/api/settings'
import { isDismissed, dismiss } from '@/utils/notice-dismiss'
import { boldSegments } from '@/utils/inline-bold'
import type { Release, ReleaseItem, UpdateStatus } from '@/types'

const router = useRouter()

const configWarning = ref<string | null>(null)
const status = ref<UpdateStatus | null>(null)
const dismissed = ref(false)
const dialogVisible = ref(false)

const latest = computed<Release | null>(() => status.value?.newer?.[0] ?? null)
// 任一未升级版本含【需操作】即按会话级关闭——需操作事项在升级前一直存在
const hasActionRequired = computed(
  () => !!status.value?.newer?.some(r => r.sections.some(s => s.items.some(i => i.actionRequired))),
)
const showUpdate = computed(() => !!latest.value && !dismissed.value)

function actionItems(release: Release): ReleaseItem[] {
  return release.sections.flatMap(s => s.items.filter(i => i.actionRequired))
}

function stores() {
  return { local: window.localStorage, session: window.sessionStorage }
}

function closeUpdate() {
  if (!latest.value) return
  dismiss(latest.value.version, hasActionRequired.value, stores())
  dismissed.value = true
}

function goSettings() {
  router.push({ path: '/settings', query: { tab: 'ai' } })
}

onMounted(async () => {
  // 两个接口互不影响，失败一律静默
  const [aiResp, updResp] = await Promise.allSettled([
    settingsApi.getAiStatus(),
    settingsApi.getUpdateStatus(),
  ])
  if (aiResp.status === 'fulfilled') {
    configWarning.value = aiResp.value.data.data?.config_warning ?? null
  }
  if (updResp.status === 'fulfilled') {
    const data = updResp.value.data.data ?? null
    status.value = data
    const first = data?.newer?.[0]
    if (first) {
      const actionRequired = data!.newer.some(r => r.sections.some(s => s.items.some(i => i.actionRequired)))
      try {
        dismissed.value = isDismissed(first.version, actionRequired, stores())
      } catch { /* 存储不可用则照常显示 */ }
    }
  }
})
</script>

<style scoped>
.system-notices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 32px 0;
  flex-shrink: 0;
}

.notice {
  --notice-color: var(--accent);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--text-1);
  background: color-mix(in srgb, var(--notice-color) 10%, var(--bg-1));
  border: 1px solid color-mix(in srgb, var(--notice-color) 35%, transparent);
}
.notice--warning { --notice-color: var(--warning); }
.notice-icon { flex: none; color: var(--notice-color); }
.notice-text { flex: 1; min-width: 0; line-height: 1.5; word-break: break-word; }
.notice-tag,
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
.notice-tag { margin-left: 6px; }
.notice-close {
  flex: none;
  display: inline-flex;
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: 4px;
  cursor: pointer;
}
.notice-close:hover { color: var(--text-0); background: color-mix(in srgb, var(--notice-color) 14%, transparent); }

.nb-release + .nb-release { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--card-border, rgba(124, 92, 255, 0.12)); }
.nb-release-title { font-size: 15px; font-weight: 600; color: var(--text-0); }
.nb-date { font-size: 12px; font-weight: 400; color: var(--text-2); }
.nb-intro { margin-top: 4px; font-size: 13px; color: var(--text-2); }
.nb-section-title { margin: 10px 0 4px; font-size: 12px; font-weight: 600; color: var(--text-2); }
.nb-item { display: flex; align-items: flex-start; gap: 8px; margin-top: 6px; font-size: 13px; line-height: 1.6; color: var(--text-1); }
.nb-tag { flex: none; margin-top: 2px; }
.nb-text { min-width: 0; word-break: break-word; }

@media (max-width: 768px) {
  .system-notices { padding: 10px 16px 0; }
  .notice { flex-wrap: wrap; }
  .notice-text { flex-basis: calc(100% - 40px); }
}
</style>
