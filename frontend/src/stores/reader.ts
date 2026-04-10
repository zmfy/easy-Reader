import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ReaderSettings } from '@/types'

const defaultSettings: ReaderSettings = {
  fontFamily: 'Noto Serif SC',
  fontSize: 18,
  letterSpacing: 1,
  lineHeight: 1.9,
  theme: 'night',
  backgroundColor: '#0b1020',
  fontColor: '#c9d3ea',
  pageMode: 'scroll',
}

export const useReaderStore = defineStore('reader', () => {
  const settings = ref<ReaderSettings>({
    ...defaultSettings,
    ...JSON.parse(localStorage.getItem('readerSettings') || '{}'),
  })

  function updateSettings(partial: Partial<ReaderSettings>) {
    settings.value = { ...settings.value, ...partial }
    localStorage.setItem('readerSettings', JSON.stringify(settings.value))
  }

  function resetSettings() {
    settings.value = { ...defaultSettings }
    localStorage.setItem('readerSettings', JSON.stringify(settings.value))
  }

  const themes = {
    white: { backgroundColor: '#FFFFFF', fontColor: '#333333' },
    'eye-care': { backgroundColor: '#FFFDF0', fontColor: '#4a4a4a' },
    night: { backgroundColor: '#0b1020', fontColor: '#c9d3ea' },
    dark: { backgroundColor: '#1a1a1a', fontColor: '#d0d0d0' },
  }

  function applyTheme(theme: ReaderSettings['theme']) {
    updateSettings({ theme, ...themes[theme] })
  }

  return { settings, updateSettings, resetSettings, applyTheme, themes }
})
