import * as pdfjs from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { LoadedDocument, PdfItemLayout, TextEdit } from '../core/types';
import { distributeEdits, type Segment } from './segments';
import { sparseSubsetTtf } from './ttf-subset';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const FONT_URL = `${import.meta.env.BASE_URL}fonts/NotoSansTC-Regular.ttf`;

export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  width: number;
}

export interface PdfPage {
  width: number;
  height: number;
  items: PdfTextItem[];
}

/** Rasterized source page used by OCR outputs to preserve the original visual layout. */
export interface PdfPageImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface PdfHandle {
  pages: PdfPage[];
  /** One segment per non-empty text item, in reading order, mapping into the full text. */
  segments: Segment[];
  /** segments[i] belongs to pages[itemPage[i]].items[itemIndex[i]] */
  itemPage: number[];
  itemIndex: number[];
  /** Present only for scanned/OCR PDFs. The source page is kept as the visual background. */
  pageImages?: PdfPageImage[];
}

export function buildPdfDocument(
  fileName: string,
  text: string,
  pages: PdfPage[],
  segments: Segment[],
  itemPage: number[],
  itemIndex: number[],
  pageImages?: PdfPageImage[],
): LoadedDocument {
  const handle: PdfHandle = { pages, segments, itemPage, itemIndex, pageImages };
  const layoutPages = pages.map((pg) => ({ width: pg.width, height: pg.height, items: [] as PdfItemLayout[] }));
  segments.forEach((segment, i) => {
    const item = pages[itemPage[i]].items[itemIndex[i]];
    layoutPages[itemPage[i]].items.push({
      start: segment.start,
      end: segment.end,
      x: item.x,
      y: item.y,
      fontSize: item.fontSize,
      width: item.width,
    });
  });
  return { fileName, format: 'pdf', text, handle, layout: { kind: 'pdf', pages: layoutPages } };
}

function fontSizeOf(item: TextItem): number {
  const [, , c, d] = item.transform;
  const size = Math.hypot(c, d);
  return size > 0.5 ? size : item.height || 10;
}

export async function parsePdf(file: File): Promise<LoadedDocument> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const pdf = await task.promise;
  const pages: PdfPage[] = [];
  const segments: Segment[] = [];
  const itemPage: number[] = [];
  const itemIndex: number[] = [];
  let text = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const [x0, y0, x1, y1] = page.view;
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    let lastEndX = Number.NaN;
    let lastY = Number.NaN;

    for (const raw of content.items) {
      if (!('str' in raw)) continue;
      const it = raw as TextItem;
      const x = it.transform[4] - x0;
      const y = it.transform[5] - y0;
      const size = fontSizeOf(it);

      if (it.str.length > 0) {
        const sameLine = Math.abs(y - lastY) < size * 0.5;
        if (!Number.isNaN(lastY)) {
          if (!sameLine) {
            if (!text.endsWith('\n')) text += '\n';
          } else if (x - lastEndX > size * 0.25 && !text.endsWith(' ')) {
            text += ' ';
          }
        }
        segments.push({ start: text.length, end: text.length + it.str.length, text: it.str });
        itemPage.push(p - 1);
        itemIndex.push(items.length);
        items.push({ text: it.str, x, y, fontSize: size, width: it.width });
        text += it.str;
        lastEndX = x + it.width;
        lastY = y;
      }
      if (it.hasEOL && !text.endsWith('\n')) {
        text += '\n';
        lastY = Number.NaN;
      }
    }
    pages.push({ width: x1 - x0, height: y1 - y0, items });
    if (!text.endsWith('\n')) text += '\n';
    text += '\n';
  }
  await task.destroy();

  if (text.trim().length === 0) {
    throw Object.assign(new Error('此 PDF 沒有可擷取的文字層（可能是掃描影像），無法處理'), { code: 'PDF_NO_TEXT_LAYER' });
  }
  return buildPdfDocument(file.name, text, pages, segments, itemPage, itemIndex);
}

let fontBytesPromise: Promise<ArrayBuffer> | null = null;
function loadFontBytes(): Promise<ArrayBuffer> {
  if (!fontBytesPromise) {
    fontBytesPromise = fetch(FONT_URL).then((r) => {
      if (!r.ok) throw new Error('無法載入中文字型，PDF 輸出失敗');
      return r.arrayBuffer();
    });
  }
  return fontBytesPromise;
}

function sanitizeForFont(text: string, supported: Set<number>): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += supported.has(cp) ? ch : cp < 0x20 ? '' : '?';
  }
  return out;
}

function fitSize(font: PDFFont, text: string, size: number, maxWidth: number): number {
  if (maxWidth <= 0 || text.length === 0) return size;
  const w = font.widthOfTextAtSize(text, size);
  if (w <= maxWidth * 1.02) return size;
  return Math.max(4, (size * maxWidth) / w);
}

interface RedactionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function redactionRect(item: PdfTextItem): RedactionRect {
  // OCR boxes can be a few pixels tighter than the visible glyphs. Generous horizontal padding
  // prevents a leading digit, decimal point, or percent sign from surviving at the bar edge.
  const padX = Math.max(2, item.fontSize * 0.38);
  const padY = Math.max(1, item.fontSize * 0.22);
  return {
    x: Math.max(0, item.x - padX),
    y: Math.max(0, item.y - item.fontSize * 0.25 - padY),
    width: Math.max(1, item.width + padX * 2),
    height: Math.max(1, item.fontSize * 1.15 + padY * 2),
  };
}

