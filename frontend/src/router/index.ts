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

  if (to.meta.roles && Array.isArray(to.meta.roles)) {
    if (!to.meta.roles.includes(authStore.user?.role)) {
      next('/library')
      return
    }
  }

  next()
})

export default router
