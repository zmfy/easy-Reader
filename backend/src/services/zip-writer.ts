import fs from 'fs';
import zlib from 'zlib';
import { promisify } from 'util';

// 逐条写入的最小 zip 写入器：每加一个条目就压缩（libuv 线程池，不阻塞事件循环）并追加到文件，
// 内存里只有当前条目和目录记录。用于把大书转成 EPUB，避免整本书堆在内存里打包。
// 只支持 zip（非 zip64）：最多 65535 个条目、单文件与总大小 4GB 以内，对电子书足够。

const deflateRaw = promisify(zlib.deflateRaw);
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

interface CentralRecord { name: Buffer; method: number; crc: number; csize: number; usize: number; offset: number; time: number; date: number }

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  private offset = 0;
  private records: CentralRecord[] = [];
  private stamp = dosDateTime(new Date());

  // 保留 FileHandle 对象本身：只拿数字 fd 的话，句柄被垃圾回收时文件会被提前关闭
  private constructor(private filePath: string, private handle: fs.promises.FileHandle) {}

  static async open(filePath: string): Promise<ZipWriter> {
    return new ZipWriter(filePath, await fs.promises.open(filePath, 'w'));
  }

  private async write(buf: Buffer): Promise<void> {
    let written = 0;
    while (written < buf.length) {
      const { bytesWritten } = await this.handle.write(buf, written, buf.length - written);
      written += bytesWritten;
    }
    this.offset += buf.length;
  }

  /** store: true 时不压缩（EPUB 的 mimetype 必须如此） */
  async add(name: string, data: Buffer, opts: { store?: boolean } = {}): Promise<void> {
    if (this.records.length >= MAX_ENTRIES) throw new Error('条目过多，无法生成文件');
    const nameBuf = Buffer.from(name, 'utf8');
    const method = opts.store ? 0 : 8;
    const body = method === 8 ? await deflateRaw(data) : data;
    if (data.length > MAX_SIZE || this.offset + body.length > MAX_SIZE) throw new Error('文件过大，无法生成');
    const crc = zlib.crc32(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);            // version needed
    header.writeUInt16LE(0x0800, 6);        // UTF-8 文件名
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.date, 12);
    header.writeUInt32LE(crc >>> 0, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);

    const offset = this.offset;
    await this.write(Buffer.concat([header, nameBuf]));
    await this.write(body);
    this.records.push({ name: nameBuf, method, crc: crc >>> 0, csize: body.length, usize: data.length, offset, ...this.stamp });
  }

  async close(): Promise<void> {
    const start = this.offset;
    for (const r of this.records) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);               // version made by
      c.writeUInt16LE(20, 6);               // version needed
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(r.method, 10);
      c.writeUInt16LE(r.time, 12);
      c.writeUInt16LE(r.date, 14);
      c.writeUInt32LE(r.crc, 16);
      c.writeUInt32LE(r.csize, 20);
      c.writeUInt32LE(r.usize, 24);
      c.writeUInt16LE(r.name.length, 28);
      c.writeUInt32LE(r.offset, 42);
      await this.write(Buffer.concat([c, r.name]));
    }
    const size = this.offset - start;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.records.length, 8);
    end.writeUInt16LE(this.records.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    await this.handle.close();
  }

  /** 放弃：关闭并删除半成品文件 */
  async abort(): Promise<void> {
    await this.handle.close().catch(() => undefined);
    await fs.promises.rm(this.filePath, { force: true });
  }
}
