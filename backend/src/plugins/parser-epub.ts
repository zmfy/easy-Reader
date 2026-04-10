import { ReaderPlugin } from '../types';

export class EpubParser implements ReaderPlugin {
  format = 'epub';
  private epub: unknown = null;
  private chapters: Array<{ index: number; title: string; id: string }> = [];

  async load(filePath: string): Promise<void> {
    const EPub = require('epub2');
    this.epub = await EPub.createAsync(filePath);
    const flow = (this.epub as Record<string, unknown>).flow as Array<{ title?: string; id: string }>;
    this.chapters = flow.map((item, idx) => ({
      index: idx,
      title: item.title || `章节 ${idx + 1}`,
      id: item.id,
    }));
  }

  async getChapters(): Promise<Array<{ index: number; title: string }>> {
    return this.chapters.map(c => ({ index: c.index, title: c.title }));
  }

  async getChapterContent(index: number): Promise<string> {
    const chapter = this.chapters[index];
    if (!chapter) throw new Error(`章节 ${index} 不存在`);

    return new Promise((resolve, reject) => {
      (this.epub as Record<string, (id: string, cb: (err: Error | null, text: string) => void) => void>).getChapter(chapter.id, (err, text) => {
        if (err) reject(err);
        else resolve(text || '');
      });
    });
  }

  async getTotalProgress(): Promise<number> {
    return this.chapters.length;
  }

  async getProgress(): Promise<number> {
    return 0;
  }
}
