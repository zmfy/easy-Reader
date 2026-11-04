import { describe, it, expect, vi } from 'vitest'
import { pickChineseVoice, createBrowserSpeaker, speechErrorMessage, type VoiceLike } from './browser-speech'

const v = (name: string, lang: string): VoiceLike => ({ name, lang })

describe('pickChineseVoice', () => {
  it('prefers natural / neural Mandarin voices', () => {
    const voices = [v('Google US English', 'en-US'), v('Google 普通话（中国大陆）', 'zh-CN'), v('Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', 'zh-CN')]
    expect(pickChineseVoice(voices)?.name).toContain('Xiaoxiao')
  })

  it('falls back to any mainland Chinese voice, then any Chinese voice', () => {
    expect(pickChineseVoice([v('Ting-Ting', 'zh_CN'), v('Mei-Jia', 'zh-TW')])?.name).toBe('Ting-Ting')
    expect(pickChineseVoice([v('Sin-ji', 'zh-HK')])?.name).toBe('Sin-ji')
    expect(pickChineseVoice([v('Alex', 'en-US')])).toBeNull()
  })
})

class FakeUtterance {
  text: string; lang = ''; rate = 1; voice: unknown = null
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  constructor(text: string) { this.text = text }
}

function fakeSynth() {
  const spoken: FakeUtterance[] = []
  return {
    spoken,
    speak: vi.fn((u: FakeUtterance) => { spoken.push(u); u.onstart?.() }),
    cancel: vi.fn(() => { const u = spoken[spoken.length - 1]; u?.onerror?.({ error: 'interrupted' }) }),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: () => [v('Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', 'zh-CN')],
  }
}

describe('createBrowserSpeaker', () => {
  it('speaks Chinese text with the chosen voice and rate and reports the end', () => {
    const synth = fakeSynth()
    const sp = createBrowserSpeaker(synth, t => new FakeUtterance(t))
    const onEnd = vi.fn()
    sp.speak('你好', { rate: 1.5, onEnd, onError: vi.fn() })
    const u = synth.spoken[0]
    expect(u.text).toBe('你好')
    expect(u.lang).toBe('zh-CN')
    expect(u.rate).toBe(1.5)
    expect((u.voice as VoiceLike).name).toContain('Xiaoxiao')
    u.onend?.()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('ignores the end / interruption of an utterance that was replaced or cancelled', () => {
    const synth = fakeSynth()
    const sp = createBrowserSpeaker(synth, t => new FakeUtterance(t))
    const first = { onEnd: vi.fn(), onError: vi.fn() }
    sp.speak('一', { rate: 1, ...first })
    sp.speak('二', { rate: 1, onEnd: vi.fn(), onError: vi.fn() })
    synth.spoken[0].onend?.()
    expect(first.onEnd).not.toHaveBeenCalled()
    expect(first.onError).not.toHaveBeenCalled()
    sp.cancel()
    expect(synth.cancel).toHaveBeenCalled()
  })

  it('reports real errors', () => {
    const synth = fakeSynth()
    const sp = createBrowserSpeaker(synth, t => new FakeUtterance(t))
    const onError = vi.fn()
    sp.speak('一', { rate: 1, onEnd: vi.fn(), onError })
    synth.spoken[0].onerror?.({ error: 'synthesis-failed' })
    expect(onError).toHaveBeenCalledWith('synthesis-failed')
  })
})

describe('speechErrorMessage', () => {
  it('explains missing voices and blocked playback in plain words', () => {
    expect(speechErrorMessage('synthesis-failed')).toContain('没有可用的中文语音')
    expect(speechErrorMessage('language-unavailable')).toContain('没有可用的中文语音')
    expect(speechErrorMessage('voice-unavailable')).toContain('没有可用的中文语音')
    expect(speechErrorMessage('not-allowed')).toContain('再点一次播放')
    expect(speechErrorMessage('network')).toBe('浏览器朗读失败（network）')
  })
})
