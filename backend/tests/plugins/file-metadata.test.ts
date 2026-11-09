import { parseUmdHeader } from '../../src/plugins/parser-umd';
import { epubMetadata } from '../../src/plugins/parser-epub';
import { pdfInfoMetadata } from '../../src/plugins/parser-pdf';

function umdBlock(type: number, text: string): Buffer {
  const data = Buffer.from(text, 'utf16le');
  const head = Buffer.from([0x23, type & 0xff, type >> 8, 0x00, data.length + 5]);
  return Buffer.concat([head, data]);
}

describe('parseUmdHeader', () => {
  it('reads title / author / date / kind / publisher blocks', () => {
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x9b, 0x9a, 0xde]),
      Buffer.from([0x23, 0x01, 0x00, 0x00, 0x08, 0x01, 0x44, 0x2c]),
      umdBlock(0x02, '封神演义 '), umdBlock(0x03, '许仲琳'), umdBlock(0x04, '2006'),
      umdBlock(0x05, '11'), umdBlock(0x07, '古典'), umdBlock(0x08, '某出版社'),
      Buffer.from([0x24, 0, 0, 0, 0]),
    ]);
    expect(parseUmdHeader(buf)).toEqual({
      title: '封神演义', author: '许仲琳', date: '2006-11', subjects: ['古典'], publisher: '某出版社',
    });
  });

  it('returns empty metadata when there are no header blocks', () => {
    expect(parseUmdHeader(Buffer.from([0x89, 0x9b, 0x9a, 0xde, 0x24]))).toEqual({});
  });
});

describe('epubMetadata', () => {
  it('normalizes creator / subject array / date / html description', () => {
    expect(epubMetadata({
      title: '克莱因文集', creator: '[英]梅兰妮•克莱因', publisher: '九州出版社',
      subject: ['爱、罪疚与修复', ' '], date: '2017-04-30T16:00:00+00:00',
      description: '<p>儿童<b>精神分析</b></p>', ISBN: '9787510851308',
    })).toEqual({
      title: '克莱因文集', author: '[英]梅兰妮•克莱因', publisher: '九州出版社',
      subjects: ['爱、罪疚与修复'], date: '2017-04-30', description: '儿童 精神分析', isbn: '9787510851308',
    });
  });

  it('accepts a single subject string and missing metadata', () => {
    expect(epubMetadata({ subject: '历史' })).toEqual({ subjects: ['历史'] });
    expect(epubMetadata(undefined)).toEqual({});
  });
});

describe('pdfInfoMetadata', () => {
  it('drops tool-generated titles', () => {
    expect(pdfInfoMetadata({ Title: 'Microsoft Word - 书稿.doc', Author: 'islijun' })).toEqual({ author: 'islijun' });
    expect(pdfInfoMetadata({ Title: '傲慢与偏见.docx', Subject: '小说' })).toEqual({ title: '傲慢与偏见', subjects: ['小说'] });
    expect(pdfInfoMetadata(undefined)).toEqual({});
  });
});
