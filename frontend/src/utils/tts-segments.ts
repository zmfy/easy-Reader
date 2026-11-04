/** 听书的一段：要合成的文字 + 对应的段落范围（b0..b1，-1 表示章节标题），用于高亮与定位 */
export interface TtsSegment { text: string; b0: number; b1: number }

// 句末标点后可跟的收尾引号 / 括号
const SENTENCE = /[^。！？!?…；;]+(?:[。！？!?…；;]+[”’」』"')）]*)|[^。！？!?…；;]+$/g

function splitLong(text: string, max: number): string[] {
  const sentences: string[] = []
  for (const s of text.match(SENTENCE) || [text]) {
    for (let i = 0; i < s.length; i += max) sentences.push(s.slice(i, i + max))
  }
  // 句子尽量拼满一段，减少请求次数
  const out: string[] = []
  for (const s of sentences) {
    if (out.length && out[out.length - 1].length + s.length <= max) out[out.length - 1] += s
    else out.push(s)
  }
  return out
}

/**
 * 把章节段落切成适合语音合成的片段：短段合并、长段按句子拆分，每段不超过 max 字（默认 180，兼顾高亮粒度与请求次数）。
 * blocks 与阅读器的段落一一对应（隐藏段落传空字符串以保持序号）；从 start 段开始；
 * 传入 title 时先念章节标题。
 */
export function buildTtsSegments(
  blocks: string[],
  { start = 0, max = 180, title }: { start?: number; max?: number; title?: string } = {},
): TtsSegment[] {
  const out: TtsSegment[] = []
  if (title?.trim()) out.push({ text: title.trim(), b0: -1, b1: -1 })
  // 上一段是否为可继续合并的普通短段（标题、长段拆出的片段不再合并）
  let mergeable = false
  for (let i = Math.max(0, start); i < blocks.length; i++) {
    const t = blocks[i].trim()
    if (!t) continue
    const last = out[out.length - 1]
    if (t.length > max) {
      for (const piece of splitLong(t, max)) out.push({ text: piece, b0: i, b1: i })
      mergeable = false
    } else if (mergeable && last.text.length + 1 + t.length <= max) {
      last.text += `\n${t}`
      last.b1 = i
    } else {
      out.push({ text: t, b0: i, b1: i })
      mergeable = true
    }
  }
  return out
}
