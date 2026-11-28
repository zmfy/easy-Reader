import fs from 'fs';
import iconv from 'iconv-lite';
import { detectEncoding, isCrOnly } from '../../plugins/parser-txt';

export interface TxtLine {
  lineNo: number;
  byteStart: number;
  /** 不含换行符 */
  byteEnd: number;
  /** 已解码、未 trim */
  text: string;
}

/**
 * 逐行读取 TXT。编码识别、UTF-16 转码、只用 CR 换行的处理与 TxtParser.load 一致，
 * 字节位置与 TxtParser 的章节 startByte 同一坐标系（UTF-16 为转成 UTF-8 后的位置，CR 已换成 LF）。
 * 大文件用 256KB 块流式读取，不整本读入内存。
 * range：只读 [start, end) 字节区间（start 须是行开头，不给 end 读到末尾）；此时 lineNo 从区间开头的 0 数起。
 */
export async function* readTxtLines(filePath: string, range?: { start: number; end?: number }): AsyncGenerator<TxtLine> {
  const start = range?.start ?? 0;
  const detected = detectEncoding(filePath);
  let encoding = detected;
  let memBuffer: Buffer | null = null;
  if (detected === 'utf-16le' || detected === 'utf-16be') {
    memBuffer = Buffer.from(iconv.decode(fs.readFileSync(filePath), detected), 'utf8');
    encoding = 'utf8';
  } else if (isCrOnly(filePath)) {
    memBuffer = fs.readFileSync(filePath);
    for (let i = 0; i < memBuffer.length; i++) if (memBuffer[i] === 0x0d) memBuffer[i] = 0x0a;
  }

  const decode = (data: Buffer, start: number, end: number) => {
    const text = encoding === 'utf8' ? data.toString('utf8', start, end) : iconv.decode(data.subarray(start, end), encoding);
    return text.replace(/^﻿/, '').replace(/\r$/, '');
  };

  let lineNo = 0;
  if (memBuffer) {
    const data = memBuffer.subarray(0, Math.min(range?.end ?? memBuffer.length, memBuffer.length));
    let from = start;
    let nl: number;
    while ((nl = data.indexOf(0x0a, from)) !== -1) {
      yield { lineNo: lineNo++, byteStart: from, byteEnd: nl, text: decode(data, from, nl) };
      from = nl + 1;
    }
    if (from < data.length) yield { lineNo: lineNo++, byteStart: from, byteEnd: data.length, text: decode(data, from, data.length) };
    return;
  }

  if (range?.end !== undefined && range.end <= start) return;
  let processed = start;
  let remainder: Buffer = Buffer.alloc(0);
  // createReadStream 的 end 含该字节
  const stream = fs.createReadStream(filePath, { highWaterMark: 256 * 1024, start, end: range?.end !== undefined ? range.end - 1 : undefined });
  for await (const chunk of stream) {
    const data = remainder.length ? Buffer.concat([remainder, chunk as Buffer]) : (chunk as Buffer);
    let from = 0;
    let nl: number;
    while ((nl = data.indexOf(0x0a, from)) !== -1) {
      yield { lineNo: lineNo++, byteStart: processed + from, byteEnd: processed + nl, text: decode(data, from, nl) };
      from = nl + 1;
    }
    processed += from;
    remainder = data.subarray(from);
  }
  if (remainder.length > 0) {
    yield { lineNo: lineNo++, byteStart: processed, byteEnd: processed + remainder.length, text: decode(remainder, 0, remainder.length) };
  }
}
