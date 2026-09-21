import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { detect } from '../../src/core/detector';
import { BUILTIN_PATTERNS } from '../../src/core/patterns';
import { applyRedactions } from '../../src/core/redactor';
import { restore } from '../../src/core/restorer';
import { buildPdfDocument, generatePdf, parsePdf } from '../../src/formats/pdf';

const FONT = new Uint8Array(readFileSync('public/fonts/NotoSansTC-Regular.ttf'));

const LINES = [
  '個案姓名：王小明先生（身分證字號 A123456789）',
  '聯絡手機 0912-345-678，Email：xiaoming.wang@example.com',
  '地址：台北市信義區市府路45號8樓',
];

async function buildPdf(lines: string[]): Promise<File> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(FONT, { subset: true });
  const page = pdf.addPage([595, 842]);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 24, size: 12, font }));
  const bytes = await pdf.save();
  return new File([bytes as BlobPart], 'sample.pdf', { type: 'application/pdf' });
}

beforeAll(() => {
  // The font is fetched from the static site at runtime; serve it from disk here.
  vi.stubGlobal('fetch', async () => new Response(FONT));
  // Vite's `?url` worker path is not importable under Node; point pdf.js at the file directly.
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL('node_modules/pdfjs-dist/build/pdf.worker.min.mjs').href;
});

describe('PDF round trip', () => {
  it('preserves an OCR page image and masks only changed regions', async () => {
    const pageImage = Uint8Array.from(Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ));
    const doc = buildPdfDocument(
      'scan.pdf',
      '機密文件 王小明',
      [{
        width: 200,
        height: 200,
        items: [
          { text: '機密文件', x: 20, y: 160, fontSize: 12, width: 48 },
          { text: '王小明', x: 80, y: 160, fontSize: 12, width: 36 },
        ],
      }],
      [
        { start: 0, end: 4, text: '機密文件' },
        { start: 5, end: 8, text: '王小明' },
      ],
      [0, 0],
      [0, 1],
      [{ bytes: pageImage, width: 200, height: 200 }],
    );

    const fillRect = vi.fn();
    const context = { drawImage: vi.fn(), fillRect, fillStyle: '' };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback) => callback(new Blob([pageImage as BlobPart], { type: 'image/png' }))),
    };
    const originalCreateElement = document.createElement.bind(document);
    const createElement = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) =>
      tagName === 'canvas' ? fakeCanvas : originalCreateElement(tagName)) as typeof document.createElement);
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() })),
    });

    const blob = await generatePdf(doc, [{ start: 5, end: 8, replacement: '[姓名:abcdef]' }]);
    createElement.mockRestore();
    Reflect.deleteProperty(globalThis, 'createImageBitmap');
    const out = await parsePdf(new File([blob], 'scan.deid.pdf'));

    expect(out.text).toContain('機密文件');
    expect(out.text).toContain('[姓名:abcdef]');
    expect(out.text).not.toContain('王小明');
    expect(Buffer.from(await blob.arrayBuffer()).toString('latin1')).toContain('/Subtype /Image');
    expect(fillRect).toHaveBeenCalled();
  });

  it('extracts text with positions and rebuilds a text-only PDF without the originals', async () => {
    const doc = await parsePdf(await buildPdf(LINES));
    for (const l of LINES) expect(doc.text.replace(/\s/g, '')).toContain(l.replace(/\s/g, ''));

    const items = detect(doc.text, BUILTIN_PATTERNS);
    const originals = items.map((i) => i.original);
    expect(originals).toContain('A123456789');
    expect(originals).toContain('王小明');
    expect(originals).toContain('xiaoming.wang@example.com');
    expect(originals).toContain('台北市信義區市府路45號8樓');

    const { edits, mapping } = applyRedactions(doc.text, items);
    const blob = await generatePdf(doc, edits);
    const out = await parsePdf(new File([blob], 'out.pdf'));
    for (const o of originals) expect(out.text).not.toContain(o);
    for (const m of mapping) expect(out.text).toContain(`[${m.category}:${m.code}]`);

    // The rebuilt PDF must not embed the original bytes at all (no hidden text underneath).
    const raw = Buffer.from(await blob.arrayBuffer()).toString('latin1');
    expect(raw).not.toContain('A123456789');

    const restored = restore(out.text, mapping);
    expect(restored.missingCodes).toEqual([]);
    expect(restored.restoredText.replace(/\s/g, '')).toBe(doc.text.replace(/\s/g, ''));
  });

  it('rejects a PDF without a text layer', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const file = new File([(await pdf.save()) as BlobPart], 'blank.pdf');
    await expect(parsePdf(file)).rejects.toThrow(/文字層/);
  });
});
