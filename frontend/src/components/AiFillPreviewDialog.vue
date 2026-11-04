<template>
  <el-dialog
    :model-value="modelValue"
    title="AI 填充预览"
    width="640px"
    :fullscreen="isNarrow"
    :close-on-click-modal="false"
    class="ai-fill-preview"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="preview && form" class="preview-body">
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
            <span class="caption">{{ c.title }}{{ c.year ? ` · ${c.year}` : '' }}</span>
          </button>
          <button
            type="button"
            class="cover-item"
            :class="{ selected: form.cover === 'default' }"
            @click="form.cover = 'default'"
          >
            <img v-if="defaultCoverUrl" :src="defaultCoverUrl" alt="系统默认封面" />
            <div v-else class="cover-loading"><el-icon class="is-loading"><Loading /></el-icon></div>
            <span class="badge">默认</span>
          </button>
        </div>
        <div v-if="preview.coverCandidates.length === 0" class="hint">豆瓣没有找到候选封面</div>
      </section>

      <!-- 作者 / 分类 / 简介（锁定字段可切换为 AI 结果） -->
      <section v-for="f in textFields" :key="f.key" class="block">
        <div class="block-title">
          {{ f.label }}
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
        <el-input
          v-model="form[f.key]"
          :type="f.key === 'summary' ? 'textarea' : 'text'"
          :autosize="f.key === 'summary' ? { minRows: 3, maxRows: 10 } : undefined"
          :placeholder="f.label"
          :maxlength="f.max"
        />
        <div v-if="isLocked(f.key) && preview.suggested[f.key]" class="hint other-value">
          {{ form.useAi[f.key] ? '原内容' : 'AI 建议' }}：{{ clip(form.useAi[f.key] ? preview.current[f.key] : preview.suggested[f.key]) }}
        </div>
      </section>

      <section class="block">
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
      <section class="block">
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
      <section class="block">
        <div class="block-title">类似作品</div>
        <div v-for="(s, i) in form.similar" :key="`${s.title}-${i}`" class="similar-item">
          <div class="similar-text">
            《{{ s.title }}》<span v-if="s.author" class="similar-author">{{ s.author }}</span>
            <div v-if="s.reason" class="hint">{{ s.reason }}</div>
          </div>
          <el-button :icon="Delete" circle size="small" text @click="form.similar.splice(i, 1)" />
        </div>
        <div class="similar-add">
          <el-input v-model="newSimilar.title" size="small" placeholder="书名（必填）" maxlength="100" />
          <el-input v-model="newSimilar.author" size="small" placeholder="作者（选填）" maxlength="100" />
          <el-button size="small" :disabled="!newSimilar.title.trim()" @click="addSimilar">添加</el-button>
        </div>
      </section>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="applying" :disabled="!form" @click="apply">应用</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onBeforeUnmount } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { ElMessage } from 'element-plus'
import { Delete, Loading } from '@element-plus/icons-vue'
import { libraryApi } from '@/api/library'
import { initialForm, buildApplyPayload, type AiFillForm } from '@/utils/ai-fill-form'
import type { AiFillPreview, AiFillLockableField, Book } from '@/types'

const props = defineProps<{ modelValue: boolean; preview: AiFillPreview | null; bookId: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; applied: [book: Book] }>()

const isNarrow = useMediaQuery('(max-width: 768px)')
const form = ref<AiFillForm | null>(null)
const applying = ref(false)
const newTag = ref('')
const newSimilar = reactive({ title: '', author: '' })
const defaultCoverUrl = ref('')

// 长度上限与后端 parseAiFillApplyBody 一致
const textFields: Array<{ key: AiFillLockableField; label: string; max: number }> = [
  { key: 'author', label: '作者', max: 200 },
  { key: 'category', label: '分类', max: 50 },
  { key: 'summary', label: '简介', max: 20000 },
]

watch(() => props.preview, (p) => {
  form.value = p ? initialForm(p) : null
  newTag.value = ''
  newSimilar.title = ''
  newSimilar.author = ''
}, { immediate: true })

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
  clearTimeout(coverTimer)
  setDefaultCoverUrl('')
})
</script>

<style scoped>
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
  border-radius: 6px;
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
  border-radius: 8px;
  background: rgba(11, 16, 32, 0.8);
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

.similar-add {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
</style>