function mergeLineRects(rects: RedactionRect[]): RedactionRect[] {
  const lines: RedactionRect[] = [];
  for (const rect of [...rects].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((candidate) => {
      const center = candidate.y + candidate.height / 2;
      const rectCenter = rect.y + rect.height / 2;
      return Math.abs(center - rectCenter) <= Math.max(candidate.height, rect.height) * 0.6;
    });
    if (!line) {
      lines.push({ ...rect });
      continue;
    }
    const right = Math.max(line.x + line.width, rect.x + rect.width);
    const top = Math.max(line.y + line.height, rect.y + rect.height);
    line.x = Math.min(line.x, rect.x);
    line.y = Math.min(line.y, rect.y);
    line.width = right - line.x;
    line.height = top - line.y;
  }
  return lines;
}

function scannedRedactionRects(handle: PdfHandle, edits: TextEdit[]): Map<number, RedactionRect[]> {
  const byPage = new Map<number, RedactionRect[]>();
  for (const edit of edits) {
    const editRects = new Map<number, RedactionRect[]>();
    for (let segmentIndex = 0; segmentIndex < handle.segments.length; segmentIndex += 1) {
      const segment = handle.segments[segmentIndex];
      if (segment.end <= edit.start || segment.start >= edit.end) continue;
      const pageIndex = handle.itemPage[segmentIndex];
      const item = handle.pages[pageIndex]?.items[handle.itemIndex[segmentIndex]];
      if (!item) continue;
      if (!editRects.has(pageIndex)) editRects.set(pageIndex, []);
      editRects.get(pageIndex)!.push(redactionRect(item));
    }
    for (const [pageIndex, rects] of editRects) {
      if (!byPage.has(pageIndex)) byPage.set(pageIndex, []);
      byPage.get(pageIndex)!.push(...mergeLineRects(rects));
    }
  }
  return byPage;
}

async function burnRedactionsIntoPageImage(
  source: PdfPageImage,
  page: PdfPage,
  redactions: RedactionRect[],
): Promise<Uint8Array> {
  if (redactions.length === 0) return source.bytes;
  const bitmap = await createImageBitmap(new Blob([source.bytes as BlobPart], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('無法建立掃描 PDF 安全遮罩畫布');
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const scaleX = canvas.width / page.width;
  const scaleY = canvas.height / page.height;
  context.fillStyle = '#1f1f1f';
  for (const rect of redactions) {
    context.fillRect(
      rect.x * scaleX,
      canvas.height - (rect.y + rect.height) * scaleY,
      rect.width * scaleX,
      rect.height * scaleY,
    );
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('無法輸出掃描 PDF 安全遮罩影像')), 'image/png');
  });
  canvas.width = 1;
  canvas.height = 1;
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Rebuilds regular text PDFs as text-only pages. OCR PDFs use their rendered source page as a
 * background instead, so tables, stamps, line spacing and the original visual layout survive.
 */
export async function generatePdf(doc: LoadedDocument, edits: TextEdit[]): Promise<Blob> {
  const handle = doc.handle as PdfHandle;
  const changes = distributeEdits(handle.segments, edits);

  const newTexts: Map<number, Map<number, string>> = new Map();
  for (const [segIdx, newText] of changes) {
    const p = handle.itemPage[segIdx];
    if (!newTexts.has(p)) newTexts.set(p, new Map());
    newTexts.get(p)!.set(handle.itemIndex[segIdx], newText);
  }

  // Embed only the glyphs this document draws (see ttf-subset.ts for why not pdf-lib's subsetter).
  let allText = '?';
  handle.pages.forEach((pg, pIdx) => pg.items.forEach((it, iIdx) => (allText += newTexts.get(pIdx)?.get(iIdx) ?? it.text)));
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const font = await out.embedFont(sparseSubsetTtf(new Uint8Array(await loadFontBytes()), allText), { subset: false });
  const supported = new Set(font.getCharacterSet());
  const pageImages = handle.pageImages;
  const preserveScannedLayout = pageImages?.length === handle.pages.length;
  const imageRedactions = preserveScannedLayout ? scannedRedactionRects(handle, edits) : undefined;
  const securedPageImages = preserveScannedLayout
    ? await Promise.all(pageImages!.map((image, pageIndex) => burnRedactionsIntoPageImage(
        image,
        handle.pages[pageIndex],
        imageRedactions?.get(pageIndex) ?? [],
      )))
    : undefined;
  const embeddedPageImages = securedPageImages
    ? await Promise.all(securedPageImages.map((bytes) => out.embedPng(bytes)))
    : undefined;

  handle.pages.forEach((pg, pIdx) => {
    const page = out.addPage([pg.width, pg.height]);
    const pageChanges = newTexts.get(pIdx);
    const sourceImage = preserveScannedLayout ? pageImages![pIdx] : undefined;
    const embeddedImage = embeddedPageImages?.[pIdx];
    if (sourceImage && embeddedImage) {
      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: pg.width,
        height: pg.height,
      });
    }
    pg.items.forEach((it, iIdx) => {
      const changed = pageChanges?.has(iIdx) ?? false;
      const text = sanitizeForFont(changed ? pageChanges!.get(iIdx)! : it.text, supported);
      if (text.length === 0) return;
      // Replacement text may run past the original item; let it use the space up to the right
      // margin before shrinking, so whole-line items keep their size. For an OCR background,
      // stay inside the original word box to avoid colliding with neighbouring scan content.
      const room = sourceImage ? it.width : Math.max(it.width, pg.width - it.x - 36);
      const size = changed ? fitSize(font, text, it.fontSize, room) : it.fontSize;
      // OCR pages already contain the text in the page image. Keep both unchanged text and
      // replacement markers in an invisible searchable layer; opaque patches provide clean,
      // unambiguous redaction without squeezing long marker strings into small OCR word boxes.
      page.drawText(text, { x: it.x, y: it.y, size, font, opacity: sourceImage ? 0 : 1 });
    });
  });

  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
