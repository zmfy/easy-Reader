import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { shelfApi } from '@/api/shelf'

/**
 * 当前书「是否在书架」及加入 / 移出切换（书页、阅读器共用）。
 * 在别处已加入（409）或已移出（404）时同步为实际状态，不当作失败。
 */
export function useShelfToggle(getBookId: () => string | undefined) {
  const onShelf = ref(false)
  const busy = ref(false)

  async function refresh() {
    const id = getBookId()
    if (!id) return
    try {
      const resp = await shelfApi.status(id)
      onShelf.value = !!resp.data.data?.inShelf
    } catch {
      onShelf.value = false
    }
  }

  async function toggle() {
    const id = getBookId()
    if (!id || busy.value) return
    busy.value = true
    try {
      if (onShelf.value) {
        await shelfApi.remove(id)
        onShelf.value = false
        ElMessage.success('已移出书架')
      } else {
        await shelfApi.add(id)
        onShelf.value = true
        ElMessage.success('已加入书架')
      }
    } catch (err: unknown) {
      const resp = (err as { response?: { status?: number; data?: { message?: string } } })?.response
      if (resp?.data?.message?.includes('已在书架')) {
        onShelf.value = true
      } else if (onShelf.value && resp?.status === 404) {
        onShelf.value = false
        ElMessage.info('该书已不在书架中')
      } else {
        ElMessage.error(onShelf.value ? '移出失败' : '添加失败')
      }
    } finally {
      busy.value = false
    }
  }

  return { onShelf, busy, refresh, toggle }
}
