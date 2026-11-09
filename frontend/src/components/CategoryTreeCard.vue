<template>
  <section class="section-card">
    <h2 class="section-title">分类</h2>
    <p class="section-desc">
      多级分类（最多 {{ CATEGORY_MAX_DEPTH }} 级）。书库按分类检索时，选上级会包含全部下级；AI 填充只会从分类表里选分类。
    </p>
    <div class="ct-summary">
      <span>当前 {{ topCount }} 个一级分类、共 {{ totalCount }} 个分类</span>
      <el-button @click="openEditor">编辑分类表</el-button>
    </div>

    <div class="ct-legacy">
      <template v-if="legacyCount > 0">
        <p class="note note--warning">
          有 {{ legacyCount }} 本书的分类不在分类表中（旧版的单级分类，或分类被删除）。整理后才能按分类检索到它们。
        </p>
        <el-button @click="openLegacy">整理</el-button>
      </template>
      <p v-else class="form-hint">所有书的分类都在分类表中。</p>
    </div>

    <!-- 分类表编辑：弹出层内改，保存才生效；取消则丢弃改动 -->
    <el-dialog
      v-model="editorVisible"
      title="编辑分类表"
      width="640px"
      :fullscreen="isNarrow"
      align-center
      :close-on-click-modal="false"
      :before-close="confirmCloseEditor"
      class="ct-dialog"
    >
      <p class="section-desc">改名会同步到已有的书；删除分类不会改动书，这些书会出现在「待整理」里。</p>
      <el-tree
        v-if="nodes.length"
        :data="nodes"
        node-key="id"
        :props="{ label: 'name', children: 'children' }"
        :expand-on-click-node="false"
        class="ct-tree"
      >
        <template #default="{ node, data }">
          <div class="ct-node">
            <span class="ct-name">{{ data.name }}</span>
            <span v-if="counts[pathOf(node)]" class="ct-count">{{ counts[pathOf(node)] }} 本</span>
            <span class="ct-actions">
              <el-button
                v-if="node.level < CATEGORY_MAX_DEPTH"
                text
                size="small"
                title="添加子分类"
                @click.stop="addChild(data)"
              ><IconPlus :size="15" :stroke-width="1.75" /></el-button>
              <el-button text size="small" title="改名" @click.stop="rename(node, data)">
                <IconPencil :size="15" :stroke-width="1.75" />
              </el-button>
              <el-button text size="small" title="删除" @click.stop="remove(node, data)">
                <IconTrash :size="15" :stroke-width="1.75" />
              </el-button>
            </span>
          </div>
        </template>
      </el-tree>
      <template #footer>
        <div class="ct-footer">
          <div>
            <el-button @click="addRoot">添加一级分类</el-button>
            <el-button @click="resetToDefault">恢复默认</el-button>
          </div>
          <div>
            <el-button @click="confirmCloseEditor(() => (editorVisible = false))">取消</el-button>
            <el-button type="primary" :loading="saving" :disabled="!dirty" @click="save">保存</el-button>
          </div>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="legacyVisible" title="整理分类" width="820px" :fullscreen="isNarrow" align-center class="ct-dialog">
      <div v-if="suggesting" class="ct-loading">
        <el-icon class="is-loading"><IconLoader2 /></el-icon>
        正在生成建议（AI 每次判断 10 本），已用 {{ elapsed }} 秒…
      </div>
      <template v-else>
        <p class="section-desc">建议来自无歧义的对应关系（「自动对应」）或 AI（「AI 建议」），可逐本修改。勾选的书才会写入。</p>
        <el-table :data="rows" max-height="56vh" @selection-change="(v: LegacyRow[]) => (selected = v)" ref="tableRef">
          <el-table-column type="selection" width="42" :selectable="(r: LegacyRow) => !!r.category" />
          <el-table-column label="书名" min-width="180">
            <template #default="{ row }">
              <div class="ct-title">{{ row.title }}</div>
              <div v-if="row.author" class="form-hint">{{ row.author }}</div>
            </template>
          </el-table-column>
          <el-table-column label="旧分类" prop="old" width="110" />
          <el-table-column label="新分类" min-width="230">
            <template #default="{ row }">
              <el-cascader
                v-model="row.category"
                :options="options"
                :props="{ checkStrictly: true, emitPath: false }"
                placeholder="选择分类"
                filterable
                clearable
                size="small"
                class="ct-select"
              />
              <el-tag v-if="row.source" size="small" type="info" class="ct-source">
                {{ row.source === 'map' ? '自动对应' : 'AI 建议' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </template>
      <template #footer>
        <el-button @click="legacyVisible = false">取消</el-button>
        <el-button type="primary" :loading="applying" :disabled="suggesting || selected.length === 0" @click="applyLegacy">
          应用所选（{{ selected.length }}）
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { ElMessage, ElMessageBox, type TableInstance } from 'element-plus'
import { IconLoader2, IconPencil, IconPlus, IconTrash } from '@tabler/icons-vue'
import { libraryApi } from '@/api/library'
import { settingsApi } from '@/api/settings'
import type { CategoryNode } from '@/types'
import { categoryPaths, toCategoryOptions } from '@/utils/category'
import {
  CATEGORY_MAX_DEPTH, computeRenames, fromTree, nameError, newEditNode, toTree, type EditNode,
} from '@/utils/category-edit'

interface LegacyRow { id: string; title: string; author: string | null; old: string; category: string | null; source?: 'map' | 'ai' }
interface TreeNodeLike { level: number; data: EditNode; parent: TreeNodeLike | null }

const isNarrow = useMediaQuery('(max-width: 768px)')
const nodes = ref<EditNode[]>([])
const counts = ref<Record<string, number>>({})
const defaultTree = ref<CategoryNode[]>([])
const savedJson = ref('')
const saving = ref(false)
const legacyCount = ref(0)

const savedTree = ref<CategoryNode[]>([])
const topCount = computed(() => savedTree.value.length)
const totalCount = computed(() => categoryPaths(savedTree.value).length)
const editorVisible = ref(false)

function openEditor() {
  load(savedTree.value)   // 每次打开都从已保存的分类表开始
  editorVisible.value = true
}

async function confirmCloseEditor(done: () => void) {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('分类表有未保存的修改，确定放弃？', '放弃修改', {
        type: 'warning', confirmButtonText: '放弃', cancelButtonText: '继续编辑',
      })
    } catch { return }
  }
  done()
}

