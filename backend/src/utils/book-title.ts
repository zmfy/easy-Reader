/** 去掉文件名中的版本标记、括号说明、作者等，得到用于检索与显示的书名 */
export function cleanBookTitle(raw: string): string {
  return raw
    .replace(/[《《][^》》]{0,40}[》》]/g, (m) => m.slice(1, -1))  // 《xxx》 → xxx
    .replace(/作者[：:][^\s，,。]{0,30}/g, '')                                  // 作者：xxx
    .replace(/[(（][^)）]{0,30}[)）]/g, '')                          // (xxx) （xxx）
    .replace(/[[【][^\]】]{0,30}[\]】]/g, '')                        // [xxx] 【xxx】
    .replace(/[-_\s]*(完本|精校版?|全本|完整版|最新版|修订版|番外|特别版|典藏版)[-_\s]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || raw;
}

/**
 * 印在默认封面上的书名：在 cleanBookTitle 基础上再去掉开头的编号（如「0361. 」）和任意长度的括号说明
 * （套装册数、宣传语等），只留书名本身。只用于封面显示，不影响检索与去重。
 */
export function coverTitle(raw: string): string {
  const t = cleanBookTitle(raw.replace(/^\s*\d{1,5}\s*[.．、]\s*/, ''))
    .replace(/[(（][^)）]*[)）]/g, '')
    .replace(/[[【][^\]】]*[\]】]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t || cleanBookTitle(raw);
}
