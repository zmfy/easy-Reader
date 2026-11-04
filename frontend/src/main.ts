import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import router from './router'
import App from './App.vue'
import './assets/styles/main.css'
import { applySiteTheme } from './utils/theme'

// 默认深色主题，站点设置加载后再按实际主题切换
applySiteTheme()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

app.mount('#app')
