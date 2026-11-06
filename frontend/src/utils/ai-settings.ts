// 构造「保存 AI 设置」的请求体。
// 所有字段都提交（空值 = 清除之前保存的值，如清空模型改用默认模型）；
// 唯一例外是 apiKey：为空表示不修改（页面不回显已保存的 Key）。
export function buildAiSettingsPayload(
  pluginName: string,
  fields: string[],
  form: Record<string, string>,
  summaryLength: number,
  fillConcurrency: number,
): Record<string, string> {
  const payload: Record<string, string> = {
    ai_plugin: pluginName,
    ai_summary_length: String(summaryLength),
    ai_fill_concurrency: String(fillConcurrency),
  }
  for (const field of fields) {
    const value = form[field] ?? ''
    if (field === 'apiKey' && !value) continue
    payload[`ai_${pluginName}_${field}`] = value
  }
  return payload
}