const dirty = computed(() => JSON.stringify(toTree(nodes.value)) !== savedJson.value || computeRenames(nodes.value).length > 0)
const options = computed(() => toCategoryOptions(savedTree.value))

function pathOf(node: TreeNodeLike): string {
  const names: string[] = []
  for (let n: TreeNodeLike | null = node; n && n.level > 0; n = n.parent) names.unshift(n.data.name)
  return names.join('/')
}

function load(tree: CategoryNode[]) {
  nodes.value = fromTree(tree)
  savedJson.value = JSON.stringify(toTree(nodes.value))
}

async function refresh() {
  try {
    const [cats, legacy] = await Promise.all([libraryApi.categories(), libraryApi.legacyCategories()])
    const info = cats.data.data!
    savedTree.value = info.tree
    load(info.tree)
    counts.value = info.counts
    defaultTree.value = info.defaultTree
    legacyCount.value = legacy.data.data!.length
  } catch {
    ElMessage.error('分类表加载失败')
  }
}

async function askName(title: string, initial: string, siblings: EditNode[], self?: EditNode): Promise<string | null> {
  try {
    const { value } = await ElMessageBox.prompt('', title, {
      inputValue: initial,
      inputPlaceholder: '分类名称',
      inputValidator: (v: string) => nameError(v, siblings, self) ?? true,
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
    return value.trim()
  } catch {
    return null
  }
}

async function addRoot() {
  const name = await askName('添加一级分类', '', nodes.value)
  if (name) nodes.value.push(newEditNode(name))
}

async function addChild(data: EditNode) {
  const name = await askName(`在「${data.name}」下添加`, '', data.children)
  if (name) data.children.push(newEditNode(name))
}

function siblingsOf(node: TreeNodeLike): EditNode[] {
  return node.parent && node.parent.level > 0 ? node.parent.data.children : nodes.value
}

async function rename(node: TreeNodeLike, data: EditNode) {
  const name = await askName('改名', data.name, siblingsOf(node), data)
  if (name) data.name = name
}

async function remove(node: TreeNodeLike, data: EditNode) {
  const n = counts.value[pathOf(node)] ?? 0
  try {
    await ElMessageBox.confirm(
      `删除「${data.name}」${data.children.length ? '及其下级分类' : ''}？${n ? `其中的 ${n} 本书会保留原分类，之后可在「待整理」里重新归类。` : ''}`,
      '删除分类',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch { return }
  const list = siblingsOf(node)
  list.splice(list.indexOf(data), 1)
}

async function resetToDefault() {
  try {
    await ElMessageBox.confirm('恢复为内置的默认分类表？保存后生效，不在默认分类表里的书会出现在「待整理」里。', '恢复默认', {
      confirmButtonText: '恢复', cancelButtonText: '取消',
    })
  } catch { return }
  // 默认表是整体替换，不按名字推断改名
  nodes.value = fromTree(defaultTree.value)
  const strip = (list: EditNode[]) => list.forEach((n) => { n.origName = undefined; strip(n.children) })
  strip(nodes.value)
}

async function save() {
  if (nodes.value.length === 0) { ElMessage.warning('分类表不能为空'); return }
  saving.value = true
  try {
    const resp = await settingsApi.saveCategoryTree(toTree(nodes.value), computeRenames(nodes.value))
    const renamed = resp.data.data!.renamed
    ElMessage.success(renamed ? `分类表已保存，${renamed} 本书的分类已同步改名` : '分类表已保存')
    await refresh()
    editorVisible.value = false
  } catch (err: unknown) {
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

// ── 待整理 ──
const legacyVisible = ref(false)
const suggesting = ref(false)
const applying = ref(false)
const rows = ref<LegacyRow[]>([])
const selected = ref<LegacyRow[]>([])
const tableRef = ref<TableInstance>()
const elapsed = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

async function openLegacy() {
  legacyVisible.value = true
  suggesting.value = true
  rows.value = []
  selected.value = []
  elapsed.value = 0
  clearInterval(timer)
  timer = setInterval(() => { elapsed.value++ }, 1000)
  try {
    const resp = await libraryApi.suggestLegacyCategories()
    rows.value = resp.data.data!.map(s => ({
      id: s.id, title: s.title, author: s.author, old: s.category, category: s.suggested ?? null, source: s.source,
    }))
    suggesting.value = false
    // 有建议的默认勾选
    await nextTick()
    rows.value.filter(r => r.category).forEach(r => tableRef.value?.toggleRowSelection(r, true))
  } catch (err: unknown) {
    legacyVisible.value = false
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || '生成建议失败')
  } finally {
    suggesting.value = false
    clearInterval(timer)
  }
}

async function applyLegacy() {
  const items = selected.value.filter(r => r.category).map(r => ({ book_id: r.id, category: r.category! }))
  if (items.length === 0) return
  applying.value = true
  try {
    const resp = await libraryApi.applyCategories(items)
    ElMessage.success(`已更新 ${resp.data.data!.updated} 本书的分类`)
    legacyVisible.value = false
    await refresh()
  } catch (err: unknown) {
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || '应用失败')
  } finally {
    applying.value = false
  }
}

onMounted(refresh)
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
.ct-summary {
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  color: var(--text-1);
}
.ct-footer {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.ct-tree {
  max-height: 60vh;
  overflow-y: auto;
  margin: 4px 0 0;
  background: transparent;
}
.ct-node {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding-right: 4px;
}
.ct-name {
  color: var(--text-0);
}
.ct-count {
  font-size: 12px;
  color: var(--text-2);
}
.ct-actions {
  margin-left: auto;
  display: flex;
  opacity: 0.55;
}
.ct-node:hover .ct-actions {
  opacity: 1;
}
.ct-actions .el-button {
  padding: 4px;
  margin-left: 0;
}
.ct-legacy {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--card-border);
}
.ct-legacy .note {
  margin-bottom: 10px;
}
.ct-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 200px;
  color: var(--text-1);
}
.ct-title {
  color: var(--text-0);
}
.ct-select {
  width: 190px;
}
.ct-source {
  margin-left: 6px;
}
</style>
