import { ref, computed, onUnmounted } from 'vue'
import { readerApi } from '@/api/reader'
import { buildTtsSegments, type TtsSegment } from '@/utils/tts-segments'

/** 阅读器提供给听书的数据与操作 */
export interface ListenSource {
  bookId: string
  /** 当前章节：标题 + 段落元素（与阅读位置同一套段落） */
  chapter(): { title: string; blocks: HTMLElement[] } | null
  /** 当前阅读位置所在段落 */
  startBlock(): number
  /** 进入下一章（内容渲染完成后 resolve）；没有下一章返回 false */
  nextChapter(): Promise<boolean>
  meta(): { title: string; artist: string; artwork?: string }
}

export type SleepMode = 0 | 15 | 30 | 60 | 'chapter'

export const LISTEN_RATES = [0.8, 1, 1.25, 1.5, 2]
const RATE_KEY = 'listenRate'
const PREFETCH = 2
const HIGHLIGHT_CLASS = 'tts-reading'

// 极短的静音 WAV：首次点击播放时同步播放一下，解锁 iOS 等浏览器的自动播放限制
function silentWav(): string {
  const samples = 800
  const buf = new ArrayBuffer(44 + samples * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true)
  v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, samples * 2, true)
  let bin = ''
  new Uint8Array(buf).forEach(b => { bin += String.fromCharCode(b) })
  return `data:audio/wav;base64,${btoa(bin)}`
}

function readRate(): number {
  try {
    const r = Number(localStorage.getItem(RATE_KEY))
    return LISTEN_RATES.includes(r) ? r : 1
  } catch { return 1 }
}

async function errorText(err: unknown): Promise<string> {
  const e = err as { response?: { data?: unknown }; code?: string }
  if (e.code === 'ECONNABORTED') return '语音合成超时，请稍后再试'
  const data = e.response?.data
  try {
    if (data instanceof Blob) return (JSON.parse(await data.text()) as { message?: string }).message || '语音合成失败'
  } catch { /* 非 JSON */ }
  return (data as { message?: string } | undefined)?.message || '语音合成失败，请检查网络'
}

