import { levenshtein } from './title-normalizer';

/** 归一化作者名：全角→半角、去所有空白、去尾部「著/编著/着」、小写。 */
export function normalizeAuthor(s: string): string {
  return (s || '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, '')
    .replace(/(编著|编着|著|着)$/g, '')
    .toLowerCase()
    .trim();
}

/**
 * 判断两个作者名是否"一致"：归一化后 ① 完全相等 → ② 一方包含另一方
 * → ③ 模糊相似度 >= 2/3。任一方归一化后为空则不一致。
 */
export function authorsMatch(a: string, b: string): boolean {
  const na = normalizeAuthor(a);
  const nb = normalizeAuthor(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const sim = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  return sim >= 2 / 3;
}
