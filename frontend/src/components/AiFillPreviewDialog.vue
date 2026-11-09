<template>
  <el-dialog
    :model-value="modelValue"
    title="AI 填充预览"
    width="880px"
    align-center
    :fullscreen="isNarrow"
    :close-on-click-modal="false"
    class="ai-fill-preview"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 检索中：明显的加载状态 + 已用时间，可随时取消 -->
    <div v-if="loading" class="preview-loading">
      <el-icon class="is-loading loading-icon"><IconLoader2 /></el-icon>
      <div class="loading-title">AI 正在查找书籍信息…</div>
      <div class="loading-hint">已用 {{ elapsed }} 秒，通常需要几秒到一分钟，可随时取消</div>
    </div>
    <div v-else-if="preview && form" class="preview-body">
      <p v-if="preview.contentMismatch" class="note note--warning">
        AI 读到的正文是《{{ preview.contentMismatch.title }}》<template v-if="preview.contentMismatch.author">（{{ preview.contentMismatch.author }}）</template>，与文件名不符，文件可能标错了，下面的建议是按正文给出的。
        <template v-if="preview.contentMismatch.reason">{{ preview.contentMismatch.reason }}</template>
      </p>
      <!-- 封面 -->
      <section class="block">
        <div class="block-title">封面 <span class="hint">左右滑动，点选一张</span></div>
        <div class="cover-strip">
          <button
            v-if="preview.current.cover_url"
            type="button"
            class="cover-item"
            :class="{ selected: form.cover === 'current' }"
            @click="form.cover = 'current'"
          >
            <img :src="preview.current.cover_url" alt="当前封面" />
            <span class="badge">当前</span>
          </button>
          <button
            v-for="(c, i) in preview.coverCandidates"
            :key="c.pic"
            type="button"
            class="cover-item"
            :class="{ selected: form.cover === i }"
            :title="[c.title, c.author, c.year].filter(Boolean).join(' · ')"
            @click="form.cover = i"
          >
            <img :src="c.thumbnail" :alt="c.title" />
            <span v-if="c.kind" class="badge">{{ c.kind }}</span>
            <span class="caption">{{ c.title }}{{ c.year ? ` · ${c.year}` : '' }}</span>
          </button>
          <button
            type="button"
            class="cover-item"
            :class="{ selected: form.cover === 'default' }"
            @click="form.cover = 'default'"
          >
            <img v-if="defaultCoverUrl" :src="defaultCoverUrl" alt="系统默认封面" />
            <div v-else class="cover-loading"><el-icon class="is-loading"><IconLoader2 /></el-icon></div>
            <span class="badge">默认</span>
          </button>
        </div>
        <div v-if="preview.coverCandidates.length === 0" class="hint">豆瓣没有找到候选封面</div>
      </section>

      <!-- 宽屏两栏：左侧 作者 / 分类 / 连载 / 标签，右侧 简介 / 类似作品 -->
      <div class="preview-grid">
      <!-- 作者 / 分类 / 简介（锁定字段可切换为 AI 结果） -->
      <section v-for="f in textFields" :key="f.key" class="block" :class="`area-${f.key}`">
        <div class="block-title">
          {{ f.label }}
          <el-tag
            v-if="preview.suggested[f.key] && preview.suggested.confidence?.[f.key]"
            size="small"
            :type="preview.suggested.confidence[f.key] === 'low' ? 'warning' : 'info'"
          >{{ CONFIDENCE_LABELS[preview.suggested.confidence[f.key]!] }}</el-tag>
          <template v-if="isLocked(f.key)">
            <el-tag size="small" type="info">已锁定</el-tag>
            <el-switch
              v-if="preview.suggested[f.key]"
              v-model="form.useAi[f.key]"
              size="small"
              active-text="改用 AI 结果"
              @change="onToggleAi(f.key)"
            />
          </template>
        </div>
        <!-- 分类：从分类树选（值为完整路径）；当前值不在分类树里时以占位文字显示 -->
        <el-cascader
          v-if="f.key === 'category'"
          v-model="form.category"
          :options="categoryOptions"
          :props="{ checkStrictly: true, emitPath: false }"
          :placeholder="form.category ? `${form.category}（旧分类）` : '分类'"
          clearable
          filterable
          class="category-select"
        />
        <el-input
          v-else
          v-model="form[f.key]"
          :type="f.key === 'summary' ? 'textarea' : 'text'"
          :autosize="f.key === 'summary' ? { minRows: 6, maxRows: 12 } : undefined"
          :placeholder="f.label"
          :maxlength="f.max"
        />
        <div v-if="isLocked(f.key) && preview.suggested[f.key]" class="hint other-value">
          {{ form.useAi[f.key] ? '原内容' : 'AI 建议' }}：{{ clip(form.useAi[f.key] ? preview.current[f.key] : preview.suggested[f.key]) }}
        </div>
        <!-- 低置信建议不预填：显示出来，由用户决定是否采用 -->
        <div
          v-if="!isLocked(f.key) && preview.suggested[f.key] && isLowConfidence(preview, f.key) && form[f.key] !== preview.suggested[f.key]"
          class="hint other-value"
        >
          AI 猜测（未采用）：{{ clip(preview.suggested[f.key]) }}
          <el-button link type="primary" size="small" @click="adoptSuggestion(f.key)">采用</el-button>
        </div>
        <div v-if="preview.suggested[f.key] && preview.suggested.evidence?.[f.key]" class="hint other-value">
          依据：{{ preview.suggested.evidence[f.key] }}
        </div>
      </section>

      <section class="block area-status">
        <div class="block-title">连载状态</div>
        <!-- 未知（null）时两项都不选中 -->
        <el-radio-group
          :model-value="form.is_finished ?? undefined"
          @update:model-value="(v: string | number | boolean | undefined) => { if (form) form.is_finished = !!v }"
        >
          <el-radio :value="false">连载中</el-radio>
          <el-radio :value="true">已完结</el-radio>
        </el-radio-group>
      </section>

      <!-- 推荐标签 -->
      <section class="block area-tags">
        <div class="block-title">推荐标签</div>
        <div class="tag-list">
          <el-tag v-for="(t, i) in form.tags" :key="t" closable @close="form.tags.splice(i, 1)">{{ t }}</el-tag>
          <el-input
            v-model="newTag"
            size="small"
            class="tag-input"
            placeholder="添加标签，回车确认"
            maxlength="30"
            @keyup.enter="addTag"
          />
        </div>
      </section>

      <!-- 类似作品 -->
      <section class="block area-similar">
        <div class="block-title">类似作品</div>
        <div v-for="(s, i) in form.similar" :key="`${s.title}-${i}`" class="similar-item">
          <div class="similar-text">
            《{{ s.title }}》<span v-if="s.author" class="similar-author">{{ s.author }}</span>
            <div v-if="s.reason" class="hint">{{ s.reason }}</div>
          </div>
          <el-button :icon="IconTrash" circle size="small" text @click="form.similar.splice(i, 1)" />
        </div>
        <div class="similar-add">
          <el-input v-model="newSimilar.title" size="small" placeholder="书名（必填）" maxlength="100" />
          <el-input v-model="newSimilar.author" size="small" placeholder="作者（选填）" maxlength="100" />
          <el-button size="small" :disabled="!newSimilar.title.trim()" @click="addSimilar">添加</el-button>
        </div>
      </section>

      <!-- 改编作品：豆瓣影视 / 猫耳FM 的搜索结果经 AI 筛选，只能删除不能手填（每条都要有来源链接） -->
      <section class="block area-adapt">
        <div class="block-title">改编作品 <span class="hint">来自豆瓣影视、猫耳FM，经 AI 筛选，点击可核对；短剧由集数推断</span></div>
        <div v-for="(a, i) in form.adaptations" :key="a.url" class="similar-item">
          <div class="similar-text">
            <el-tag size="small" type="info" :title="a.type === '短剧' ? SHORT_DRAMA_HINT : undefined">{{ a.type }}</el-tag>
            <a :href="a.url" target="_blank" rel="noopener noreferrer" class="adapt-link">{{ a.title }}</a>
            <span class="similar-author">{{ [a.year, ADAPTATION_SOURCE_LABELS[a.source]].filter(Boolean).join(' · ') }}</span>
          </div>
          <el-button :icon="IconTrash" circle size="small" text @click="form.adaptations.splice(i, 1)" />
        </div>
        <div v-if="form.adaptations.length === 0" class="hint">没有找到改编作品</div>
      </section>
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="applying" :disabled="loading || !form" @click="apply">应用</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onBeforeUnmount } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { ElMessage } from 'element-plus'
import { IconLoader2, IconTrash } from '@tabler/icons-vue'
import { libraryApi } from '@/api/library'
import { initialForm, buildApplyPayload, isLowConfidence, ADAPTATION_SOURCE_LABELS, SHORT_DRAMA_HINT, type AiFillForm } from '@/utils/ai-fill-form'
import type { AiFillPreview, AiFillLockableField, AiFillConfidence, Book } from '@/types'
import { toCategoryOptions, type CategoryOption } from '@/utils/category'

