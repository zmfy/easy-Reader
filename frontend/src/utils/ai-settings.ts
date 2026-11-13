// 构造「保存 AI 设置」的请求体。
// 所有字段都提交（空值 = 清除之前保存的值，如清空模型改用默认模型）；
// 唯一例外是 apiKey：为空表示不修改（页面不回显已保存的 Key）。
export function buildAiSettingsPayload(
  pluginName: string,
  fields: string[],
  form: Record<string, string>,
  summaryLength: number,
  fillConcurrency: number,
  lookupEnabled: boolean,
): Record<string, string> {
  const payload: Record<string, string> = {
    ai_plugin: pluginName,
    ai_summary_length: String(summaryLength),
    ai_fill_concurrency: String(fillConcurrency),
    ai_lookup_enabled: lookupEnabled ? '1' : '0',
  }
  for (const field of fields) {
    const value = form[field] ?? ''
    if (field === 'apiKey' && !value) continue
    payload[`ai_${pluginName}_${field}`] = value
  }
  return payload
}

// 读取「AI 查证」开关：缺省或任何非 '0' 的值都视为开（与后端 isLookupEnabled 一致）
export function parseLookupEnabled(value: string | undefined): boolean {
  return value !== '0'
}
