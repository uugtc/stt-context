import { readFile } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ReferenceDocument } from '../shared/types';

export async function readDocument(path: string): Promise<ReferenceDocument> {
  const bytes = await readFile(path);
  let text: string;
  if (bytes.length > 20 * 1024 * 1024) throw new Error('資料は1ファイル20MB以内にしてください。');
  if (extname(path).toLowerCase() === '.pdf') {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pdf = await task.promise;
    try {
      const pages: string[] = [];
      let length = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
        pages.push(pageText);
        length += pageText.length;
        if (length > 500000)
          throw new Error('資料の文章が長すぎます。50万文字以内の範囲に分けてください。');
      }
      text = pages.join('\n\n');
    } finally {
      await task.destroy();
    }
  } else text = bytes.toString('utf8');
  if (!text.trim())
    throw new Error('文字を抽出できません。画像のみのPDF（OCR）は初版では未対応です。');
  if (text.length > 500000) throw new Error('資料は50万文字以内にしてください。');
  return {
    id: randomUUID(),
    name: basename(path),
    text,
    digest: '',
    terms: [],
    status: 'extracted',
  };
}
