import * as pdfjs from 'pdfjs-dist';
import type { Block, Word } from 'tesseract.js';
import { createWorker } from 'tesseract.js';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Segment } from './segments';
import { buildPdfDocument, type PdfPage, type PdfTextItem } from './pdf';
import type { LoadedDocument } from '../core/types';
import type { ParseProgress } from './index';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

const MAX_RENDER_PIXELS = 4_000_000;
const MAX_OCR_SCALE = 2;

function report(
  onProgress: ((progress: ParseProgress) => void) | undefined,
  progress: ParseProgress,
): void {
  onProgress?.(progress);
}

function pageScale(width: number, height: number): number {
  const pixelsAtScaleOne = Math.max(1, width * height);
  return Math.min(MAX_OCR_SCALE, Math.max(1, Math.sqrt(MAX_RENDER_PIXELS / pixelsAtScaleOne)));
}

interface LastWord {
  text: string;
  xEnd: number;
  top: number;
  height: number;
}

function appendWord(
  word: Word,
  scale: number,
  pageHeight: number,
  text: string,
  items: PdfTextItem[],
  segments: Segment[],
  itemPage: number[],
  itemIndex: number[],
  pageIndex: number,
  last: LastWord | undefined,
): { text: string; last?: LastWord } {
  const value = word.text.trim().replace(/\s+/gu, ' ');
  if (!value) return { text, last };

  const x = word.bbox.x0 / scale;
  const top = word.bbox.y0 / scale;
  const height = Math.max(1, (word.bbox.y1 - word.bbox.y0) / scale);
  const fontSize = Math.max(6, height * 0.85);
  const sameLine = !!last && Math.abs(top - last.top) < Math.max(height, last.height) * 0.6;
  const latinBoundary = !!last && /[A-Za-z0-9]$/u.test(last.text) && /^[A-Za-z0-9]/u.test(value);
  const separated = !!last && x - last.xEnd > fontSize * 0.3;
  if (last) text += sameLine ? (separated && latinBoundary ? ' ' : '') : '\n';

  const start = text.length;
  text += value;
  const item: PdfTextItem = {
    text: value,
    x,
    y: pageHeight - top - fontSize * 0.8,
    fontSize,
    width: Math.max(1, (word.bbox.x1 - word.bbox.x0) / scale),
  };
  const index = items.length;
  items.push(item);
  segments.push({ start, end: text.length, text: value });
  itemPage.push(pageIndex);
  itemIndex.push(index);
  return { text, last: { text: value, xEnd: word.bbox.x1 / scale, top, height } };
}

function appendBlockWords(
  blocks: Block[],
  scale: number,
  pageHeight: number,
  pageIndex: number,
  text: string,
  items: PdfTextItem[],
  segments: Segment[],
  itemPage: number[],
  itemIndex: number[],
): string {
  let last: LastWord | undefined;
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const next = appendWord(word, scale, pageHeight, text, items, segments, itemPage, itemIndex, pageIndex, last);
          text = next.text;
          last = next.last;
        }
      }
    }
  }
  return text;
}

function appendFallbackText(
  rawText: string,
  pageWidth: number,
  pageHeight: number,
  pageIndex: number,
  text: string,
  items: PdfTextItem[],
  segments: Segment[],
  itemPage: number[],
  itemIndex: number[],
): string {
  const lines = rawText.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
  for (const [lineIndex, value] of lines.entries()) {
    if (text && !text.endsWith('\n')) text += '\n';
    const lineStart = text.length;
    text += value;
    const fontSize = Math.min(14, Math.max(8, pageWidth / Math.max(24, value.length)));
    const itemIndexValue = items.length;
    items.push({ text: value, x: 36, y: pageHeight - 48 - lineIndex * (fontSize + 5), fontSize, width: pageWidth - 72 });
    segments.push({ start: lineStart, end: text.length, text: value });
    itemPage.push(pageIndex);
    itemIndex.push(itemIndexValue);
  }
  return text;
}

/**
 * OCRs image-only PDF pages in the browser and returns the same text/layout contract as the
 * regular PDF parser. The source image is only used as an in-memory canvas and is never copied
 * into the generated output PDF.
 */
export async function parsePdfWithOcr(
  file: File,
  onProgress?: (progress: ParseProgress) => void,
): Promise<LoadedDocument> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const pdf = await task.promise;
  const totalPages = pdf.numPages;
  let currentPage = 0;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;

  try {
    try {
      worker = await createWorker(['chi_tra', 'eng'], 1, {
        logger: (message) => {
          const status = message.status.toLowerCase();
          report(onProgress, {
            stage: status.includes('recogniz') ? 'ocr-recognize' : 'ocr-model',
            page: status.includes('recogniz') ? currentPage : 0,
            totalPages,
            progress: Number.isFinite(message.progress) ? message.progress : undefined,
          });
        },
      });
    } catch (error) {
      const reason = error instanceof Error && error.message ? `（${error.message}）` : '';
      throw new Error(`OCR 引擎或繁中／英文語言模型載入失敗，請確認瀏覽器可連線下載語言模型後重試${reason}`);
    }

    const pages: PdfPage[] = [];
    const segments: Segment[] = [];
    const itemPage: number[] = [];
    const itemIndex: number[] = [];
    let text = '';

    for (let p = 1; p <= totalPages; p++) {
      currentPage = p;
      const page = await pdf.getPage(p);
      const [x0, y0, x1, y1] = page.view;
      const width = x1 - x0;
      const height = y1 - y0;
      const scale = pageScale(width, height);
      const viewport = page.getViewport({ scale, rotation: 0 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('無法建立 OCR 畫布，請改用支援 Canvas 的瀏覽器');

      report(onProgress, { stage: 'ocr-render', page: p, totalPages, progress: 0 });
      await page.render({ canvasContext: context, viewport }).promise;
      report(onProgress, { stage: 'ocr-render', page: p, totalPages, progress: 1 });
      const result = await worker.recognize(canvas, {}, { blocks: true });
      const items: PdfTextItem[] = [];
      text = appendBlockWords(result.data.blocks ?? [], scale, height, p - 1, text, items, segments, itemPage, itemIndex);
      if (items.length === 0) {
        text = appendFallbackText(result.data.text, width, height, p - 1, text, items, segments, itemPage, itemIndex);
      }
      pages.push({ width, height, items });
      if (!text.endsWith('\n')) text += '\n';
      text += '\n';
      canvas.width = 1;
      canvas.height = 1;
      page.cleanup();
    }

    if (text.trim().length === 0) throw new Error('OCR 未辨識到可處理的文字，請確認掃描清晰度或先使用專業 OCR');
    return buildPdfDocument(file.name, text, pages, segments, itemPage, itemIndex);
  } finally {
    if (worker) await worker.terminate();
    await task.destroy();
  }
}
