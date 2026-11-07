import type { App } from 'vue'
import { ElMessageBox, provideGlobalConfig } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

// 组件按需引入时不会走 app.use(ElementPlus)，需单独设置：
// - 全局语言设为简体中文（分页、空状态、日期等组件内置文字）
// - ElMessageBox.confirm 等函数式弹窗不在组件树内，要 app.use 才能拿到应用上下文，否则按钮显示英文 OK / Cancel
export function setupElementPlus(app: App): void {
  provideGlobalConfig({ locale: zhCn }, app, true)
  app.use(ElMessageBox)
}
