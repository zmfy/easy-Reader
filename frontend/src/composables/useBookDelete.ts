import { ElMessage, ElMessageBox } from 'element-plus'
import { libraryApi, type BookDeleteResult } from '@/api/library'

interface DeleteOpts {
  cascade_duplicates?: boolean
  confirm_shelf_impact?: boolean
  keep_file?: boolean
}

/**
 * 删除书籍并处理后端的二次确认（409）：
 * HAS_DUPLICATES → 询问是否级联删除重复书；AFFECTS_SHELF → 询问是否影响用户书架。
 * 返回删除结果；用户取消或失败时返回 null。
 */
export async function deleteBookWithPrompts(bookId: string, opts: DeleteOpts = {}): Promise<BookDeleteResult | null> {
  try {
    const resp = await libraryApi.removeWithOptions(bookId, opts)
    return resp.data.data ?? { files_deleted: 0, records_deleted: 0, shelf_entries_affected: 0, warnings: [] }
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: { code?: string; data?: { duplicate_count?: number; affected_users?: number } } } }
    if (e.response?.status === 409 && e.response.data?.code === 'HAS_DUPLICATES') {
      const cnt = e.response.data.data?.duplicate_count ?? 0
      try {
        await ElMessageBox.confirm(`此书有 ${cnt} 个重复关联，一并删除？`, '级联删除', { type: 'warning' })
      } catch { return null }
      return deleteBookWithPrompts(bookId, { ...opts, cascade_duplicates: true })
    }
    if (e.response?.status === 409 && e.response.data?.code === 'AFFECTS_SHELF') {
      const users = e.response.data.data?.affected_users ?? 0
      try {
        await ElMessageBox.confirm(
          `此书已被 ${users} 个用户加入书架，确认删除？\n\n用户书架上的此书会消失。`,
          '影响用户书架',
          { type: 'warning' },
        )
      } catch { return null }
      return deleteBookWithPrompts(bookId, { ...opts, confirm_shelf_impact: true })
    }
    ElMessage.error('删除失败')
    return null
  }
}