const props = defineProps<{ modelValue: boolean; preview: AiFillPreview | null; bookId: string; loading?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; applied: [book: Book] }>()

const isNarrow = useMediaQuery('(max-width: 768px)')
const form = ref<AiFillForm | null>(null)
const applying = ref(false)
const newTag = ref('')
const newSimilar = reactive({ title: '', author: '' })
const defaultCoverUrl = ref('')

// 加载计时：让用户知道仍在进行
const elapsed = ref(0)
let elapsedTimer: ReturnType<typeof setInterval> | undefined
watch(() => props.loading, (loading) => {
  clearInterval(elapsedTimer)
  elapsed.value = 0
  if (loading) elapsedTimer = setInterval(() => { elapsed.value++ }, 1000)
}, { immediate: true })

// 长度上限与后端 parseAiFillApplyBody 一致
const textFields: Array<{ key: AiFillLockableField; label: string; max: number }> = [
  { key: 'author', label: '作者', max: 200 },
  { key: 'category', label: '分类', max: 50 },
  { key: 'summary', label: '简介', max: 20000 },
]

const categoryOptions = ref<CategoryOption[]>([])
async function loadCategoryOptions() {
  if (categoryOptions.value.length > 0) return
  try {
    categoryOptions.value = toCategoryOptions((await libraryApi.categories()).data.data!.tree)
  } catch { /* 取不到分类表时分类保持原值 */ }
}

