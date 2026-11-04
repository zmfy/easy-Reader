// 浏览器自带语音（Web Speech API）：未开启 MiniMax 听书时的备用朗读方式。
// 语音引擎通过参数传入，便于测试。

export interface VoiceLike { name: string; lang: string }

interface UtteranceLike {
  lang: string
  rate: number
  voice: unknown
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

interface SynthLike {
  speak(u: never): void
  cancel(): void
  pause(): void
  resume(): void
  getVoices(): VoiceLike[]
}

const norm = (lang: string) => lang.replace('_', '-').toLowerCase()

/** 选中文音色：优先系统里的自然 / 神经网络音色（如 Edge 的 Xiaoxiao），其次普通话，再次任何中文 */
export function pickChineseVoice<V extends VoiceLike>(voices: V[]): V | null {
  const zh = voices.filter(x => norm(x.lang).startsWith('zh'))
  const mainland = zh.filter(x => norm(x.lang) === 'zh-cn')
  return mainland.find(x => /natural|neural|online|xiaoxiao|yunxi/i.test(x.name))
    || mainland[0]
    || zh[0]
    || null
}

export interface SpeakOptions {
  rate: number
  onStart?: () => void
  onEnd: () => void
  onError: (error: string) => void
}

/** 包一层浏览器语音：每次只念一段，被替换 / 取消的那段不再回调 */
// makeUtterance 返回浏览器的 SpeechSynthesisUtterance（事件参数类型比这里用到的更具体，故放宽为 object）
export function createBrowserSpeaker(synth: SynthLike, makeUtterance: (text: string) => object) {
  let token = 0
  return {
    speak(text: string, opts: SpeakOptions) {
      const t = ++token
      synth.cancel()
      const u = makeUtterance(text) as UtteranceLike
      u.lang = 'zh-CN'
      u.rate = opts.rate
      const voice = pickChineseVoice(synth.getVoices())
      if (voice) u.voice = voice
      u.onstart = () => { if (t === token) opts.onStart?.() }
      u.onend = () => { if (t === token) opts.onEnd() }
      u.onerror = (e) => {
        // 主动取消 / 打断不算错误
        if (t !== token || e.error === 'interrupted' || e.error === 'canceled') return
        opts.onError(e.error)
      }
      synth.speak(u as never)
    },
    pause() { synth.pause() },
    resume() { synth.resume() },
    cancel() { token++; synth.cancel() },
  }
}

/** 浏览器语音错误码 → 用户能看懂的提示 */
export function speechErrorMessage(code: string): string {
  if (['synthesis-failed', 'synthesis-unavailable', 'language-unavailable', 'voice-unavailable'].includes(code)) {
    return '这台设备的浏览器没有可用的中文语音，可在「AI 设置 → MiniMax」开启听书'
  }
  if (code === 'not-allowed') return '浏览器阻止了朗读，请再点一次播放'
  return `浏览器朗读失败（${code}）`
}