export function useListen(src: ListenSource) {
  const audio = new Audio()
  audio.preload = 'auto'

  const active = ref(false)       // 播放条是否显示
  const playing = ref(false)
  const loading = ref(false)
  const error = ref('')
  const rate = ref(readRate())
  const sleepMode = ref<SleepMode>(0)
  const sleepEndsAt = ref(0)
  const now = ref(Date.now())

  let segs: TtsSegment[] = []
  let blocks: HTMLElement[] = []
  let idx = 0
  let gen = 0                     // 换章 / 停止时递增，丢弃过期的请求结果
  let urls = new Map<number, Promise<string>>()
  let highlighted: HTMLElement[] = []
  let sleepTimer: ReturnType<typeof setTimeout> | undefined
  let tick: ReturnType<typeof setInterval> | undefined
  let advancing = false           // 由听书自己触发的换章（阅读器据此区分手动换章）
  let unlocking = false           // 正在播放解锁用的静音，其结束事件不代表念完一段

  const sleepLeft = computed(() => {
    if (typeof sleepMode.value !== 'number' || !sleepMode.value) return ''
    const s = Math.max(0, Math.round((sleepEndsAt.value - now.value) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  })

  // ── 段落与音频 ─────────────────────────────────────
  function loadChapter(fromTop: boolean): boolean {
    const ch = src.chapter()
    if (!ch) return false
    blocks = ch.blocks
    const texts = blocks.map(b => (b.hidden ? '' : b.textContent || ''))
    const start = fromTop ? 0 : Math.max(0, src.startBlock())
    segs = buildTtsSegments(texts, { start, title: start === 0 ? ch.title : undefined })
    idx = 0
    revokeAll()
    return segs.length > 0
  }

  function fetchSeg(i: number): Promise<string> {
    let p = urls.get(i)
    if (!p) {
      const text = segs[i].text
      const load = () => readerApi.tts(src.bookId, text).then(r => URL.createObjectURL(r.data))
      p = load().catch(() => load())   // 失败自动重试一次
      urls.set(i, p)
      p.catch(() => urls.delete(i))
    }
    return p
  }

  function revokeAll() {
    for (const p of urls.values()) p.then(u => URL.revokeObjectURL(u), () => {})
    urls = new Map()
  }

  // 释放已经念过的段落音频，只保留上一段
  function revokeBefore(i: number) {
    for (const [k, p] of urls) {
      if (k < i - 1) { p.then(u => URL.revokeObjectURL(u), () => {}); urls.delete(k) }
    }
  }

  function clearHighlight() {
    highlighted.forEach(el => el.classList.remove(HIGHLIGHT_CLASS))
    highlighted = []
  }

  function highlight(seg: TtsSegment) {
    clearHighlight()
    if (seg.b0 < 0) return
    highlighted = blocks.slice(seg.b0, seg.b1 + 1)
    highlighted.forEach(el => el.classList.add(HIGHLIGHT_CLASS))
    const first = highlighted[0]
    if (!first) return
    const r = first.getBoundingClientRect()
    if (r.top < 80 || r.bottom > window.innerHeight - 120) first.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  async function playIndex(i: number) {
    const g = gen
    idx = i
    error.value = ''
    loading.value = true
    try {
      const url = await fetchSeg(i)
      if (g !== gen) return
      unlocking = false
      audio.src = url
      audio.defaultPlaybackRate = rate.value
      audio.playbackRate = rate.value
      highlight(segs[i])
      updateMediaSession()
      await audio.play()
      for (let k = 1; k <= PREFETCH && i + k < segs.length; k++) fetchSeg(i + k).catch(() => {})
      revokeBefore(i)
    } catch (err) {
      if (g !== gen) return
      error.value = await errorText(err)
      playing.value = false
    } finally {
      if (g === gen) loading.value = false
    }
  }

  async function advanceChapter() {
    if (sleepMode.value === 'chapter') { pauseForSleep(); return }
    const g = ++gen
    loading.value = true
    advancing = true
    let ok = false
    try { ok = await src.nextChapter() } finally { advancing = false }
    if (g !== gen) return
    if (!ok) { loading.value = false; playing.value = false; error.value = '全书已经念完了'; clearHighlight(); return }
    if (!loadChapter(true)) { loading.value = false; error.value = '本章没有可朗读的文字'; return }
    playIndex(0)
  }

  audio.addEventListener('ended', () => {
    if (unlocking) return
    if (idx + 1 < segs.length) playIndex(idx + 1)
    else advanceChapter()
  })
  audio.addEventListener('play', () => { playing.value = true; setPlaybackState() })
  audio.addEventListener('pause', () => { playing.value = false; setPlaybackState() })

  // ── 锁屏 / 耳机控制 ─────────────────────────────────
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return
    const m = src.meta()
    navigator.mediaSession.metadata = new MediaMetadata({
      title: m.title,
      artist: m.artist,
      artwork: m.artwork ? [{ src: m.artwork, sizes: '512x512' }] : [],
    })
  }

  function setPlaybackState() {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing.value ? 'playing' : 'paused'
  }

  function bindMediaSession() {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h) } catch { /* 不支持的动作 */ } }
    set('play', () => toggle())
    set('pause', () => audio.pause())
    set('previoustrack', () => prev())
    set('nexttrack', () => next())
    set('stop', () => stop())
  }

  function unbindMediaSession() {
    if (!('mediaSession' in navigator)) return
    for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'stop'] as MediaSessionAction[]) {
      try { navigator.mediaSession.setActionHandler(a, null) } catch { /* ignore */ }
    }
    navigator.mediaSession.metadata = null
  }

  // ── 定时停止 ───────────────────────────────────────
  function clearSleep() {
    clearTimeout(sleepTimer)
    clearInterval(tick)
    sleepMode.value = 0
  }

  function setSleep(mode: SleepMode) {
    clearSleep()
    sleepMode.value = mode
    if (typeof mode === 'number' && mode > 0) {
      sleepEndsAt.value = Date.now() + mode * 60_000
      now.value = Date.now()
      tick = setInterval(() => { now.value = Date.now() }, 1000)
      sleepTimer = setTimeout(pauseForSleep, mode * 60_000)
    }
  }

  // 到点：音量在 4 秒内渐弱后暂停
  function pauseForSleep() {
    clearSleep()
    const steps = 20
    let n = 0
    const fade = setInterval(() => {
      n++
      audio.volume = Math.max(0, 1 - n / steps)
      if (n >= steps) {
        clearInterval(fade)
        audio.pause()
        audio.volume = 1
      }
    }, 200)
  }

  // ── 对外操作 ───────────────────────────────────────
  function start() {
    // 必须在点击事件里同步调用 play()，之后异步换源才允许播放（iOS）
    unlocking = true
    audio.src = silentWav()
    audio.play().catch(() => {})
    gen++
    if (!loadChapter(false)) { error.value = '本章没有可朗读的文字'; active.value = true; return }
    active.value = true
    bindMediaSession()
    playIndex(0)
  }

  function toggle() {
    if (playing.value) { audio.pause(); return }
    if (loading.value) return
    if (audio.src && !audio.ended && !error.value && audio.currentTime > 0) { audio.play().catch(() => {}); return }
    playIndex(idx)
  }

  function prev() {
    if (audio.currentTime > 3 || idx === 0) { audio.currentTime = 0; if (!playing.value) audio.play().catch(() => {}); return }
    gen++
    playIndex(idx - 1)
  }

  function next() {
    gen++
    if (idx + 1 < segs.length) playIndex(idx + 1)
    else advanceChapter()
  }

  function setRate(r: number) {
    rate.value = r
    audio.defaultPlaybackRate = r
    audio.playbackRate = r
    try { localStorage.setItem(RATE_KEY, String(r)) } catch { /* 隐私模式 */ }
  }

  /** 用户手动换章后，从新章节开头接着念 */
  function restartFromChapterTop() {
    if (!active.value || advancing) return
    gen++
    audio.pause()
    if (loadChapter(true)) playIndex(0)
  }

  function stop() {
    gen++
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
    clearHighlight()
    revokeAll()
    clearSleep()
    unbindMediaSession()
    active.value = false
    playing.value = false
    loading.value = false
    error.value = ''
  }

  onUnmounted(stop)

  return {
    active, playing, loading, error, rate, sleepMode, sleepLeft,
    start, toggle, prev, next, stop, setRate, setSleep, restartFromChapterTop,
    isAdvancing: () => advancing,
  }
}