watch(() => props.preview, (p) => {
  if (p) loadCategoryOptions()
  form.value = p ? initialForm(p) : null
  newTag.value = ''
  newSimilar.title = ''
  newSimilar.author = ''
}, { immediate: true })

const CONFIDENCE_LABELS: Record<AiFillConfidence, string> = {
  high: '依据明确',
  medium: '依据推断',
  low: '低置信',
}

function adoptSuggestion(field: AiFillLockableField) {
  if (form.value && props.preview) form.value[field] = props.preview.suggested[field] || ''
}

function isLocked(field: AiFillLockableField): boolean {
  return !!props.preview?.lockedFields.includes(field)
}

function onToggleAi(field: AiFillLockableField) {
  if (!form.value || !props.preview) return
  form.value[field] = (form.value.useAi[field] ? props.preview.suggested[field] : props.preview.current[field]) || ''
}

function clip(text?: string | null): string {
  const t = text || '（空）'
  return t.length > 80 ? `${t.slice(0, 80)}…` : t
}

function addTag() {
  const t = newTag.value.trim()
  if (!form.value || !t) return
  if (!form.value.tags.includes(t) && form.value.tags.length < 20) form.value.tags.push(t)
  newTag.value = ''
}

function addSimilar() {
  if (!form.value || !newSimilar.title.trim() || form.value.similar.length >= 20) return
  form.value.similar.push({
    title: newSimilar.title.trim(),
    ...(newSimilar.author.trim() ? { author: newSimilar.author.trim() } : {}),
  })
  newSimilar.title = ''
  newSimilar.author = ''
}

