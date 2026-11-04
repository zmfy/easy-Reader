import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ReaderSettings, ReaderTheme } from '@/types'
import { settingsApi } from '@/api/settings'
import { migrateReaderTheme } from '@/utils/reader-style'

// 默认阅读样式：靛青（与网站靛青主题同色）、Noto Serif SC 20px、行高 1.8
export const DEFAULT_READER_FONT = 'Noto Serif SC'
export const SANS_FONT_STACK = '"Source Han Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

const defaultSettings: ReaderSettings = {
  fontFamily: DEFAULT_READER_FONT,
  fontSize: 20,
  letterSpacing: 0,
  lineHeight: 1.8,
  pageWidth: 90,
  theme: 'indigo',
  backgroundColor: '#ffffff',
  fontColor: '#1a2440',
  pageMode: 'scroll',
}

export const themes: Record<ReaderTheme, { backgroundColor: string; fontColor: string; label: string }> = {
  'indigo':      { backgroundColor: '#ffffff',  fontColor: '#1a2440', label: '靛青' },
  'white':       { backgroundColor: '#FFFFFF',  fontColor: '#333333', label: '白昼' },
  'eye-care':    { backgroundColor: '#FFFDF0',  fontColor: '#4a4a4a', label: '护眼' },
  'night':       { backgroundColor: '#0b1020',  fontColor: '#c9d3ea', label: '夜间' },
  'dark':        { backgroundColor: '#1a1a1a',  fontColor: '#d0d0d0', label: '深黑' },
  'light-green': { backgroundColor: '#f0f8f0',  fontColor: '#2d4a2d', label: '浅绿' },
  'light-blue':  { backgroundColor: '#eef4ff',  fontColor: '#1a3366', label: '浅蓝' },
  'light-gray':  { backgroundColor: '#f5f5f5',  fontColor: '#333333', label: '浅灰' },
  'light-yellow':{ backgroundColor: '#fdf8e0',  fontColor: '#4a3a1a', label: '浅黄' },
  'light-brown': { backgroundColor: '#f5ebe0',  fontColor: '#4a2e1a', label: '浅棕' },
}

export const fontOptions = [
  { label: 'Noto Serif SC（默认）',   value: DEFAULT_READER_FONT },
  { label: '思源黑体',                value: SANS_FONT_STACK },
  { label: 'Noto Sans SC（无衬线）',  value: 'Noto Sans SC' },
  { label: '宋体',                    value: 'SimSun, 宋体, serif' },
  { label: '黑体',                    value: 'SimHei, 黑体, sans-serif' },
  { label: '微软雅黑',                value: 'Microsoft YaHei, 微软雅黑, sans-serif' },
  { label: '楷体',                    value: 'KaiTi, 楷体, STKaiti, serif' },
  { label: '仿宋',                    value: 'FangSong, 仿宋, STFangSong, serif' },
  { label: '华文中宋',                value: 'STZhongsong, 华文中宋, serif' },
  { label: '系统默认',                value: 'system-ui, sans-serif' },
]

let saveTimer: ReturnType<typeof setTimeout>

export const useReaderStore = defineStore('reader', () => {
  const settings = ref<ReaderSettings>({
    ...defaultSettings,
    ...JSON.parse(localStorage.getItem('readerSettings') || '{}'),
  })
  settings.value = migrateReaderTheme(settings.value, themes)

  async function loadPrefs() {
    try {
      const resp = await settingsApi.getReaderPrefs()
      if (resp.data.data) {
        settings.value = migrateReaderTheme({ ...defaultSettings, ...resp.data.data }, themes)
        localStorage.setItem('readerSettings', JSON.stringify(settings.value))
      }
    } catch {
      // Network error, keep localStorage value
    }
  }

  function updateSettings(partial: Partial<ReaderSettings>) {
    settings.value = { ...settings.value, ...partial }
    localStorage.setItem('readerSettings', JSON.stringify(settings.value))
    // Debounced save to server
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      settingsApi.saveReaderPrefs(settings.value).catch(() => {})
    }, 800)
  }

  function resetSettings() {
    settings.value = { ...defaultSettings }
    localStorage.setItem('readerSettings', JSON.stringify(settings.value))
    settingsApi.saveReaderPrefs(settings.value).catch(() => {})
  }

  function applyTheme(theme: ReaderTheme) {
    const t = themes[theme]
    updateSettings({ theme, backgroundColor: t.backgroundColor, fontColor: t.fontColor })
  }

  return { settings, themes, fontOptions, loadPrefs, updateSettings, resetSettings, applyTheme }
})
