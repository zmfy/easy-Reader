import fs from 'fs';
import { ReaderPlugin } from '../types';

export class PdfParser implements ReaderPlugin {
  format = 'pdf';
  private pages: string[] = [];

  async load(filePath: string): Promise<void> {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer, {
      pagerender: (pageData: Record<string, unknown>) => {
        return (pageData.getTextContent as () => Promise<{ items: Array<{ str: string }> }>)().then(textContent => {
          const text = textContent.items.map(item => item.str).join(' ');
          this.pages.push(text);
          return text;
        });
      }
    });
    if (this.pages.length === 0 && data.text) {
      // Fallback: split by estimated page size
      const chunkSize = 2000;
      for (let i = 0; i < data.text.length; i += chunkSize) {
        this.pages.push(data.text.slice(i, i + chunkSize));
      }
    }
  }

  async getChapters(): Promise<Array<{ index: number; title: string }>> {
    return this.pages.map((_, i) => ({ index: i, title: `第 ${i + 1} 页` }));
  }

  async getChapterContent(index: number): Promise<string> {
    const page = this.pages[index];
    if (page === undefined) throw new Error(`页面 ${index} 不存在`);
    const paragraphs = page.split(/\n+/).filter(p => p.trim());
    return paragraphs.map(p => `<p>${p.trim()}</p>`).join('\n');
  }

  async getTotalProgress(): Promise<number> {
    return this.pages.length;
  }

  async getProgress(): Promise<number> {
    return 0;
  }
}
