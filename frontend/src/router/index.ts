import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/library',
    },
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login.vue'),
      meta: { requiresAuth: false },
    },
    {
      path: '/register',
      name: 'Register',
      component: () => import('@/views/Register.vue'),
      meta: { requiresAuth: false },
    },
    {
      path: '/change-password',
      name: 'ChangePassword',
      component: () => import('@/views/ChangePassword.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/library',
      name: 'Library',
      component: () => import('@/views/Library.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/shelf',
      name: 'Bookshelf',
      component: () => import('@/views/Bookshelf.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/book/:bookId',
      name: 'BookDetail',
      component: () => import('@/views/BookDetail.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/book/:bookId/map',
      name: 'BookMap',
      component: () => import('@/views/BookMap.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/book/:bookId/summary',
      name: 'StudySummary',
      component: () => import('@/views/StudySummary.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/reader/:bookId',
      name: 'Reader',
      component: () => import('@/views/Reader.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/settings',
      name: 'Settings',
      component: () => import('@/views/Settings.vue'),
      meta: { requiresAuth: true, roles: ['admin'] },
    },
    {
      path: '/library/scan-batches',
      name: 'scan-batches',
      component: () => import('@/views/ScanBatchList.vue'),
      meta: { requiresAuth: true, roles: ['admin'] },
    },
    {
      path: '/library/scan-batches/:id',
      name: 'scan-batch-review',
      component: () => import('@/views/ScanBatchReview.vue'),
      meta: { requiresAuth: true, roles: ['admin'] },
    },
    {
      path: '/library/problems',
      name: 'problem-books',
      component: () => import('@/views/ProblemBooks.vue'),
      meta: { requiresAuth: true, roles: ['admin'] },
    },
    {
      path: '/library/series/:id',
      name: 'series-detail',
      component: () => import('@/views/SeriesDetail.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/library/manual-overrides',
      name: 'manual-overrides',
      component: () => import('@/views/ManualOverridesAdmin.vue'),
      meta: { requiresAuth: true, roles: ['admin'] },
    },
    {
      path: '/library/audit-log',
      name: 'audit-log',
      component: () => import('@/views/AuditLogView.vue'),
      meta: { requiresAuth: true, roles: ['admin'] },
    },
  ],
})

router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore()

  if (to.meta.requiresAuth === false) {
    if (authStore.isLoggedIn && to.path === '/login') {
      next('/library')
    } else {
      next()
    }
    return
  }

  if (!authStore.isLoggedIn) {
    // accessToken 缺失但 refreshToken 存在时，先尝试静默刷新
    const refreshed = await authStore.tryRefresh()
    if (!refreshed) {
      next('/login')
      return
    }
  }

  if (!authStore.user) {
    await authStore.fetchMe()
  }

  // 仍在使用默认密码：只能停留在改密码页（后端也会拒绝其他接口）
  if (authStore.user?.mustChangePassword && to.path !== '/change-password') {
    next('/change-password')
    return
  }

  if (to.meta.roles && Array.isArray(to.meta.roles)) {
    if (!to.meta.roles.includes(authStore.user?.role)) {
      next('/library')
      return
    }
  }

  next()
})

export default router
