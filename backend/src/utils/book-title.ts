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
