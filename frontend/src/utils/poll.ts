const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * 反复探测直到得到结果：最多 tries 次，每次间隔 interval 毫秒；返回 null 表示超时。
 * hold() 为真时只等待、不消耗次数（例如 PDF 文件仍在下载，计时不应开始）。
 */
export async function pollUntil<T>(
  probe: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  opts: { tries: number; interval: number; hold?: () => boolean },
): Promise<T | null> {
  for (let i = 0; i < opts.tries;) {
    if (opts.hold?.()) {
      await sleep(opts.interval)
      continue
    }
    const r = await probe()
    if (r) return r
    i++
    if (i < opts.tries) await sleep(opts.interval)
  }
  return null
}