// 默认封面缩略图：风格随分类、文字随作者变化，防抖后向后端取 SVG（与保存时同一生成函数）
let coverTimer: ReturnType<typeof setTimeout> | undefined
let coverSeq = 0
function setDefaultCoverUrl(url: string) {
  if (defaultCoverUrl.value) URL.revokeObjectURL(defaultCoverUrl.value)
  defaultCoverUrl.value = url
}
watch(
  () => [props.preview?.coverTitle, form.value?.author, form.value?.category] as const,
  ([title, author, category]) => {
    clearTimeout(coverTimer)
    if (!title) return
    coverTimer = setTimeout(async () => {
      const seq = ++coverSeq
      try {
        const resp = await libraryApi.defaultCoverSvg({ title, author: author || undefined, category: category || undefined })
        if (seq !== coverSeq) return
        setDefaultCoverUrl(URL.createObjectURL(new Blob([resp.data], { type: 'image/svg+xml' })))
      } catch { /* 预览图失败不影响选择与应用 */ }
    }, 300)
  },
  { immediate: true },
)

async function apply() {
  if (!form.value || !props.preview) return
  applying.value = true
  try {
    const resp = await libraryApi.aiFillApply(props.bookId, buildApplyPayload(form.value, props.preview))
    ElMessage.success('AI 信息已应用')
    emit('applied', resp.data.data as Book)
    emit('update:modelValue', false)
  } catch (err: unknown) {
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || '应用失败')
  } finally {
    applying.value = false
  }
}

onBeforeUnmount(() => {
  clearInterval(elapsedTimer)
  clearTimeout(coverTimer)
  setDefaultCoverUrl('')
})
</script>

<style scoped>
.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 320px;
  text-align: center;
}
.loading-icon {
  font-size: 44px;
  color: var(--el-color-primary);
}
.loading-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.loading-hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.preview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  grid-template-areas:
    "author summary"
    "category summary"
    "status summary"
    "tags similar"
    "adapt adapt";
  column-gap: 24px;
  row-gap: 16px;
  align-items: start;
}
.area-author { grid-area: author; }
.area-category { grid-area: category; }
.area-summary { grid-area: summary; }
.area-status { grid-area: status; }
.area-tags { grid-area: tags; }
.area-similar { grid-area: similar; }
.area-adapt { grid-area: adapt; }

/* 窄屏（全屏弹窗）单列 */
@media (max-width: 768px) {
  .preview-grid {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "author" "category" "summary" "status" "tags" "similar" "adapt";
  }
}

.preview-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.block-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.hint {
  font-size: 12px;
  font-weight: normal;
  color: var(--el-text-color-secondary);
}

.other-value {
  margin-top: 4px;
}

.cover-strip {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 4px 2px 8px;
  scroll-snap-type: x proximity;
}

.cover-item {
  position: relative;
  flex: 0 0 auto;
  width: 96px;
  padding: 0;
  border: 3px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  cursor: pointer;
  overflow: hidden;
  scroll-snap-align: start;
}

.cover-item.selected {
  border-color: var(--accent);
}

.cover-item img,
.cover-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 5 / 7;
  object-fit: cover;
  color: var(--text-2);
}

.cover-item .badge {
  position: absolute;
  top: 4px;
  left: 4px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-0) 80%, transparent);
  color: var(--text-0);
  font-size: 11px;
  line-height: 18px;
}

.cover-item .caption {
  display: block;
  padding: 2px 4px;
  font-size: 11px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.tag-input {
  width: 160px;
}

.similar-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-regular);
}

.similar-author {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.category-select {
  width: 100%;
}

.adapt-link {
  margin-left: 6px;
  color: var(--accent);
  text-decoration: none;
}
.adapt-link:hover { text-decoration: underline; }

.similar-add {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
</style>

<style>
/* 弹窗内容超出时只滚动中间区域，标题与「取消 / 应用」按钮始终可见 */
.ai-fill-preview {
  max-width: calc(100vw - 32px);
}
.ai-fill-preview:not(.is-fullscreen) .el-dialog__body {
  max-height: calc(100vh - 170px);
  overflow-y: auto;
}
.ai-fill-preview.is-fullscreen {
  display: flex;
  flex-direction: column;
}
.ai-fill-preview.is-fullscreen .el-dialog__body {
  flex: 1;
  overflow-y: auto;
}
</style>
