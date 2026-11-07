import { describe, it, expect } from 'vitest'
import { createApp, defineComponent, h, unref } from 'vue'
import { ElMessageBox, localeContextKey } from 'element-plus'
import { setupElementPlus } from './element-plus'

describe('setupElementPlus', () => {
  it('应用上下文的 Element Plus 语言为简体中文', () => {
    const app = createApp(defineComponent({ render: () => h('div') }))
    setupElementPlus(app)
    const locale = unref(app._context.provides[localeContextKey as symbol]) as { name: string; el: { messagebox: { confirm: string } } }
    expect(locale.name).toBe('zh-cn')
    expect(locale.el.messagebox.confirm).toBe('确定')
  })

  it('函数式弹窗 ElMessageBox 继承本应用上下文（否则按钮是英文 OK / Cancel）', () => {
    const app = createApp(defineComponent({ render: () => h('div') }))
    setupElementPlus(app)
    expect((ElMessageBox as unknown as { _context: unknown })._context).toBe(app._context)
  })
})
