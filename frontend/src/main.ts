import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import router from './router'
import App from './App.vue'
import './assets/styles/main.css'
import { applySiteTheme } from './utils/theme'
import { setupElementPlus } from './utils/element-plus'
import { initPwaInstall } from './composables/usePwaInstall'

// 「安装到桌面」：浏览器在加载早期派发安装提示事件，须在挂载前开始监听
initPwaInstall()

// 默认深色主题，站点设置加载后再按实际主题切换
applySiteTheme()

const app = createApp(App)
const pinia = createPinia()

setupElementPlus(app)
app.use(pinia)
app.use(router)

app.mount('#app')
