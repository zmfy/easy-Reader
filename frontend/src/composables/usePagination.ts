import { reactive } from 'vue'

export function usePagination(defaultPageSize = 20) {
  const pagination = reactive({
    page: 1,
    pageSize: defaultPageSize,
    total: 0,
    totalPages: 0,
  })

  function updatePagination(p: { page: number; pageSize: number; total: number; totalPages: number }) {
    pagination.page = p.page
    pagination.pageSize = p.pageSize
    pagination.total = p.total
    pagination.totalPages = p.totalPages
  }

  function handlePageChange(page: number) {
    pagination.page = page
  }

  return { pagination, updatePagination, handlePageChange }
}
