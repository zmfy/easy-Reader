// 把更新说明条目里成对的 **x** 拆成加粗片段；不成对的 ** 原样保留为文本。
// 只返回纯文本片段，由模板用 <strong> 渲染，不经过 v-html。
export function boldSegments(text: string): Array<{ text: string; bold: boolean }> {
  const segs: Array<{ text: string; bold: boolean }> = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), bold: false })
    segs.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < text.length) segs.push({ text: text.slice(last), bold: false })
  return segs.length ? segs : [{ text, bold: false }]
}
