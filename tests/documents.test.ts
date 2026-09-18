import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readDocument } from '../src/main/documents';

it('reads UTF-8 notes without losing specialized Japanese terms', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stt-doc-'));
  try {
    const file = join(dir, 'context.md');
    writeFileSync(file, '# 腸管\n全層性壊死について検討する。');
    expect(await readDocument(file)).toMatchObject({
      name: 'context.md',
      text: '# 腸管\n全層性壊死について検討する。',
      status: 'extracted',
    });
    writeFileSync(file, '');
    await expect(readDocument(file)).rejects.toThrow('文字を抽出できません');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it('extracts embedded text from a real PDF stream', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stt-pdf-'));
  try {
    const text = 'BT /F1 12 Tf 30 100 Td (Transmural necrosis) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((n) => `${String(n).padStart(10, '0')} 00000 n `)
      .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const file = join(dir, 'brief.pdf');
    writeFileSync(file, pdf);
    expect((await readDocument(file)).text).toContain('Transmural necrosis');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
